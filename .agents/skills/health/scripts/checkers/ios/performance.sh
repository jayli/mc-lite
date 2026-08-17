#!/bin/bash
# iOS 性能健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ios_performance_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_performance() {
    local score=0
    local issues_count=0

    # 1. 算法复杂度风险检查 (2分)
    local complexity_issues=0

    # 检查深层嵌套
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local max_indent=0
        while IFS= read -r line; do
            local indent=$(echo "$line" | sed 's/[^ \t].*//' | wc -c | tr -d ' ')
            if [ "$indent" -gt "$max_indent" ]; then
                max_indent=$indent
            fi
        done < <(grep -E "^\s*(for|while|if|dispatch_apply)" "$file" 2>/dev/null)

        if [ "$max_indent" -gt 20 ]; then
            add_issue "P1" "$short_file" "N/A" "深层嵌套代码" "嵌套深度>${max_indent}" "重构为方法调用"
            complexity_issues=$((complexity_issues + 1))
        fi
    done < <(find . -name "*.m" -o -name "*.swift" 2>/dev/null | head -30)

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

    # 检查主线程IO操作
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P0" "$short_file" "$lineno" "可能有主线程IO" "fetch in main thread" "使用后台线程"
        query_issues=$((query_issues + 1))
    done < <(grep -rnE "dispatch_sync.*main|dispatch_get_main_queue|DispatchQueue\.main\.sync" --include="*.m" --include="*.swift" . 2>/dev/null | head -10)

    # 检查Core Data批量操作
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local context=$(grep -A10 "for.*in.*fetch" "$file" 2>/dev/null | head -15)
        if echo "$context" | grep -qE "save|delete"; then
            add_issue "P1" "$short_file" "N/A" "可能有批量操作问题" "loop save/delete" "使用批量操作"
            query_issues=$((query_issues + 1))
        fi
    done < <(grep -lE "NSManagedObjectContext|ManagedObjectContext" --include="*.m" --include="*.swift" . 2>/dev/null | head -10)

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

    # 检查循环引用风险
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        if ! echo "$line" | grep -qE "weak|unowned|__weak|__unsafe_unretained"; then
            add_issue "P1" "$short_file" "$lineno" "可能有循环引用" "block捕获self" "使用weak self"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(grep -rnE "self\." --include="*.m" --include="*.swift" . 2>/dev/null | grep -E "dispatch_async|dispatch_sync|\^{" | head -15)

    # 检查未释放的Timer
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        if ! grep -qE "invalidate|Invalidate" "$file" 2>/dev/null; then
            add_issue "P2" "$short_file" "N/A" "可能有未释放Timer" "NSTimer无invalidate" "在dealloc中invalidate"
            memory_issues=$((memory_issues + 1))
        fi
    done < <(grep -lE "NSTimer|Timer|scheduledTimer" --include="*.m" --include="*.swift" . 2>/dev/null | head -10)

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

check_ios_performance