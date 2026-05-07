#!/bin/bash
# iOS 可观测性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ios_observability_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_observability() {
    local score=0
    local issues_count=0

    # 1. 监控配置检查 (1分)
    local monitoring_issues=0

    local has_crashlytics=0
    local has_sentry=0
    local has_bugsnag=0
    local has_datadog=0

    if [ -f "Podfile" ]; then
        grep -qE "Crashlytics|Firebase/Crashlytics" Podfile && has_crashlytics=1
        grep -qE "Sentry" Podfile && has_sentry=1
        grep -qE "Bugsnag" Podfile && has_bugsnag=1
        grep -qE "Datadog" Podfile && has_datadog=1
    fi

    grep -rqE "import Firebase|FirebaseApp\.configure|Crashlytics" --include="*.swift" . 2>/dev/null && has_crashlytics=1
    grep -rqE "import Sentry|SentrySDK" --include="*.swift" . 2>/dev/null && has_sentry=1

    local has_any_monitoring=$((has_crashlytics + has_sentry + has_bugsnag + has_datadog))

    if [ "$has_any_monitoring" -eq 0 ]; then
        add_issue "P2" "Podfile" "N/A" "缺少崩溃监控" "无Crashlytics/Sentry" "配置崩溃监控"
        monitoring_issues=$((monitoring_issues + 1))
    fi

    # 检查性能监控
    local has_perf_monitor=0
    if [ -f "Podfile" ]; then
        grep -qE "Firebase/Performance|MetricKit|NewRelic" Podfile && has_perf_monitor=1
    fi

    if [ "$has_perf_monitor" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少性能监控" "无MetricKit/Performance" "配置性能监控"
        monitoring_issues=$((monitoring_issues + 1))
    fi

    if [ "$monitoring_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + monitoring_issues))
    fi

    # 2. 日志系统检查 (1分)
    local logging_issues=0

    local has_structured_logging=0
    if [ -f "Podfile" ]; then
        grep -qE "CocoaLumberjack" Podfile && has_structured_logging=1
    fi

    grep -rqE "DDLog|DDFileLogger" --include="*.m" --include="*.swift" . 2>/dev/null && has_structured_logging=1

    if [ "$has_structured_logging" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "日志缺少结构化" "仅NSLog" "使用CocoaLumberjack"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查日志级别
    local has_log_levels=0
    grep -rqE "DDLogError|DDLogWarn|DDLogInfo|DDLogDebug|os_log_error|os_log_info" --include="*.m" --include="*.swift" . 2>/dev/null && has_log_levels=1

    if [ "$has_structured_logging" -eq 1 ] && [ "$has_log_levels" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "日志缺少级别区分" "无debug/info/error" "使用日志级别"
        logging_issues=$((logging_issues + 1))
    fi

    if [ "$logging_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    fi

    # 3. 追踪机制检查 (1分)
    local tracing_issues=0

    # iOS通常通过Firebase/Sentry实现追踪
    local has_tracing=0
    if [ -f "Podfile" ]; then
        grep -qE "Firebase/Analytics|Firebase/Crashlytics|Sentry" Podfile && has_tracing=1
    fi

    grep -rqE "trace|TraceID|requestID|signpost|os_signpost" --include="*.swift" --include="*.m" . 2>/dev/null && has_tracing=1

    if [ "$has_tracing" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少请求追踪机制" "无TraceID" "添加请求追踪"
        tracing_issues=$((tracing_issues + 1))
    fi

    # 检查os_signpost使用（性能追踪）
    local has_perf_tracing=0
    grep -rqE "os_signpost|OSSignposter|signpost" --include="*.swift" . 2>/dev/null && has_perf_tracing=1

    if [ "$has_perf_tracing" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少性能追踪" "无os_signpost" "添加性能追踪点"
        tracing_issues=$((tracing_issues + 1))
    fi

    if [ "$tracing_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + tracing_issues))
    fi

    echo "$score:$issues_count"
}

check_ios_observability