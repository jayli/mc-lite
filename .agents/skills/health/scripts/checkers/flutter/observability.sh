#!/bin/bash
# Flutter 可观测性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_observability_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_observability() {
    local score=0
    local issues_count=0

    # 1. 监控配置检查 (1分)
    local monitoring_issues=0

    local has_firebase=0
    local has_sentry=0
    local has_crashlytics=0
    local has_datadog=0

    if [ -f "pubspec.yaml" ]; then
        grep -qE "firebase_crashlytics|firebase_analytics" pubspec.yaml && has_firebase=1
        grep -qE "sentry_flutter|sentry:" pubspec.yaml && has_sentry=1
        grep -qE "datadog_flutter" pubspec.yaml && has_datadog=1
    fi

    local has_any_monitoring=$((has_firebase + has_sentry + has_datadog))

    if [ "$has_any_monitoring" -eq 0 ]; then
        add_issue "P2" "pubspec.yaml" "N/A" "缺少崩溃监控" "无Crashlytics/Sentry" "配置崩溃监控"
        monitoring_issues=$((monitoring_issues + 1))
    fi

    # 检查性能监控
    local has_perf_monitor=0
    if [ -f "pubspec.yaml" ]; then
        grep -qE "firebase_performance|flutter_driver" pubspec.yaml && has_perf_monitor=1
    fi

    if [ "$has_perf_monitor" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少性能监控" "无性能监控" "配置性能监控"
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
    if [ -f "pubspec.yaml" ]; then
        grep -qE "logger:|logging:|log:" pubspec.yaml && has_structured_logging=1
    fi

    if [ "$has_structured_logging" -eq 0 ]; then
        add_issue "P2" "pubspec.yaml" "N/A" "缺少日志库" "无logger库" "引入logger库"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查日志级别
    local has_log_levels=0
    grep -rqE "log\.(debug|info|warn|error)|logger\.(d|i|w|e)" --include="*.dart" lib/ 2>/dev/null && has_log_levels=1

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

    local has_trace_id=0
    grep -rqE "traceId|trace_id|requestId|request_id|correlationId" --include="*.dart" lib/ 2>/dev/null && has_trace_id=1

    local has_otel=0
    if [ -f "pubspec.yaml" ]; then
        grep -qE "opentelemetry" pubspec.yaml && has_otel=1
    fi

    if [ "$has_trace_id" -eq 0 ] && [ "$has_otel" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少请求追踪机制" "无TraceID" "添加请求ID追踪"
        tracing_issues=$((tracing_issues + 1))
    fi

    # 检查Firebase Analytics
    local has_analytics=0
    if [ -f "pubspec.yaml" ]; then
        grep -qE "firebase_analytics|analytics" pubspec.yaml && has_analytics=1
    fi

    if [ "$has_analytics" -eq 0 ]; then
        add_issue "P2" "pubspec.yaml" "N/A" "缺少用户行为追踪" "无Analytics" "配置Analytics"
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

check_flutter_observability