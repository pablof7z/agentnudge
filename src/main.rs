mod model;
mod server;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use server::{WaitConfig, WaitResult};
use url::Url;

#[derive(Debug, Parser)]
#[command(
    name = "agentnudge",
    version,
    about = "Wait for visual feedback from software under development",
    long_about = "AgentNudge creates a one-shot local rendezvous between a waiting coding agent and a small feedback widget embedded in a development UI."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Wait for one feedback batch, write its evidence bundle, then exit.
    Wait {
        /// Exact browser origin allowed to submit feedback.
        #[arg(long, default_value = "http://localhost:5173")]
        origin: Url,

        /// Loopback port used by the development widget.
        #[arg(long, default_value_t = 4317)]
        port: u16,

        /// Directory where feedback bundles are written.
        #[arg(short, long, default_value = ".agentnudge/feedback")]
        output: PathBuf,

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
        Command::Wait {
            origin,
            port,
            output,
            json,
        } => match server::wait_for_feedback(WaitConfig {
            origin,
            port,
            output,
        })
        .await?
        {
            WaitResult::Feedback(receipt) => {
                if json {
                    println!("{}", serde_json::to_string(&receipt)?);
                } else {
                    println!("Feedback received");
                    if !receipt.message.is_empty() {
                        println!("Overall note: {}", receipt.message);
                    }
                    println!("Page: {}", receipt.page_url);
                    println!("Comments: {}", receipt.comment_count);
                    for comment in receipt.comment_summaries {
                        println!("  {comment}");
                    }
                    println!("Drawing strokes: {}", receipt.drawing_stroke_count);
                    println!("Manifest: {}", receipt.manifest_path);
                    println!("Screenshot: {}", receipt.screenshot_path);
                }
                Ok(ExitCode::SUCCESS)
            }
            WaitResult::Cancelled => {
                eprintln!("AgentNudge cancelled.");
                Ok(ExitCode::from(130))
            }
        },
    }
}
