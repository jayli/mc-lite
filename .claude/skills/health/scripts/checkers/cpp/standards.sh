#!/bin/bash
# C/C++ 代码规范检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.cpp_standards_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_cpp_standards() {
    local score=0
    local issues_count=0

    # 1. 命名规范检查 (4分)
    local naming_issues=0

    # 检查宏定义是否使用大写
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "宏定义应使用大写" "$content" "宏命名使用UPPER_CASE"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "#define\s+[a-z]" --include="*.h" --include="*.hpp" --include="*.c" --include="*.cpp" . 2>/dev/null | head -10)

    # 检查函数命名
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "函数命名不规范" "$content" "使用snake_case"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "^[a-zA-Z_][a-zA-Z0-9_]*\s+[a-z]+[A-Z]" \
        --include="*.c" --include="*.cpp" --include="*.cc" . 2>/dev/null | grep -v "static\|const\|void\|int\|char\|double\|float" | head -10)

    if [ "$naming_issues" -eq 0 ]; then
        score=$((score + 4))
    elif [ "$naming_issues" -lt 10 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + naming_issues))

    # 2. 头文件保护 (3分)
    local header_issues=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        if ! head -10 "$file" 2>/dev/null | grep -qE "#ifndef|#pragma once"; then
            local short_file=$(echo "$file" | sed 's|^\./||')
            add_issue "P2" "$short_file" "N/A" "头文件缺少保护宏" "" "添加#ifndef保护或#pragma once"
            header_issues=$((header_issues + 1))
        fi
    done < <(find . \( -name "*.h" -o -name "*.hpp" \) 2>/dev/null | head -15)

    if [ "$header_issues" -eq 0 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + header_issues))

    # 3. 缩进检查 (3分)
    local indent_issues=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P2" "$file" "$lineno" "使用Tab缩进" "" "统一使用空格缩进"
        indent_issues=$((indent_issues + 1))
    done < <(grep -rn $'\t' --include="*.c" --include="*.cpp" --include="*.cc" --include="*.h" --include="*.hpp" . 2>/dev/null | head -15)

    if [ "$indent_issues" -lt 10 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + indent_issues))

    echo "$score:$issues_count"
}

# 执行检查
check_cpp_standards
