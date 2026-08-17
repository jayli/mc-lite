#!/bin/bash
# Go 性能健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.go_performance_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_go_performance() {
    local score=0
    local issues_count=0

    # 1. 算法复杂度风险检查 (2分)
    local complexity_issues=0

    # 检查循环内分配
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "循环内可能有内存分配" "make/new in loop" "预分配或使用sync.Pool"
        complexity_issues=$((complexity_issues + 1))
    done < <(grep -rnE "for\s*\(.*\)\s*\{[^}]*make\(|for\s*\(.*\)\s*\{[^}]*new\(" --include="*.go" . 2>/dev/null | head -10)

    if [ "$complexity_issues" -eq 0 ]; then
        score=$((score + 2))
    else
        score=$((score + 1))
        issues_count=$((issues_count + complexity_issues))
    fi

    # 2. 查询性能风险检查 (2分)
    local query_issues=0

    # 检查循环内的数据库调用
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P0" "$short_file" "$lineno" "循环内可能有DB调用" "DB query in loop" "批量查询"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "for\s*\(.*range.*\)\s*\{[^}]*\.Find|\.First|\.Query|\.Exec" --include="*.go" . 2>/dev/null | head -10)

    # 检查是否使用预编译语句
    local prepare_count=$(grep -rE "Prepare|PrepareContext" --include="*.go" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$prepare_count" -eq 0 ]; then
        # 检查是否有重复执行的SQL
        local repeat_sql=$(grep -rE "for.*\{[^}]*db\." --include="*.go" . 2>/dev/null | wc -l | tr -d ' ')
        if [ "$repeat_sql" -gt 5 ]; then
            add_issue "P2" "项目全局" "N/A" "可能缺少预编译语句" "重复SQL执行" "使用Prepare"
            query_issues=$((query_issues + 1))
        fi
    fi

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

    # 检查大对象复制
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P2" "$short_file" "$lineno" "可能有大对象复制" "值传递大struct" "使用指针传递"
        memory_issues=$((memory_issues + 1))
    done < <(grep -rnE "func\s*\([^)]*\)\s+\w+\s*\(" --include="*.go" . 2>/dev/null | grep -v "\*" | head -15)

    # 检查goroutine泄漏风险
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        if ! grep -qE "context\.|Done\(\)|select\s*\{" "$file" 2>/dev/null; then
            add_issue "P2" "$short_file" "N/A" "goroutine可能泄漏" "无context控制" "使用context控制生命周期"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(grep -lE "go\s+func|go\s+\w+\(" --include="*.go" . 2>/dev/null | head -10)

    if [ "$memory_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + memory_issues))
    fi

    echo "$score:$issues_count"
}

check_go_performance