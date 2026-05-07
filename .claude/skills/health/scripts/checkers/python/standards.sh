#!/bin/bash
# Python 代码规范检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.python_standards_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_python_standards() {
    local score=0
    local issues_count=0

    # 1. PEP 8 命名规范检查 (4分)
    local naming_issues=0

    # 检查类名是否使用PascalCase
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "类名应使用PascalCase" "$content" "使用PascalCase命名类"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "^class\s+[a-z]" --include="*.py" . 2>/dev/null | head -10)

    # 检查常量是否使用UPPER_CASE
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "常量应使用UPPER_CASE" "$content" "使用全大写下划线命名常量"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "^[A-Z][a-zA-Z0-9_]+\s*=\s*" --include="*.py" . 2>/dev/null | grep -v "^[^:]*:[0-9]*:class\|^[^:]*:[0-9]*:def" | head -10)

    if [ "$naming_issues" -eq 0 ]; then
        score=$((score + 4))
    elif [ "$naming_issues" -lt 5 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + naming_issues))

    # 2. 缩进检查 (3分)
    local indent_issues=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P2" "$file" "$lineno" "混合使用Tab和空格缩进" "" "统一使用4空格缩进"
        indent_issues=$((indent_issues + 1))
    done < <(grep -rn $'\t' --include="*.py" . 2>/dev/null | head -10)

    if [ "$indent_issues" -eq 0 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + indent_issues))

    # 3. 行长度检查 (3分)
    local long_lines=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "行长度超过79字符" "$content" "换行或使用括号续行"
        long_lines=$((long_lines + 1))
    done < <(grep -rnE "^.{80,}" --include="*.py" . 2>/dev/null | head -15)

    if [ "$long_lines" -lt 10 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + long_lines))

    echo "$score:$issues_count"
}

# 执行检查
check_python_standards
