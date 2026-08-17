#!/bin/bash
# PHP 错误处理质量检查
# 输出: 分数:问题数
# 检查项：异常处理完整性(1分)、错误信息质量(1分)、日志记录(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.php_error_handling_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_php_error_handling() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 异常处理完整性检查 (1分)
    # ============================================

    local exception_issues=0

    # 检查是否有空的 catch 块
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查 catch 后是否只有 } 或空行
        local catch_block=$(sed -n "${lineno},$((lineno+5))p" "$file" 2>/dev/null)

        if echo "$catch_block" | grep -qE "catch\s*\([^)]*\)\s*\{" && echo "$catch_block" | grep -qE "^\s*\}\s*$"; then
            add_issue "P1" "$short_file" "$lineno" "异常处理为空" "catch without handler" "记录日志或合理处理"
            exception_issues=$((exception_issues + 1))
        fi
    done < <(grep -rnE "catch\s*\(" --include="*.php" . 2>/dev/null | grep -v vendor | head -10)

    # 检查关键操作是否有异常处理（文件操作、网络请求、数据库操作）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local context=$(sed -n "$((lineno-10)),${lineno}p" "$file" 2>/dev/null)
        if ! echo "$context" | grep -qE "try\s*\{|catch"; then
            add_issue "P1" "$short_file" "$lineno" "关键操作无异常处理" "file/network/db" "添加try-catch块"
            exception_issues=$((exception_issues + 1))
        fi
    done < <(grep -rnE "file_get_contents|file_put_contents|curl_exec|fopen|PDO::" --include="*.php" . 2>/dev/null | grep -v vendor | head -10)

    if [ "$exception_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + exception_issues))
    fi

    # ============================================
    # 2. 错误信息质量检查 (1分)
    # ============================================

    local error_info_issues=0

    # 检查是否有过于简单的错误信息
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local throw_msg=$(echo "$line" | grep -oE "throw.*Exception\s*\(['\"]([^'\"]+)['\"]" | sed "s/.*['\"]//;s/['\"]$//")

        if [ -n "$throw_msg" ] && [ "${#throw_msg}" -lt 5 ]; then
            add_issue "P2" "$short_file" "$lineno" "错误信息过于简单" "throw '$throw_msg'" "添加详细错误描述"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "throw\s+new\s+\w+Exception\s*\(" --include="*.php" . 2>/dev/null | grep -v vendor | head -10)

    if [ "$error_info_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + error_info_issues))
    fi

    # ============================================
    # 3. 日志记录检查 (1分)
    # ============================================

    local logging_issues=0

    # 检查是否配置了日志系统
    local has_logger=0

    grep -rqE "Log::|logger\(|Monolog|Illuminate\\\\Log" --include="*.php" . 2>/dev/null && has_logger=1

    if [ "$has_logger" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少日志配置" "无Log/Monolog" "配置日志系统"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查异常块内是否有日志记录
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local catch_block=$(sed -n "${lineno},$((lineno+10))p" "$file" 2>/dev/null | head -10)
        if ! echo "$catch_block" | grep -qE "Log::|logger\(|error_log|echo|print"; then
            add_issue "P2" "$short_file" "$lineno" "异常块无日志记录" "catch无logging" "添加Log::error"
            logging_issues=$((logging_issues + 1))
        fi
    done < <(grep -rnE "catch\s*\(" --include="*.php" . 2>/dev/null | grep -v vendor | head -10)

    if [ "$logging_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    fi

    echo "$score:$issues_count"
}

check_php_error_handling