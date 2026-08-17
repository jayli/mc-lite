#!/bin/bash
# Go 可观测性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.go_observability_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_go_observability() {
    local score=0
    local issues_count=0

    # 1. 监控配置检查 (1分)
    local monitoring_issues=0

    local has_prometheus=0
    local has_otel=0
    local has_sentry=0
    local has_datadog=0

    if [ -f "go.mod" ]; then
        grep -qE "prometheus/client_golang" go.mod && has_prometheus=1
        grep -qE "opentelemetry" go.mod && has_otel=1
        grep -qE "sentry-go" go.mod && has_sentry=1
        grep -qE "datadog" go.mod && has_datadog=1
    fi

    local has_any_monitoring=$((has_prometheus + has_otel + has_sentry + has_datadog))

    if [ "$has_any_monitoring" -eq 0 ]; then
        add_issue "P2" "go.mod" "N/A" "缺少监控工具" "无prometheus/otel" "配置prometheus"
        monitoring_issues=$((monitoring_issues + 1))
    fi

    # 检查健康检查端点
    local has_health=0
    grep -rqE "/health|healthcheck|HealthCheck" --include="*.go" . 2>/dev/null && has_health=1

    if [ "$has_health" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少健康检查端点" "无/health" "添加健康检查接口"
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
    grep -rqE "zap\.|logrus\.|zerolog\.|slog\." --include="*.go" . 2>/dev/null && has_structured_logging=1

    if [ "$has_structured_logging" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "日志缺少结构化" "无zap/logrus" "引入zap日志库"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查日志级别
    local has_log_levels=0
    grep -rqE "(Info|Debug|Warn|Error|Fatal)\(" --include="*.go" . 2>/dev/null && has_log_levels=1

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

    local has_trace=0
    grep -rqE "trace|TraceID|span|SpanID|otel|opentelemetry" --include="*.go" . 2>/dev/null && has_trace=1

    if [ "$has_trace" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少追踪机制" "无TraceID" "添加OpenTelemetry"
        tracing_issues=$((tracing_issues + 1))
    fi

    # 检查context传递
    local context_count=$(grep -rE "context\.Context" --include="*.go" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$context_count" -lt 5 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少context传递" "context使用少" "使用context传递追踪信息"
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

check_go_observability