#!/bin/bash
# Java 性能健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.java_performance_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_performance() {
    local score=0
    local issues_count=0

    # 1. 算法复杂度风险检查 (2分)
    local complexity_issues=0

    # 检查深层嵌套
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 统计嵌套深度
        local max_indent=0
        while IFS= read -r line; do
            local indent=$(echo "$line" | sed 's/[^ \t].*//' | wc -c | tr -d ' ')
            if [ "$indent" -gt "$max_indent" ]; then
                max_indent=$indent
            fi
        done < <(grep -E "^\s*(for|while|if)" "$file" 2>/dev/null)

        if [ "$max_indent" -gt 20 ]; then
            add_issue "P1" "$short_file" "N/A" "深层嵌套代码" "嵌套深度>${max_indent}" "重构为方法调用"
            complexity_issues=$((complexity_issues + 1))
        fi
    done < <(find . -name "*.java" 2>/dev/null | head -30)

    # 检查循环内字符串拼接
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "循环内字符串拼接" "String + in loop" "使用StringBuilder"
        complexity_issues=$((complexity_issues + 1))
    done < <(grep -rnE "for\s*\([^)]*\)\s*\{[^}]*\+\s*\"" --include="*.java" . 2>/dev/null | head -10)

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

    # 检查N+1查询风险
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P0" "$short_file" "$lineno" "可能有N+1查询" "循环内数据库调用" "批量查询或JOIN FETCH"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "for\s*\([^)]*\)\s*\{[^}]*\.find|\.get\(|\.query" --include="*.java" . 2>/dev/null | head -10)

    # 检查缺少分页
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        if ! grep -qE "Pageable|Page<|LIMIT|OFFSET|fetchAll" "$file" 2>/dev/null; then
            add_issue "P2" "$short_file" "N/A" "可能缺少分页" "findAll无限制" "添加分页参数"
            query_issues=$((query_issues + 1))
        fi
    done < <(grep -lE "findAll\(\)|getAll\(\)" --include="*.java" . 2>/dev/null | head -10)

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

    # 检查未关闭的资源
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local context=$(sed -n "$((lineno-5)),${lineno}p" "$file" 2>/dev/null)
        if ! echo "$context" | grep -qE "try\s*\(|try-with-resources|AutoCloseable"; then
            add_issue "P1" "$short_file" "$lineno" "资源可能未关闭" "InputStream/Connection" "使用try-with-resources"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(grep -rnE "new (FileInputStream|FileOutputStream|BufferedReader|Connection)" --include="*.java" . 2>/dev/null | head -10)

    if [ "$memory_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + memory_issues))
    fi

    echo "$score:$issues_count"
}

check_java_performance