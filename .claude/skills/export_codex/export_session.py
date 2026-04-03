#!/usr/bin/env python3
import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple


Message = Tuple[str, str, str]


def find_project_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".codex" / "skills" / "export_codex").exists():
            return candidate
    raise FileNotFoundError("Cannot find project root containing .codex/skills/export_codex")


def latest_session_file() -> Path:
    sessions_root = Path.home() / ".codex" / "sessions"
    if not sessions_root.exists():
        raise FileNotFoundError("~/.codex/sessions not found")
    files = sorted(
        sessions_root.rglob("rollout-*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not files:
        raise FileNotFoundError("No rollout session file found in ~/.codex/sessions")
    return files[0]


def parse_messages(session_path: Path) -> Tuple[List[Message], bool]:
    messages: List[Message] = []
    last_clear_index: Optional[int] = None

    with session_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            if event.get("type") != "event_msg":
                continue
            payload = event.get("payload", {})
            ptype = payload.get("type")
            ts = event.get("timestamp", "")

            if ptype == "user_message":
                text = str(payload.get("message", "")).strip()
                if re.match(r"^/?clear$", text, flags=re.IGNORECASE):
                    last_clear_index = len(messages)
                    continue
                messages.append((ts, "user", text))
            elif ptype == "agent_message":
                text = str(payload.get("message", "")).strip()
                messages.append((ts, "assistant", text))

    if last_clear_index is not None:
        return messages[last_clear_index:], True
    return messages, False


def next_log_path(log_dir: Path) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now().strftime("%Y-%m-%d")
    pattern = re.compile(rf"^{re.escape(date_str)}-(\d{{4}})\.txt$")
    max_idx = 0
    for p in log_dir.glob(f"{date_str}-*.txt"):
        match = pattern.match(p.name)
        if match:
            max_idx = max(max_idx, int(match.group(1)))
    return log_dir / f"{date_str}-{max_idx + 1:04d}.txt"


def write_export(target: Path, session_path: Path, messages: List[Message], used_clear: bool) -> None:
    exported_at = datetime.now().isoformat(timespec="seconds")
    mode = "after last /clear" if used_clear else "full current session (no /clear found)"

    lines: List[str] = [
        f"exported_at: {exported_at}",
        f"session_file: {session_path}",
        f"scope: {mode}",
        "",
    ]

    for ts, role, text in messages:
        lines.append(f"[{ts}] {role}")
        lines.append(text)
        lines.append("")

    target.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export Codex current-session dialogue into .codex/logs/YYYY-MM-DD-0001.txt"
    )
    parser.add_argument(
        "--session",
        type=Path,
        help="Optional path to a specific rollout-*.jsonl file",
    )
    args = parser.parse_args()

    try:
        project_root = find_project_root(Path.cwd())
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    session_path = args.session.resolve() if args.session else latest_session_file()
    if not session_path.exists():
        print(f"ERROR: session file not found: {session_path}", file=sys.stderr)
        return 1

    messages, used_clear = parse_messages(session_path)
    log_dir = project_root / ".codex" / "logs"
    target = next_log_path(log_dir)
    write_export(target, session_path, messages, used_clear)

    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
