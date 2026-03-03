# Skill: Fix Spec Directory Numbering

Use this skill when the user runs `/fixspec` to fix duplicate or incorrect spec directory numbering.

## Usage

```
/fixspec [<spec-name>]
```

## Instructions

### Phase 1: Get Spec Selection

1. **Execute Shell Script**:
   - Run: `.claude/skills/fixspec/fixspec-interactive.sh [<spec-name>]`
   - If `DIRECT_MODE:<name>`: jump to Phase 2 with that spec
   - If `LIST_MODE`: start interactive selection below

2. **Interactive Selection (LIST_MODE)**:
   - Parse specs from script output into an array
   - Display specs in pages of 3 items each
   - **Page navigation options**:
     - Page 1: [spec1, spec2, spec3, "→ 下一页"]
     - Middle pages: [spec1, spec2, spec3, "→ 下一页" / "← 上一页"]
     - Last page: [spec1, spec2, spec3 (or less), "← 上一页"]
   - Use label pattern: `next-N` for next page, `prev-N` for prev page, spec name for selection
   - When user selects a spec name, proceed to Phase 2

### Phase 2: Fix Directory Numbering

3. **Validate Spec**: Verify directory exists under `./specs/`

4. **Find Maximum 编号**: List all `NNN-name` pattern directories, find max

5. **Calculate New 编号**: New = max + 1, format as `004`

6. **Rename Directory**:
   - Extract name part (e.g., `bbb` from `001-bbb`)
   - `git mv ./specs/<old> ./specs/<new>` or `mv` if not in git

7. **Update Internal References**:
   - Search and replace old directory name → new directory name
   - Update markdown links, text references, hardcoded paths

8. **Report**: Inform user of renaming and list updated files

## Example

```
/fixspec 001-bbb → rename to 004-bbb
/fixspec         → interactive selection → rename selected
```
