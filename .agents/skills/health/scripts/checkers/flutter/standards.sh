#!/bin/bash
# Flutter/Dart 代码规范检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_standards_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_standards() {
    local score=0
    local issues_count=0

    # 1. Lint配置 (3分)
    if [ -f "analysis_options.yaml" ]; then
        score=$((score + 3))
    else
        add_issue "P2" "项目整体" "N/A" "缺少analysis_options.yaml" "" "创建analysis_options.yaml"
        issues_count=$((issues_count + 1))
    fi

    # 2. 命名规范 (2分)
    local naming_violations=$(grep -rE 'class\s+[a-z]' lib/ --include="*.dart" 2>/dev/null | wc -l)
    if [ "$naming_violations" -lt 10 ]; then
        score=$((score + 2))
    else
        add_issue "P2" "lib/" "N/A" "类名命名不规范" "${naming_violations}处小写开头" "使用PascalCase"
        issues_count=$((issues_count + 1))
    fi

    # 3. Lint警告 (2分)
    local ignore_count=$(grep -r '// ignore:\|// ignore_for_file:' lib/ --include="*.dart" 2>/dev/null | wc -l)
    if [ "$ignore_count" -lt 20 ]; then
        score=$((score + 2))
    elif [ "$ignore_count" -lt 40 ]; then
        score=$((score + 1))
        add_issue "P2" "lib/" "N/A" "较多忽略lint规则" "${ignore_count}处// ignore" "修复lint警告"
    else
        add_issue "P1" "lib/" "N/A" "大量忽略lint规则" "${ignore_count}处// ignore" "重构代码消除警告"
    fi

    # 4. Git提交规范 (3分)
    local total=$(git log --oneline -100 2>/dev/null | wc -l)
    if [ "$total" -gt 0 ]; then
        local conventional=$(git log --oneline -100 2>/dev/null | \
            grep -cE "^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)" || true)
        local ratio=$((conventional * 100 / total))
        if [ "$ratio" -gt 70 ]; then
            score=$((score + 3))
        elif [ "$ratio" -gt 40 ]; then
            score=$((score + 2))
        elif [ "$ratio" -gt 20 ]; then
            score=$((score + 1))
        fi
    fi

    echo "$score:$issues_count"
}

check_flutter_standards
