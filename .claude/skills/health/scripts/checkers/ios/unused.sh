#!/bin/bash
# iOS/Objective-C 废代码检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ios_unused_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_unused() {
    local deduction=0
    local issues_count=0

    # 1. 注释掉的代码块
    local commented_blocks=$(grep -rE '^\s*//.*-\s*\(|^\s*//.*@implementation\s+' --include="*.m" --include="*.mm" --include="*.h" . 2>/dev/null | wc -l)
    if [ "$commented_blocks" -gt 50 ]; then
        deduction=$((deduction + 15))
        add_issue "P1" "项目整体" "N/A" "大量注释掉的代码" "${commented_blocks}处" "清理废弃代码"
    elif [ "$commented_blocks" -gt 30 ]; then
        deduction=$((deduction + 10))
        add_issue "P2" "项目整体" "N/A" "较多注释掉的代码" "${commented_blocks}处" "清理废弃代码"
    elif [ "$commented_blocks" -gt 15 ]; then
        deduction=$((deduction + 5))
        add_issue "P2" "项目整体" "N/A" "有注释掉的代码" "${commented_blocks}处" "清理废弃代码"
    fi

    # 记录具体位置
    local shown=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        [ $shown -ge 10 ] && break
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "疑似废弃代码(注释)" "$content" "清理或恢复使用"
        shown=$((shown + 1))
        issues_count=$((issues_count + 1))
    done < <(grep -rnE "^\s*//.*-\s*\(|^\s*//.*@implementation\s+" --include="*.m" --include="*.mm" --include="*.h" . 2>/dev/null | head -10)

    # 2. 注释掉的import
    local unused_imports=$(grep -rE '^\s*//#import\s+|^\s*//@import' --include="*.m" --include="*.mm" . 2>/dev/null | wc -l)
    if [ "$unused_imports" -gt 20 ]; then
        add_issue "P2" "项目整体" "N/A" "大量注释掉的import" "${unused_imports}处" "清理未使用的import"
        deduction=$((deduction + 3))
    fi

    echo "$deduction:$issues_count"
}

check_ios_unused
