use std::collections::{HashMap, VecDeque};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow, bail};
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path as AxumPath, Query, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    CACHE_CONTROL, CONTENT_TYPE, ORIGIN, VARY, X_CONTENT_TYPE_OPTIONS,
};
use axum::http::{HeaderMap, HeaderValue, Response, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify, oneshot};
use tokio::time::Instant;
use url::Url;
use uuid::Uuid;

use crate::model::{
    AgentReplyImageUpload, AgentReplySubmission, BrowserAction, BrowserActionRequest,
    BrowserActionResponse, BrowserCommand, BrowserCommandPollResponse,
    BrowserCommandResultSubmission, BrowserPage, BrowserPagesResponse, ChatMessage, ChatRole,
    ChatSubmission, ConversationResponse, InboundMessage, MAX_BROWSER_FILL_CHARS,
    MAX_BROWSER_RESULT_BYTES, MAX_BROWSER_SELECTOR_CHARS, MAX_REPLY_IMAGE_ATTACHMENTS,
    MAX_REPLY_IMAGE_BYTES, MAX_REPLY_IMAGE_TOTAL_BYTES, MAX_SCREENSHOT_BYTES, MessageManifest,
    MessageReceipt, PROTOCOL_VERSION, ReplyImageAttachment, ReplyReceipt, TrustBoundary,
};

const WIDGET_SOURCE: &str = include_str!("../web/dist/widget.js");
const MAX_REQUEST_BYTES: usize = 15 * 1024 * 1024;
const DEFAULT_BROKER_PORT: u16 = 4317;
const MAX_WAIT: Duration = Duration::from_secs(24 * 60 * 60);
const BROWSER_PAGE_STALE_AFTER: Duration = Duration::from_secs(45);
const BROWSER_COMMAND_POLL: Duration = Duration::from_secs(20);
const NATO_WORDS: [&str; 26] = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliett",
    "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango",
    "uniform", "victor", "whiskey", "xray", "yankee", "zulu",
];

#[derive(Clone, Debug)]
pub struct SessionConfig {
    pub origin: Url,
    pub output: PathBuf,
    pub allow_browser_control: bool,
}

#[derive(Clone, Debug)]
pub struct BrokerConfig {
    pub port: u16,
    pub descriptor_file: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreated {
    pub version: u8,
    pub status: String,
    pub session: String,
    pub widget_url: String,
    pub script_tag: String,
    pub browser_control_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitResponse {
    pub version: u8,
    pub status: String,
    pub session: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<InboundMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waited_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndSessionReceipt {
    pub version: u8,
    pub status: String,
    pub session: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokerDescriptor {
    version: u8,
    endpoint: String,
    agent_token: String,
    pid: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionRequest {
    origin: String,
    output_directory: String,
    #[serde(default)]
    allow_browser_control: bool,
}

#[derive(Deserialize)]
struct ConversationQuery {
    #[serde(default)]
    after: u64,
}

#[derive(Deserialize)]
struct WaitQuery {
    timeout_ms: u64,
}

#[derive(Deserialize)]
struct BrowserCommandQuery {
    page_id: String,
    url: String,
    title: String,
}

#[derive(Default)]
struct Conversation {
    next_sequence: u64,
    messages: Vec<ChatMessage>,
    inbound: VecDeque<InboundMessage>,
}

#[derive(Clone)]
struct SessionState {
    allowed_origin: String,
    endpoint: String,
    session_id: String,
    browser_token: String,
    output: PathBuf,
    conversation: Arc<Mutex<Conversation>>,
    reply_assets: Arc<Mutex<HashMap<String, StoredReplyAsset>>>,
    inbound_notify: Arc<Notify>,
    transcript_notify: Arc<Notify>,
    browser_control_enabled: bool,
    browser_control: Arc<Mutex<BrowserControlState>>,
    browser_command_notify: Arc<Notify>,
    ended: Arc<AtomicBool>,
}

#[derive(Default)]
struct BrowserControlState {
    pages: HashMap<String, BrowserPage>,
    commands: VecDeque<BrowserCommand>,
    pending: HashMap<String, PendingBrowserCommand>,
}

struct PendingBrowserCommand {
    page_id: String,
    fill_characters: Option<usize>,
    sender: oneshot::Sender<BrowserCommandResultSubmission>,
}

#[derive(Clone)]
struct StoredReplyAsset {
    path: PathBuf,
    media_type: String,
}

struct PreparedAgentReply {
    message: String,
    in_reply_to: Option<String>,
    attachments: Vec<PreparedReplyImage>,
}

struct PreparedReplyImage {
    file_name: String,
    media_type: String,
    bytes: Vec<u8>,
}

struct PersistedReplyImages {
    metadata: Vec<ReplyImageAttachment>,
    assets: Vec<(String, StoredReplyAsset)>,
}

#[derive(Clone)]
struct BrokerState {
    endpoint: String,
    agent_token: String,
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
}

impl BrokerState {
    fn new(endpoint: String, agent_token: String) -> Self {
        Self {
            endpoint,
            agent_token,
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub async fn start_session(config: SessionConfig) -> Result<SessionCreated> {
    let descriptor = ensure_broker().await?;
    let output = absolute_path(&config.output)?;
    let request = CreateSessionRequest {
        origin: origin_string(&config.origin)?,
        output_directory: output.display().to_string(),
        allow_browser_control: config.allow_browser_control,
    };
    let response = agent_client(Duration::from_secs(10))?
        .post(format!("{}/agent/sessions", descriptor.endpoint))
        .header("x-agentnudge-agent-token", &descriptor.agent_token)
        .json(&request)
        .send()
        .await
        .context("could not create an AgentNudge session")?;
    parse_response(response).await
}

pub async fn wait_for_message(session: &str, duration: Duration) -> Result<WaitResponse> {
    validate_wait(duration)?;
    let session = validate_session_id(session)?;
    let descriptor = live_broker().await?;
    wait_with_descriptor(&descriptor, &session, duration).await
}

pub async fn list_browser_pages(session: &str) -> Result<BrowserPagesResponse> {
    let session = validate_session_id(session)?;
    let descriptor = live_broker().await?;
    let response = agent_client(Duration::from_secs(10))?
        .get(format!(
            "{}/agent/sessions/{session}/browser/pages",
            descriptor.endpoint
        ))
        .header("x-agentnudge-agent-token", &descriptor.agent_token)
        .send()
        .await
        .context("could not list connected AgentNudge pages")?;
    parse_response(response).await
}

pub async fn run_browser_action(
    session: &str,
    page_id: Option<String>,
    duration: Duration,
    action: BrowserAction,
) -> Result<BrowserActionResponse> {
    validate_wait(duration)?;
    if duration.is_zero() {
        bail!("browser actions need a duration greater than zero");
    }
    let session = validate_session_id(session)?;
    let descriptor = live_broker().await?;
    let timeout_ms = u64::try_from(duration.as_millis()).unwrap_or(u64::MAX);
    let response = agent_client(duration.saturating_add(Duration::from_secs(10)))?
        .post(format!(
            "{}/agent/sessions/{session}/browser/actions",
            descriptor.endpoint
        ))
        .query(&[("timeout_ms", timeout_ms)])
        .header("x-agentnudge-agent-token", &descriptor.agent_token)
        .json(&BrowserActionRequest { page_id, action })
        .send()
        .await
        .context("could not run the AgentNudge browser action")?;
    parse_response(response).await
}

pub async fn reply_and_wait(
    session: &str,
    duration: Duration,
    message: String,
    in_reply_to: Option<String>,
    attachment_paths: Vec<PathBuf>,
) -> Result<WaitResponse> {
    validate_wait(duration)?;
    let session = validate_session_id(session)?;
    let attachments = load_reply_image_uploads(&attachment_paths)?;
    let submission = AgentReplySubmission {
        message,
        in_reply_to,
        attachments,
    }
    .validate_and_sanitize()
    .map_err(anyhow::Error::msg)?;
    let descriptor = live_broker().await?;
    let response = agent_client(Duration::from_secs(10))?
        .post(format!(
            "{}/agent/sessions/{session}/reply",
            descriptor.endpoint
        ))
        .header("x-agentnudge-agent-token", &descriptor.agent_token)
        .json(&submission)
        .send()
        .await
        .context("could not send the AgentNudge reply")?;
    let _: ReplyReceipt = parse_response(response).await?;
    wait_with_descriptor(&descriptor, &session, duration).await
}

pub fn load_reply_image_uploads(paths: &[PathBuf]) -> Result<Vec<AgentReplyImageUpload>> {
    if paths.len() > MAX_REPLY_IMAGE_ATTACHMENTS {
        bail!("a reply can attach at most {MAX_REPLY_IMAGE_ATTACHMENTS} images");
    }

    let mut uploads = Vec::with_capacity(paths.len());
    let mut total_bytes = 0usize;
    for path in paths {
        let metadata = std::fs::metadata(path)
            .with_context(|| format!("could not read reply image {}", path.display()))?;
        if !metadata.is_file() {
            bail!("reply attachment {} is not a regular file", path.display());
        }
        if metadata.len() > MAX_REPLY_IMAGE_BYTES as u64 {
            bail!(
                "reply image {} exceeds the {} MiB per-file limit",
                path.display(),
                MAX_REPLY_IMAGE_BYTES / (1024 * 1024)
            );
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                anyhow!(
                    "reply image {} has no usable UTF-8 file name",
                    path.display()
                )
            })?
            .to_string();
        let mut file = std::fs::File::open(path)
            .with_context(|| format!("could not open reply image {}", path.display()))?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        Read::by_ref(&mut file)
            .take((MAX_REPLY_IMAGE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .with_context(|| format!("could not read reply image {}", path.display()))?;
        if bytes.len() > MAX_REPLY_IMAGE_BYTES {
            bail!(
                "reply image {} exceeds the {} MiB per-file limit",
                path.display(),
                MAX_REPLY_IMAGE_BYTES / (1024 * 1024)
            );
        }
        let media_type = detect_reply_image_type(&bytes).ok_or_else(|| {
            anyhow!(
                "reply attachment {} is not a supported PNG or JPEG image",
                path.display()
            )
        })?;
        validate_image_extension(&file_name, media_type)?;
        total_bytes = total_bytes.saturating_add(bytes.len());
        if total_bytes > MAX_REPLY_IMAGE_TOTAL_BYTES {
            bail!(
                "reply images exceed the {} MiB aggregate limit",
                MAX_REPLY_IMAGE_TOTAL_BYTES / (1024 * 1024)
            );
        }
        uploads.push(AgentReplyImageUpload {
            file_name,
            media_type: media_type.into(),
            data_base64: STANDARD.encode(bytes),
        });
    }
    Ok(uploads)
}

pub async fn end_session(session: &str) -> Result<EndSessionReceipt> {
    let session = validate_session_id(session)?;
    let descriptor = live_broker().await?;
    let response = agent_client(Duration::from_secs(10))?
        .delete(format!("{}/agent/sessions/{session}", descriptor.endpoint))
        .header("x-agentnudge-agent-token", &descriptor.agent_token)
        .send()
        .await
        .context("could not end the AgentNudge session")?;
    parse_response(response).await
}

pub async fn run_broker(config: BrokerConfig) -> Result<()> {
    let descriptor_file = absolute_path(&config.descriptor_file)?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, config.port))
        .await
        .with_context(|| {
            format!(
                "could not listen on 127.0.0.1:{}; another process may already own the AgentNudge broker port",
                config.port
            )
        })?;
    let address = listener.local_addr()?;
    let endpoint = format!("http://{}", display_address(address));
    let descriptor = BrokerDescriptor {
        version: PROTOCOL_VERSION,
        endpoint: endpoint.clone(),
        agent_token: capability_token(),
        pid: std::process::id(),
    };
    write_private_json(&descriptor_file, &descriptor)?;

    let state = BrokerState::new(endpoint.clone(), descriptor.agent_token.clone());
    eprintln!("AgentNudge broker ready on {endpoint}");
    let result = axum::serve(listener, broker_router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await;

    remove_descriptor_if_owned(&descriptor_file, &descriptor.agent_token);
    result.context("the local AgentNudge broker failed")
}

fn broker_router(state: BrokerState) -> Router {
    Router::new()
        .route("/agent/health", get(agent_health))
        .route("/agent/sessions", post(create_session))
        .route("/agent/sessions/{session_id}", delete(delete_session))
        .route("/agent/sessions/{session_id}/wait", get(agent_wait))
        .route("/agent/sessions/{session_id}/reply", post(agent_reply))
        .route(
            "/agent/sessions/{session_id}/browser/pages",
            get(agent_browser_pages),
        )
        .route(
            "/agent/sessions/{session_id}/browser/actions",
            post(agent_browser_action),
        )
        .route("/{session_id}/widget.js", get(widget))
        .route(
            "/{session_id}/messages",
            post(submit_message).options(browser_preflight),
        )
        .route(
            "/{session_id}/conversation",
            get(conversation).options(browser_preflight),
        )
        .route(
            "/{session_id}/browser/commands",
            get(browser_commands).options(browser_preflight),
        )
        .route(
            "/{session_id}/browser/commands/{command_id}",
            post(browser_command_result).options(browser_command_result_preflight),
        )
        .route(
            "/{session_id}/reply-assets/{attachment_id}",
            get(reply_asset).options(reply_asset_preflight),
        )
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

async fn agent_health(State(state): State<BrokerState>, headers: HeaderMap) -> Response<Body> {
    if !valid_agent_token(&state, &headers) {
        return agent_unauthorized();
    }
    let active_sessions = state.sessions.lock().await.len();
    (
        StatusCode::OK,
        Json(json!({
            "status": "ready",
            "version": PROTOCOL_VERSION,
            "activeSessions": active_sessions,
        })),
    )
        .into_response()
}

async fn create_session(
    State(state): State<BrokerState>,
    headers: HeaderMap,
    Json(request): Json<CreateSessionRequest>,
) -> Response<Body> {
    if !valid_agent_token(&state, &headers) {
        return agent_unauthorized();
    }
    let origin = match Url::parse(&request.origin)
        .context("the session origin is invalid")
        .and_then(|value| origin_string(&value))
    {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"error": "invalid_origin", "message": error.to_string()})),
            )
                .into_response();
        }
    };
    let output = PathBuf::from(request.output_directory);
    if !output.is_absolute() {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({
                "error": "invalid_output_directory",
                "message": "the output directory must be absolute"
            })),
        )
            .into_response();
    }

    match register_session(&state, origin, output, request.allow_browser_control).await {
        Ok(created) => (StatusCode::CREATED, Json(created)).into_response(),
        Err(error) => (
            StatusCode::CONFLICT,
            Json(json!({"error": "session_limit", "message": error.to_string()})),
        )
            .into_response(),
    }
}

async fn register_session(
    broker: &BrokerState,
    allowed_origin: String,
    output_root: PathBuf,
    browser_control_enabled: bool,
) -> Result<SessionCreated> {
    let mut sessions = broker.sessions.lock().await;
    let session_id = allocate_session_id(&sessions)?;
    let endpoint = format!("{}/{}", broker.endpoint, session_id);
    let widget_url = format!("{endpoint}/widget.js");
    sessions.insert(
        session_id.clone(),
        SessionState {
            allowed_origin,
            endpoint,
            session_id: session_id.clone(),
            browser_token: capability_token(),
            output: output_root.join(&session_id),
            conversation: Arc::new(Mutex::new(Conversation::default())),
            reply_assets: Arc::new(Mutex::new(HashMap::new())),
            inbound_notify: Arc::new(Notify::new()),
            transcript_notify: Arc::new(Notify::new()),
            browser_control_enabled,
            browser_control: Arc::new(Mutex::new(BrowserControlState::default())),
            browser_command_notify: Arc::new(Notify::new()),
            ended: Arc::new(AtomicBool::new(false)),
        },
    );
    Ok(SessionCreated {
        version: PROTOCOL_VERSION,
        status: "ready".into(),
        session: session_id,
        script_tag: format!("<script type=\"module\" src=\"{widget_url}\"></script>"),
        widget_url,
        browser_control_enabled,
    })
}

async fn delete_session(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
) -> Response<Body> {
    if !valid_agent_token(&state, &headers) {
        return agent_unauthorized();
    }
    let session_id = match validate_session_id(&session_id) {
        Ok(value) => value,
        Err(error) => return agent_bad_request(error.to_string()),
    };
    let removed = state.sessions.lock().await.remove(&session_id);
    let Some(session) = removed else {
        return agent_not_found(&session_id);
    };
    session.ended.store(true, Ordering::Release);
    {
        let mut browser = session.browser_control.lock().await;
        browser.commands.clear();
        browser.pending.clear();
        browser.pages.clear();
    }
    session.inbound_notify.notify_waiters();
    session.transcript_notify.notify_waiters();
    session.browser_command_notify.notify_waiters();
    (
        StatusCode::OK,
        Json(EndSessionReceipt {
            version: PROTOCOL_VERSION,
            status: "ended".into(),
            session: session_id,
        }),
    )
        .into_response()
}

async fn agent_wait(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
    Query(query): Query<WaitQuery>,
) -> Response<Body> {
    if !valid_agent_token(&state, &headers) {
        return agent_unauthorized();
    }
    let duration = Duration::from_millis(query.timeout_ms);
    if let Err(error) = validate_wait(duration) {
        return agent_bad_request(error.to_string());
    }
    let Some(session) = find_session(&state, &session_id).await else {
        return agent_not_found(&session_id);
    };
    (
        StatusCode::OK,
        Json(wait_on_session(&session, duration).await),
    )
        .into_response()
}

async fn agent_reply(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
    Json(submission): Json<AgentReplySubmission>,
) -> Response<Body> {
    if !valid_agent_token(&state, &headers) {
        return agent_unauthorized();
    }
    let Some(session) = find_session(&state, &session_id).await else {
        return agent_not_found(&session_id);
    };
    let submission = match prepare_agent_reply(submission) {
        Ok(value) => value,
        Err(message) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"error": "invalid_reply", "message": message})),
            )
                .into_response();
        }
    };
    match record_agent_reply(&session, submission).await {
        Ok(receipt) => (StatusCode::ACCEPTED, Json(receipt)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "reply_failed", "message": error.to_string()})),
        )
            .into_response(),
    }
}

async fn agent_browser_pages(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
) -> Response<Body> {
    if !valid_agent_token(&state, &headers) {
        return agent_unauthorized();
    }
    let Some(session) = find_session(&state, &session_id).await else {
        return agent_not_found(&session_id);
    };
    if !session.browser_control_enabled {
        return browser_control_disabled();
    }
    let now = match unix_time_ms_u64() {
        Ok(value) => value,
        Err(error) => return agent_bad_request(error.to_string()),
    };
    let mut browser = session.browser_control.lock().await;
    prune_stale_browser_pages(&mut browser, now);
    let mut pages: Vec<_> = browser.pages.values().cloned().collect();
    pages.sort_by(|first, second| first.page_id.cmp(&second.page_id));
    (
        StatusCode::OK,
        Json(BrowserPagesResponse {
            version: PROTOCOL_VERSION,
            status: "ready".into(),
            session: session.session_id,
            pages,
            trust: TrustBoundary::untrusted_page(),
        }),
    )
        .into_response()
}

async fn agent_browser_action(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
    Query(query): Query<WaitQuery>,
    Json(mut request): Json<BrowserActionRequest>,
) -> Response<Body> {
    if !valid_agent_token(&state, &headers) {
        return agent_unauthorized();
    }
    let duration = Duration::from_millis(query.timeout_ms);
    if duration.is_zero() {
        return agent_bad_request("browser actions need a duration greater than zero".into());
    }
    if let Err(error) = validate_wait(duration) {
        return agent_bad_request(error.to_string());
    }
    let Some(session) = find_session(&state, &session_id).await else {
        return agent_not_found(&session_id);
    };
    if !session.browser_control_enabled {
        return browser_control_disabled();
    }
    if let Err(error) = validate_browser_action(&mut request.action, &session.allowed_origin) {
        return agent_bad_request(error.to_string());
    }
    let now = match unix_time_ms_u64() {
        Ok(value) => value,
        Err(error) => return agent_bad_request(error.to_string()),
    };
    let started = Instant::now();
    let command_id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    let fill_characters = match &request.action {
        BrowserAction::Fill { text, .. } => Some(text.chars().count()),
        _ => None,
    };
    let page_id = {
        let mut browser = session.browser_control.lock().await;
        prune_stale_browser_pages(&mut browser, now);
        let page_id = match select_browser_page(&browser, request.page_id.as_deref()) {
            Ok(value) => value,
            Err(error) => return agent_bad_request(error.to_string()),
        };
        let expires_at_unix_ms = now.saturating_add(query.timeout_ms);
        browser.commands.push_back(BrowserCommand {
            version: PROTOCOL_VERSION,
            command_id: command_id.clone(),
            session: session.session_id.clone(),
            page_id: page_id.clone(),
            expires_at_unix_ms,
            action: request.action,
        });
        browser.pending.insert(
            command_id.clone(),
            PendingBrowserCommand {
                page_id: page_id.clone(),
                fill_characters,
                sender,
            },
        );
        page_id
    };
    session.browser_command_notify.notify_waiters();

    match tokio::time::timeout(duration, receiver).await {
        Ok(Ok(result)) => (
            StatusCode::OK,
            Json(BrowserActionResponse {
                version: PROTOCOL_VERSION,
                status: result.status,
                session: session.session_id,
                command_id: Some(command_id),
                page_id: Some(page_id),
                value: result.value,
                error: result.error,
                current_url: Some(result.current_url),
                title: Some(result.title),
                waited_ms: elapsed_ms(started.elapsed()),
                trust: TrustBoundary::untrusted_page(),
            }),
        )
            .into_response(),
        Ok(Err(_)) => (
            StatusCode::OK,
            Json(BrowserActionResponse {
                version: PROTOCOL_VERSION,
                status: "ended".into(),
                session: session.session_id,
                command_id: Some(command_id),
                page_id: Some(page_id),
                value: None,
                error: Some("the AgentNudge session ended before the action completed".into()),
                current_url: None,
                title: None,
                waited_ms: elapsed_ms(started.elapsed()),
                trust: TrustBoundary::untrusted_page(),
            }),
        )
            .into_response(),
        Err(_) => {
            let mut browser = session.browser_control.lock().await;
            browser.pending.remove(&command_id);
            browser
                .commands
                .retain(|command| command.command_id != command_id);
            drop(browser);
            (
                StatusCode::OK,
                Json(BrowserActionResponse {
                    version: PROTOCOL_VERSION,
                    status: "timeout".into(),
                    session: session.session_id,
                    command_id: Some(command_id),
                    page_id: Some(page_id),
                    value: None,
                    error: None,
                    current_url: None,
                    title: None,
                    waited_ms: elapsed_ms(started.elapsed()),
                    trust: TrustBoundary::untrusted_page(),
                }),
            )
                .into_response()
        }
    }
}

async fn record_agent_reply(
    state: &SessionState,
    submission: PreparedAgentReply,
) -> Result<ReplyReceipt> {
    let created_at_unix_ms = unix_time_ms()?;
    let message_id = Uuid::new_v4().to_string();
    let persisted = persist_reply_images(state, &message_id, submission.attachments)?;
    state.reply_assets.lock().await.extend(persisted.assets);
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
            image_attachments: persisted.metadata,
        });
        sequence
    };
    state.transcript_notify.notify_waiters();
    Ok(ReplyReceipt {
        version: PROTOCOL_VERSION,
        status: "accepted".into(),
        message_id,
        sequence,
    })
}

fn prepare_agent_reply(submission: AgentReplySubmission) -> Result<PreparedAgentReply, String> {
    let submission = submission.validate_and_sanitize()?;
    let mut total_bytes = 0usize;
    let mut attachments = Vec::with_capacity(submission.attachments.len());
    for attachment in submission.attachments {
        let bytes = STANDARD
            .decode(&attachment.data_base64)
            .map_err(|_| format!("reply image `{}` is not valid base64", attachment.file_name))?;
        if bytes.len() > MAX_REPLY_IMAGE_BYTES {
            return Err(format!(
                "reply image `{}` exceeds the {} MiB per-file limit",
                attachment.file_name,
                MAX_REPLY_IMAGE_BYTES / (1024 * 1024)
            ));
        }
        total_bytes = total_bytes.saturating_add(bytes.len());
        if total_bytes > MAX_REPLY_IMAGE_TOTAL_BYTES {
            return Err(format!(
                "reply images exceed the {} MiB aggregate limit",
                MAX_REPLY_IMAGE_TOTAL_BYTES / (1024 * 1024)
            ));
        }
        let detected = detect_reply_image_type(&bytes).ok_or_else(|| {
            format!(
                "reply attachment `{}` is not a supported PNG or JPEG image",
                attachment.file_name
            )
        })?;
        if detected != attachment.media_type {
            return Err(format!(
                "reply image `{}` does not match its declared media type",
                attachment.file_name
            ));
        }
        validate_image_extension(&attachment.file_name, detected)
            .map_err(|error| error.to_string())?;
        attachments.push(PreparedReplyImage {
            file_name: attachment.file_name,
            media_type: detected.into(),
            bytes,
        });
    }
    Ok(PreparedAgentReply {
        message: submission.message,
        in_reply_to: submission.in_reply_to,
        attachments,
    })
}

fn persist_reply_images(
    state: &SessionState,
    message_id: &str,
    images: Vec<PreparedReplyImage>,
) -> Result<PersistedReplyImages> {
    if images.is_empty() {
        return Ok(PersistedReplyImages {
            metadata: vec![],
            assets: vec![],
        });
    }

    let reply_root = state.output.join("replies");
    std::fs::create_dir_all(&reply_root).with_context(|| {
        format!(
            "could not create reply image directory {}",
            reply_root.display()
        )
    })?;
    let final_directory = reply_root.join(message_id);
    let temporary_directory = reply_root.join(format!(".{message_id}.tmp"));
    if final_directory.exists() || temporary_directory.exists() {
        bail!("the reply image directory already exists; retry the reply");
    }
    std::fs::create_dir(&temporary_directory).with_context(|| {
        format!(
            "could not create temporary reply image directory {}",
            temporary_directory.display()
        )
    })?;

    let result = (|| {
        let mut metadata = Vec::with_capacity(images.len());
        let mut stored = Vec::with_capacity(images.len());
        for image in images {
            let attachment_id = Uuid::new_v4().to_string();
            let extension = match image.media_type.as_str() {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                _ => unreachable!("reply image type was validated before persistence"),
            };
            let stored_name = format!("{attachment_id}.{extension}");
            let temporary_path = temporary_directory.join(&stored_name);
            let final_path = final_directory.join(&stored_name);
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o400);
            }
            let mut file = options.open(&temporary_path).with_context(|| {
                format!("could not create reply image {}", temporary_path.display())
            })?;
            file.write_all(&image.bytes).with_context(|| {
                format!("could not write reply image {}", temporary_path.display())
            })?;
            file.sync_all().with_context(|| {
                format!(
                    "could not finalize reply image {}",
                    temporary_path.display()
                )
            })?;
            let size_bytes = image.bytes.len();
            metadata.push(ReplyImageAttachment {
                id: attachment_id.clone(),
                file_name: image.file_name,
                media_type: image.media_type.clone(),
                size_bytes,
                asset_path: format!("/{}/reply-assets/{attachment_id}", state.session_id),
            });
            stored.push((
                attachment_id,
                StoredReplyAsset {
                    path: final_path,
                    media_type: image.media_type,
                },
            ));
        }
        std::fs::rename(&temporary_directory, &final_directory)
            .context("could not atomically finalize the reply images")?;
        Ok(PersistedReplyImages {
            metadata,
            assets: stored,
        })
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&temporary_directory);
    }
    result
}

async fn widget(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
) -> Response<Body> {
    let Some(session) = find_session(&state, &session_id).await else {
        return (StatusCode::NOT_FOUND, "AgentNudge session not found").into_response();
    };
    if !valid_origin(&headers, &session.allowed_origin) {
        return json_response(
            &session.allowed_origin,
            StatusCode::FORBIDDEN,
            json!({"error": "origin_not_allowed"}),
        );
    }
    let script = WIDGET_SOURCE
        .replace("__AGENTNUDGE_ENDPOINT__", &session.endpoint)
        .replace("__AGENTNUDGE_ORIGIN__", &session.allowed_origin)
        .replace("__AGENTNUDGE_SESSION__", &session.session_id)
        .replace("__AGENTNUDGE_BROWSER_TOKEN__", &session.browser_token)
        .replace(
            "__AGENTNUDGE_BROWSER_CONTROL__",
            if session.browser_control_enabled {
                "true"
            } else {
                "false"
            },
        );
    let mut response = Response::new(Body::from(script));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/javascript; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    apply_cors_headers(&mut response, &session.allowed_origin);
    response
}

async fn browser_preflight(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
) -> Response<Body> {
    let Some(session) = find_session(&state, &session_id).await else {
        return (StatusCode::NOT_FOUND, Body::empty()).into_response();
    };
    if !valid_origin(&headers, &session.allowed_origin) {
        return json_response(
            &session.allowed_origin,
            StatusCode::FORBIDDEN,
            json!({"error": "origin_not_allowed"}),
        );
    }
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    apply_cors_headers(&mut response, &session.allowed_origin);
    response
}

async fn reply_asset_preflight(
    AxumPath((session_id, _attachment_id)): AxumPath<(String, String)>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
) -> Response<Body> {
    let Some(session) = find_session(&state, &session_id).await else {
        return (StatusCode::NOT_FOUND, Body::empty()).into_response();
    };
    if !valid_origin(&headers, &session.allowed_origin) {
        return json_response(
            &session.allowed_origin,
            StatusCode::FORBIDDEN,
            json!({"error": "origin_not_allowed"}),
        );
    }
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    apply_cors_headers(&mut response, &session.allowed_origin);
    response
}

async fn browser_command_result_preflight(
    AxumPath((session_id, _command_id)): AxumPath<(String, String)>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
) -> Response<Body> {
    let Some(session) = find_session(&state, &session_id).await else {
        return (StatusCode::NOT_FOUND, Body::empty()).into_response();
    };
    if !valid_origin(&headers, &session.allowed_origin) {
        return json_response(
            &session.allowed_origin,
            StatusCode::FORBIDDEN,
            json!({"error": "origin_not_allowed"}),
        );
    }
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    apply_cors_headers(&mut response, &session.allowed_origin);
    response
}

async fn reply_asset(
    AxumPath((session_id, attachment_id)): AxumPath<(String, String)>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
) -> Response<Body> {
    let Some(session) = find_session(&state, &session_id).await else {
        return (StatusCode::NOT_FOUND, Body::empty()).into_response();
    };
    if let Some(response) = browser_authorization_error(&session, &headers) {
        return response;
    }
    let asset = session
        .reply_assets
        .lock()
        .await
        .get(&attachment_id)
        .cloned();
    let Some(asset) = asset else {
        return json_response(
            &session.allowed_origin,
            StatusCode::NOT_FOUND,
            json!({"error": "reply_asset_not_found"}),
        );
    };
    let bytes = match std::fs::read(&asset.path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return json_response(
                &session.allowed_origin,
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error": "reply_asset_unavailable", "message": error.to_string()}),
            );
        }
    };
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&asset.media_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    response
        .headers_mut()
        .insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    apply_cors_headers(&mut response, &session.allowed_origin);
    response
        .headers_mut()
        .insert(VARY, HeaderValue::from_static("Origin, X-AgentNudge-Token"));
    response
}

async fn browser_commands(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
    Query(query): Query<BrowserCommandQuery>,
) -> Response<Body> {
    let Some(session) = find_session(&state, &session_id).await else {
        return (StatusCode::NOT_FOUND, Body::empty()).into_response();
    };
    if let Some(response) = browser_authorization_error(&session, &headers) {
        return response;
    }
    if !session.browser_control_enabled {
        return json_response(
            &session.allowed_origin,
            StatusCode::CONFLICT,
            json!({"error": "browser_control_disabled"}),
        );
    }
    let page = match browser_page_from_query(&query, &session.allowed_origin) {
        Ok(value) => value,
        Err(error) => {
            return json_response(
                &session.allowed_origin,
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"error": "invalid_browser_page", "message": error.to_string()}),
            );
        }
    };

    {
        let mut browser = session.browser_control.lock().await;
        browser.pages.insert(page.page_id.clone(), page.clone());
    }

    loop {
        let notified = session.browser_command_notify.notified();
        let command = {
            let now = unix_time_ms_u64().unwrap_or(u64::MAX);
            let mut browser = session.browser_control.lock().await;
            browser
                .commands
                .retain(|command| command.expires_at_unix_ms > now);
            browser
                .commands
                .iter()
                .position(|command| command.page_id == page.page_id)
                .and_then(|position| browser.commands.remove(position))
        };
        if let Some(command) = command {
            return cors_json(
                &session.allowed_origin,
                StatusCode::OK,
                &BrowserCommandPollResponse {
                    version: PROTOCOL_VERSION,
                    status: "command".into(),
                    command: Some(command),
                },
            );
        }
        if tokio::time::timeout(BROWSER_COMMAND_POLL, notified)
            .await
            .is_err()
        {
            return cors_json(
                &session.allowed_origin,
                StatusCode::OK,
                &BrowserCommandPollResponse {
                    version: PROTOCOL_VERSION,
                    status: "idle".into(),
                    command: None,
                },
            );
        }
    }
}

async fn browser_command_result(
    AxumPath((session_id, command_id)): AxumPath<(String, String)>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
    Json(result): Json<BrowserCommandResultSubmission>,
) -> Response<Body> {
    let Some(session) = find_session(&state, &session_id).await else {
        return (StatusCode::NOT_FOUND, Body::empty()).into_response();
    };
    if let Some(response) = browser_authorization_error(&session, &headers) {
        return response;
    }
    if !session.browser_control_enabled {
        return json_response(
            &session.allowed_origin,
            StatusCode::CONFLICT,
            json!({"error": "browser_control_disabled"}),
        );
    }
    let result = match validate_browser_result(result, &command_id, &session.allowed_origin) {
        Ok(value) => value,
        Err(error) => {
            return json_response(
                &session.allowed_origin,
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"error": "invalid_browser_result", "message": error.to_string()}),
            );
        }
    };
    let pending = session
        .browser_control
        .lock()
        .await
        .pending
        .remove(&command_id);
    let Some(pending) = pending else {
        return json_response(
            &session.allowed_origin,
            StatusCode::GONE,
            json!({"error": "browser_command_expired"}),
        );
    };
    if pending.page_id != result.page_id {
        session
            .browser_control
            .lock()
            .await
            .pending
            .insert(command_id.clone(), pending);
        return json_response(
            &session.allowed_origin,
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({"error": "browser_page_mismatch"}),
        );
    }
    let result = redact_fill_result(result, pending.fill_characters);
    let _ = pending.sender.send(result);
    cors_json(
        &session.allowed_origin,
        StatusCode::ACCEPTED,
        &json!({
            "version": PROTOCOL_VERSION,
            "status": "accepted",
            "commandId": command_id,
        }),
    )
}

async fn submit_message(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
    Json(submission): Json<ChatSubmission>,
) -> Response<Body> {
    let Some(session) = find_session(&state, &session_id).await else {
        return (StatusCode::NOT_FOUND, Body::empty()).into_response();
    };
    if let Some(response) = browser_authorization_error(&session, &headers) {
        return response;
    }
    let submission = match submission.validate_and_sanitize(&session.session_id) {
        Ok(value) => value,
        Err(message) => {
            return json_response(
                &session.allowed_origin,
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
                &session.allowed_origin,
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error": "clock_error", "message": error.to_string()}),
            );
        }
    };
    let sequence = {
        let mut conversation = session.conversation.lock().await;
        conversation.next_sequence += 1;
        conversation.next_sequence
    };
    let inbound = match persist_message(
        &submission,
        &session.output,
        &session.session_id,
        &message_id,
        sequence,
        received_at_unix_ms,
    ) {
        Ok(value) => value,
        Err(error) => {
            return json_response(
                &session.allowed_origin,
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
        image_attachments: vec![],
    };
    {
        let mut conversation = session.conversation.lock().await;
        conversation.messages.push(chat_message);
        conversation.inbound.push_back(inbound);
    }
    session.inbound_notify.notify_waiters();
    session.transcript_notify.notify_waiters();

    cors_json(
        &session.allowed_origin,
        StatusCode::ACCEPTED,
        &MessageReceipt {
            version: PROTOCOL_VERSION,
            status: "accepted".into(),
            message_id,
            sequence,
        },
    )
}

async fn conversation(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<BrokerState>,
    headers: HeaderMap,
    Query(query): Query<ConversationQuery>,
) -> Response<Body> {
    let Some(session) = find_session(&state, &session_id).await else {
        return (StatusCode::NOT_FOUND, Body::empty()).into_response();
    };
    if let Some(response) = browser_authorization_error(&session, &headers) {
        return response;
    }

    let deadline = Duration::from_secs(20);
    loop {
        let notified = session.transcript_notify.notified();
        let response = {
            let conversation = session.conversation.lock().await;
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
            return cors_json(&session.allowed_origin, StatusCode::OK, &response);
        }
        if tokio::time::timeout(deadline, notified).await.is_err() {
            return cors_json(
                &session.allowed_origin,
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

async fn find_session(state: &BrokerState, session_id: &str) -> Option<SessionState> {
    state.sessions.lock().await.get(session_id).cloned()
}

async fn wait_on_session(state: &SessionState, duration: Duration) -> WaitResponse {
    let started = Instant::now();
    let deadline = started + duration;
    loop {
        let notified = state.inbound_notify.notified();
        if let Some(message) = state.conversation.lock().await.inbound.pop_front() {
            return WaitResponse {
                version: PROTOCOL_VERSION,
                status: "message".into(),
                session: state.session_id.clone(),
                message: Some(message),
                waited_ms: Some(elapsed_ms(started.elapsed())),
            };
        }
        if state.ended.load(Ordering::Acquire) {
            return WaitResponse {
                version: PROTOCOL_VERSION,
                status: "ended".into(),
                session: state.session_id.clone(),
                message: None,
                waited_ms: Some(elapsed_ms(started.elapsed())),
            };
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() || tokio::time::timeout(remaining, notified).await.is_err() {
            return WaitResponse {
                version: PROTOCOL_VERSION,
                status: "timeout".into(),
                session: state.session_id.clone(),
                message: None,
                waited_ms: Some(elapsed_ms(started.elapsed())),
            };
        }
    }
}

async fn wait_with_descriptor(
    descriptor: &BrokerDescriptor,
    session: &str,
    duration: Duration,
) -> Result<WaitResponse> {
    let timeout_ms = u64::try_from(duration.as_millis()).unwrap_or(u64::MAX);
    let response = agent_client(duration.saturating_add(Duration::from_secs(10)))?
        .get(format!(
            "{}/agent/sessions/{session}/wait",
            descriptor.endpoint
        ))
        .query(&[("timeout_ms", timeout_ms)])
        .header("x-agentnudge-agent-token", &descriptor.agent_token)
        .send()
        .await
        .context("could not wait for AgentNudge feedback")?;
    parse_response(response).await
}

async fn ensure_broker() -> Result<BrokerDescriptor> {
    if let Ok(descriptor) = read_broker_descriptor()
        && broker_is_live(&descriptor).await
    {
        return Ok(descriptor);
    }

    let descriptor_file = broker_descriptor_path()?;
    if descriptor_file.exists() {
        std::fs::remove_file(&descriptor_file).with_context(|| {
            format!(
                "could not remove stale broker descriptor {}",
                descriptor_file.display()
            )
        })?;
    }
    let port = broker_port()?;
    spawn_broker(&descriptor_file, port)?;

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(descriptor) = read_broker_descriptor()
            && broker_is_live(&descriptor).await
        {
            return Ok(descriptor);
        }
        if Instant::now() >= deadline {
            bail!(
                "the AgentNudge broker did not become ready; inspect {}",
                broker_log_path()?.display()
            );
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn live_broker() -> Result<BrokerDescriptor> {
    let descriptor = read_broker_descriptor().context(
        "no AgentNudge broker is available; create a session with `agentnudge session` first",
    )?;
    if !broker_is_live(&descriptor).await {
        bail!("the AgentNudge broker is not running; create a new session");
    }
    Ok(descriptor)
}

fn spawn_broker(descriptor_file: &Path, port: u16) -> Result<()> {
    let executable = std::env::current_exe().context("could not locate the AgentNudge binary")?;
    let log_path = broker_log_path()?;
    let log = private_append_file(&log_path)?;
    let stderr = log
        .try_clone()
        .with_context(|| format!("could not open {} for broker stderr", log_path.display()))?;
    let mut command = Command::new(executable);
    command
        .arg("broker")
        .arg("--port")
        .arg(port.to_string())
        .arg("--descriptor-file")
        .arg(descriptor_file)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
    }
    command
        .spawn()
        .context("could not start the AgentNudge broker")?;
    Ok(())
}

async fn broker_is_live(descriptor: &BrokerDescriptor) -> bool {
    if validate_broker_descriptor(descriptor).is_err() {
        return false;
    }
    let Ok(client) = agent_client(Duration::from_secs(1)) else {
        return false;
    };
    client
        .get(format!("{}/agent/health", descriptor.endpoint))
        .header("x-agentnudge-agent-token", &descriptor.agent_token)
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

fn read_broker_descriptor() -> Result<BrokerDescriptor> {
    let path = broker_descriptor_path()?;
    let descriptor: BrokerDescriptor = serde_json::from_slice(
        &std::fs::read(&path)
            .with_context(|| format!("could not read broker descriptor {}", path.display()))?,
    )
    .context("the AgentNudge broker descriptor is invalid")?;
    validate_broker_descriptor(&descriptor)?;
    Ok(descriptor)
}

fn validate_broker_descriptor(descriptor: &BrokerDescriptor) -> Result<()> {
    if descriptor.version != PROTOCOL_VERSION {
        bail!(
            "the broker uses protocol version {}, but this CLI expects {}",
            descriptor.version,
            PROTOCOL_VERSION
        );
    }
    let endpoint = Url::parse(&descriptor.endpoint).context("the broker endpoint is invalid")?;
    let loopback = endpoint
        .host_str()
        .is_some_and(|host| matches!(host, "127.0.0.1" | "::1" | "localhost"));
    if endpoint.scheme() != "http" || !loopback {
        bail!("the broker descriptor does not point to a loopback HTTP endpoint");
    }
    if descriptor.agent_token.len() < 32 {
        bail!("the broker descriptor has an invalid agent capability");
    }
    Ok(())
}

fn broker_descriptor_path() -> Result<PathBuf> {
    Ok(runtime_directory()?.join(format!("broker-v{PROTOCOL_VERSION}.json")))
}

fn broker_log_path() -> Result<PathBuf> {
    Ok(runtime_directory()?.join("broker.log"))
}

fn runtime_directory() -> Result<PathBuf> {
    let root = if let Some(path) = std::env::var_os("AGENTNUDGE_RUNTIME_DIR") {
        PathBuf::from(path)
    } else if let Some(path) = std::env::var_os("XDG_RUNTIME_DIR") {
        PathBuf::from(path).join("agentnudge")
    } else if let Some(path) = std::env::var_os("LOCALAPPDATA") {
        PathBuf::from(path).join("AgentNudge").join("runtime")
    } else {
        #[cfg(unix)]
        let suffix = unsafe { libc::geteuid() }.to_string();
        #[cfg(not(unix))]
        let suffix = "user".to_string();
        std::env::temp_dir().join(format!("agentnudge-{suffix}"))
    };
    std::fs::create_dir_all(&root)
        .with_context(|| format!("could not create runtime directory {}", root.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(root)
}

fn broker_port() -> Result<u16> {
    match std::env::var("AGENTNUDGE_PORT") {
        Ok(value) => value
            .parse()
            .context("AGENTNUDGE_PORT must be a valid TCP port"),
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_BROKER_PORT),
        Err(error) => Err(error).context("AGENTNUDGE_PORT is not valid Unicode"),
    }
}

fn allocate_session_id(sessions: &HashMap<String, SessionState>) -> Result<String> {
    let offset = usize::from(Uuid::new_v4().as_bytes()[0]) % NATO_WORDS.len();
    for index in 0..NATO_WORDS.len() {
        let candidate = NATO_WORDS[(offset + index) % NATO_WORDS.len()];
        if !sessions.contains_key(candidate) {
            return Ok(candidate.into());
        }
    }
    bail!("all 26 NATO session words are currently in use; end an existing session first")
}

fn validate_session_id(value: &str) -> Result<String> {
    let value = value.trim().to_ascii_lowercase();
    if NATO_WORDS.contains(&value.as_str()) {
        Ok(value)
    } else {
        bail!("the session id must be an active NATO word such as `lima`")
    }
}

fn validate_wait(duration: Duration) -> Result<()> {
    if duration > MAX_WAIT {
        bail!("the wait duration cannot exceed 24 hours");
    }
    Ok(())
}

fn validate_browser_action(action: &mut BrowserAction, allowed_origin: &str) -> Result<()> {
    match action {
        BrowserAction::Snapshot | BrowserAction::Reload => {}
        BrowserAction::Click { selector } | BrowserAction::WaitFor { selector } => {
            sanitize_browser_selector(selector)?;
        }
        BrowserAction::Fill { selector, text } => {
            sanitize_browser_selector(selector)?;
            if text.chars().count() > MAX_BROWSER_FILL_CHARS {
                bail!("browser fill text exceeds {MAX_BROWSER_FILL_CHARS} characters");
            }
        }
        BrowserAction::Scroll { selector, x, y } => {
            if let Some(selector) = selector {
                sanitize_browser_selector(selector)?;
            }
            for coordinate in [x.as_ref(), y.as_ref()].into_iter().flatten() {
                if !coordinate.is_finite() || coordinate.abs() > 10_000_000.0 {
                    bail!("browser scroll coordinates must be finite and bounded");
                }
            }
            if selector.is_none() && x.is_none() && y.is_none() {
                bail!("browser scroll needs a selector, --x, or --y");
            }
        }
        BrowserAction::Navigate { url } => {
            let base = Url::parse(&format!("{allowed_origin}/"))?;
            let resolved = base
                .join(url.trim())
                .context("the browser navigation URL is invalid")?;
            if origin_string(&resolved)? != allowed_origin {
                bail!("browser navigation must remain on the session's allowed origin");
            }
            *url = resolved.to_string();
        }
    }
    Ok(())
}

fn sanitize_browser_selector(selector: &mut String) -> Result<()> {
    *selector = selector.trim().to_string();
    if selector.is_empty() {
        bail!("browser actions need a non-empty CSS selector");
    }
    if selector.chars().count() > MAX_BROWSER_SELECTOR_CHARS {
        bail!("browser selector exceeds {MAX_BROWSER_SELECTOR_CHARS} characters");
    }
    Ok(())
}

fn select_browser_page(browser: &BrowserControlState, requested: Option<&str>) -> Result<String> {
    if let Some(requested) = requested {
        let requested = validate_page_id(requested)?;
        if browser.pages.contains_key(&requested) {
            return Ok(requested);
        }
        bail!("browser page `{requested}` is not connected to this session");
    }
    match browser.pages.len() {
        0 => bail!("no browser page is connected; load the session widget first"),
        1 => Ok(browser.pages.keys().next().cloned().unwrap()),
        _ => bail!("more than one browser page is connected; pass --page with a page ID"),
    }
}

fn browser_page_from_query(
    query: &BrowserCommandQuery,
    allowed_origin: &str,
) -> Result<BrowserPage> {
    let page_id = validate_page_id(&query.page_id)?;
    let url = sanitize_browser_url(&query.url, allowed_origin)?;
    Ok(BrowserPage {
        page_id,
        url,
        title: truncate_string(query.title.trim(), 500),
        last_seen_unix_ms: unix_time_ms_u64()?,
    })
}

fn validate_browser_result(
    mut result: BrowserCommandResultSubmission,
    expected_command_id: &str,
    allowed_origin: &str,
) -> Result<BrowserCommandResultSubmission> {
    let command_id = Uuid::parse_str(result.command_id.trim())
        .context("the browser command ID is invalid")?
        .to_string();
    if command_id != expected_command_id {
        bail!("the browser result command ID does not match the route");
    }
    result.command_id = command_id;
    result.page_id = validate_page_id(&result.page_id)?;
    if !matches!(result.status.as_str(), "completed" | "error") {
        bail!("browser result status must be `completed` or `error`");
    }
    if let Some(value) = &result.value
        && serde_json::to_vec(value)?.len() > MAX_BROWSER_RESULT_BYTES
    {
        bail!("browser result exceeds the {MAX_BROWSER_RESULT_BYTES}-byte limit");
    }
    result.error = result
        .error
        .take()
        .map(|value| truncate_string(value.trim(), 2_000))
        .filter(|value| !value.is_empty());
    if result.status == "error" && result.error.is_none() {
        bail!("an error browser result needs an error message");
    }
    if result.status == "completed" {
        result.error = None;
    }
    result.current_url = sanitize_browser_url(&result.current_url, allowed_origin)?;
    result.title = truncate_string(result.title.trim(), 500);
    Ok(result)
}

fn redact_fill_result(
    mut result: BrowserCommandResultSubmission,
    fill_characters: Option<usize>,
) -> BrowserCommandResultSubmission {
    let Some(characters) = fill_characters else {
        return result;
    };
    if result.status == "completed" {
        result.value = Some(json!({"filled": true, "characters": characters}));
        result.error = None;
    } else {
        result.value = None;
        result.error = Some("the connected page reported that the fill action failed".into());
    }
    result
}

fn validate_page_id(value: &str) -> Result<String> {
    Ok(Uuid::parse_str(value.trim())
        .context("the browser page ID is invalid")?
        .to_string())
}

fn sanitize_browser_url(value: &str, allowed_origin: &str) -> Result<String> {
    let mut url = Url::parse(value).context("the browser page URL is invalid")?;
    if origin_string(&url)? != allowed_origin {
        bail!("the browser page URL is outside the session's allowed origin");
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
}

fn prune_stale_browser_pages(browser: &mut BrowserControlState, now_unix_ms: u64) {
    let threshold = now_unix_ms.saturating_sub(elapsed_ms(BROWSER_PAGE_STALE_AFTER));
    browser
        .pages
        .retain(|_, page| page.last_seen_unix_ms >= threshold);
}

fn truncate_string(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn elapsed_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn agent_client(timeout: Duration) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .context("could not create the local AgentNudge HTTP client")
}

fn valid_agent_token(state: &BrokerState, headers: &HeaderMap) -> bool {
    headers
        .get("x-agentnudge-agent-token")
        .and_then(|value| value.to_str().ok())
        == Some(state.agent_token.as_str())
}

fn agent_unauthorized() -> Response<Body> {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"error": "invalid_agent_capability"})),
    )
        .into_response()
}

fn agent_not_found(session_id: &str) -> Response<Body> {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": "session_not_found",
            "message": format!("AgentNudge session `{session_id}` is not active")
        })),
    )
        .into_response()
}

fn agent_bad_request(message: String) -> Response<Body> {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({"error": "invalid_request", "message": message})),
    )
        .into_response()
}

fn browser_control_disabled() -> Response<Body> {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": "browser_control_disabled",
            "message": "this session was not armed for browser control; create it with --allow-browser-control"
        })),
    )
        .into_response()
}

fn browser_authorization_error(
    state: &SessionState,
    headers: &HeaderMap,
) -> Option<Response<Body>> {
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

fn json_response(origin: &str, status: StatusCode, value: serde_json::Value) -> Response<Body> {
    let mut response = (status, Json(value)).into_response();
    apply_cors_headers(&mut response, origin);
    response
}

fn cors_json<T: Serialize>(origin: &str, status: StatusCode, value: &T) -> Response<Body> {
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

fn unix_time_ms_u64() -> Result<u64> {
    u64::try_from(unix_time_ms()?).context("the system time does not fit in a browser timestamp")
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

fn detect_reply_image_type(bytes: &[u8]) -> Option<&'static str> {
    const PNG_SIGNATURE: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() >= 24 && bytes.starts_with(PNG_SIGNATURE) && bytes.get(12..16) == Some(b"IHDR") {
        return Some("image/png");
    }
    if bytes.len() >= 4 && bytes.starts_with(&[0xff, 0xd8, 0xff]) && bytes.ends_with(&[0xff, 0xd9])
    {
        return Some("image/jpeg");
    }
    None
}

fn validate_image_extension(file_name: &str, media_type: &str) -> Result<()> {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let valid = match media_type {
        "image/png" => extension.as_deref() == Some("png"),
        "image/jpeg" => matches!(extension.as_deref(), Some("jpg" | "jpeg")),
        _ => false,
    };
    if !valid {
        bail!(
            "reply image `{file_name}` needs an extension matching its detected {media_type} content"
        );
    }
    Ok(())
}

fn absolute_path(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

fn private_append_file(path: &Path) -> Result<std::fs::File> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("could not create {}", parent.display()))?;
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .with_context(|| format!("could not write {}", path.display()))
}

fn write_private_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
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
        .with_context(|| format!("could not write {}", path.display()))?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn remove_descriptor_if_owned(path: &Path, token: &str) {
    let owned = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<BrokerDescriptor>(&bytes).ok())
        .is_some_and(|value| value.agent_token == token);
    if owned {
        let _ = std::fs::remove_file(path);
    }
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
        bail!("AgentNudge broker returned HTTP {status}: {message}");
    }
    serde_json::from_slice(&bytes).context("the AgentNudge broker returned invalid JSON")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AttachmentKind, ContextAttachment, PageContext, Rect, Viewport};

    const ONE_PIXEL_PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    fn submission(session_id: &str) -> ChatSubmission {
        ChatSubmission {
            session_id: session_id.into(),
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

    fn broker() -> BrokerState {
        BrokerState::new(
            "http://127.0.0.1:4317".into(),
            "agent-secret-agent-secret-agent-secret".into(),
        )
    }

    fn browser_headers(session: &SessionState) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(ORIGIN, HeaderValue::from_static("http://localhost:5173"));
        headers.insert(
            "x-agentnudge-token",
            HeaderValue::from_str(&session.browser_token).unwrap(),
        );
        headers
    }

    fn agent_headers(broker: &BrokerState) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-agentnudge-agent-token",
            HeaderValue::from_str(&broker.agent_token).unwrap(),
        );
        headers
    }

    fn browser_page(page_id: &str) -> BrowserPage {
        BrowserPage {
            page_id: page_id.into(),
            url: "http://localhost:5173/".into(),
            title: "Demo".into(),
            last_seen_unix_ms: unix_time_ms_u64().unwrap(),
        }
    }

    fn png_bytes() -> Vec<u8> {
        STANDARD
            .decode(
                ONE_PIXEL_PNG
                    .strip_prefix("data:image/png;base64,")
                    .unwrap(),
            )
            .unwrap()
    }

    fn image_reply(in_reply_to: Option<String>) -> AgentReplySubmission {
        AgentReplySubmission {
            message: "Here is the updated layout.".into(),
            in_reply_to,
            attachments: vec![AgentReplyImageUpload {
                file_name: "updated-layout.png".into(),
                media_type: "image/png".into(),
                data_base64: STANDARD.encode(png_bytes()),
            }],
        }
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
    fn allocates_only_unused_nato_words() {
        let mut sessions = HashMap::new();
        let state = SessionState {
            allowed_origin: String::new(),
            endpoint: String::new(),
            session_id: String::new(),
            browser_token: String::new(),
            output: PathBuf::new(),
            conversation: Arc::new(Mutex::new(Conversation::default())),
            reply_assets: Arc::new(Mutex::new(HashMap::new())),
            inbound_notify: Arc::new(Notify::new()),
            transcript_notify: Arc::new(Notify::new()),
            browser_control_enabled: false,
            browser_control: Arc::new(Mutex::new(BrowserControlState::default())),
            browser_command_notify: Arc::new(Notify::new()),
            ended: Arc::new(AtomicBool::new(false)),
        };
        for word in NATO_WORDS {
            sessions.insert(word.into(), state.clone());
        }
        assert!(allocate_session_id(&sessions).is_err());
    }

    #[test]
    fn persists_an_atomic_message_bundle() {
        let temporary = tempfile::tempdir().unwrap();
        let inbound = persist_message(
            &submission("lima"),
            temporary.path(),
            "lima",
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
    }

    #[test]
    fn loads_only_bounded_raster_image_files() {
        let temporary = tempfile::tempdir().unwrap();
        let png = temporary.path().join("preview.png");
        std::fs::write(&png, png_bytes()).unwrap();
        let uploads = load_reply_image_uploads(std::slice::from_ref(&png)).unwrap();
        assert_eq!(uploads.len(), 1);
        assert_eq!(uploads[0].file_name, "preview.png");
        assert_eq!(uploads[0].media_type, "image/png");

        let svg = temporary.path().join("pretend.png");
        std::fs::write(&svg, b"<svg xmlns='http://www.w3.org/2000/svg'></svg>").unwrap();
        let error = load_reply_image_uploads(&[svg]).unwrap_err().to_string();
        assert!(error.contains("not a supported PNG or JPEG"));

        let wrong_extension = temporary.path().join("preview.jpg");
        std::fs::write(&wrong_extension, png_bytes()).unwrap();
        let error = load_reply_image_uploads(&[wrong_extension])
            .unwrap_err()
            .to_string();
        assert!(error.contains("extension matching"));

        let oversized = temporary.path().join("oversized.png");
        std::fs::write(&oversized, vec![0u8; MAX_REPLY_IMAGE_BYTES + 1]).unwrap();
        let error = load_reply_image_uploads(&[oversized])
            .unwrap_err()
            .to_string();
        assert!(error.contains("per-file limit"));
    }

    #[test]
    fn broker_revalidates_reply_image_magic_and_media_type() {
        let mut upload = image_reply(None);
        upload.attachments[0].media_type = "image/jpeg".into();
        let error = prepare_agent_reply(upload).err().unwrap();
        assert!(error.contains("does not match its declared media type"));

        let mut upload = image_reply(None);
        upload.attachments[0].data_base64 = STANDARD.encode(b"<svg></svg>");
        let error = prepare_agent_reply(upload).err().unwrap();
        assert!(error.contains("not a supported PNG or JPEG"));
    }

    #[test]
    fn writes_a_private_broker_descriptor() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("broker.json");
        let descriptor = BrokerDescriptor {
            version: PROTOCOL_VERSION,
            endpoint: "http://127.0.0.1:4317".into(),
            agent_token: "agent-secret-agent-secret-agent-secret".into(),
            pid: 123,
        };
        write_private_json(&path, &descriptor).unwrap();
        assert_eq!(
            serde_json::from_slice::<BrokerDescriptor>(&std::fs::read(&path).unwrap())
                .unwrap()
                .pid,
            123
        );
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
    async fn isolates_two_sessions_and_carries_reply_to_transcript() {
        let temporary = tempfile::tempdir().unwrap();
        let broker = broker();
        let first = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            false,
        )
        .await
        .unwrap();
        let second = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            false,
        )
        .await
        .unwrap();
        assert_ne!(first.session, second.session);

        let second_state = find_session(&broker, &second.session).await.unwrap();
        let submitted = submit_message(
            AxumPath(second.session.clone()),
            State(broker.clone()),
            browser_headers(&second_state),
            Json(submission(&second.session)),
        )
        .await;
        assert_eq!(submitted.status(), StatusCode::ACCEPTED);
        let submitted: MessageReceipt = response_json(submitted).await;

        let first_state = find_session(&broker, &first.session).await.unwrap();
        let unrelated = wait_on_session(&first_state, Duration::ZERO).await;
        assert_eq!(unrelated.status, "timeout");

        let received = wait_on_session(&second_state, Duration::ZERO).await;
        assert_eq!(received.status, "message");
        assert_eq!(
            received.message.as_ref().unwrap().message_id,
            submitted.message_id
        );
        record_agent_reply(
            &second_state,
            prepare_agent_reply(AgentReplySubmission {
                message: "It starts onboarding.".into(),
                in_reply_to: Some(submitted.message_id.clone()),
                attachments: vec![],
            })
            .unwrap(),
        )
        .await
        .unwrap();

        let transcript = conversation(
            AxumPath(second.session),
            State(broker),
            browser_headers(&second_state),
            Query(ConversationQuery { after: 0 }),
        )
        .await;
        let transcript: ConversationResponse = response_json(transcript).await;
        assert_eq!(transcript.messages.len(), 2);
        assert!(matches!(transcript.messages[0].role, ChatRole::User));
        assert!(matches!(transcript.messages[1].role, ChatRole::Agent));
    }

    #[tokio::test]
    async fn widget_capability_is_scoped_to_the_allowed_origin() {
        let temporary = tempfile::tempdir().unwrap();
        let broker = broker();
        let created = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            false,
        )
        .await
        .unwrap();
        let response = widget(AxumPath(created.session), State(broker), HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn widget_uses_only_its_session_endpoint_and_browser_capability() {
        let temporary = tempfile::tempdir().unwrap();
        let broker = broker();
        let created = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            false,
        )
        .await
        .unwrap();
        let session = find_session(&broker, &created.session).await.unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(ORIGIN, HeaderValue::from_static("http://localhost:5173"));
        let response = widget(
            AxumPath(created.session.clone()),
            State(broker.clone()),
            headers,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let script = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(script.contains(&session.endpoint));
        assert!(script.contains(&session.browser_token));
        assert!(!script.contains(&broker.agent_token));
    }

    #[tokio::test]
    async fn reply_images_are_copied_and_served_only_to_the_session_browser() {
        let temporary = tempfile::tempdir().unwrap();
        let broker = broker();
        let created = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            false,
        )
        .await
        .unwrap();
        let session = find_session(&broker, &created.session).await.unwrap();
        let other = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            false,
        )
        .await
        .unwrap();
        let other_session = find_session(&broker, &other.session).await.unwrap();
        let encoded = ONE_PIXEL_PNG.split_once(',').unwrap().1;
        record_agent_reply(
            &session,
            prepare_agent_reply(AgentReplySubmission {
                message: "Updated preview".into(),
                in_reply_to: Some("user-message-id".into()),
                attachments: vec![AgentReplyImageUpload {
                    file_name: "preview.png".into(),
                    media_type: "image/png".into(),
                    data_base64: encoded.into(),
                }],
            })
            .unwrap(),
        )
        .await
        .unwrap();

        let conversation = session.conversation.lock().await;
        assert_eq!(
            conversation.messages[0].in_reply_to.as_deref(),
            Some("user-message-id")
        );
        assert!(conversation.messages[0].attachments.is_empty());
        let attachment = conversation.messages[0].image_attachments[0].clone();
        let transcript_json = serde_json::to_string(&conversation.messages).unwrap();
        assert!(!transcript_json.contains(&temporary.path().display().to_string()));
        assert!(!transcript_json.contains("data:image"));
        drop(conversation);
        assert_eq!(attachment.file_name, "preview.png");
        assert_eq!(attachment.media_type, "image/png");
        assert_eq!(attachment.size_bytes, png_bytes().len());
        assert_eq!(
            attachment.asset_path,
            format!("/{}/reply-assets/{}", created.session, attachment.id)
        );
        let stored = session
            .reply_assets
            .lock()
            .await
            .get(&attachment.id)
            .cloned()
            .unwrap();
        assert!(stored.path.is_file());

        let forbidden = reply_asset(
            AxumPath((created.session.clone(), attachment.id.clone())),
            State(broker.clone()),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let wrong_browser = reply_asset(
            AxumPath((created.session.clone(), attachment.id.clone())),
            State(broker.clone()),
            browser_headers(&other_session),
        )
        .await;
        assert_eq!(wrong_browser.status(), StatusCode::UNAUTHORIZED);

        let wrong_session = reply_asset(
            AxumPath((other.session, attachment.id.clone())),
            State(broker.clone()),
            browser_headers(&other_session),
        )
        .await;
        assert_eq!(wrong_session.status(), StatusCode::NOT_FOUND);

        let response = reply_asset(
            AxumPath((created.session, attachment.id)),
            State(broker),
            browser_headers(&session),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "image/png");
        assert_eq!(
            response.headers()[CACHE_CONTROL],
            "private, max-age=31536000, immutable"
        );
        assert_eq!(response.headers()[X_CONTENT_TYPE_OPTIONS], "nosniff");
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[tokio::test]
    async fn browser_actions_require_agent_auth_and_explicit_session_opt_in() {
        let temporary = tempfile::tempdir().unwrap();
        let broker = broker();
        let created = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            false,
        )
        .await
        .unwrap();
        let disabled = agent_browser_pages(
            AxumPath(created.session.clone()),
            State(broker.clone()),
            agent_headers(&broker),
        )
        .await;
        assert_eq!(disabled.status(), StatusCode::CONFLICT);

        let session = find_session(&broker, &created.session).await.unwrap();
        let browser_cannot_author_actions = agent_browser_action(
            AxumPath(created.session),
            State(broker),
            browser_headers(&session),
            Query(WaitQuery { timeout_ms: 100 }),
            Json(BrowserActionRequest {
                page_id: None,
                action: BrowserAction::Snapshot,
            }),
        )
        .await;
        assert_eq!(
            browser_cannot_author_actions.status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn routes_browser_actions_to_one_session_page_and_returns_untrusted_results() {
        const PAGE_ID: &str = "d3dc4786-46bc-4bc4-81e0-508de3417cf9";
        let temporary = tempfile::tempdir().unwrap();
        let broker = broker();
        let created = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            true,
        )
        .await
        .unwrap();
        let other = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            true,
        )
        .await
        .unwrap();
        let session = find_session(&broker, &created.session).await.unwrap();
        let other_session = find_session(&broker, &other.session).await.unwrap();
        session
            .browser_control
            .lock()
            .await
            .pages
            .insert(PAGE_ID.into(), browser_page(PAGE_ID));

        let action_broker = broker.clone();
        let action_session = created.session.clone();
        let action_headers = agent_headers(&broker);
        let action_task = tokio::spawn(async move {
            agent_browser_action(
                AxumPath(action_session),
                State(action_broker),
                action_headers,
                Query(WaitQuery { timeout_ms: 2_000 }),
                Json(BrowserActionRequest {
                    page_id: None,
                    action: BrowserAction::Snapshot,
                }),
            )
            .await
        });
        for _ in 0..100 {
            if !session.browser_control.lock().await.commands.is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(session.browser_control.lock().await.commands.len(), 1);
        assert!(
            other_session
                .browser_control
                .lock()
                .await
                .commands
                .is_empty()
        );

        let delivered = browser_commands(
            AxumPath(created.session.clone()),
            State(broker.clone()),
            browser_headers(&session),
            Query(BrowserCommandQuery {
                page_id: PAGE_ID.into(),
                url: "http://localhost:5173/?private=yes".into(),
                title: "Demo".into(),
            }),
        )
        .await;
        let delivered: BrowserCommandPollResponse = response_json(delivered).await;
        let command = delivered.command.unwrap();
        assert_eq!(command.page_id, PAGE_ID);
        assert!(matches!(command.action, BrowserAction::Snapshot));

        let wrong_browser = browser_command_result(
            AxumPath((created.session.clone(), command.command_id.clone())),
            State(broker.clone()),
            browser_headers(&other_session),
            Json(BrowserCommandResultSubmission {
                command_id: command.command_id.clone(),
                page_id: PAGE_ID.into(),
                status: "completed".into(),
                value: Some(json!({"elements": []})),
                error: None,
                current_url: "http://localhost:5173/".into(),
                title: "Demo".into(),
            }),
        )
        .await;
        assert_eq!(wrong_browser.status(), StatusCode::UNAUTHORIZED);

        let accepted = browser_command_result(
            AxumPath((created.session, command.command_id.clone())),
            State(broker.clone()),
            browser_headers(&session),
            Json(BrowserCommandResultSubmission {
                command_id: command.command_id,
                page_id: PAGE_ID.into(),
                status: "completed".into(),
                value: Some(json!({"elements": [{"selector": "#save"}]})),
                error: None,
                current_url: "http://localhost:5173/?secret=yes".into(),
                title: "Demo".into(),
            }),
        )
        .await;
        assert_eq!(accepted.status(), StatusCode::ACCEPTED);
        let response: BrowserActionResponse = response_json(action_task.await.unwrap()).await;
        assert_eq!(response.status, "completed");
        assert_eq!(response.page_id.as_deref(), Some(PAGE_ID));
        assert_eq!(
            response.current_url.as_deref(),
            Some("http://localhost:5173/")
        );
        assert_eq!(response.trust.page_content, "untrusted");
    }

    #[tokio::test]
    async fn browser_fill_receipts_cannot_echo_page_supplied_text() {
        const PAGE_ID: &str = "5a536984-a063-4dca-86fe-0414f696262b";
        const PRIVATE_TEXT: &str = "private@example.com";
        let temporary = tempfile::tempdir().unwrap();
        let broker = broker();
        let created = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            true,
        )
        .await
        .unwrap();
        let session = find_session(&broker, &created.session).await.unwrap();
        session
            .browser_control
            .lock()
            .await
            .pages
            .insert(PAGE_ID.into(), browser_page(PAGE_ID));

        let action_broker = broker.clone();
        let action_session = created.session.clone();
        let action_headers = agent_headers(&broker);
        let action_task = tokio::spawn(async move {
            agent_browser_action(
                AxumPath(action_session),
                State(action_broker),
                action_headers,
                Query(WaitQuery { timeout_ms: 2_000 }),
                Json(BrowserActionRequest {
                    page_id: None,
                    action: BrowserAction::Fill {
                        selector: "#email".into(),
                        text: PRIVATE_TEXT.into(),
                    },
                }),
            )
            .await
        });
        for _ in 0..100 {
            if !session.browser_control.lock().await.commands.is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
        let delivered = browser_commands(
            AxumPath(created.session.clone()),
            State(broker.clone()),
            browser_headers(&session),
            Query(BrowserCommandQuery {
                page_id: PAGE_ID.into(),
                url: "http://localhost:5173/".into(),
                title: "Demo".into(),
            }),
        )
        .await;
        let delivered: BrowserCommandPollResponse = response_json(delivered).await;
        let command = delivered.command.unwrap();

        let accepted = browser_command_result(
            AxumPath((created.session, command.command_id.clone())),
            State(broker),
            browser_headers(&session),
            Json(BrowserCommandResultSubmission {
                command_id: command.command_id,
                page_id: PAGE_ID.into(),
                status: "completed".into(),
                value: Some(json!({"echo": PRIVATE_TEXT})),
                error: None,
                current_url: "http://localhost:5173/".into(),
                title: "Demo".into(),
            }),
        )
        .await;
        assert_eq!(accepted.status(), StatusCode::ACCEPTED);
        let response: BrowserActionResponse = response_json(action_task.await.unwrap()).await;
        assert_eq!(
            response.value,
            Some(json!({"filled": true, "characters": 19}))
        );
        assert!(
            !serde_json::to_string(&response)
                .unwrap()
                .contains(PRIVATE_TEXT)
        );
    }

    #[tokio::test]
    async fn browser_action_timeout_cleans_the_session_queue() {
        const PAGE_ID: &str = "a1818c91-e5ac-49ae-9b63-90062661c836";
        let temporary = tempfile::tempdir().unwrap();
        let broker = broker();
        let created = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            true,
        )
        .await
        .unwrap();
        let session = find_session(&broker, &created.session).await.unwrap();
        session
            .browser_control
            .lock()
            .await
            .pages
            .insert(PAGE_ID.into(), browser_page(PAGE_ID));
        let response = agent_browser_action(
            AxumPath(created.session),
            State(broker.clone()),
            agent_headers(&broker),
            Query(WaitQuery { timeout_ms: 5 }),
            Json(BrowserActionRequest {
                page_id: None,
                action: BrowserAction::Click {
                    selector: "#save".into(),
                },
            }),
        )
        .await;
        let response: BrowserActionResponse = response_json(response).await;
        assert_eq!(response.status, "timeout");
        let control = session.browser_control.lock().await;
        assert!(control.commands.is_empty());
        assert!(control.pending.is_empty());
    }

    #[tokio::test]
    async fn ending_a_session_completes_a_pending_browser_action() {
        const PAGE_ID: &str = "33f2ddba-86e8-4f3d-8bfd-100f8283351b";
        let temporary = tempfile::tempdir().unwrap();
        let broker = broker();
        let created = register_session(
            &broker,
            "http://localhost:5173".into(),
            temporary.path().to_path_buf(),
            true,
        )
        .await
        .unwrap();
        let session = find_session(&broker, &created.session).await.unwrap();
        session
            .browser_control
            .lock()
            .await
            .pages
            .insert(PAGE_ID.into(), browser_page(PAGE_ID));

        let action_broker = broker.clone();
        let action_session = created.session.clone();
        let action_headers = agent_headers(&broker);
        let action_task = tokio::spawn(async move {
            agent_browser_action(
                AxumPath(action_session),
                State(action_broker),
                action_headers,
                Query(WaitQuery { timeout_ms: 10_000 }),
                Json(BrowserActionRequest {
                    page_id: None,
                    action: BrowserAction::Snapshot,
                }),
            )
            .await
        });
        for _ in 0..100 {
            if !session.browser_control.lock().await.pending.is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
        let ended = delete_session(
            AxumPath(created.session),
            State(broker.clone()),
            agent_headers(&broker),
        )
        .await;
        assert_eq!(ended.status(), StatusCode::OK);
        let response: BrowserActionResponse = response_json(action_task.await.unwrap()).await;
        assert_eq!(response.status, "ended");
    }
}
