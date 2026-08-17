#!/bin/bash
# Rust 性能健康度检查
# 输出: 分数:问题数
# 检查项：算法复杂度风险(2分)、查询性能风险(2分)、内存管理风险(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_performance_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_performance() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 算法复杂度风险检查 (2分)
    # ============================================

    local complexity_issues=0

    # 检查深层嵌套循环
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查是否有深层嵌套的 for 循环
        local nested_loop_count=$(grep -cE "for.*in.*\{[^}]*for.*in" "$file" 2>/dev/null || echo 0)

        if [ "$nested_loop_count" -gt 3 ]; then
            add_issue "P1" "$short_file" "N/A" "深层嵌套循环" "${nested_loop_count}层嵌套" "重构为函数调用"
            complexity_issues=$((complexity_issues + 1))
        fi
    done < <(find src -name "*.rs" 2>/dev/null | head -30)

    # 检查循环内的字符串拼接
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "循环内字符串拼接" "String + in loop" "使用String::with_capacity"
        complexity_issues=$((complexity_issues + 1))
    done < <(grep -rnE "for.*in.*push_str|for.*in.*format!" --include="*.rs" src/ 2>/dev/null | head -10)

    if [ "$complexity_issues" -eq 0 ]; then
        score=$((score + 2))
    elif [ "$complexity_issues" -le 2 ]; then
        score=$((score + 1))
        issues_count=$((issues_count + complexity_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + complexity_issues))
    fi

    # ============================================
    # 2. 查询性能风险检查 (2分)
    # ============================================

    local query_issues=0

    # 检查 N+1 查询问题（对于数据库操作）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P0" "$short_file" "$lineno" "可能有N+1查询" "循环内数据库调用" "批量查询"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "for.*in.*\{.*\.load\(|for.*in.*\{.*\.find\(|for.*in.*\{.*query" --include="*.rs" src/ 2>/dev/null | head -10)

    # 检查是否使用了异步但可能阻塞的操作
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P2" "$short_file" "$lineno" "异步函数中可能有阻塞操作" "blocking in async" "使用tokio::spawn_blocking"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "async fn.*\{.*std::fs|async fn.*\{.*std::net" --include="*.rs" src/ 2>/dev/null | head -10)

    if [ "$query_issues" -eq 0 ]; then
        score=$((score + 2))
    elif [ "$query_issues" -le 2 ]; then
        score=$((score + 1))
        issues_count=$((issues_count + query_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + query_issues))
    fi

    # ============================================
    # 3. 内存管理风险检查 (1分)
    # ============================================

    local memory_issues=0

    # 检查过多 clone() 调用
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local clone_count=$(grep -cE "\.clone\(\)" "$file" 2>/dev/null || echo 0)
        if [ "$clone_count" -gt 20 ]; then
            add_issue "P2" "$short_file" "N/A" "过多clone()调用" "${clone_count}处" "考虑使用引用"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(find src -name "*.rs" 2>/dev/null | head -20)

    # 检查大对象创建
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P2" "$short_file" "$lineno" "可能创建大对象" "Vec::with_capacity" "预分配或使用迭代器"
        memory_issues=$((memory_issues + 1))
    done < <(grep -rnE "Vec::new\(\).*for.*in|HashMap::new\(\).*for.*in" --include="*.rs" src/ 2>/dev/null | head -10)

    if [ "$memory_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + memory_issues))
    fi

    echo "$score:$issues_count"
}

check_rust_performance