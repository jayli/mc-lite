#!/bin/bash
# Flutter/Dart 结构复杂性检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_complexity_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_complexity() {
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
    done < <(find lib -name "*.dart" -not -path "*/generated/*" -not -path "*/.dart_tool/*" \
        -exec wc -l {} + 2>/dev/null | awk '$1 > 800 {print $1, $2}' | sort -rn | head -15)

    [ "$large_files" -lt 5 ] && score=$((score + 2))
    issues_count=$((issues_count + large_files))

    # 2. 循环依赖 (1分)
    local circular=0
    while IFS= read -r file; do
        [ -f "$file" ] || continue
        local imports=$(grep -oE "import\s+['\"][^'\"]+['\"]" "$file" 2>/dev/null | \
            sed "s/.*['\"]//;s/['\"].*//;s/\.dart$//" | xargs -I {} basename {} 2>/dev/null)
        local file_base=$(basename "$file" .dart)
        for imp in $imports; do
            local imp_file=$(find lib -name "${imp}.dart" 2>/dev/null | head -1)
            if [ -n "$imp_file" ] && [ "$imp_file" != "$file" ]; then
                if grep -q "$file_base" "$imp_file" 2>/dev/null; then
                    circular=$((circular + 1))
                    local short_file=$(echo "$file" | sed 's|^\./||')
                    add_issue "P1" "$short_file" "N/A" "疑似循环依赖" "与${imp}.dart相互导入" "重构消除循环依赖"
                fi
            fi
        done
    done < <(find lib -name "*.dart" -not -path "*/generated/*" -not -path "*/.dart_tool/*" 2>/dev/null)

    [ "$circular" -eq 0 ] && score=$((score + 1))

    echo "$score:$issues_count"
}

check_flutter_complexity
