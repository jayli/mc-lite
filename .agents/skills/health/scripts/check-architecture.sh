#!/bin/bash
# 架构设计质量检查 - 主入口

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

get_architecture_issues_file() {
    local project_type=$(detect_project_type)
    case "$project_type" in
        iOS) echo "${SCRIPT_DIR}/../.ios_architecture_issues.txt" ;;
        Flutter) echo "${SCRIPT_DIR}/../.flutter_architecture_issues.txt" ;;
        Java) echo "${SCRIPT_DIR}/../.java_architecture_issues.txt" ;;
        Python) echo "${SCRIPT_DIR}/../.python_architecture_issues.txt" ;;
        Go) echo "${SCRIPT_DIR}/../.go_architecture_issues.txt" ;;
        Cpp) echo "${SCRIPT_DIR}/../.cpp_architecture_issues.txt" ;;
        Ruby) echo "${SCRIPT_DIR}/../.ruby_architecture_issues.txt" ;;
        PHP) echo "${SCRIPT_DIR}/../.php_architecture_issues.txt" ;;
        Rust) echo "${SCRIPT_DIR}/../.rust_architecture_issues.txt" ;;
        *) echo "${SCRIPT_DIR}/../.js_architecture_issues.txt" ;;
    esac
}

check_architecture() {
    local project_type=$(detect_project_type)
    local result

    case "$project_type" in
        iOS)
            result=$(bash "${SCRIPT_DIR}/checkers/ios/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
        Flutter)
            result=$(bash "${SCRIPT_DIR}/checkers/flutter/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
        Java)
            result=$(bash "${SCRIPT_DIR}/checkers/java/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
        Python)
            result=$(bash "${SCRIPT_DIR}/checkers/python/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
        Go)
            result=$(bash "${SCRIPT_DIR}/checkers/go/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
        Cpp)
            result=$(bash "${SCRIPT_DIR}/checkers/cpp/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
        Ruby)
            result=$(bash "${SCRIPT_DIR}/checkers/ruby/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
        PHP)
            result=$(bash "${SCRIPT_DIR}/checkers/php/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
        Rust)
            result=$(bash "${SCRIPT_DIR}/checkers/rust/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
        *)
            result=$(bash "${SCRIPT_DIR}/checkers/js/architecture.sh" 2>/dev/null || echo "0:0")
            ;;
    esac

    echo "${result%%:*}"
}

output_architecture_details() {
    local issues_file=$(get_architecture_issues_file)
    if [ -f "$issues_file" ] && [ -s "$issues_file" ]; then
        cat "$issues_file"
    fi
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    check_architecture
fi