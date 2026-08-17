#!/bin/bash
# Python 注释完整度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.python_comments_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_python_comments() {
    local score=0
    local issues_count=0

    # 1. 模块文档字符串检查 (5分)
    local total_modules=0
    local documented_modules=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        total_modules=$((total_modules + 1))

        # 检查文件开头是否有docstring
        if head -20 "$file" 2>/dev/null | grep -qE '^"""|^\'\'\''; then
            documented_modules=$((documented_modules + 1))
        else
            local short_file=$(echo "$file" | sed 's|^\./||')
            add_issue "P2" "$short_file" "N/A" "模块缺少文档字符串" "" "添加模块级docstring"
        fi
    done < <(find . -name "*.py" 2>/dev/null | head -20)

    if [ "$total_modules" -gt 0 ]; then
        local module_doc_ratio=$((documented_modules * 5 / total_modules))
        score=$((score + module_doc_ratio))
    fi
    issues_count=$((issues_count + total_modules - documented_modules))

    # 2. 函数文档字符串检查 (5分)
    local total_funcs=0
    local documented_funcs=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        total_funcs=$((total_funcs + 1))

        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)

        # 检查函数定义后是否有docstring
        local next_lines=$(sed -n "$((lineno+1)),$((lineno+3))p" "$file" 2>/dev/null)

        if echo "$next_lines" | grep -qE '^    """|^    \'\'\''; then
            documented_funcs=$((documented_funcs + 1))
        else
            local short_file=$(echo "$file" | sed 's|^\./||')
            local func_name=$(echo "$line" | cut -d: -f3- | grep -oE "def\s+\w+" | awk '{print $2}')
            add_issue "P2" "$short_file" "$lineno" "函数缺少文档字符串" "def $func_name" "添加函数docstring"
        fi
    done < <(grep -rnE "^def [^_]" --include="*.py" . 2>/dev/null | grep -v "test_" | head -30)

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
    done < <(grep -rnE "TODO|FIXME|XXX|HACK" --include="*.py" . 2>/dev/null | head -15)

    if [ "$todo_count" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$todo_count" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + todo_count))

    echo "$score:$issues_count"
}

# 执行检查
check_python_comments
