#!/bin/bash
# Flutter/Dart 注释质量检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_comments_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_comments() {
    local score=0
    local issues_count=0

    # 1. dartdoc覆盖率 (6分)
    local dartdoc_count=$(grep -r '^\s*///\|^\s*/\*\*' lib/ --include="*.dart" 2>/dev/null | wc -l)
    if [ "$dartdoc_count" -gt 50 ]; then
        score=$((score + 6))
    elif [ "$dartdoc_count" -gt 20 ]; then
        score=$((score + 3))
        add_issue "P2" "lib/" "N/A" "文档注释覆盖率不足" "${dartdoc_count}处" "为公共API添加///文档"
    else
        add_issue "P1" "lib/" "N/A" "文档注释严重不足" "${dartdoc_count}处" "为所有公共API添加dartdoc"
    fi
    issues_count=$((issues_count + 1))

    # 2. TODO/FIXME (4分)
    local todo_count=$(grep -r "TODO\|FIXME" lib/ --include="*.dart" 2>/dev/null | wc -l)
    if [ "$todo_count" -lt 20 ]; then
        score=$((score + 4))
    elif [ "$todo_count" -lt 50 ]; then
        score=$((score + 2))
        add_issue "P2" "lib/" "N/A" "TODO/FIXME较多" "${todo_count}处" "定期review并处理"
    else
        add_issue "P1" "lib/" "N/A" "TODO/FIXME过多" "${todo_count}处" "立即处理或移除"
    fi

    # 记录具体TODO位置
    local shown=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        [ $shown -ge 10 ] && break
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "TODO/FIXME标记" "$content" "review并处理"
        shown=$((shown + 1))
        issues_count=$((issues_count + 1))
    done < <(grep -rni "TODO\|FIXME" lib/ --include="*.dart" 2>/dev/null | head -10)

    echo "$score:$issues_count"
}

check_flutter_comments
