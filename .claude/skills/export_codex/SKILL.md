---
name: export_codex
description: Use when running in Codex and needing to export the current session conversation after the latest clear into project-local log files.
---

# export_codex

This skill is only for Codex CLI sessions.

## Purpose

Export current-session dialogue (user + assistant) after the latest `/clear` marker into:

`.codex/logs/YYYY-MM-DD-0001.txt`

`0001` increments automatically per day.

## Run

From project root:

```bash
python3 .codex/skills/export_codex/export_session.py
```

Optional:

```bash
python3 .codex/skills/export_codex/export_session.py --session /absolute/path/to/rollout-xxxx.jsonl
```

## Notes

- Reads source session files from `~/.codex/sessions`.
- If no `/clear` marker is found in the current session log, it exports from the first message in that session.
- Output is plain text and includes timestamp + role for each message.
