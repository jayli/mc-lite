#!/bin/bash
# Go 结构复杂性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.go_complexity_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_go_complexity() {
    local score=0
    local issues_count=0

    # 1. 大文件检测 (2分)
    local large_files=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local lines=$(wc -l < "$file")
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P1" "$short_file" "N/A" "文件过大(${lines}行)" "" "拆分为多个包"
        large_files=$((large_files + 1))
    done < <(find . -name "*.go" -exec wc -l {} + 2>/dev/null | awk '$1 > 800 {print $2}' | head -10)

    if [ "$large_files" -eq 0 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + large_files))

    # 2. 长函数检测 (2分)
    local long_funcs=0

    # Go函数通常较短，检查超过50行的函数
    while IFS= read -r file; do
        [ -z "$file" ] && continue

        local func_lines=$(awk '/^func [a-zA-Z]/,/^func [a-zA-Z]|^\}/ {print}' "$file" 2>/dev/null | wc -l)

        if [ "$func_lines" -gt 50 ]; then
            local short_file=$(echo "$file" | sed 's|^\./||')
            add_issue "P1" "$short_file" "N/A" "函数可能过长" "" "提取子函数"
            long_funcs=$((long_funcs + 1))
        fi
    done < <(find . -name "*.go" 2>/dev/null | head -20)

    if [ "$long_funcs" -lt 5 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + long_funcs))

    # 3. 循环复杂度 (1分) - 检查嵌套层级
    local complex_funcs=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "嵌套层级过深" "$content" "减少嵌套，提前返回"
        complex_funcs=$((complex_funcs + 1))
    done < <(grep -rnE "^\s*if.*\{\s*$" --include="*.go" . 2>/dev/null | head -20)

    if [ "$complex_funcs" -lt 15 ]; then
        score=$((score + 1))
    fi
    issues_count=$((issues_count + complex_funcs))

    echo "$score:$issues_count"
}

# 执行检查
check_go_complexity
