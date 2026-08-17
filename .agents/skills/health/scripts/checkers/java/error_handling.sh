#!/bin/bash
# Java 错误处理质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.java_error_handling_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_error_handling() {
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

        add_issue "P1" "$short_file" "$lineno" "空catch块" "catch块为空" "添加错误处理或日志"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "catch\s*\([^)]*\)\s*\{\s*\}" --include="*.java" . 2>/dev/null | head -10)

    # 检查仅打印堆栈
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P2" "$short_file" "$lineno" "catch仅打印堆栈" "printStackTrace" "使用日志框架"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "catch.*\{\s*e\.printStackTrace\(\)" --include="*.java" . 2>/dev/null | head -10)

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

    # 检查throw是否有足够信息
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local error_msg=$(echo "$line" | grep -oE '"[^"]*"' | sed 's/"//g')
        if [ -n "$error_msg" ] && [ "${#error_msg}" -lt 5 ]; then
            add_issue "P2" "$short_file" "$lineno" "错误信息过于简单" "$error_msg" "添加详细错误描述"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "throw new \w+Exception\(" --include="*.java" . 2>/dev/null | head -10)

    if [ "$error_info_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + error_info_issues))
    fi

    # 3. 日志记录检查 (1分)
    local logging_issues=0

    # 检查是否有日志框架
    local has_logger=0
    grep -rqE "import.*slf4j|import.*log4j|import.*Logger" --include="*.java" . 2>/dev/null && has_logger=1

    if [ "$has_logger" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少日志框架" "无SLF4J/Log4j" "引入日志框架"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查catch块内是否有日志
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local catch_block=$(sed -n "${lineno},$((lineno+10))p" "$file" 2>/dev/null | head -10)
        if ! echo "$catch_block" | grep -qE "log\.|logger\.|LOG\."; then
            add_issue "P2" "$short_file" "$lineno" "catch块无日志" "无log.error" "添加错误日志"
            logging_issues=$((logging_issues + 1))
        fi
    done < <(grep -rnE "catch\s*\(" --include="*.java" . 2>/dev/null | head -10)

    if [ "$logging_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$logging_issues" -le 2 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    fi

    echo "$score:$issues_count"
}

check_java_error_handling