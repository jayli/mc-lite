#!/bin/bash
# JavaScript/Node.js 结构复杂性检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.js_complexity_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_js_complexity() {
    local score=0
    local issues_count=0

    # 1. 大文件 (2分)
    local large_files=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local lines=$(echo "$line" | awk '{print $1}')
        local file=$(echo "$line" | awk '{print $2}' | sed 's|^\./||')
        add_issue "P1" "$file" "N/A" "文件过大" "${lines}行" "按功能拆分"
        large_files=$((large_files + 1))
    done < <(find src lib -name "*.js" -o -name "*.ts" 2>/dev/null | \
        xargs wc -l 2>/dev/null | awk '$1 > 1000 {print $1, $2}' | sort -rn | head -15)

    [ "$large_files" -lt 5 ] && score=$((score + 2))
    issues_count=$((issues_count + large_files))

    # 2. 循环依赖 (1分)
    local circular=0
    while IFS= read -r file; do
        [ -f "$file" ] || continue
        local imports=$(grep -oE "from\s+['\"][^'\"]+['\"]|require\s*\(\s*['\"][^'\"]+['\"]" "$file" 2>/dev/null | \
            sed "s/.*['\"]//;s/['\"].*//")
        for imp in $imports; do
            if [ -f "$imp.js" ] && grep -q "$(basename "$file" .js)" "$imp.js" 2>/dev/null; then
                circular=$((circular + 1))
                local short_file=$(echo "$file" | sed 's|^\./||')
                add_issue "P1" "$short_file" "N/A" "疑似循环依赖" "" "重构代码消除循环依赖"
            fi
        done
    done < <(find src lib -name "*.js" -o -name "*.ts" 2>/dev/null)

    [ "$circular" -eq 0 ] && score=$((score + 1))

    echo "$score:$issues_count"
}

check_js_complexity
