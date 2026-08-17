#!/bin/bash
# C++ 性能健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.cpp_performance_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_cpp_performance() {
    local score=0
    local issues_count=0

    # 1. 算法复杂度风险检查 (2分)
    local complexity_issues=0

    # 检查嵌套循环
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local nested_loops=$(grep -cE "^\s{8,}(for|while)" "$file" 2>/dev/null || echo 0)

        if [ "$nested_loops" -gt 5 ]; then
            add_issue "P1" "$short_file" "N/A" "深层嵌套循环" "${nested_loops}处深层循环" "重构算法"
            complexity_issues=$((complexity_issues + 1))
        fi
    done < <(find . -name "*.cpp" -o -name "*.cc" 2>/dev/null | head -30)

    if [ "$complexity_issues" -eq 0 ]; then
        score=$((score + 2))
    elif [ "$complexity_issues" -le 2 ]; then
        score=$((score + 1))
        issues_count=$((issues_count + complexity_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + complexity_issues))
    fi

    # 2. 查询性能风险检查 (2分)
    local query_issues=0

    # 检查循环内的IO操作
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P0" "$short_file" "$lineno" "循环内可能有IO操作" "IO in loop" "批量操作或缓存"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "for\s*\(.*\)\s*\{[^}]*fopen|fread|fwrite|recv|send" --include="*.cpp" --include="*.cc" . 2>/dev/null | head -10)

    if [ "$query_issues" -eq 0 ]; then
        score=$((score + 2))
    elif [ "$query_issues" -le 1 ]; then
        score=$((score + 1))
        issues_count=$((issues_count + query_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + query_issues))
    fi

    # 3. 内存管理风险检查 (1分)
    local memory_issues=0

    # 检查裸指针new/delete
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P2" "$short_file" "$lineno" "使用裸指针" "new/delete" "使用智能指针"
        memory_issues=$((memory_issues + 1))
    done < <(grep -rnE "^\s*[a-zA-Z_]+\s*\*\s*\w+\s*=\s*new\s+" --include="*.cpp" --include="*.cc" . 2>/dev/null | head -15)

    # 检查内存泄漏风险
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local new_count=$(grep -cE "\bnew\b" "$file" 2>/dev/null || echo 0)
        local delete_count=$(grep -cE "\bdelete\b" "$file" 2>/dev/null || echo 0)

        if [ "$new_count" -gt "$((delete_count + 2))" ]; then
            add_issue "P1" "$short_file" "N/A" "可能有内存泄漏" "new:${new_count}, delete:${delete_count}" "检查内存管理"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(find . -name "*.cpp" -o -name "*.cc" 2>/dev/null | head -20)

    if [ "$memory_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + memory_issues))
    fi

    echo "$score:$issues_count"
}

check_cpp_performance