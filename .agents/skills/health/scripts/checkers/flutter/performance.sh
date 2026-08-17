#!/bin/bash
# Flutter 性能健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_performance_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_performance() {
    local score=0
    local issues_count=0

    # 1. 算法复杂度风险检查 (2分)
    local complexity_issues=0

    # 检查build方法中的循环
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local build_loop=$(grep -A50 "Widget build" "$file" 2>/dev/null | grep -cE "for\s*\(|forEach|map\s*\(" || echo 0)

        if [ "$build_loop" -gt 3 ]; then
            add_issue "P1" "$short_file" "N/A" "build方法内循环过多" "${build_loop}个循环" "提取为常量或缓存"
            complexity_issues=$((complexity_issues + 1))
        fi
    done < <(find lib -name "*.dart" 2>/dev/null | head -20)

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

    # 检查循环内的API调用
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P0" "$short_file" "$lineno" "循环内可能有API调用" "fetch in loop" "批量请求"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "(for|while).*await.*(get|post|fetch|http)" --include="*.dart" lib/ 2>/dev/null | head -10)

    # 检查ListView是否使用builder
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "可能缺少builder优化" "ListView with items" "使用ListView.builder"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "ListView\(\s*children" --include="*.dart" lib/ 2>/dev/null | head -10)

    if [ "$query_issues" -eq 0 ]; then
        score=$((score + 2))
    elif [ "$query_issues" -le 2 ]; then
        score=$((score + 1))
        issues_count=$((issues_count + query_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + query_issues))
    fi

    # 3. 内存管理风险检查 (1分)
    local memory_issues=0

    # 检查StreamController是否被关闭
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        if ! grep -qE "\.close\(\)|dispose\(\)" "$file" 2>/dev/null; then
            add_issue "P2" "$short_file" "N/A" "StreamController可能未关闭" "无close调用" "在dispose中关闭"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(grep -lE "StreamController" --include="*.dart" lib/ 2>/dev/null | head -10)

    # 检查Timer是否被取消
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        if ! grep -qE "Timer\?|cancel\(\)" "$file" 2>/dev/null; then
            add_issue "P2" "$short_file" "N/A" "Timer可能未取消" "无cancel调用" "在dispose中取消"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(grep -lE "Timer\." --include="*.dart" lib/ 2>/dev/null | head -10)

    if [ "$memory_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + memory_issues))
    fi

    echo "$score:$issues_count"
}

check_flutter_performance