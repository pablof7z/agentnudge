mod claude_acp;
mod codex;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, mpsc, oneshot};

const COMMAND_CAPACITY: usize = 64;
const EVENT_CAPACITY: usize = 64;
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeAdapterKind {
    ClaudeAcp,
    Codex,
}

impl RuntimeAdapterKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ClaudeAcp => "claude_acp",
            Self::Codex => "codex",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLaunchConfig {
    pub adapter: RuntimeAdapterKind,
    pub context: String,
    pub cwd: PathBuf,
    pub executable: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct RuntimeUserMessage {
    pub message_id: String,
    pub text: String,
    pub manifest_path: String,
    pub screenshot_path: String,
    pub attachment_summaries: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub adapter: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug)]
pub enum RuntimeEvent {
    AssistantMessage(String),
    Error(String),
}

enum RuntimeCommand {
    UserMessage(RuntimeUserMessage),
    Shutdown(oneshot::Sender<()>),
}

#[derive(Clone)]
pub struct RuntimeHandle {
    commands: mpsc::Sender<RuntimeCommand>,
    snapshot: Arc<Mutex<RuntimeSnapshot>>,
}

impl RuntimeHandle {
    pub async fn send_user_message(&self, message: RuntimeUserMessage) -> Result<()> {
        self.commands
            .send(RuntimeCommand::UserMessage(message))
            .await
            .map_err(|_| anyhow::anyhow!("the embedded agent runtime stopped"))
    }

    pub async fn snapshot(&self) -> RuntimeSnapshot {
        self.snapshot.lock().await.clone()
    }

    pub async fn shutdown(&self) -> Result<()> {
        let (sender, receiver) = oneshot::channel();
        if self
            .commands
            .send(RuntimeCommand::Shutdown(sender))
            .await
            .is_err()
        {
            return Ok(());
        }
        if tokio::time::timeout(SHUTDOWN_TIMEOUT, receiver)
            .await
            .is_err()
        {
            bail!("the embedded agent runtime did not stop within five seconds");
        }
        Ok(())
    }
}

pub async fn start(
    config: RuntimeLaunchConfig,
) -> Result<(RuntimeHandle, mpsc::Receiver<RuntimeEvent>)> {
    let (command_sender, command_receiver) = mpsc::channel(COMMAND_CAPACITY);
    let (event_sender, event_receiver) = mpsc::channel(EVENT_CAPACITY);
    let snapshot = Arc::new(Mutex::new(RuntimeSnapshot {
        adapter: config.adapter.as_str().into(),
        state: "starting".into(),
        thread_id: None,
        active_turn_id: None,
        error: None,
    }));
    let handle = RuntimeHandle {
        commands: command_sender,
        snapshot: snapshot.clone(),
    };

    match config.adapter.clone() {
        RuntimeAdapterKind::ClaudeAcp => {
            claude_acp::start(config, command_receiver, event_sender, snapshot).await?;
        }
        RuntimeAdapterKind::Codex => {
            codex::start(config, command_receiver, event_sender, snapshot).await?;
        }
    }
    Ok((handle, event_receiver))
}
