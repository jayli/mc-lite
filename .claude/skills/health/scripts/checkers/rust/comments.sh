#!/bin/bash
# Rust 注释完整度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_comments_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_comments() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 模块文档注释检查 (5分) - //! 或 ///
    # ============================================

    local total_modules=0
    local documented_modules=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        total_modules=$((total_modules + 1))

        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查文件开头是否有文档注释 //! 或 mod 文档
        local first_lines=$(head -20 "$file" 2>/dev/null)

        if echo "$first_lines" | grep -qE "^//!|^/\*!"; then
            documented_modules=$((documented_modules + 1))
        else
            add_issue "P2" "$short_file" "N/A" "模块缺少文档注释" "" "添加//!文档注释"
        fi
    done < <(find src -name "*.rs" -o -name "lib.rs" -o -name "main.rs" 2>/dev/null | head -20)

    if [ "$total_modules" -gt 0 ]; then
        local module_doc_ratio=$((documented_modules * 5 / total_modules))
        score=$((score + module_doc_ratio))
    fi
    issues_count=$((issues_count + total_modules - documented_modules))

    # ============================================
    # 2. 函数/结构体文档注释检查 (5分)
    # ============================================

    local total_items=0
    local documented_items=0

    # 检查公共函数文档
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        total_items=$((total_items + 1))

        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查函数定义前是否有文档注释 ///
        local prev_lines=$(sed -n "$((lineno-5)),${lineno}p" "$file" 2>/dev/null)

        if echo "$prev_lines" | grep -qE "^///|^/\*\*"; then
            documented_items=$((documented_items + 1))
        else
            local func_name=$(echo "$line" | cut -d: -f3- | grep -oE "fn\s+\w+" | awk '{print $2}')
            add_issue "P2" "$short_file" "$lineno" "函数缺少文档注释" "pub fn $func_name" "添加///文档注释"
        fi
    done < <(grep -rnE "^\s*pub\s+(async\s+)?fn " --include="*.rs" src/ 2>/dev/null | head -30)

    # 检查公共结构体文档
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        total_items=$((total_items + 1))

        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local prev_lines=$(sed -n "$((lineno-5)),${lineno}p" "$file" 2>/dev/null)

        if echo "$prev_lines" | grep -qE "^///|^/\*\*"; then
            documented_items=$((documented_items + 1))
        else
            local struct_name=$(echo "$line" | cut -d: -f3- | grep -oE "struct\s+\w+" | awk '{print $2}')
            add_issue "P2" "$short_file" "$lineno" "结构体缺少文档注释" "pub struct $struct_name" "添加///文档注释"
        fi
    done < <(grep -rnE "^\s*pub\s+struct " --include="*.rs" src/ 2>/dev/null | head -20)

    if [ "$total_items" -gt 0 ]; then
        local item_doc_ratio=$((documented_items * 5 / total_items))
        score=$((score + item_doc_ratio))
    fi
    issues_count=$((issues_count + total_items - documented_items))

    # ============================================
    # 3. TODO/FIXME检查 (5分)
    # ============================================

    local todo_count=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "存在待处理标记" "$content" "及时处理或记录到Issue"
        todo_count=$((todo_count + 1))
    done < <(grep -rnE "// TODO|// FIXME|// XXX|// HACK|TODO!|FIXME!" --include="*.rs" src/ 2>/dev/null | head -15)

    if [ "$todo_count" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$todo_count" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + todo_count))

    echo "$score:$issues_count"
}

check_rust_comments