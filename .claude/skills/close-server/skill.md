# Skill: Close Server

Use this skill when the user asks to close/stop the development server on port 8080.

## Instructions

1. **Find and Kill Process**:
   - Run `lsof -ti:8080 | xargs kill -9 2>/dev/null` to find and kill any process listening on port 8080.

2. **Report**:
   - If a process was killed, inform the user that port 8080 has been closed.
   - If no process was found, inform the user that no server was running on port 8080.
