use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow, bail};
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    CACHE_CONTROL, CONTENT_TYPE, ORIGIN, VARY,
};
use axum::http::{HeaderMap, HeaderValue, Response, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};
use url::Url;
use uuid::Uuid;

use crate::model::{
    AgentReplySubmission, ChatMessage, ChatRole, ChatSubmission, ConversationResponse,
    InboundMessage, MAX_SCREENSHOT_BYTES, MessageManifest, MessageReceipt, PROTOCOL_VERSION,
    ReplyReceipt, SessionDescriptor, TrustBoundary,
};

const WIDGET_SOURCE: &str = include_str!("../web/dist/widget.js");
const MAX_REQUEST_BYTES: usize = 15 * 1024 * 1024;

pub struct SessionConfig {
    pub origin: Url,
    pub port: u16,
    pub output: PathBuf,
    pub session_file: PathBuf,
}

pub enum SessionResult {
    Cancelled,
}

#[derive(Default)]
struct Conversation {
    next_sequence: u64,
    messages: Vec<ChatMessage>,
    inbound: VecDeque<InboundMessage>,
}

#[derive(Clone)]
struct AppState {
    allowed_origin: String,
    endpoint: String,
    session_id: String,
    browser_token: String,
    agent_token: String,
    output: PathBuf,
    conversation: Arc<Mutex<Conversation>>,
    inbound_notify: Arc<Notify>,
    transcript_notify: Arc<Notify>,
}

#[derive(Deserialize)]
struct ConversationQuery {
    #[serde(default)]
    after: u64,
}

pub async fn run_session(config: SessionConfig) -> Result<SessionResult> {
    let allowed_origin = origin_string(&config.origin)?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, config.port))
        .await
        .with_context(|| {
            format!(
                "could not listen on 127.0.0.1:{}; choose another port with --port",
                config.port
            )
        })?;
    let address = listener.local_addr()?;
    let endpoint = format!("http://{}", display_address(address));
    let session_id = Uuid::new_v4().to_string();
    let browser_token = capability_token();
    let agent_token = capability_token();
    let output = absolute_path(&config.output)?;
    let session_file = absolute_path(&config.session_file)?;

    let descriptor = SessionDescriptor {
        version: PROTOCOL_VERSION,
        endpoint: endpoint.clone(),
        session_id: session_id.clone(),
        agent_token: agent_token.clone(),
        allowed_origin: allowed_origin.clone(),
        output_directory: output.display().to_string(),
    };
    write_private_json(&session_file, &descriptor)?;

    let state = AppState {
        allowed_origin: allowed_origin.clone(),
        endpoint: endpoint.clone(),
        session_id,
        browser_token,
        agent_token,
        output,
        conversation: Arc::new(Mutex::new(Conversation::default())),
        inbound_notify: Arc::new(Notify::new()),
        transcript_notify: Arc::new(Notify::new()),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/widget.js", get(widget))
        .route("/messages", post(submit_message).options(browser_preflight))
        .route(
            "/conversation",
            get(conversation).options(browser_preflight),
        )
        .route("/agent/next", get(agent_next))
        .route("/agent/reply", post(agent_reply))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state);

    eprintln!("AgentNudge chat session is ready.");
    eprintln!("Allowed page origin: {allowed_origin}");
    eprintln!("Agent session file: {}", session_file.display());
    eprintln!("Add this development-only script to the page:");
    eprintln!("<script type=\"module\" src=\"{endpoint}/widget.js\"></script>");
    eprintln!("Use `agentnudge next --json` to wait for a message.");
    eprintln!("Press Ctrl-C to stop the session.");

    let result = axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await;

    if let Err(error) = std::fs::remove_file(&session_file)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        eprintln!(
            "Warning: could not remove stale session file {}: {error}",
            session_file.display()
        );
    }
    result.context("the local AgentNudge server failed")?;
    Ok(SessionResult::Cancelled)
}

pub async fn next_message(session_file: &Path) -> Result<InboundMessage> {
    let descriptor = read_descriptor(session_file)?;
    let response = reqwest::Client::new()
        .get(format!("{}/agent/next", descriptor.endpoint))
        .header("x-agentnudge-agent-token", &descriptor.agent_token)
        .send()
        .await
        .context("could not reach the AgentNudge session; start `agentnudge session` first")?;
    parse_response(response).await
}

pub async fn send_reply(
    session_file: &Path,
    message: String,
    in_reply_to: Option<String>,
) -> Result<ReplyReceipt> {
    let descriptor = read_descriptor(session_file)?;
    let submission = AgentReplySubmission {
        message,
        in_reply_to,
    }
    .validate_and_sanitize()
    .map_err(anyhow::Error::msg)?;
    let response = reqwest::Client::new()
        .post(format!("{}/agent/reply", descriptor.endpoint))
        .header("x-agentnudge-agent-token", &descriptor.agent_token)
        .json(&submission)
        .send()
        .await
        .context("could not reach the AgentNudge session; start `agentnudge session` first")?;
    parse_response(response).await
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "status": "ready",
        "version": PROTOCOL_VERSION,
        "sessionId": state.session_id,
        "allowedOrigin": state.allowed_origin,
    }))
}

async fn widget(State(state): State<AppState>) -> Response<Body> {
    let script = WIDGET_SOURCE
        .replace("__AGENTNUDGE_ENDPOINT__", &state.endpoint)
        .replace("__AGENTNUDGE_ORIGIN__", &state.allowed_origin)
        .replace("__AGENTNUDGE_SESSION__", &state.session_id)
        .replace("__AGENTNUDGE_BROWSER_TOKEN__", &state.browser_token);
    let mut response = Response::new(Body::from(script));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/javascript; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    apply_cors_headers(&mut response, &state.allowed_origin);
    response
}

async fn browser_preflight(State(state): State<AppState>, headers: HeaderMap) -> Response<Body> {
    if !valid_origin(&headers, &state.allowed_origin) {
        return json_response(
            &state.allowed_origin,
            StatusCode::FORBIDDEN,
            json!({"error": "origin_not_allowed"}),
        );
    }
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    apply_cors_headers(&mut response, &state.allowed_origin);
    response
}

async fn submit_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(submission): Json<ChatSubmission>,
) -> Response<Body> {
    if let Some(response) = browser_authorization_error(&state, &headers) {
        return response;
    }
    let submission = match submission.validate_and_sanitize(&state.session_id) {
        Ok(value) => value,
        Err(message) => {
            return json_response(
                &state.allowed_origin,
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"error": "invalid_message", "message": message}),
            );
        }
    };

    let message_id = Uuid::new_v4().to_string();
    let received_at_unix_ms = match unix_time_ms() {
        Ok(value) => value,
        Err(error) => {
            return json_response(
                &state.allowed_origin,
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error": "clock_error", "message": error.to_string()}),
            );
        }
    };
    let sequence = {
        let mut conversation = state.conversation.lock().await;
        conversation.next_sequence += 1;
        conversation.next_sequence
    };

    let inbound = match persist_message(
        &submission,
        &state.output,
        &state.session_id,
        &message_id,
        sequence,
        received_at_unix_ms,
    ) {
        Ok(value) => value,
        Err(error) => {
            return json_response(
                &state.allowed_origin,
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error": "persist_failed", "message": error.to_string()}),
            );
        }
    };

    let chat_message = ChatMessage {
        id: message_id.clone(),
        sequence,
        role: ChatRole::User,
        text: submission.text,
        created_at_unix_ms: received_at_unix_ms,
        in_reply_to: None,
        attachments: submission.attachments,
    };
    {
        let mut conversation = state.conversation.lock().await;
        conversation.messages.push(chat_message);
        conversation.inbound.push_back(inbound);
    }
    state.inbound_notify.notify_waiters();
    state.transcript_notify.notify_waiters();

    let receipt = MessageReceipt {
        version: PROTOCOL_VERSION,
        status: "accepted".into(),
        message_id,
        sequence,
    };
    cors_json(&state.allowed_origin, StatusCode::ACCEPTED, &receipt)
}

async fn conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ConversationQuery>,
) -> Response<Body> {
    if let Some(response) = browser_authorization_error(&state, &headers) {
        return response;
    }

    let deadline = Duration::from_secs(20);
    loop {
        let notified = state.transcript_notify.notified();
        let response = {
            let conversation = state.conversation.lock().await;
            let messages: Vec<_> = conversation
                .messages
                .iter()
                .filter(|message| message.sequence > query.after)
                .cloned()
                .collect();
            if messages.is_empty() {
                None
            } else {
                Some(ConversationResponse {
                    version: PROTOCOL_VERSION,
                    cursor: messages.last().map_or(query.after, |value| value.sequence),
                    messages,
                })
            }
        };
        if let Some(response) = response {
            return cors_json(&state.allowed_origin, StatusCode::OK, &response);
        }
        if tokio::time::timeout(deadline, notified).await.is_err() {
            return cors_json(
                &state.allowed_origin,
                StatusCode::OK,
                &ConversationResponse {
                    version: PROTOCOL_VERSION,
                    messages: vec![],
                    cursor: query.after,
                },
            );
        }
    }
}

async fn agent_next(State(state): State<AppState>, headers: HeaderMap) -> Response<Body> {
    if !valid_agent_token(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "invalid_agent_capability"})),
        )
            .into_response();
    }

    loop {
        let notified = state.inbound_notify.notified();
        if let Some(message) = state.conversation.lock().await.inbound.pop_front() {
            return (StatusCode::OK, Json(message)).into_response();
        }
        notified.await;
    }
}

async fn agent_reply(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(submission): Json<AgentReplySubmission>,
) -> Response<Body> {
    if !valid_agent_token(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "invalid_agent_capability"})),
        )
            .into_response();
    }
    let submission = match submission.validate_and_sanitize() {
        Ok(value) => value,
        Err(message) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"error": "invalid_reply", "message": message})),
            )
                .into_response();
        }
    };
    let created_at_unix_ms = match unix_time_ms() {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "clock_error", "message": error.to_string()})),
            )
                .into_response();
        }
    };
    let message_id = Uuid::new_v4().to_string();
    let sequence = {
        let mut conversation = state.conversation.lock().await;
        conversation.next_sequence += 1;
        let sequence = conversation.next_sequence;
        conversation.messages.push(ChatMessage {
            id: message_id.clone(),
            sequence,
            role: ChatRole::Agent,
            text: submission.message,
            created_at_unix_ms,
            in_reply_to: submission.in_reply_to,
            attachments: vec![],
        });
        sequence
    };
    state.transcript_notify.notify_waiters();
    (
        StatusCode::ACCEPTED,
        Json(ReplyReceipt {
            version: PROTOCOL_VERSION,
            status: "accepted".into(),
            message_id,
            sequence,
        }),
    )
        .into_response()
}

fn browser_authorization_error(state: &AppState, headers: &HeaderMap) -> Option<Response<Body>> {
    if !valid_origin(headers, &state.allowed_origin) {
        return Some(json_response(
            &state.allowed_origin,
            StatusCode::FORBIDDEN,
            json!({"error": "origin_not_allowed"}),
        ));
    }
    let supplied_token = headers
        .get("x-agentnudge-token")
        .and_then(|value| value.to_str().ok());
    if supplied_token != Some(state.browser_token.as_str()) {
        return Some(json_response(
            &state.allowed_origin,
            StatusCode::UNAUTHORIZED,
            json!({"error": "invalid_browser_capability"}),
        ));
    }
    None
}

fn valid_agent_token(state: &AppState, headers: &HeaderMap) -> bool {
    headers
        .get("x-agentnudge-agent-token")
        .and_then(|value| value.to_str().ok())
        == Some(state.agent_token.as_str())
}

fn json_response(origin: &str, status: StatusCode, value: serde_json::Value) -> Response<Body> {
    let mut response = (status, Json(value)).into_response();
    apply_cors_headers(&mut response, origin);
    response
}

fn cors_json<T: serde::Serialize>(origin: &str, status: StatusCode, value: &T) -> Response<Body> {
    let mut response = (status, Json(value)).into_response();
    apply_cors_headers(&mut response, origin);
    response
}

fn apply_cors_headers(response: &mut Response<Body>, origin: &str) {
    let headers = response.headers_mut();
    if let Ok(origin) = HeaderValue::from_str(origin) {
        headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    headers.insert(VARY, HeaderValue::from_static("Origin"));
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, X-AgentNudge-Token"),
    );
}

fn valid_origin(headers: &HeaderMap, expected: &str) -> bool {
    headers.get(ORIGIN).and_then(|value| value.to_str().ok()) == Some(expected)
}

fn origin_string(url: &Url) -> Result<String> {
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("--origin must be an absolute http or https URL");
    }
    Ok(url.origin().ascii_serialization())
}

fn display_address(address: SocketAddr) -> String {
    match address {
        SocketAddr::V4(value) => value.to_string(),
        SocketAddr::V6(value) => format!("[{}]:{}", value.ip(), value.port()),
    }
}

fn capability_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn unix_time_ms() -> Result<u128> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("the system clock is before the Unix epoch")?
        .as_millis())
}

fn persist_message(
    submission: &ChatSubmission,
    output_root: &Path,
    session_id: &str,
    message_id: &str,
    sequence: u64,
    received_at_unix_ms: u128,
) -> Result<InboundMessage> {
    let screenshot = decode_screenshot(&submission.screenshot_data_url)?;
    std::fs::create_dir_all(output_root).with_context(|| {
        format!(
            "could not create output directory {}",
            output_root.display()
        )
    })?;

    let message_prefix: String = message_id.chars().take(8).collect();
    let directory_name = format!("{}-{message_prefix}", received_at_unix_ms / 1_000);
    let final_directory = output_root.join(&directory_name);
    let temporary_directory = output_root.join(format!(".{directory_name}.tmp"));
    if final_directory.exists() || temporary_directory.exists() {
        bail!("the message output directory already exists; retry the message");
    }
    std::fs::create_dir(&temporary_directory).with_context(|| {
        format!(
            "could not create temporary output directory {}",
            temporary_directory.display()
        )
    })?;

    let final_screenshot = final_directory.join("screenshot.png");
    let final_manifest = final_directory.join("message.json");
    std::fs::write(temporary_directory.join("screenshot.png"), screenshot)
        .context("could not write the screenshot")?;

    let manifest = MessageManifest {
        version: PROTOCOL_VERSION,
        received_at_unix_ms,
        session_id: session_id.into(),
        message_id: message_id.into(),
        sequence,
        text: submission.text.clone(),
        page: submission.page.clone(),
        attachments: submission.attachments.clone(),
        screenshot_path: final_screenshot.display().to_string(),
        trust: TrustBoundary::untrusted_page(),
    };
    std::fs::write(
        temporary_directory.join("message.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )
    .context("could not write the message manifest")?;
    std::fs::rename(&temporary_directory, &final_directory)
        .context("could not atomically finalize the message bundle")?;

    Ok(InboundMessage {
        version: PROTOCOL_VERSION,
        session_id: session_id.into(),
        message_id: message_id.into(),
        sequence,
        text: submission.text.clone(),
        page_url: submission.page.url.clone(),
        attachments: submission
            .attachments
            .iter()
            .map(|value| value.summarized())
            .collect(),
        manifest_path: final_manifest.display().to_string(),
        screenshot_path: final_screenshot.display().to_string(),
        trust: TrustBoundary::untrusted_page(),
    })
}

fn decode_screenshot(value: &str) -> Result<Vec<u8>> {
    let encoded = value
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| anyhow!("the screenshot is not a PNG data URL"))?;
    let bytes = STANDARD
        .decode(encoded)
        .context("the screenshot is not valid base64")?;
    if bytes.len() > MAX_SCREENSHOT_BYTES {
        bail!("the screenshot exceeds the 10 MiB limit");
    }
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        bail!("the screenshot payload is not a PNG file");
    }
    Ok(bytes)
}

fn absolute_path(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

fn write_private_json(path: &Path, value: &SessionDescriptor) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("could not create {}", parent.display()))?;
    }
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("could not write session descriptor {}", path.display()))?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn read_descriptor(path: &Path) -> Result<SessionDescriptor> {
    let path = absolute_path(path)?;
    let descriptor: SessionDescriptor =
        serde_json::from_slice(&std::fs::read(&path).with_context(|| {
            format!(
                "could not read {}; start `agentnudge session` first",
                path.display()
            )
        })?)
        .context("the AgentNudge session descriptor is invalid")?;
    if descriptor.version != PROTOCOL_VERSION {
        bail!(
            "the session uses protocol version {}, but this CLI expects {}",
            descriptor.version,
            PROTOCOL_VERSION
        );
    }
    let endpoint = Url::parse(&descriptor.endpoint).context("the session endpoint is invalid")?;
    let loopback = endpoint
        .host_str()
        .is_some_and(|host| matches!(host, "127.0.0.1" | "::1" | "localhost"));
    if endpoint.scheme() != "http" || !loopback {
        bail!("the session descriptor does not point to a loopback HTTP endpoint");
    }
    Ok(descriptor)
}

async fn parse_response<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let bytes = response.bytes().await?;
    if !status.is_success() {
        let message = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|value| {
                value
                    .get("message")
                    .or_else(|| value.get("error"))
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| String::from_utf8_lossy(&bytes).into_owned());
        bail!("AgentNudge session returned HTTP {status}: {message}");
    }
    serde_json::from_slice(&bytes).context("the AgentNudge session returned invalid JSON")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AttachmentKind, ContextAttachment, PageContext, Rect, Viewport};

    const ONE_PIXEL_PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    fn submission() -> ChatSubmission {
        ChatSubmission {
            session_id: "12345678-session".into(),
            text: "What does this do?".into(),
            page: PageContext {
                url: "http://localhost:5173/".into(),
                title: "Demo".into(),
                viewport: Viewport {
                    width: 100.0,
                    height: 100.0,
                    scroll_x: 0.0,
                    scroll_y: 0.0,
                },
                device_pixel_ratio: 1.0,
            },
            attachments: vec![ContextAttachment {
                id: "attachment-1".into(),
                kind: AttachmentKind::Region,
                rect: Some(Rect {
                    x: 10.0,
                    y: 20.0,
                    width: 30.0,
                    height: 40.0,
                }),
                element: None,
                strokes: vec![],
            }],
            screenshot_data_url: ONE_PIXEL_PNG.into(),
        }
    }

    fn test_state(output: PathBuf) -> AppState {
        AppState {
            allowed_origin: "http://localhost:5173".into(),
            endpoint: "http://127.0.0.1:4317".into(),
            session_id: "12345678-session".into(),
            browser_token: "browser-secret".into(),
            agent_token: "agent-secret".into(),
            output,
            conversation: Arc::new(Mutex::new(Conversation::default())),
            inbound_notify: Arc::new(Notify::new()),
            transcript_notify: Arc::new(Notify::new()),
        }
    }

    fn browser_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(ORIGIN, HeaderValue::from_static("http://localhost:5173"));
        headers.insert(
            "x-agentnudge-token",
            HeaderValue::from_static("browser-secret"),
        );
        headers
    }

    fn agent_headers(token: &'static str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("x-agentnudge-agent-token", HeaderValue::from_static(token));
        headers
    }

    async fn response_json<T: serde::de::DeserializeOwned>(response: Response<Body>) -> T {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[test]
    fn origin_discards_paths() {
        let value = Url::parse("http://localhost:5173/a/path?secret=yes").unwrap();
        assert_eq!(origin_string(&value).unwrap(), "http://localhost:5173");
    }

    #[test]
    fn persists_an_atomic_message_bundle() {
        let temporary = tempfile::tempdir().unwrap();
        let inbound = persist_message(
            &submission(),
            temporary.path(),
            "12345678-session",
            "message-12345678",
            1,
            1_785_840_000_000,
        )
        .unwrap();
        assert!(Path::new(&inbound.manifest_path).is_file());
        assert!(Path::new(&inbound.screenshot_path).is_file());
        assert_eq!(inbound.attachments.len(), 1);
        assert_eq!(
            inbound.attachments[0].summary,
            "region x=10 y=20 width=30 height=40"
        );
        assert!(
            std::fs::read_to_string(inbound.manifest_path)
                .unwrap()
                .contains("\"pageContent\": \"untrusted\"")
        );
    }

    #[test]
    fn writes_a_private_session_descriptor() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("session.json");
        let descriptor = SessionDescriptor {
            version: PROTOCOL_VERSION,
            endpoint: "http://127.0.0.1:4317".into(),
            session_id: "session".into(),
            agent_token: "secret".into(),
            allowed_origin: "http://localhost:5173".into(),
            output_directory: temporary.path().display().to_string(),
        };
        write_private_json(&path, &descriptor).unwrap();
        assert_eq!(read_descriptor(&path).unwrap().agent_token, "secret");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[tokio::test]
    async fn carries_a_browser_message_through_agent_reply_and_transcript() {
        let temporary = tempfile::tempdir().unwrap();
        let state = test_state(temporary.path().to_path_buf());

        let submitted =
            submit_message(State(state.clone()), browser_headers(), Json(submission())).await;
        assert_eq!(submitted.status(), StatusCode::ACCEPTED);
        let submitted: MessageReceipt = response_json(submitted).await;

        let next = agent_next(State(state.clone()), agent_headers("agent-secret")).await;
        assert_eq!(next.status(), StatusCode::OK);
        let next: InboundMessage = response_json(next).await;
        assert_eq!(next.message_id, submitted.message_id);
        assert_eq!(next.attachments.len(), 1);
        assert!(Path::new(&next.manifest_path).is_file());

        let replied = agent_reply(
            State(state.clone()),
            agent_headers("agent-secret"),
            Json(AgentReplySubmission {
                message: "It starts onboarding.".into(),
                in_reply_to: Some(submitted.message_id.clone()),
            }),
        )
        .await;
        assert_eq!(replied.status(), StatusCode::ACCEPTED);

        let transcript = conversation(
            State(state),
            browser_headers(),
            Query(ConversationQuery { after: 0 }),
        )
        .await;
        assert_eq!(transcript.status(), StatusCode::OK);
        let transcript: ConversationResponse = response_json(transcript).await;
        assert_eq!(transcript.messages.len(), 2);
        assert!(matches!(transcript.messages[0].role, ChatRole::User));
        assert!(matches!(transcript.messages[1].role, ChatRole::Agent));
        assert_eq!(
            transcript.messages[1].in_reply_to.as_deref(),
            Some(submitted.message_id.as_str())
        );
    }

    #[tokio::test]
    async fn browser_capability_cannot_author_agent_replies() {
        let temporary = tempfile::tempdir().unwrap();
        let state = test_state(temporary.path().to_path_buf());
        let response = agent_reply(
            State(state),
            agent_headers("browser-secret"),
            Json(AgentReplySubmission {
                message: "forged".into(),
                in_reply_to: None,
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
