#!/bin/bash
# Flutter/Dart 废代码检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_unused_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_unused() {
    local deduction=0
    local issues_count=0

    # 注释掉的代码
    local commented_blocks=$(grep -r '^\s*//.*class\s+\|^\s*//.*void\s+\|^\s*//.*Widget\s+\|^\s*//.*final\s+' \
        lib/ --include="*.dart" 2>/dev/null | wc -l)

    if [ "$commented_blocks" -gt 50 ]; then
        deduction=$((deduction + 15))
        add_issue "P1" "lib/" "N/A" "大量注释掉的代码" "${commented_blocks}处" "清理废弃代码"
    elif [ "$commented_blocks" -gt 30 ]; then
        deduction=$((deduction + 10))
        add_issue "P2" "lib/" "N/A" "较多注释掉的代码" "${commented_blocks}处" "清理废弃代码"
    elif [ "$commented_blocks" -gt 15 ]; then
        deduction=$((deduction + 5))
        add_issue "P2" "lib/" "N/A" "有注释掉的代码" "${commented_blocks}处" "清理废弃代码"
    fi

    # ignore注释
    local ignore_count=$(grep -r '// ignore:.*unused' lib/ --include="*.dart" 2>/dev/null | wc -l)
    if [ "$ignore_count" -gt 20 ]; then
        add_issue "P2" "lib/" "N/A" "较多未使用警告被忽略" "${ignore_count}处" "修复或移除未使用代码"
    fi

    echo "$deduction:0"
}

check_flutter_unused
