#!/bin/bash
# JavaScript/TypeScript 可观测性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.js_observability_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_js_observability() {
    local score=0
    local issues_count=0

    # 1. 监控配置检查 (1分)
    local monitoring_issues=0

    local has_sentry=0
    local has_datadog=0
    local has_newrelic=0
    local has_prometheus=0

    if [ -f "package.json" ]; then
        grep -qE '"@sentry' package.json && has_sentry=1
        grep -qE '"dd-trace|@datadog' package.json && has_datadog=1
        grep -qE '"newrelic"' package.json && has_newrelic=1
        grep -qE '"prom-client|@opentelemetry' package.json && has_prometheus=1
    fi

    local has_any_monitoring=$((has_sentry + has_datadog + has_newrelic + has_prometheus))

    if [ "$has_any_monitoring" -eq 0 ]; then
        add_issue "P2" "package.json" "N/A" "缺少监控工具" "无Sentry/Datadog等" "配置错误监控"
        monitoring_issues=$((monitoring_issues + 1))
    fi

    # 检查Web应用的健康检查端点
    if [ -f "package.json" ] && grep -qE '"express"|"fastify"|"koa"|"next"' package.json; then
        if ! grep -rqE "health|/health|healthcheck" --include="*.ts" --include="*.js" . 2>/dev/null; then
            add_issue "P2" "项目配置" "N/A" "缺少健康检查端点" "无/health端点" "添加健康检查接口"
            monitoring_issues=$((monitoring_issues + 1))
        fi
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
    if [ -f "package.json" ]; then
        grep -qE '"winston"|"pino"|"bunyan"|"loglevel"' package.json && has_structured_logging=1
    fi

    # 检查日志是否结构化
    if [ "$has_structured_logging" -eq 0 ]; then
        # 检查是否只用console
        local console_only=$(grep -rE "console\.(log|error|warn)" --include="*.ts" --include="*.js" . 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')

        if [ "$console_only" -gt 10 ]; then
            add_issue "P2" "项目配置" "N/A" "日志缺少结构化" "仅使用console" "使用winston/pino"
            logging_issues=$((logging_issues + 1))
        fi
    fi

    # 检查日志级别使用
    local has_log_levels=0
    grep -rqE "logger\.(debug|info|warn|error)|log\.(debug|info|warn|error)" --include="*.ts" --include="*.js" . 2>/dev/null && has_log_levels=1

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
    grep -rqE "traceId|trace_id|requestId|request_id|X-Trace-Id|X-Request-Id" --include="*.ts" --include="*.js" . 2>/dev/null && has_trace_id=1

    local has_otel=0
    if [ -f "package.json" ]; then
        grep -qE '"@opentelemetry|"@grpc/grpc-js"' package.json && has_otel=1
    fi

    if [ "$has_trace_id" -eq 0 ] && [ "$has_otel" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少请求追踪机制" "无TraceID" "添加请求ID追踪"
        tracing_issues=$((tracing_issues + 1))
    fi

    # 检查是否有性能追踪
    local has_perf_tracking=0
    grep -rqE "performance\.|performance\.mark|performance\.measure|console\.time" --include="*.ts" --include="*.js" . 2>/dev/null && has_perf_tracking=1

    if [ "$has_perf_tracking" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少性能追踪" "无耗时记录" "添加关键操作耗时日志"
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

check_js_observability