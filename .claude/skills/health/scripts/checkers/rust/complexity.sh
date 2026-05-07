#!/bin/bash
# Rust 结构复杂性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_complexity_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_complexity() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 大文件检测 (2分) - 超过500行的文件
    # ============================================

    local large_files=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local lines=$(wc -l < "$file")
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P1" "$short_file" "N/A" "文件过大(${lines}行)" "" "拆分为多个模块"
        large_files=$((large_files + 1))
    done < <(find src -name "*.rs" -exec wc -l {} + 2>/dev/null | awk '$1 > 500 {print $2}' | head -10)

    if [ "$large_files" -eq 0 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + large_files))

    # ============================================
    # 2. 长函数检测 (2分) - 超过50行的函数
    # ============================================

    local long_funcs=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 统计函数数量
        local func_count=$(grep -cE "^\s*(pub\s+)?(async\s+)?fn " "$file" 2>/dev/null || echo 0)

        if [ "$func_count" -gt 0 ]; then
            local total_lines=$(wc -l < "$file")
            local avg_func_len=$((total_lines / func_count))

            if [ "$avg_func_len" -gt 50 ]; then
                add_issue "P1" "$short_file" "N/A" "函数可能过长" "平均${avg_func_len}行" "提取子函数"
                long_funcs=$((long_funcs + 1))
            fi
        fi
    done < <(find src -name "*.rs" 2>/dev/null | head -20)

    if [ "$long_funcs" -lt 5 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + long_funcs))

    # ============================================
    # 3. 结构体复杂度检查 (1分) - 字段数过多
    # ============================================

    local complex_structs=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local struct_name=$(echo "$line" | cut -d: -f3- | grep -oE "struct\s+\w+" | awk '{print $2}')
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 计算结构体字段数（从struct到}之间的字段数量）
        local struct_block=$(sed -n "${lineno},/^}/p" "$file" 2>/dev/null | head -50)
        local field_count=$(echo "$struct_block" | grep -cE "^\s*(pub\s+)?\w+:" || echo 0)

        if [ "$field_count" -gt 15 ]; then
            add_issue "P2" "$short_file" "$lineno" "结构体字段过多(${field_count}个)" "struct $struct_name" "拆分结构体"
            complex_structs=$((complex_structs + 1))
        fi
    done < <(grep -rnE "^\s*pub\s+struct " --include="*.rs" src/ 2>/dev/null | head -15)

    if [ "$complex_structs" -eq 0 ]; then
        score=$((score + 1))
    fi
    issues_count=$((issues_count + complex_structs))

    echo "$score:$issues_count"
}

check_rust_complexity