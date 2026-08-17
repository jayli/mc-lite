#!/bin/bash
# iOS 错误处理质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ios_error_handling_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_error_handling() {
    local score=0
    local issues_count=0

    # 1. 异常处理完整性检查 (1分)
    local exception_issues=0

    # 检查空@catch块
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "空@catch块" "@catch为空" "添加错误处理或日志"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "@catch\s*\([^)]*\)\s*\{\s*\}" --include="*.m" . 2>/dev/null | head -10)

    # 检查Swift空catch
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        add_issue "P1" "$short_file" "$lineno" "空catch块" "catch为空" "添加错误处理"
        exception_issues=$((exception_issues + 1))
    done < <(grep -rnE "catch\s*\{\s*\}" --include="*.swift" . 2>/dev/null | head -10)

    # 检查NSError**参数是否被检查
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查方法中是否有NSError**参数但未使用
        if grep -qE "NSError\s*\*\*\s*error" "$file" 2>/dev/null; then
            if ! grep -qE "if\s*\(\s*error\s*\)|error\s*=" "$file" 2>/dev/null; then
                add_issue "P2" "$short_file" "N/A" "NSError参数未检查" "error参数未使用" "检查并设置error"
                exception_issues=$((exception_issues + 1))
            fi
        fi
    done < <(find . -name "*.m" 2>/dev/null | head -20)

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

    # 检查NSAssert是否有足够信息
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        local assert_msg=$(echo "$line" | grep -oE '@"[^"]*"' | sed 's/@"//;s/"//')
        if [ -n "$assert_msg" ] && [ "${#assert_msg}" -lt 5 ]; then
            add_issue "P2" "$short_file" "$lineno" "断言信息过于简单" "$assert_msg" "添加详细断言描述"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "NSAssert\(|NSCAssert\(" --include="*.m" . 2>/dev/null | head -10)

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
    grep -rqE "CocoaLumberjack|NSLog|os_log|Logger\(" --include="*.m" --include="*.swift" . 2>/dev/null && has_logger=1

    if [ "$has_logger" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少日志框架" "无CocoaLumberjack等" "引入日志框架"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查NSLog过度使用
    local nslog_count=$(grep -rE "NSLog\(" --include="*.m" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$nslog_count" -gt 50 ]; then
        add_issue "P2" "项目全局" "N/A" "过度使用NSLog" "${nslog_count}处NSLog" "使用CocoaLumberjack"
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

check_ios_error_handling