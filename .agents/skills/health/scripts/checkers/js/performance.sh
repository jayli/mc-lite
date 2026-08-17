#!/bin/bash
# JavaScript/TypeScript 性能健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.js_performance_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_js_performance() {
    local score=0
    local issues_count=0

    # 1. 算法复杂度风险检查 (2分)
    local complexity_issues=0

    # 检查深层嵌套
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查嵌套回调或循环
        local nested=$(grep -cE "^\s{16,}(for|while|if|map|forEach|filter|reduce)" "$file" 2>/dev/null || echo 0)

        if [ "$nested" -gt 5 ]; then
            add_issue "P1" "$short_file" "N/A" "深层嵌套代码" "${nested}处深层嵌套" "重构为函数调用"
            complexity_issues=$((complexity_issues + 1))
        fi
    done < <(find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | grep -v node_modules | head -30)

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

        add_issue "P0" "$short_file" "$lineno" "循环内可能有API调用" "fetch/axios in loop" "批量请求或并发控制"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "(for|while|forEach|map)\s*\([^)]*\)\s*\{[^}]*fetch|axios|request" --include="*.ts" --include="*.js" . 2>/dev/null | grep -v node_modules | head -10)

    # 检查缺少key的列表渲染
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "列表渲染缺少key" "map without key" "添加唯一key属性"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "\.map\(.*=>" --include="*.tsx" --include="*.jsx" . 2>/dev/null | grep -v "key=" | grep -v node_modules | head -10)

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

    # 检查未清理的事件监听器
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        if ! grep -q "removeEventListener" "$file" 2>/dev/null; then
            add_issue "P2" "$short_file" "N/A" "可能有未清理的事件监听" "addEventListener无remove" "useEffect cleanup"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(grep -lE "addEventListener" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" . 2>/dev/null | grep -v node_modules | head -10)

    # 检查未清理的定时器
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        if ! grep -qE "clearTimeout|clearInterval" "$file" 2>/dev/null; then
            add_issue "P2" "$short_file" "N/A" "可能有未清理的定时器" "setTimeout无clear" "清理定时器"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(grep -lE "setTimeout|setInterval" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" . 2>/dev/null | grep -v node_modules | head -10)

    if [ "$memory_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$memory_issues" -le 2 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + memory_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + memory_issues))
    fi

    echo "$score:$issues_count"
}

check_js_performance