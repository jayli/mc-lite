#!/bin/bash
# iOS/Objective-C 代码规范检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ios_standards_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_standards() {
    local score=0
    local issues_count=0

    # 1. 静态分析配置 (3分)
    if [ -f ".swiftlint.yml" ] || [ -f ".oclint" ] || [ -f ".clang-format" ]; then
        score=$((score + 3))
    else
        score=$((score + 1))
        add_issue "P2" "项目整体" "N/A" "缺少静态分析配置" "" "配置SwiftLint/OCLint/.clang-format"
        issues_count=$((issues_count + 1))
    fi

    # 2. 命名规范 (2分)
    local naming_violations=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "类名应以大写字母开头" "$content" "遵循PascalCase"
        naming_violations=$((naming_violations + 1))
    done < <(grep -rnE "^\s*@implementation\s+[a-z]" --include="*.m" --include="*.mm" . 2>/dev/null | head -10)

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "方法名应以小写字母开头" "$content" "遵循camelCase"
        naming_violations=$((naming_violations + 1))
    done < <(grep -rnE "^\s*[-+]\s*\([^(]+\)\s*[A-Z]" --include="*.m" --include="*.mm" . 2>/dev/null | head -10)

    [ "$naming_violations" -lt 20 ] && score=$((score + 2))
    issues_count=$((issues_count + naming_violations))

    # 3. 内存管理规范 (2分)
    local arc_mismatches=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P1" "$file" "$lineno" "ARC项目中使用MRC方法" "$content" "使用ARC自动管理"
        arc_mismatches=$((arc_mismatches + 1))
    done < <(grep -rnE "\[.*\s+retain\]|\[.*\s+release\]|\[.*\s+autorelease\]" \
        --include="*.m" --include="*.mm" . 2>/dev/null | head -10)

    [ "$arc_mismatches" -lt 10 ] && score=$((score + 2))
    issues_count=$((issues_count + arc_mismatches))

    # 4. Git提交规范 (3分)
    local total=$(git log --oneline -100 2>/dev/null | wc -l)
    local conventional=0
    if [ "$total" -gt 0 ]; then
        conventional=$(git log --oneline -100 2>/dev/null | \
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

check_ios_standards
