---
name: "close-server"
description: "Stop the development server process that is listening on port 8080."
user-invocable: true
---

# Skill: Close Server

Use this skill when the user asks to close/stop the development server on port 8080.

## Instructions

1. **Find and Kill Process**:
   - Run `lsof -ti:8080` to find any process listening on port 8080.
   - If a PID is found, stop it with `kill -9 <pid>` (or equivalent).

2. **Report**:
   - If a process was killed, inform the user that port 8080 has been closed.
   - If no process was found, inform the user that no server was running on port 8080.
