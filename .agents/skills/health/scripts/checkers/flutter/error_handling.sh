#!/bin/bash
# Flutter 错误处理质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_error_handling_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_error_handling() {
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

        add_issue "P1" "$short_file" "$lineno" "空catch块" "catch为空" "添加错误处理逻辑"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "catch\s*\([^)]*\)\s*\{\s*\}" --include="*.dart" lib/ 2>/dev/null | head -10)

    # 检查try-catch覆盖率
    local try_count=$(grep -cE "try\s*\{" --include="*.dart" lib/ -r 2>/dev/null | awk -F: '{sum+=$NF} END {print sum}' || echo 0)
    local async_count=$(grep -cE "async\s*\{" --include="*.dart" lib/ -r 2>/dev/null | awk -F: '{sum+=$NF} END {print sum}' || echo 0)

    if [ "$async_count" -gt 10 ] && [ "$try_count" -lt "$((async_count / 2))" ]; then
        add_issue "P2" "项目全局" "N/A" "异步方法缺少try-catch" "async:${async_count}, try:${try_count}" "添加异常处理"
        exception_issues=$((exception_issues + 1))
    fi

    if [ "$exception_issues" -eq 0 ]; then
        score=$((score + 1))
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

        local error_msg=$(echo "$line" | grep -oE "Exception\(['\"][^'\"]*['\"]\)" | sed "s/Exception(['\"]//;s/['\"]$//")
        if [ -n "$error_msg" ] && [ "${#error_msg}" -lt 5 ]; then
            add_issue "P2" "$short_file" "$lineno" "错误信息过于简单" "$error_msg" "添加详细错误描述"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "throw\s+\w+Exception\(" --include="*.dart" lib/ 2>/dev/null | head -10)

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
    if [ -f "pubspec.yaml" ]; then
        grep -qE "logger:|logging:|log:" pubspec.yaml && has_logger=1
    fi

    if [ "$has_logger" -eq 0 ]; then
        # 检查是否只用print
        local print_count=$(grep -rE "print\(" --include="*.dart" lib/ 2>/dev/null | wc -l | tr -d ' ')

        if [ "$print_count" -gt 20 ]; then
            add_issue "P2" "pubspec.yaml" "N/A" "过度使用print" "${print_count}处print" "使用logger库"
            logging_issues=$((logging_issues + 1))
        fi
    fi

    # 检查catch块内是否有日志
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local catch_block=$(sed -n "${lineno},$((lineno+10))p" "$file" 2>/dev/null | head -10)
        if ! echo "$catch_block" | grep -qE "log\.|logger\.|print\(|debugPrint"; then
            add_issue "P2" "$short_file" "$lineno" "catch块无日志" "无日志记录" "添加错误日志"
            logging_issues=$((logging_issues + 1))
        fi
    done < <(grep -rnE "catch\s*\(" --include="*.dart" lib/ 2>/dev/null | head -10)

    if [ "$logging_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    fi

    echo "$score:$issues_count"
}

check_flutter_error_handling