#!/bin/bash
# Java 可观测性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.java_observability_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_observability() {
    local score=0
    local issues_count=0

    # 1. 监控配置检查 (1分)
    local monitoring_issues=0

    local has_micrometer=0
    local has_prometheus=0
    local has_sentry=0
    local has_datadog=0
    local has_otel=0

    if [ -f "pom.xml" ]; then
        grep -qE "micrometer" pom.xml && has_micrometer=1
        grep -qE "prometheus" pom.xml && has_prometheus=1
        grep -qE "sentry" pom.xml && has_sentry=1
        grep -qE "dd-trace|datadog" pom.xml && has_datadog=1
        grep -qE "opentelemetry" pom.xml && has_otel=1
    fi

    if [ -f "build.gradle" ]; then
        grep -qE "micrometer" build.gradle && has_micrometer=1
        grep -qE "prometheus" build.gradle && has_prometheus=1
        grep -qE "sentry" build.gradle && has_sentry=1
        grep -qE "dd-trace|datadog" build.gradle && has_datadog=1
        grep -qE "opentelemetry" build.gradle && has_otel=1
    fi

    local has_any_monitoring=$((has_micrometer + has_prometheus + has_sentry + has_datadog + has_otel))

    if [ "$has_any_monitoring" -eq 0 ]; then
        add_issue "P2" "项目依赖" "N/A" "缺少监控工具" "无Micrometer/Sentry等" "配置监控系统"
        monitoring_issues=$((monitoring_issues + 1))
    fi

    # 检查健康检查端点
    if grep -rqE "HealthIndicator|@Health|actuator/health" --include="*.java" . 2>/dev/null; then
        :
    else
        add_issue "P2" "项目配置" "N/A" "缺少健康检查端点" "无HealthIndicator" "添加健康检查接口"
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
    grep -rqE "logstash|json-layout|structured-logging" --include="*.java" . 2>/dev/null && has_structured_logging=1

    if [ -f "pom.xml" ]; then
        grep -qE "logstash|logback-json" pom.xml && has_structured_logging=1
    fi
    if [ -f "build.gradle" ]; then
        grep -qE "logstash|logback-json" build.gradle && has_structured_logging=1
    fi

    if [ "$has_structured_logging" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "日志缺少结构化" "无JSON日志" "使用logstash-logback"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查日志级别
    local has_log_levels=0
    grep -rqE "log\.(debug|info|warn|error)|logger\.(debug|info|warn|error)" --include="*.java" . 2>/dev/null && has_log_levels=1

    if [ "$has_log_levels" -eq 0 ]; then
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
    grep -rqE "traceId|trace_id|MDC\.put|RequestId" --include="*.java" . 2>/dev/null && has_trace_id=1

    local has_otel=$((has_otel + 0))
    if [ -f "pom.xml" ]; then
        grep -qE "opentelemetry|spring-cloud-sleuth|brave" pom.xml && has_otel=1
    fi
    if [ -f "build.gradle" ]; then
        grep -qE "opentelemetry|spring-cloud-sleuth|brave" build.gradle && has_otel=1
    fi

    if [ "$has_trace_id" -eq 0 ] && [ "$has_otel" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少请求追踪机制" "无TraceID" "添加MDC TraceID"
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

check_java_observability