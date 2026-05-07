#!/bin/bash
# Rust 可观测性检查
# 输出: 分数:问题数
# 检查项：监控配置(1分)、日志系统(1分)、追踪机制(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_observability_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_observability() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 监控配置检查 (1分)
    # ============================================

    local monitoring_issues=0

    # 检查是否有性能监控/错误监控工具
    local has_sentry=0
    local has_prometheus=0
    local has_metrics=0
    local has_tracing=0

    grep -rqE "sentry|Sentry" --include="*.rs" src/ 2>/dev/null && has_sentry=1
    grep -rqE "prometheus|Prometheus|metrics" --include="*.rs" src/ 2>/dev/null && has_prometheus=1
    grep -rqE "metrics::" --include="*.rs" src/ 2>/dev/null && has_metrics=1
    grep -rqE "tracing::|tracing_subscriber" --include="*.rs" src/ 2>/dev/null && has_tracing=1

    # 检查 Cargo.toml
    if [ -f "Cargo.toml" ]; then
        grep -qiE "sentry" Cargo.toml && has_sentry=1
        grep -qiE "prometheus|metrics" Cargo.toml && has_prometheus=1
        grep -qiE "tracing" Cargo.toml && has_tracing=1
    fi

    local has_any_monitoring=$((has_sentry + has_prometheus + has_metrics + has_tracing))

    if [ "$has_any_monitoring" -eq 0 ]; then
        add_issue "P2" "项目依赖" "N/A" "缺少监控工具" "无Sentry/Prometheus等" "配置错误监控"
        monitoring_issues=$((monitoring_issues + 1))
    fi

    # 检查是否有健康检查端点（对于Web服务）
    local has_health_endpoint=0

    if [ -d "src/handlers" ] || [ -d "src/controllers" ]; then
        grep -rqE "health|Health" --include="*.rs" src/handlers src/controllers 2>/dev/null && has_health_endpoint=1
    fi

    if [ "$has_health_endpoint" -eq 0 ]; then
        # 检查是否是Web项目
        if [ -f "Cargo.toml" ] && grep -qE "actix-web|rocket|axum|warp" Cargo.toml 2>/dev/null; then
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

    # ============================================
    # 2. 日志系统检查 (1分)
    # ============================================

    local logging_issues=0

    # 检查是否使用了日志库
    local has_logger=0

    grep -rqE "log::|tracing::|env_logger|log4rs" --include="*.rs" src/ 2>/dev/null && has_logger=1

    if [ "$has_logger" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少日志模块" "无log/tracing使用" "配置log或tracing"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查日志级别使用是否合理
    local has_log_levels=0

    grep -rqE "debug!|info!|warn!|error!|trace!" --include="*.rs" src/ 2>/dev/null && has_log_levels=1

    if [ "$has_logger" -eq 1 ] && [ "$has_log_levels" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "日志缺少级别区分" "只有println!" "使用info!/error!等"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查是否过度使用 println!
    local println_count=$(grep -rE "println!|eprintln!" --include="*.rs" src/ 2>/dev/null | wc -l | tr -d ' ')

    if [ "$println_count" -gt 10 ]; then
        add_issue "P2" "项目配置" "N/A" "过度使用println!" "${println_count}处" "替换为log::info等"
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

    # 检查是否有请求追踪（tracing库）
    local has_tracing_lib=0

    grep -rqE "tracing::|#[instrument|#\[instrument" --include="*.rs" src/ 2>/dev/null && has_tracing_lib=1

    if [ "$has_tracing_lib" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少请求追踪机制" "无tracing" "使用tracing库"
        tracing_issues=$((tracing_issues + 1))
    fi

    # 检查是否有性能追踪/耗时记录
    local has_performance_tracking=0

    grep -rqE "Instant::now|Duration|elapsed|span" --include="*.rs" src/ 2>/dev/null && has_performance_tracking=1

    if [ "$has_performance_tracking" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少性能追踪" "无耗时记录" "添加Instant::now追踪"
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

check_rust_observability