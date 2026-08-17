#!/bin/bash
# Ruby 性能健康度检查
# 输出: 分数:问题数
# 检查项：算法复杂度风险(2分)、查询性能风险(2分)、内存管理风险(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ruby_performance_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ruby_performance() {
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

        # 检查是否有深层嵌套的 each/map 循环
        local nested_loop_count=$(grep -cE "\.each\s*\{.*\.each|\.map\s*\{.*\.map" "$file" 2>/dev/null || echo 0)

        if [ "$nested_loop_count" -gt 3 ]; then
            add_issue "P1" "$short_file" "N/A" "深层嵌套循环" "${nested_loop_count}层嵌套" "重构为方法调用"
            complexity_issues=$((complexity_issues + 1))
        fi
    done < <(find . -name "*.rb" -not -path "*/test/*" 2>/dev/null | head -30)

    # 检查循环内的字符串拼接
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "循环内字符串拼接" "String + in loop" "使用join或<<"
        complexity_issues=$((complexity_issues + 1))
    done < <(grep -rnE "\.each.*\+=|\.map.*\+=" --include="*.rb" . 2>/dev/null | head -10)

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

    # 检查 N+1 查询问题（Rails 特有）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P0" "$short_file" "$lineno" "可能有N+1查询" "循环内数据库调用" "使用includes/preload"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "\.each\s*\{.*\.|\)\.each.*\.save|\)\.each.*\.update" --include="*.rb" . 2>/dev/null | head -10)

    # 检查缺少 eager loading
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查是否有 association 调用但缺少 includes
        if grep -qE "\.association|\.belongs_to|\.has_many" "$file" 2>/dev/null; then
            if ! grep -qE "includes|preload|eager_load" "$file" 2>/dev/null; then
                add_issue "P2" "$short_file" "N/A" "可能缺少eager loading" "关联调用无includes" "添加includes避免N+1"
                query_issues=$((query_issues + 1))
            fi
        fi
    done < <(find . -name "*.rb" -path "*/models/*" 2>/dev/null | head -10)

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

    # 检查是否有大对象在循环中创建
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查循环内是否有大数组/哈希创建
        if grep -qE "\.each\s*\{|\.map\s*\{" "$file" 2>/dev/null; then
            if grep -AE "\.each\s*\{|\.map\s*\{" "$file" 2>/dev/null | grep -qE "\[\s*\]|Hash\.new|\{"; then
                add_issue "P2" "$short_file" "N/A" "循环内创建大对象" "array/hash in loop" "预分配或使用lazy"
                memory_issues=$((memory_issues + 1))
            fi
        fi
    done < <(find . -name "*.rb" -not -path "*/test/*" 2>/dev/null | head -15)

    # 检查是否有未关闭的文件/连接
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查是否使用了 File.open 但没有 block 形式
        local context=$(sed -n "${lineno},$((lineno+5))p" "$file" 2>/dev/null)
        if ! echo "$context" | grep -qE "File\.open.*\{|do\s*\|"; then
            add_issue "P1" "$short_file" "$lineno" "文件可能未正确关闭" "File.open without block" "使用block形式"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(grep -rnE "File\.open|IO\.open" --include="*.rb" . 2>/dev/null | head -10)

    if [ "$memory_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + memory_issues))
    fi

    echo "$score:$issues_count"
}

check_ruby_performance