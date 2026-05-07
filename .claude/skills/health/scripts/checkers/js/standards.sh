#!/bin/bash
# JavaScript/Node.js 代码规范检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.js_standards_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|DETAIL:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_js_standards() {
    local score=0
    local issues_count=0

    # 1. ESLint配置 (3分)
    if [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ] || [ -f "eslint.config.js" ]; then
        score=$((score + 3))
    else
        add_issue "P2" "项目整体" "N/A" "缺少ESLint配置" "" "创建ESLint配置"
        issues_count=$((issues_count + 1))
    fi

    # 2. 命名一致性 (2分)
    local camelCase_violations=$(grep -rn "function\s\+_[a-z]\|const\s\+_[a-z]" \
        src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)

    if [ "$camelCase_violations" -lt 10 ]; then
        score=$((score + 2))
    else
        add_issue "P2" "src/" "N/A" "命名风格不一致" "${camelCase_violations}处下划线命名" "使用camelCase"
        issues_count=$((issues_count + 1))
    fi

    # 3. Git提交规范 (3分)
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

check_js_standards
