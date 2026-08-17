#!/bin/bash
# Rust 代码规范检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_standards_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_standards() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 命名规范检查 (4分) - Rust 命名规范
    # ============================================

    local naming_issues=0

    # 检查类型名是否使用 PascalCase
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "类型名应使用PascalCase" "$content" "使用PascalCase命名类型"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "^(pub )?struct [a-z]|^(pub )?enum [a-z]|^(pub )?trait [a-z]" --include="*.rs" src/ 2>/dev/null | head -10)

    # 检查函数名是否使用 snake_case
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "函数名应使用snake_case" "$content" "使用snake_case命名函数"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "fn [A-Z]" --include="*.rs" src/ 2>/dev/null | head -10)

    # 检查常量是否使用 UPPER_CASE
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P2" "$file" "$lineno" "常量应使用UPPER_CASE" "" "使用全大写命名常量"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "^(pub )?const [a-z]" --include="*.rs" src/ 2>/dev/null | head -10)

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

    # Rust 应使用 4 空格缩进
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P2" "$file" "$lineno" "使用Tab缩进" "" "统一使用4空格缩进"
        indent_issues=$((indent_issues + 1))
    done < <(grep -rn $'\t' --include="*.rs" src/ 2>/dev/null | head -10)

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
        add_issue "P2" "$file" "$lineno" "行长度超过100字符" "$content" "换行"
        long_lines=$((long_lines + 1))
    done < <(grep -rnE "^.{100,}" --include="*.rs" src/ 2>/dev/null | head -15)

    if [ "$long_lines" -lt 10 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + long_lines))

    echo "$score:$issues_count"
}

check_rust_standards