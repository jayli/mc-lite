#!/bin/bash
# Python 可观测性检查
# 输出: 分数:问题数
# 检查项：监控配置(1分)、日志系统(1分)、追踪机制(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.python_observability_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_python_observability() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 监控配置检查 (1分)
    # ============================================

    local monitoring_issues=0

    # 检查是否有性能监控/错误监控工具
    local has_sentry=0
    local has_prometheus=0
    local has_datadog=0
    local has_newrelic=0
    local has_otel=0

    grep -rqE "import sentry|from sentry" --include="*.py" . 2>/dev/null && has_sentry=1
    grep -rqE "import prometheus|from prometheus" --include="*.py" . 2>/dev/null && has_prometheus=1
    grep -rqE "import datadog|from datadog|ddtrace" --include="*.py" . 2>/dev/null && has_datadog=1
    grep -rqE "import newrelic|from newrelic" --include="*.py" . 2>/dev/null && has_newrelic=1
    grep -rqE "import opentelemetry|from opentelemetry|otel" --include="*.py" . 2>/dev/null && has_otel=1

    if [ -f "requirements.txt" ]; then
        grep -qiE "sentry" requirements.txt && has_sentry=1
        grep -qiE "prometheus" requirements.txt && has_prometheus=1
        grep -qiE "datadog|ddtrace" requirements.txt && has_datadog=1
        grep -qiE "newrelic" requirements.txt && has_newrelic=1
        grep -qiE "opentelemetry" requirements.txt && has_otel=1
    fi

    local has_any_monitoring=$((has_sentry + has_prometheus + has_datadog + has_newrelic + has_otel))

    if [ "$has_any_monitoring" -eq 0 ]; then
        add_issue "P2" "项目依赖" "N/A" "缺少监控工具" "无Sentry/Prometheus等" "配置错误监控如Sentry"
        monitoring_issues=$((monitoring_issues + 1))
    fi

    # 检查是否有健康检查端点（对于Web服务）
    local has_health_endpoint=0

    if [ -d "app" ]; then
        grep -rqE "health|/health|health_check" --include="*.py" app/ 2>/dev/null && has_health_endpoint=1
    fi

    # 如果有Web框架但没有健康检查端点
    if [ "$has_health_endpoint" -eq 0 ]; then
        local has_web_framework=0
        grep -rqE "flask|django|fastapi|@app\.route|@router" --include="*.py" . 2>/dev/null && has_web_framework=1

        if [ "$has_web_framework" -eq 1 ]; then
            add_issue "P2" "项目配置" "N/A" "缺少健康检查端点" "无/health端点" "添加健康检查接口"
            monitoring_issues=$((monitoring_issues + 1))
        fi
    fi

    # 计算监控配置得分
    if [ "$monitoring_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + monitoring_issues))
    fi

    # ============================================
    # 2. 日志系统检查 (1分)
    # ============================================

    local logging_issues=0

    # 检查是否有结构化日志（JSON格式）
    local has_structured_logging=0

    grep -rqE "json\.dumps|JSONFormatter|structlog|python-json-logger" --include="*.py" . 2>/dev/null && has_structured_logging=1

    if [ -f "requirements.txt" ]; then
        grep -qiE "python-json-logger|structlog" requirements.txt && has_structured_logging=1
    fi

    # 检查是否使用了标准logging模块
    local has_standard_logging=0

    grep -rqE "import logging|from logging" --include="*.py" . 2>/dev/null && has_standard_logging=1

    if [ "$has_standard_logging" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少日志模块" "无logging导入" "配置logging模块"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查日志级别使用是否合理（是否有DEBUG/INFO/WARNING/ERROR分级）
    local has_log_levels=0

    grep -rqE "logging\.debug|logging\.info|logging\.warning|logging\.error|logger\.debug|logger\.info" --include="*.py" . 2>/dev/null && has_log_levels=1

    if [ "$has_standard_logging" -eq 1 ] && [ "$has_log_levels" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "日志缺少级别区分" "只有print或无分级" "使用logging.debug/info/error"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查是否过度使用print而非logging
    local print_count=$(grep -rE "print\(" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$print_count" -gt 10 ]; then
        add_issue "P2" "项目配置" "N/A" "过度使用print而非logging" "${print_count}个print调用" "替换为logging"
        logging_issues=$((logging_issues + 1))
    fi

    # 计算日志系统得分
    if [ "$logging_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$logging_issues" -le 1 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    fi

    # ============================================
    # 3. 追踪机制检查 (1分)
    # ============================================

    local tracing_issues=0

    # 检查是否有请求追踪（TraceID/RequestID）
    local has_trace_id=0

    grep -rqE "trace_id|request_id|traceID|requestID|X-Trace-Id|X-Request-Id" --include="*.py" . 2>/dev/null && has_trace_id=1

    # 检查是否使用了OpenTelemetry或其他追踪工具
    local has_tracing_tool=$((has_otel + has_datadog))

    if [ "$has_trace_id" -eq 0 ] && [ "$has_tracing_tool" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少请求追踪机制" "无TraceID" "添加请求ID追踪"
        tracing_issues=$((tracing_issues + 1))
    fi

    # 检查是否有性能追踪/耗时记录
    local has_performance_tracking=0

    grep -rqE "time\.time|duration|elapsed|latency|perf_counter" --include="*.py" . 2>/dev/null && has_performance_tracking=1

    if [ "$has_performance_tracking" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少性能追踪" "无耗时记录" "添加关键操作耗时日志"
        tracing_issues=$((tracing_issues + 1))
    fi

    # 计算追踪机制得分
    if [ "$tracing_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$tracing_issues" -le 1 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + tracing_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + tracing_issues))
    fi

    echo "$score:$issues_count"
}

# 执行检查
check_python_observability