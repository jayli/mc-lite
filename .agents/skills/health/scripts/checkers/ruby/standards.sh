#!/bin/bash
# Ruby 代码规范检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ruby_standards_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ruby_standards() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 命名规范检查 (4分)
    # ============================================

    local naming_issues=0

    # 检查类名是否使用 CamelCase
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "类名应使用CamelCase" "$content" "使用CamelCase命名类"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "^class\s+[a-z_]" --include="*.rb" . 2>/dev/null | head -10)

    # 检查方法名是否使用 snake_case
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "方法名应使用snake_case" "$content" "使用snake_case命名方法"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "def\s+[A-Z]" --include="*.rb" . 2>/dev/null | head -10)

    # 检查常量是否使用 UPPER_CASE
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P2" "$file" "$lineno" "常量应使用UPPER_CASE" "" "使用全大写命名常量"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "^[a-z][a-zA-Z0-9_]*\s*=\s*" --include="*.rb" . 2>/dev/null | \
        grep -v "def\|attr\|@\|@@\|\$" | head -10)

    if [ "$naming_issues" -eq 0 ]; then
        score=$((score + 4))
    elif [ "$naming_issues" -lt 5 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + naming_issues))

    # ============================================
    # 2. 缩进检查 (3分)
    # ============================================

    local indent_issues=0

    # Ruby 应使用 2 空格缩进
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P2" "$file" "$lineno" "混合使用Tab和空格缩进" "" "统一使用2空格缩进"
        indent_issues=$((indent_issues + 1))
    done < <(grep -rn $'\t' --include="*.rb" . 2>/dev/null | head -10)

    if [ "$indent_issues" -eq 0 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + indent_issues))

    # ============================================
    # 3. 行长度检查 (3分)
    # ============================================

    local long_lines=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "行长度超过80字符" "$content" "换行或使用续行"
        long_lines=$((long_lines + 1))
    done < <(grep -rnE "^.{80,}" --include="*.rb" . 2>/dev/null | head -15)

    if [ "$long_lines" -lt 10 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + long_lines))

    echo "$score:$issues_count"
}

check_ruby_standards