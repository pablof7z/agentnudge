mod execution;
mod model;
mod runtime;
mod server;
mod stt;

use std::ffi::OsString;
use std::io::Write as _;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use anyhow::{Context, bail};
use clap::{Parser, Subcommand, ValueEnum};
use model::BrowserAction;
use runtime::{RuntimeAdapterKind, RuntimeLaunchConfig};
use server::{BrokerConfig, SessionConfig};
use url::Url;

#[derive(Debug, Parser)]
#[command(
    name = "agentnudge",
    version,
    about = "Chat with a coding agent from the UI it is building",
    long_about = "AgentNudge runs isolated local chat sessions. Page elements, regions, and drawings become visual attachments delivered through foreground waits or an embedded coding-agent runtime."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run a local program directly with bounded structured output.
    Exec {
        /// Maximum execution time, such as 30s, 10m, or 1h.
        duration: String,

        /// Canonical boundary the working directory must remain beneath.
        #[arg(long, default_value = ".")]
        workspace: PathBuf,

        /// Working directory relative to the workspace root.
        #[arg(long, default_value = ".")]
        cwd: PathBuf,

        /// Program and arguments. Use `--` before values beginning with `-`.
        #[arg(required = true, trailing_var_arg = true, allow_hyphen_values = true)]
        command: Vec<OsString>,
    },

    /// Print a new session's short ID, then wait until the session closes.
    Session {
        /// Exact browser origin allowed to use the widget.
        #[arg(long, default_value = "http://localhost:5173")]
        origin: Url,

        /// Directory where per-session message evidence bundles are written.
        #[arg(short, long, default_value = ".agentnudge/messages")]
        output: PathBuf,

        /// Explicitly allow this session's agent to control connected preview pages.
        #[arg(long)]
        allow_browser_control: bool,

        /// Start an embedded coding-agent runtime for this page conversation.
        #[arg(long, value_enum)]
        runtime: Option<RuntimeArgument>,

        /// Trusted context supplied by the agent starting the embedded runtime.
        #[arg(long, conflicts_with = "context_file")]
        context: Option<String>,

        /// Read trusted embedded-agent context from a UTF-8 file.
        #[arg(long, value_name = "PATH", conflicts_with = "context")]
        context_file: Option<PathBuf>,

        /// Workspace used as the embedded coding agent's working directory.
        #[arg(long, default_value = ".")]
        workspace: PathBuf,

        /// Alternate embedded-runtime executable, primarily for adapter testing.
        #[arg(long, alias = "codex-bin", value_name = "PATH", requires = "runtime")]
        runtime_bin: Option<PathBuf>,
    },

    /// Inspect and control a connected preview page through typed actions.
    Browser {
        /// Short session ID returned by `agentnudge session`.
        session: String,

        /// Specific connected page ID; required when more than one page is active.
        #[arg(long)]
        page: Option<String>,

        #[command(subcommand)]
        action: BrowserCommand,
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

    /// Return the complete live or final conversation transcript.
    Transcript {
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

#[derive(Clone, Debug, ValueEnum)]
enum RuntimeArgument {
    #[value(alias = "claude-acp")]
    Claude,
    Codex,
}

#[derive(Debug, Subcommand)]
enum BrowserCommand {
    /// List connected pages that can receive actions.
    Pages,

    /// Return a bounded snapshot of the page and its interactive elements.
    Snapshot {
        /// Maximum foreground wait for the action result.
        duration: String,
    },

    /// Capture the visible page as a redacted PNG and return its local path.
    Screenshot {
        /// Maximum foreground wait for the action result.
        duration: String,
    },

    /// Click the element matching a CSS selector.
    Click {
        duration: String,
        #[arg(long)]
        selector: String,
    },

    /// Set an editable element without returning or persisting the supplied text.
    Fill {
        duration: String,
        #[arg(long)]
        selector: String,
        #[arg(long)]
        text: String,
    },

    /// Scroll the page or bring a selected element into view.
    Scroll {
        duration: String,
        #[arg(long)]
        selector: Option<String>,
        #[arg(long, allow_hyphen_values = true)]
        x: Option<f64>,
        #[arg(long, allow_hyphen_values = true)]
        y: Option<f64>,
    },

    /// Wait until a CSS selector resolves to a visible element.
    WaitFor {
        duration: String,
        #[arg(long)]
        selector: String,
    },

    /// Navigate within the session's exact allowed origin.
    Navigate {
        duration: String,
        #[arg(long)]
        url: String,
    },

    /// Reload the connected page after acknowledging the action.
    Reload { duration: String },
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
        Command::Exec {
            duration,
            workspace,
            cwd,
            command,
        } => {
            let duration = parse_wait_duration(&duration)?;
            if duration.is_zero() {
                bail!("exec needs a duration greater than zero");
            }
            let receipt = execution::execute(&workspace, &cwd, duration, &command).await?;
            println!("{}", serde_json::to_string(&receipt)?);
            Ok(ExitCode::SUCCESS)
        }
        Command::Session {
            origin,
            output,
            allow_browser_control,
            runtime,
            context,
            context_file,
            workspace,
            runtime_bin,
        } => {
            let runtime =
                build_runtime_config(runtime, context, context_file, workspace, runtime_bin)?;
            let created = server::start_session(SessionConfig {
                origin,
                output,
                allow_browser_control,
                runtime,
            })
            .await?;
            println!("{}", serde_json::to_string(&created)?);
            std::io::stdout().flush()?;
            let transcript = server::wait_for_session_end(&created.session).await?;
            println!("{}", serde_json::to_string(&transcript)?);
            Ok(ExitCode::SUCCESS)
        }
        Command::Browser {
            session,
            page,
            action,
        } => {
            match action {
                BrowserCommand::Pages => {
                    let pages = server::list_browser_pages(&session).await?;
                    println!("{}", serde_json::to_string(&pages)?);
                }
                BrowserCommand::Snapshot { duration } => {
                    print_browser_result(&session, page, duration, BrowserAction::Snapshot).await?;
                }
                BrowserCommand::Screenshot { duration } => {
                    print_browser_result(&session, page, duration, BrowserAction::Screenshot)
                        .await?;
                }
                BrowserCommand::Click { duration, selector } => {
                    print_browser_result(
                        &session,
                        page,
                        duration,
                        BrowserAction::Click { selector },
                    )
                    .await?;
                }
                BrowserCommand::Fill {
                    duration,
                    selector,
                    text,
                } => {
                    print_browser_result(
                        &session,
                        page,
                        duration,
                        BrowserAction::Fill { selector, text },
                    )
                    .await?;
                }
                BrowserCommand::Scroll {
                    duration,
                    selector,
                    x,
                    y,
                } => {
                    print_browser_result(
                        &session,
                        page,
                        duration,
                        BrowserAction::Scroll { selector, x, y },
                    )
                    .await?;
                }
                BrowserCommand::WaitFor { duration, selector } => {
                    print_browser_result(
                        &session,
                        page,
                        duration,
                        BrowserAction::WaitFor { selector },
                    )
                    .await?;
                }
                BrowserCommand::Navigate { duration, url } => {
                    print_browser_result(&session, page, duration, BrowserAction::Navigate { url })
                        .await?;
                }
                BrowserCommand::Reload { duration } => {
                    print_browser_result(&session, page, duration, BrowserAction::Reload).await?;
                }
            }
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
        Command::Transcript { session } => {
            let transcript = server::session_transcript(&session).await?;
            println!("{}", serde_json::to_string(&transcript)?);
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

fn build_runtime_config(
    runtime: Option<RuntimeArgument>,
    context: Option<String>,
    context_file: Option<PathBuf>,
    workspace: PathBuf,
    executable: Option<PathBuf>,
) -> anyhow::Result<Option<RuntimeLaunchConfig>> {
    let Some(runtime) = runtime else {
        if context.is_some() || context_file.is_some() || executable.is_some() {
            bail!("--context, --context-file, and --runtime-bin require --runtime");
        }
        return Ok(None);
    };
    let context = match (context, context_file) {
        (Some(value), None) => value,
        (None, Some(path)) => std::fs::read_to_string(&path)
            .with_context(|| format!("could not read runtime context {}", path.display()))?,
        (None, None) => String::new(),
        (Some(_), Some(_)) => unreachable!("clap rejects conflicting context sources"),
    };
    let cwd = std::fs::canonicalize(&workspace).with_context(|| {
        format!(
            "could not resolve runtime workspace {}",
            workspace.display()
        )
    })?;
    if !cwd.is_dir() {
        bail!("runtime workspace {} is not a directory", cwd.display());
    }
    let adapter = match runtime {
        RuntimeArgument::Claude => RuntimeAdapterKind::ClaudeAcp,
        RuntimeArgument::Codex => RuntimeAdapterKind::Codex,
    };
    let executable = executable
        .map(|path| {
            std::fs::canonicalize(&path)
                .with_context(|| format!("could not resolve runtime executable {}", path.display()))
        })
        .transpose()?;
    Ok(Some(RuntimeLaunchConfig {
        adapter,
        context,
        cwd,
        executable,
    }))
}

async fn print_browser_result(
    session: &str,
    page: Option<String>,
    duration: String,
    action: BrowserAction,
) -> anyhow::Result<()> {
    let duration = parse_wait_duration(&duration)?;
    if duration.is_zero() {
        bail!("browser actions need a duration greater than zero");
    }
    let result = server::run_browser_action(session, page, duration, action).await?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
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
        let command = Cli::try_parse_from([
            "agentnudge",
            "exec",
            "30s",
            "--workspace",
            ".",
            "--",
            "printf",
            "%s",
            "hello",
        ])
        .unwrap()
        .command;
        match command {
            Command::Exec { command, .. } => {
                assert_eq!(command, ["printf", "%s", "hello"]);
            }
            _ => panic!("expected exec command"),
        }
        assert!(matches!(
            Cli::try_parse_from(["agentnudge", "wait", "lima", "10m"])
                .unwrap()
                .command,
            Command::Wait { .. }
        ));
        assert!(matches!(
            Cli::try_parse_from([
                "agentnudge",
                "browser",
                "lima",
                "click",
                "10s",
                "--selector",
                "#save"
            ])
            .unwrap()
            .command,
            Command::Browser {
                action: BrowserCommand::Click { .. },
                ..
            }
        ));
        assert!(matches!(
            Cli::try_parse_from(["agentnudge", "browser", "lima", "screenshot", "10s"])
                .unwrap()
                .command,
            Command::Browser {
                action: BrowserCommand::Screenshot { .. },
                ..
            }
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
        assert!(matches!(
            Cli::try_parse_from(["agentnudge", "transcript", "lima"])
                .unwrap()
                .command,
            Command::Transcript { .. }
        ));
        assert!(matches!(
            Cli::try_parse_from([
                "agentnudge",
                "session",
                "--runtime",
                "codex",
                "--context",
                "Focus on the demo"
            ])
            .unwrap()
            .command,
            Command::Session { .. }
        ));
        assert!(matches!(
            Cli::try_parse_from([
                "agentnudge",
                "session",
                "--runtime",
                "claude",
                "--context",
                "Focus on the demo"
            ])
            .unwrap()
            .command,
            Command::Session { .. }
        ));
    }
}
