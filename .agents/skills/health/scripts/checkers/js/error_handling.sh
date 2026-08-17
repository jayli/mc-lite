#!/bin/bash
# JavaScript/TypeScript 错误处理质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.js_error_handling_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_js_error_handling() {
    local score=0
    local issues_count=0

    # 1. 异常处理完整性检查 (1分)
    local exception_issues=0

    # 检查空catch块
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "空catch块" "catch空或仅console" "添加错误处理逻辑"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "catch\s*\([^)]*\)\s*\{\s*\}" --include="*.ts" --include="*.js" . 2>/dev/null | grep -v node_modules | head -10)

    # 检查catch只有console.log
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P2" "$short_file" "$lineno" "catch仅打印日志" "catch仅console" "添加错误上报或恢复"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "catch.*\{\s*console\.(log|error)" --include="*.ts" --include="*.js" . 2>/dev/null | grep -v node_modules | head -10)

    if [ "$exception_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$exception_issues" -le 2 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + exception_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + exception_issues))
    fi

    # 2. 错误信息质量检查 (1分)
    local error_info_issues=0

    # 检查throw new Error是否有足够信息
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local error_msg=$(echo "$line" | grep -oE "Error\(['\"][^'\"]*['\"]\)" | sed "s/Error(['\"]//;s/['\"]$//")
        if [ -n "$error_msg" ] && [ "${#error_msg}" -lt 5 ]; then
            add_issue "P2" "$short_file" "$lineno" "错误信息过于简单" "$error_msg" "添加详细错误描述"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "throw new Error\(" --include="*.ts" --include="*.js" . 2>/dev/null | grep -v node_modules | head -10)

    if [ "$error_info_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + error_info_issues))
    fi

    # 3. 日志记录检查 (1分)
    local logging_issues=0

    # 检查是否过度使用console
    local console_count=$(grep -rE "console\.(log|error|warn)" --include="*.ts" --include="*.js" . 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')

    if [ "$console_count" -gt 50 ]; then
        add_issue "P2" "项目全局" "N/A" "过度使用console" "${console_count}处console" "使用专业日志库"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查是否有专业的日志库
    local has_logger=0
    if [ -f "package.json" ]; then
        grep -qE '"winston"|"pino"|"loglevel"|"bunyan"' package.json && has_logger=1
    fi

    if [ "$has_logger" -eq 0 ] && [ "$console_count" -gt 20 ]; then
        add_issue "P2" "package.json" "N/A" "缺少专业日志库" "无winston/pino等" "引入日志库"
        logging_issues=$((logging_issues + 1))
    fi

    if [ "$logging_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    fi

    echo "$score:$issues_count"
}

check_js_error_handling