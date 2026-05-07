#!/bin/bash
# Python 性能健康度检查
# 输出: 分数:问题数
# 检查项：算法复杂度风险(2分)、查询性能风险(2分)、内存管理风险(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.python_performance_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_python_performance() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 算法复杂度风险检查 (2分)
    # ============================================

    local complexity_issues=0

    # 检查深层嵌套循环（超过3层的嵌套for/while）
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 统计嵌套循环深度（简化检测）
        local max_indent=0
        while IFS= read -r line; do
            # 计算缩进级别（以空格数）
            local indent=$(echo "$line" | sed 's/[^ \t].*//' | wc -c | tr -d ' ')
            if [ "$indent" -gt "$max_indent" ]; then
                max_indent=$indent
            fi
        done < <(grep -E "^\s*(for|while)" "$file" 2>/dev/null)

        # 如果缩进超过12个空格（约3层），可能存在深层嵌套
        if [ "$max_indent" -gt 12 ]; then
            add_issue "P1" "$short_file" "N/A" "可能存在深层嵌套循环" "嵌套深度>${max_indent}" "重构为函数调用"
            complexity_issues=$((complexity_issues + 1))
        fi
    done < <(find . -name "*.py" -not -path "*/tests/*" 2>/dev/null | head -30)

    # 检查循环内的列表拼接（效率问题）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "循环内拼接列表" "list + list" "使用extend或yield"
        complexity_issues=$((complexity_issues + 1))
    done < <(grep -rnE "^\s*for.*:\s*$" --include="*.py" . 2>/dev/null | head -10)

    # 计算算法复杂度得分
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

    # 检查循环内的数据库/外部调用
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查是否有 for 循环后紧跟数据库/HTTP调用
        local has_loop_query=0

        # 检测模式：for 循环内有 query/get/post/fetch 等调用
        if grep -qE "for.*:.*query|for.*:.*get\(|for.*:.*fetch|for.*:.*request" "$file" 2>/dev/null; then
            has_loop_query=1
        fi

        # 更精确的检测：检查 for/while 循环块内是否有外部调用
        if grep -qE "^\s*(for|while).*:" "$file" 2>/dev/null; then
            # 检查循环内是否有 .query|.get|.post|.fetch
            if grep -A5E "^\s*(for|while).*:" "$file" 2>/dev/null | grep -qE "\.query|\.get\(|\.post\(|\.fetch|session\.|cursor\.|execute"; then
                has_loop_query=1
            fi
        fi

        if [ "$has_loop_query" -eq 1 ]; then
            add_issue "P0" "$short_file" "N/A" "循环内可能有数据库/HTTP调用" "N+1问题风险" "批量查询或缓存"
            query_issues=$((query_issues + 1))
        fi
    done < <(find . -name "*.py" -not -path "*/tests/*" 2>/dev/null | head -20)

    # 检查是否有缺失的批量操作（应使用批量但使用了逐条）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "可能有逐条操作" "append in loop" "考虑批量操作"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "for.*:\s*\n.*\.append|for.*:\s*\n.*\.save|for.*:\s*\n.*\.commit" --include="*.py" . 2>/dev/null | head -5)

    # 计算查询性能得分
    if [ "$query_issues" -eq 0 ]; then
        score=$((score + 2))
    elif [ "$query_issues" -le 1 ]; then
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

    # 检查是否有大对象在循环中创建
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查循环内是否有大列表/字典创建
        if grep -qE "^\s*for.*:" "$file" 2>/dev/null; then
            if grep -A5E "^\s*for.*:" "$file" 2>/dev/null | grep -qE "=\s*\[.*\]|=\s*\{.*\}"; then
                add_issue "P2" "$short_file" "N/A" "循环内创建大对象" "list/dict in loop" "预分配或使用生成器"
                memory_issues=$((memory_issues + 1))
            fi
        fi
    done < <(find . -name "*.py" -not -path "*/tests/*" 2>/dev/null | head -15)

    # 检查是否有未关闭的资源（文件/连接）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查是否使用了 with 语句（好的）或直接 open（坏的）
        if echo "$line" | grep -qE "open\(" && ! echo "$line" | grep -qE "with\s+open"; then
            # 检查上下文是否有 with
            local context_has_with=$(grep -B2 -A2 "$lineno" "$file" 2>/dev/null | grep -cE "with\s+open" || echo 0)
            if [ "$context_has_with" -eq 0 ]; then
                add_issue "P1" "$short_file" "$lineno" "文件可能未正确关闭" "open without with" "使用 with open()"
                memory_issues=$((memory_issues + 1))
            fi
        fi
    done < <(grep -rnE "open\(" --include="*.py" . 2>/dev/null | head -10)

    # 计算内存管理得分
    if [ "$memory_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + memory_issues))
    fi

    echo "$score:$issues_count"
}

# 执行检查
check_python_performance