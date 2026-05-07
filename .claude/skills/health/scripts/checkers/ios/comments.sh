#!/bin/bash
# iOS/Objective-C 注释质量检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ios_comments_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_comments() {
    local score=0
    local issues_count=0

    # 1. 头文件注释 (6分)
    local header_comments=$(grep -rE '^\s*/\*\*|^\s*///|^\s*/\*' --include="*.h" . 2>/dev/null | wc -l)
    if [ "$header_comments" -gt 50 ]; then
        score=$((score + 6))
    elif [ "$header_comments" -gt 20 ]; then
        score=$((score + 3))
        add_issue "P2" "头文件整体" "N/A" "头文件注释覆盖率不足" "${header_comments}处注释" "为公共API添加文档"
    else
        add_issue "P1" "头文件整体" "N/A" "头文件注释严重不足" "${header_comments}处注释" "为所有接口添加文档"
    fi
    issues_count=$((issues_count + 1))

    # 2. 实现文件注释 (5分)
    local impl_comments=$(grep -rE '^\s*/\*\*|^\s*///|^\s*/\*' --include="*.m" --include="*.mm" --include="*.swift" . 2>/dev/null | wc -l)
    if [ "$impl_comments" -gt 50 ]; then
        score=$((score + 5))
    elif [ "$impl_comments" -gt 20 ]; then
        score=$((score + 3))
        add_issue "P2" "实现文件整体" "N/A" "实现文件注释较少" "${impl_comments}处注释" "为复杂逻辑添加注释"
    else
        add_issue "P1" "实现文件整体" "N/A" "实现文件几乎没有注释" "${impl_comments}处注释" "添加必要注释"
    fi
    issues_count=$((issues_count + 1))

    # 3. TODO/FIXME (4分)
    local todo_count=$(grep -ri "TODO\|FIXME\|HACK\|XXX" --include="*.m" --include="*.mm" --include="*.h" --include="*.swift" . 2>/dev/null | wc -l)
    if [ "$todo_count" -lt 20 ]; then
        score=$((score + 4))
    elif [ "$todo_count" -lt 50 ]; then
        score=$((score + 2))
        add_issue "P2" "项目整体" "N/A" "TODO/FIXME较多" "${todo_count}处" "定期review并处理"
    else
        add_issue "P1" "项目整体" "N/A" "TODO/FIXME过多" "${todo_count}处" "立即处理或移除过期TODO"
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
    done < <(grep -rni "TODO\|FIXME\|HACK\|XXX" --include="*.m" --include="*.mm" --include="*.h" --include="*.swift" . 2>/dev/null | head -10)

    echo "$score:$issues_count"
}

check_ios_comments
