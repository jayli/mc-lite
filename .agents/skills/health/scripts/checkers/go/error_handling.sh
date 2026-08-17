#!/bin/bash
# Go 错误处理质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.go_error_handling_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_go_error_handling() {
    local score=0
    local issues_count=0

    # 1. 异常处理完整性检查 (1分)
    local exception_issues=0

    # 检查是否忽略错误
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P0" "$short_file" "$lineno" "忽略错误返回值" "未处理error" "检查并处理错误"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "^\s*\w+\.\w+\(" --include="*.go" . 2>/dev/null | grep -v "err\s*:=\|err\s*,\|if\s*err\|return\s*err\|err\s*!=\|err\s*==" | head -20)

    # 检查错误是否简单返回
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P2" "$short_file" "$lineno" "简单返回错误" "return err" "添加上下文信息"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "return\s+err\s*$" --include="*.go" . 2>/dev/null | head -15)

    if [ "$exception_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$exception_issues" -le 3 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + exception_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + exception_issues))
    fi

    # 2. 错误信息质量检查 (1分)
    local error_info_issues=0

    # 检查errors.New是否有足够信息
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local error_msg=$(echo "$line" | grep -oE 'errors\.New\("[^"]*"\)' | sed 's/errors\.New("//;s/")$//')
        if [ -n "$error_msg" ] && [ "${#error_msg}" -lt 10 ]; then
            add_issue "P2" "$short_file" "$lineno" "错误信息过于简单" "$error_msg" "添加详细错误描述"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "errors\.New\(" --include="*.go" . 2>/dev/null | head -10)

    if [ "$error_info_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + error_info_issues))
    fi

    # 3. 日志记录检查 (1分)
    local logging_issues=0

    # 检查是否有日志库
    local has_logger=0
    grep -rqE "logrus|zap|zerolog|slog" --include="*.go" . 2>/dev/null && has_logger=1

    if [ "$has_logger" -eq 0 ]; then
        # 检查是否只用log包
        local log_count=$(grep -rE "log\.(Print|Fatal|Panic)" --include="*.go" . 2>/dev/null | wc -l | tr -d ' ')

        if [ "$log_count" -gt 10 ]; then
            add_issue "P2" "项目配置" "N/A" "缺少结构化日志" "使用标准log" "引入zap/logrus"
            logging_issues=$((logging_issues + 1))
        fi
    fi

    if [ "$logging_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    fi

    echo "$score:$issues_count"
}

check_go_error_handling