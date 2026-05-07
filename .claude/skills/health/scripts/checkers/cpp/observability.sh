#!/bin/bash
# C++ 可观测性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.cpp_observability_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_cpp_observability() {
    local score=0
    local issues_count=0

    # 1. 监控配置检查 (1分)
    local monitoring_issues=0

    # C++项目通常监控较少，检查是否有性能分析支持
    local has_profiling=0
    if [ -f "CMakeLists.txt" ]; then
        grep -qE "profiling|benchmark|gperftools|valgrind" CMakeLists.txt 2>/dev/null && has_profiling=1
    fi

    grep -rqE "prometheus|opentelemetry|metrics|statsd" --include="*.cpp" --include="*.h" . 2>/dev/null && has_profiling=1

    if [ "$has_profiling" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少监控支持" "无prometheus/otel" "配置监控库"
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
    grep -rqE "spdlog|glog|log4cxx|boost::log|easylogging" --include="*.cpp" --include="*.h" . 2>/dev/null && has_structured_logging=1

    if [ "$has_structured_logging" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少日志库" "无专业日志库" "引入spdlog/glog"
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
    grep -rqE "trace_id|TraceId|span|opentelemetry|jaeger" --include="*.cpp" --include="*.h" . 2>/dev/null && has_trace=1

    if [ "$has_trace" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少追踪机制" "无TraceID" "添加追踪支持"
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

check_cpp_observability