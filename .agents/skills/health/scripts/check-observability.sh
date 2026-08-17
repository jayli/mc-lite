#!/bin/bash
# 可观测性检查 - 主入口

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

get_observability_issues_file() {
    local project_type=$(detect_project_type)
    case "$project_type" in
        iOS) echo "${SCRIPT_DIR}/../.ios_observability_issues.txt" ;;
        Flutter) echo "${SCRIPT_DIR}/../.flutter_observability_issues.txt" ;;
        Java) echo "${SCRIPT_DIR}/../.java_observability_issues.txt" ;;
        Python) echo "${SCRIPT_DIR}/../.python_observability_issues.txt" ;;
        Go) echo "${SCRIPT_DIR}/../.go_observability_issues.txt" ;;
        Cpp) echo "${SCRIPT_DIR}/../.cpp_observability_issues.txt" ;;
        Ruby) echo "${SCRIPT_DIR}/../.ruby_observability_issues.txt" ;;
        PHP) echo "${SCRIPT_DIR}/../.php_observability_issues.txt" ;;
        Rust) echo "${SCRIPT_DIR}/../.rust_observability_issues.txt" ;;
        *) echo "${SCRIPT_DIR}/../.js_observability_issues.txt" ;;
    esac
}

check_observability() {
    local project_type=$(detect_project_type)
    local result

    case "$project_type" in
        iOS)
            result=$(bash "${SCRIPT_DIR}/checkers/ios/observability.sh" 2>/dev/null || echo "0:0")
            ;;
        Flutter)
            result=$(bash "${SCRIPT_DIR}/checkers/flutter/observability.sh" 2>/dev/null || echo "0:0")
            ;;
        Java)
            result=$(bash "${SCRIPT_DIR}/checkers/java/observability.sh" 2>/dev/null || echo "0:0")
            ;;
        Python)
            result=$(bash "${SCRIPT_DIR}/checkers/python/observability.sh" 2>/dev/null || echo "0:0")
            ;;
        Go)
            result=$(bash "${SCRIPT_DIR}/checkers/go/observability.sh" 2>/dev/null || echo "0:0")
            ;;
        Cpp)
            result=$(bash "${SCRIPT_DIR}/checkers/cpp/observability.sh" 2>/dev/null || echo "0:0")
            ;;
        Ruby)
            result=$(bash "${SCRIPT_DIR}/checkers/ruby/observability.sh" 2>/dev/null || echo "0:0")
            ;;
        PHP)
            result=$(bash "${SCRIPT_DIR}/checkers/php/observability.sh" 2>/dev/null || echo "0:0")
            ;;
        Rust)
            result=$(bash "${SCRIPT_DIR}/checkers/rust/observability.sh" 2>/dev/null || echo "0:0")
            ;;
        *)
            result=$(bash "${SCRIPT_DIR}/checkers/js/observability.sh" 2>/dev/null || echo "0:0")
            ;;
    esac

    echo "${result%%:*}"
}

output_observability_details() {
    local issues_file=$(get_observability_issues_file)
    if [ -f "$issues_file" ] && [ -s "$issues_file" ]; then
        cat "$issues_file"
    fi
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    check_observability
fi