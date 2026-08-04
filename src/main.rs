mod model;
mod server;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use server::{SessionConfig, SessionResult};
use url::Url;

#[derive(Debug, Parser)]
#[command(
    name = "agentnudge",
    version,
    about = "Chat with a coding agent from the UI it is building",
    long_about = "AgentNudge runs a local development-only chat sidebar. Page elements, regions, and drawings become visual attachments to messages consumed and answered by a coding agent."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the local widget and conversation server until cancelled.
    Session {
        /// Exact browser origin allowed to use the widget.
        #[arg(long, default_value = "http://localhost:5173")]
        origin: Url,

        /// Loopback port used by the development widget.
        #[arg(long, default_value_t = 4317)]
        port: u16,

        /// Directory where message evidence bundles are written.
        #[arg(short, long, default_value = ".agentnudge/messages")]
        output: PathBuf,

        /// Private descriptor used by the agent-facing commands.
        #[arg(long, default_value = ".agentnudge/session.json")]
        session_file: PathBuf,
    },

    /// Wait for the next user message, print it, then exit.
    Next {
        /// Private descriptor written by `agentnudge session`.
        #[arg(long, default_value = ".agentnudge/session.json")]
        session_file: PathBuf,

        /// Print a stable JSON message receipt to stdout.
        #[arg(long)]
        json: bool,
    },

    /// Send an agent reply to the chat sidebar.
    Reply {
        /// Reply text shown in the sidebar.
        #[arg(short, long)]
        message: String,

        /// Optional user message ID this response answers.
        #[arg(long)]
        in_reply_to: Option<String>,

        /// Private descriptor written by `agentnudge session`.
        #[arg(long, default_value = ".agentnudge/session.json")]
        session_file: PathBuf,

        /// Print a stable JSON receipt to stdout.
        #[arg(long)]
        json: bool,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli).await {
        Ok(code) => code,
        Err(error) => {
            eprintln!("Error: {error:#}");
            ExitCode::FAILURE
        }
    }
}

async fn run(cli: Cli) -> anyhow::Result<ExitCode> {
    match cli.command {
        Command::Session {
            origin,
            port,
            output,
            session_file,
        } => match server::run_session(SessionConfig {
            origin,
            port,
            output,
            session_file,
        })
        .await?
        {
            SessionResult::Cancelled => {
                eprintln!("AgentNudge session stopped.");
                Ok(ExitCode::from(130))
            }
        },
        Command::Next { session_file, json } => {
            let message = server::next_message(&session_file).await?;
            if json {
                println!("{}", serde_json::to_string(&message)?);
            } else {
                println!("Message: {}", message.text);
                println!("Page: {}", message.page_url);
                for (index, attachment) in message.attachments.iter().enumerate() {
                    println!("Attachment {}: {}", index + 1, attachment.summary);
                }
                println!("Message ID: {}", message.message_id);
                println!("Manifest: {}", message.manifest_path);
                println!("Screenshot: {}", message.screenshot_path);
            }
            Ok(ExitCode::SUCCESS)
        }
        Command::Reply {
            message,
            in_reply_to,
            session_file,
            json,
        } => {
            let receipt = server::send_reply(&session_file, message, in_reply_to).await?;
            if json {
                println!("{}", serde_json::to_string(&receipt)?);
            } else {
                println!("Reply sent: {}", receipt.message_id);
            }
            Ok(ExitCode::SUCCESS)
        }
    }
}
