# Skill: Fix Spec Directory Numbering

Use this skill when the user runs `/fixspec <spec-name>` to fix duplicate or incorrect spec directory numbering.

## Usage

```
/fixspec <spec-name>
```

Where `<spec-name>` is the spec directory name with incorrect numbering (e.g., `001-bbb`).

## Instructions

1. **Validate Input**:
   - Ensure the user provided a spec directory name
   - Verify the directory exists under `./specs/`

2. **Find Maximum编号**:
   - List all directories under `./specs/`
   - Extract directories matching the pattern `NNN-name` (three digits followed by hyphen and name)
   - Find the maximum编号 value among existing directories

3. **Calculate New编号**:
   - New编号 = max编号 + 1
   - Format as three digits (e.g., `004`)

4. **Rename Directory**:
   - Extract the name part from the input (e.g., `bbb` from `001-bbb`)
   - Rename `./specs/<old-name>` to `./specs/<new-number>-<name>`
   - Use `git mv` if the directory is under git version control, otherwise use `mv`

5. **Update Internal References**:
   - Recursively search all files in the renamed directory
   - Replace all occurrences of the old directory name with the new directory name
   - Also update any references in markdown files that point to the old directory path

6. **Report**:
   - Inform the user of the renaming performed
   - List files that were updated with the new references

## Example

Given directories: `001-aaa`, `001-bbb`, `002-ccc`, `003-ddd`

Running `/fixspec 001-bbb`:
- Max编号 is `003`
- New编号 becomes `004`
- Rename `001-bbb` to `004-bbb`
- Update all internal references from `001-bbb` to `004-bbb`

## Implementation Notes

- Use Bash tool for directory operations
- Parse directory names carefully to handle the `NNN-name` pattern
- When updating references, consider:
  - Markdown links: `[text](./001-bbb/file.md)`
  - Text references in spec files
  - Any hardcoded paths in code or config files
