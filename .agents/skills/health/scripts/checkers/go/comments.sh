#!/bin/bash
# Go 注释完整度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.go_comments_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_go_comments() {
    local score=0
    local issues_count=0

    # 1. 包文档检查 (5分)
    local total_packages=0
    local documented_packages=0

    # 获取所有包含.go文件的目录
    while IFS= read -r dir; do
        [ -z "$dir" ] && continue
        total_packages=$((total_packages + 1))

        # 检查该目录下是否有doc.go或包注释
        local has_doc=0
        if [ -f "$dir/doc.go" ]; then
            has_doc=1
        else
            # 检查任意.go文件开头是否有包注释
            local pkg_file=$(find "$dir" -name "*.go" -type f 2>/dev/null | head -1)
            if [ -n "$pkg_file" ] && head -10 "$pkg_file" 2>/dev/null | grep -qE "^// Package|^/\* Package"; then
                has_doc=1
            fi
        fi

        if [ "$has_doc" -eq 1 ]; then
            documented_packages=$((documented_packages + 1))
        else
            add_issue "P2" "$dir" "N/A" "包缺少文档" "" "添加包级别注释"
        fi
    done < <(find . -name "*.go" -type f -exec dirname {} \; 2>/dev/null | sort -u | head -15)

    if [ "$total_packages" -gt 0 ]; then
        local pkg_doc_ratio=$((documented_packages * 5 / total_packages))
        score=$((score + pkg_doc_ratio))
    fi
    issues_count=$((issues_count + total_packages - documented_packages))

    # 2. 导出函数/类型文档检查 (5分)
    local total_exports=0
    local documented_exports=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        total_exports=$((total_exports + 1))

        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)

        # 检查导出元素前是否有文档注释
        local start_line=$((lineno - 5))
        [ "$start_line" -lt 1 ] && start_line=1

        if sed -n "${start_line},${lineno}p" "$file" 2>/dev/null | grep -qE "^// [A-Z]"; then
            documented_exports=$((documented_exports + 1))
        else
            local short_file=$(echo "$file" | sed 's|^\./||')
            local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 40)
            add_issue "P2" "$short_file" "$lineno" "导出元素缺少文档" "$content" "添加Go文档注释"
        fi
    done < <(grep -rnE "^func [A-Z]|^type [A-Z]|^const [A-Z]|^var [A-Z]" --include="*.go" . 2>/dev/null | head -30)

    if [ "$total_exports" -gt 0 ]; then
        local export_doc_ratio=$((documented_exports * 5 / total_exports))
        score=$((score + export_doc_ratio))
    fi
    issues_count=$((issues_count + total_exports - documented_exports))

    # 3. TODO/FIXME检查 (5分)
    local todo_count=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "存在待处理标记" "$content" "及时处理或记录到Issue"
        todo_count=$((todo_count + 1))
    done < <(grep -rnE "TODO|FIXME|XXX|HACK" --include="*.go" . 2>/dev/null | head -15)

    if [ "$todo_count" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$todo_count" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + todo_count))

    echo "$score:$issues_count"
}

# 执行检查
check_go_comments
