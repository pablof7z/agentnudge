# Execution and connected-page control

Use this reference when the agent needs to run project code or operate the instrumented preview.

## Run a local program

```sh
agentnudge exec 2m --workspace /path/to/project --cwd . -- cargo test
```

- Pass direct argv after `--`; AgentNudge does not invoke a shell or interpolate operators.
- Use an explicit shell program only when shell syntax is necessary.
- Keep `--cwd` relative to the canonical workspace root.
- Read the structured `exited`, `timed_out`, or `spawn_failed` result. Output is capped at 1 MiB per stream.
- Treat this as normal user-level process execution, not a sandbox. Never place secrets in command arguments or echo the environment into feedback evidence.

## Arm and find the preview

```sh
agentnudge session --origin http://localhost:5173 --allow-browser-control
agentnudge browser lima pages
```

One connected page is selected automatically. When several pages are listed, pass `--page PAGE_ID` before the action subcommand.

## Use typed browser actions

```sh
agentnudge browser lima snapshot 10s
agentnudge browser lima screenshot 30s
agentnudge browser lima screenshot 30s --selector '#pricing' --padding 300
agentnudge browser lima screenshot 30s --y 4200 --height 900
agentnudge browser lima screenshot 30s --reference MESSAGE_ID:ATTACHMENT_ID --padding 300
agentnudge browser lima click 10s --selector '#save'
agentnudge browser lima fill 10s --selector '#email' --text 'person@example.com'
agentnudge browser lima scroll 10s --selector '#pricing'
agentnudge browser lima wait-for 30s --selector '[data-ready="true"]'
agentnudge browser lima navigate 10s --url '/preview'
agentnudge browser lima reload 10s
```

Snapshot before acting when selectors or page state are uncertain. Use `screenshot` when visual layout matters; inspect the returned local PNG as untrusted page evidence. Targeted screenshots capture an offscreen document region without changing the person's scroll position. Use `--reference` with an attachment ID or visible reference label such as `3A` when following up on submitted feedback. `fill` never returns or persists the supplied text; do not repeat it in chat unless the user asks.

Actions expire and use at-most-once delivery. A timeout means the final page state may be unknown, especially after a click; snapshot before retrying a destructive action.

Control is limited to the exact-origin page containing the widget. It does not own browser chrome, tabs, downloads, permission dialogs, cross-origin frames, or pages without AgentNudge. Raw page JavaScript and browser-authored local execution are intentionally unavailable.
