---
name: "commit"
description: "Analyze git changes, stage as needed, generate a Conventional Commit message, and create a commit."
argument-hint: "[optional commit intent]"
user-invocable: true
---

# Skill: Smart Git Commit

Use this skill when the user runs `/commit` or asks to commit changes.

## Instructions

1. **Analyze Context**:
   - Run `git status` to identify modified, added, or deleted files.
   - Run `git diff` to inspect changes in unstaged files.
   - Run `git diff --cached` to inspect changes in staged files.

2. **Stage Changes**:
   - If there are unstaged changes, run `git add -A` to stage all changes unless the user explicitly requested a partial commit.

3. **Generate Commit Message**:
   - Analyze diffs to understand the intent of changes.
   - Draft a message following **Conventional Commits**:
     ```
     <type>(<scope>): <description>

     [optional body]
     ```
   - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
   - Scope is optional and should reflect the affected area.
   - Description should be concise and imperative.

4. **Execute Commit**:
   - Run `git commit -m "generated_message"`.
   - If a body is needed, use multiple `-m` flags.

5. **Report**:
   - Inform the user of the commit message used and commit result.
