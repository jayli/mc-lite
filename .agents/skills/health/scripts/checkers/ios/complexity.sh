#!/bin/bash
# iOS/Objective-C 结构复杂性检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ios_complexity_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_complexity() {
    local score=0
    local issues_count=0

    # 1. 大文件检查 (2分)
    local large_files=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local lines=$(echo "$line" | awk '{print $1}')
        local file=$(echo "$line" | awk '{print $2}' | sed 's|^\./||')
        add_issue "P1" "$file" "N/A" "文件过大" "${lines}行" "按功能拆分模块"
        large_files=$((large_files + 1))
    done < <(find . \( -name "*.m" -o -name "*.mm" -o -name "*.swift" \) \
        -not -path "*/Pods/*" -not -path "*/build/*" -not -path "*/DerivedData/*" \
        -exec wc -l {} + 2>/dev/null | awk '$1 > 800 {print $1, $2}' | sort -rn | head -15)

    [ "$large_files" -lt 10 ] && score=$((score + 2))
    issues_count=$((issues_count + large_files))

    # 2. 方法长度 (2分)
    local method_count=$(grep -rE "^\s*[-+]\s*\(" --include="*.m" --include="*.mm" . 2>/dev/null | wc -l)
    [ "$method_count" -lt 50 ] && score=$((score + 2))

    # 3. 头文件前向声明 (1分)
    local total_headers=$(find . -name "*.h" -not -path "*/Pods/*" -not -path "*/build/*" 2>/dev/null | wc -l)
    if [ "$total_headers" -gt 0 ]; then
        local forward_decl=$(grep -rl "@class" --include="*.h" . 2>/dev/null | wc -l)
        if [ $((forward_decl * 4)) -lt "$total_headers" ]; then
            add_issue "P2" "头文件整体" "N/A" "前向声明不足" "仅${forward_decl}/${total_headers}使用@class" "在.h中使用@class减少依赖"
            issues_count=$((issues_count + 1))
        else
            score=$((score + 1))
        fi
    fi

    echo "$score:$issues_count"
}

check_ios_complexity
