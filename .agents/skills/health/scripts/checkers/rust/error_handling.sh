#!/bin/bash
# Rust 错误处理质量检查
# 输出: 分数:问题数
# 检查项：异常处理完整性(1分)、错误信息质量(1分)、日志记录(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_error_handling_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_error_handling() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 异常处理完整性检查 (1分)
    # ============================================

    local exception_issues=0

    # 检查是否有 unwrap() 调用（可能导致 panic）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 排除测试代码
        if ! echo "$file" | grep -qE "test|spec"; then
            add_issue "P1" "$short_file" "$lineno" "使用unwrap()可能panic" ".unwrap()" "使用expect()或?操作符"
            exception_issues=$((exception_issues + 1))
        fi
    done < <(grep -rnE "\.unwrap\(\)" --include="*.rs" src/ 2>/dev/null | head -15)

    # 检查是否有 expect() 但信息过于简单
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local expect_msg=$(echo "$line" | grep -oE "expect\(\"[^\"]+\"\)" | sed 's/expect("//;s/")$//')
        if [ -n "$expect_msg" ] && [ "${#expect_msg}" -lt 10 ]; then
            add_issue "P2" "$short_file" "$lineno" "expect信息过于简单" "expect(\"$expect_msg\")" "添加详细错误描述"
            exception_issues=$((exception_issues + 1))
        fi
    done < <(grep -rnE "\.expect\(\"" --include="*.rs" src/ 2>/dev/null | head -10)

    if [ "$exception_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$exception_issues" -le 3 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + exception_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + exception_issues))
    fi

    # ============================================
    # 2. 错误信息质量检查 (1分)
    # ============================================

    local error_info_issues=0

    # 检查是否有自定义错误类型
    local has_error_type=0
    grep -rqE "enum.*Error|struct.*Error|impl.*Error|thiserror|anyhow" --include="*.rs" src/ 2>/dev/null && has_error_type=1

    if [ "$has_error_type" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少自定义错误类型" "无Error enum/struct" "定义错误类型或使用thiserror"
        error_info_issues=$((error_info_issues + 1))
    fi

    # 检查 Result 返回类型是否有明确错误
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查返回 Result<(), Box<dyn Error>> 等模糊类型
        if echo "$line" | grep -qE "Result.*Box<dyn.*Error|Result.*anyhow|Result.*Error>"; then
            # 这些是可接受的
            :
        elif echo "$line" | grep -qE "-> Result" && ! echo "$line" | grep -qE "Error>|anyhow"; then
            add_issue "P2" "$short_file" "$lineno" "Result返回类型模糊" "Result without specific error" "明确错误类型"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "-> Result" --include="*.rs" src/ 2>/dev/null | head -10)

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

    # 检查是否使用了日志库
    local has_logging=0
    grep -rqE "log::|tracing::|println!|eprintln!" --include="*.rs" src/ 2>/dev/null && has_logging=1

    if [ "$has_logging" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少日志配置" "无log/tracing使用" "配置log或tracing"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查是否有日志级别使用
    local has_log_levels=0
    grep -rqE "debug!|info!|warn!|error!|trace!" --include="*.rs" src/ 2>/dev/null && has_log_levels=1

    if [ "$has_logging" -eq 1 ] && [ "$has_log_levels" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "日志缺少级别区分" "只有println!" "使用info!/error!等"
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

check_rust_error_handling