#!/bin/bash
# PHP 可观测性检查
# 输出: 分数:问题数
# 检查项：监控配置(1分)、日志系统(1分)、追踪机制(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.php_observability_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_php_observability() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 监控配置检查 (1分)
    # ============================================

    local monitoring_issues=0

    # 检查是否有性能监控/错误监控工具
    local has_sentry=0
    local has_newrelic=0
    local has_datadog=0
    local has_prometheus=0

    grep -rqE "Sentry|sentry" --include="*.php" . 2>/dev/null && has_sentry=1
    grep -rqE "newrelic|NewRelic" --include="*.php" . 2>/dev/null && has_newrelic=1
    grep -rqE "datadog|Datadog" --include="*.php" . 2>/dev/null && has_datadog=1
    grep -rqE "prometheus|Prometheus" --include="*.php" . 2>/dev/null && has_prometheus=1

    # 检查 composer.json
    if [ -f "composer.json" ]; then
        grep -qiE "sentry" composer.json && has_sentry=1
        grep -qiE "newrelic" composer.json && has_newrelic=1
        grep -qiE "datadog" composer.json && has_datadog=1
        grep -qiE "prometheus" composer.json && has_prometheus=1
    fi

    local has_any_monitoring=$((has_sentry + has_newrelic + has_datadog + has_prometheus))

    if [ "$has_any_monitoring" -eq 0 ]; then
        add_issue "P2" "项目依赖" "N/A" "缺少监控工具" "无Sentry/NewRelic等" "配置错误监控"
        monitoring_issues=$((monitoring_issues + 1))
    fi

    # 检查是否有健康检查端点（对于Laravel应用）
    local has_health_endpoint=0

    if [ -d "app/Http/Controllers" ] || [ -d "src/Controller" ]; then
        grep -rqE "health|HealthController" --include="*.php" app/Http/Controllers src/Controller 2>/dev/null && has_health_endpoint=1
    fi

    if [ "$has_health_endpoint" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少健康检查端点" "无/health端点" "添加健康检查接口"
        monitoring_issues=$((monitoring_issues + 1))
    fi

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

    # 检查是否使用了标准 Logger
    local has_logger=0

    grep -rqE "Log::|logger\(|Monolog|error_log" --include="*.php" . 2>/dev/null && has_logger=1

    if [ "$has_logger" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少日志模块" "无Log/Monolog使用" "配置日志系统"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查日志级别使用是否合理
    local has_log_levels=0

    grep -rqE "Log::debug|Log::info|Log::warn|Log::error|logger\->debug|logger\->info" --include="*.php" . 2>/dev/null && has_log_levels=1

    if [ "$has_logger" -eq 1 ] && [ "$has_log_levels" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "日志缺少级别区分" "只有echo" "使用Log::info/error"
        logging_issues=$((logging_issues + 1))
    fi

    if [ "$logging_issues" -eq 0 ]; then
        score=$((score + 1))
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

    grep -rqE "request_id|trace_id|X-Request-Id|X-Trace-Id" --include="*.php" . 2>/dev/null && has_trace_id=1

    if [ "$has_trace_id" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少请求追踪机制" "无RequestID" "添加请求ID追踪"
        tracing_issues=$((tracing_issues + 1))
    fi

    # 检查是否有性能追踪/耗时记录
    local has_performance_tracking=0

    grep -rqE "microtime|hrtime|duration|elapsed|latency" --include="*.php" . 2>/dev/null && has_performance_tracking=1

    if [ "$has_performance_tracking" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少性能追踪" "无耗时记录" "添加microtime记录"
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

check_php_observability