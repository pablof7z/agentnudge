mod model;
mod server;

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use anyhow::{Context, bail};
use clap::{Parser, Subcommand};
use server::{BrokerConfig, SessionConfig};
use url::Url;

#[derive(Debug, Parser)]
#[command(
    name = "agentnudge",
    version,
    about = "Chat with a coding agent from the UI it is building",
    long_about = "AgentNudge runs isolated local chat sessions. Page elements, regions, and drawings become visual attachments delivered through timed foreground waits to coding agents."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Create an isolated local chat session and return its short ID.
    Session {
        /// Exact browser origin allowed to use the widget.
        #[arg(long, default_value = "http://localhost:5173")]
        origin: Url,

        /// Directory where per-session message evidence bundles are written.
        #[arg(short, long, default_value = ".agentnudge/messages")]
        output: PathBuf,
    },

    /// Wait in the foreground for feedback in a session.
    Wait {
        /// Short session ID returned by `agentnudge session`.
        session: String,

        /// Maximum foreground wait, such as 30s, 10m, or 1h.
        duration: String,
    },

    /// Send an agent reply, then wait in the foreground for the next message.
    Reply {
        /// Short session ID returned by `agentnudge session`.
        session: String,

        /// Maximum foreground wait after sending, such as 30s, 10m, or 1h.
        duration: String,

        /// Reply text shown in the sidebar.
        #[arg(short, long)]
        message: String,

        /// Optional user message ID this response answers.
        #[arg(long)]
        in_reply_to: Option<String>,

        /// Local PNG or JPEG to include with the reply; repeat for multiple images.
        #[arg(long = "attach", value_name = "PATH")]
        attachments: Vec<PathBuf>,
    },

    /// End an active session and release its short ID.
    EndSession {
        /// Short session ID returned by `agentnudge session`.
        session: String,
    },

    /// Internal persistent broker process.
    #[command(hide = true)]
    Broker {
        #[arg(long)]
        port: u16,

        #[arg(long)]
        descriptor_file: PathBuf,
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
        Command::Session { origin, output } => {
            let created = server::start_session(SessionConfig { origin, output }).await?;
            println!("{}", serde_json::to_string(&created)?);
            Ok(ExitCode::SUCCESS)
        }
        Command::Wait { session, duration } => {
            let duration = parse_wait_duration(&duration)?;
            let response = server::wait_for_message(&session, duration).await?;
            println!("{}", serde_json::to_string(&response)?);
            Ok(ExitCode::SUCCESS)
        }
        Command::Reply {
            session,
            duration,
            message,
            in_reply_to,
            attachments,
        } => {
            let duration = parse_wait_duration(&duration)?;
            let response =
                server::reply_and_wait(&session, duration, message, in_reply_to, attachments)
                    .await?;
            println!("{}", serde_json::to_string(&response)?);
            Ok(ExitCode::SUCCESS)
        }
        Command::EndSession { session } => {
            let receipt = server::end_session(&session).await?;
            println!("{}", serde_json::to_string(&receipt)?);
            Ok(ExitCode::SUCCESS)
        }
        Command::Broker {
            port,
            descriptor_file,
        } => {
            server::run_broker(BrokerConfig {
                port,
                descriptor_file,
            })
            .await?;
            Ok(ExitCode::SUCCESS)
        }
    }
}

fn parse_wait_duration(value: &str) -> anyhow::Result<Duration> {
    let duration = humantime::parse_duration(value).with_context(|| {
        format!("`{value}` is not a valid duration; use values such as 30s or 10m")
    })?;
    if duration > Duration::from_secs(24 * 60 * 60) {
        bail!("the wait duration cannot exceed 24 hours");
    }
    Ok(duration)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_human_wait_durations() {
        assert_eq!(parse_wait_duration("30s").unwrap(), Duration::from_secs(30));
        assert_eq!(
            parse_wait_duration("10m").unwrap(),
            Duration::from_secs(600)
        );
        assert_eq!(parse_wait_duration("0s").unwrap(), Duration::ZERO);
        assert!(parse_wait_duration("forever").is_err());
        assert!(parse_wait_duration("25h").is_err());
    }

    #[test]
    fn parses_the_public_session_commands() {
        assert!(matches!(
            Cli::try_parse_from(["agentnudge", "wait", "lima", "10m"])
                .unwrap()
                .command,
            Command::Wait { .. }
        ));
        assert!(matches!(
            Cli::try_parse_from(["agentnudge", "reply", "lima", "10m", "--message", "Done"])
                .unwrap()
                .command,
            Command::Reply { .. }
        ));
        let command = Cli::try_parse_from([
            "agentnudge",
            "reply",
            "lima",
            "0s",
            "--message",
            "See these",
            "--attach",
            "first.png",
            "--attach",
            "second.jpg",
        ])
        .unwrap()
        .command;
        match command {
            Command::Reply { attachments, .. } => assert_eq!(attachments.len(), 2),
            _ => panic!("expected reply command"),
        }
        assert!(matches!(
            Cli::try_parse_from(["agentnudge", "end-session", "lima"])
                .unwrap()
                .command,
            Command::EndSession { .. }
        ));
    }
}
