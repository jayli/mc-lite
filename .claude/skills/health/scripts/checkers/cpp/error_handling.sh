#!/bin/bash
# C++ 错误处理质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.cpp_error_handling_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_cpp_error_handling() {
    local score=0
    local issues_count=0

    # 1. 异常处理完整性检查 (1分)
    local exception_issues=0

    # 检查是否有异常处理
    local try_count=$(grep -rE "try\s*\{" --include="*.cpp" --include="*.cc" . 2>/dev/null | wc -l | tr -d ' ')
    local catch_count=$(grep -rE "catch\s*\(" --include="*.cpp" --include="*.cc" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$try_count" -eq 0 ]; then
        add_issue "P2" "项目全局" "N/A" "缺少异常处理" "无try-catch" "添加异常处理"
        exception_issues=$((exception_issues + 1))
    fi

    # 检查空catch块
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "空catch块" "catch为空" "添加错误处理"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "catch\s*\([^)]*\)\s*\{\s*\}" --include="*.cpp" --include="*.cc" . 2>/dev/null | head -10)

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

        if ! echo "$line" | grep -qE "what\(\)|message|error"; then
            add_issue "P2" "$short_file" "$lineno" "异常信息可能不足" "throw简单类型" "使用带信息的异常类"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "throw\s+" --include="*.cpp" --include="*.cc" . 2>/dev/null | head -10)

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
    grep -rqE "spdlog|glog|log4cxx|boost::log" --include="*.cpp" --include="*.h" . 2>/dev/null && has_logger=1

    if [ "$has_logger" -eq 0 ]; then
        # 检查是否只用printf/cout
        local print_count=$(grep -rE "printf|std::cout|std::cerr" --include="*.cpp" . 2>/dev/null | wc -l | tr -d ' ')

        if [ "$print_count" -gt 20 ]; then
            add_issue "P2" "项目配置" "N/A" "缺少日志库" "使用printf/cout" "引入spdlog等日志库"
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

check_cpp_error_handling