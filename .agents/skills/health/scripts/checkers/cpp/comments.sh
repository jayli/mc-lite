#!/bin/bash
# C/C++ 注释完整度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.cpp_comments_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_cpp_comments() {
    local score=0
    local issues_count=0

    # 1. 文件头注释检查 (5分)
    local total_files=0
    local documented_files=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        total_files=$((total_files + 1))

        # 检查文件开头是否有注释
        if head -20 "$file" 2>/dev/null | grep -qE "^/\*|^//|^ \*"; then
            documented_files=$((documented_files + 1))
        else
            local short_file=$(echo "$file" | sed 's|^\./||')
            add_issue "P2" "$short_file" "N/A" "文件缺少头注释" "" "添加文件说明注释"
        fi
    done < <(find . \( -name "*.c" -o -name "*.cpp" -o -name "*.cc" -o -name "*.h" -o -name "*.hpp" \) 2>/dev/null | head -20)

    if [ "$total_files" -gt 0 ]; then
        local file_doc_ratio=$((documented_files * 5 / total_files))
        score=$((score + file_doc_ratio))
    fi
    issues_count=$((issues_count + total_files - documented_files))

    # 2. 函数注释检查 (5分)
    local total_funcs=0
    local documented_funcs=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        total_funcs=$((total_funcs + 1))

        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)

        # 检查函数定义前是否有注释
        local start_line=$((lineno - 10))
        [ "$start_line" -lt 1 ] && start_line=1

        if sed -n "${start_line},${lineno}p" "$file" 2>/dev/null | grep -qE "/\*\*|/\*|^ \*"; then
            documented_funcs=$((documented_funcs + 1))
        else
            local short_file=$(echo "$file" | sed 's|^\./||')
            local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 40)
            add_issue "P2" "$short_file" "$lineno" "函数缺少注释" "$content" "添加函数文档"
        fi
    done < <(grep -rnE "^\w+.*\(.*\)\s*\{?$" --include="*.c" --include="*.cpp" --include="*.cc" . 2>/dev/null | grep -v "if\|for\|while\|switch" | head -30)

    if [ "$total_funcs" -gt 0 ]; then
        local func_doc_ratio=$((documented_funcs * 5 / total_funcs))
        score=$((score + func_doc_ratio))
    fi
    issues_count=$((issues_count + total_funcs - documented_funcs))

    # 3. TODO/FIXME检查 (5分)
    local todo_count=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "存在待处理标记" "$content" "及时处理或记录到Issue"
        todo_count=$((todo_count + 1))
    done < <(grep -rnE "TODO|FIXME|XXX|HACK" --include="*.c" --include="*.cpp" --include="*.cc" --include="*.h" --include="*.hpp" . 2>/dev/null | head -15)

    if [ "$todo_count" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$todo_count" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + todo_count))

    echo "$score:$issues_count"
}

# 执行检查
check_cpp_comments
