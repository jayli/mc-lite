#!/bin/bash
# 错误处理质量检查 - 主入口

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

get_error_handling_issues_file() {
    local project_type=$(detect_project_type)
    case "$project_type" in
        iOS) echo "${SCRIPT_DIR}/../.ios_error_handling_issues.txt" ;;
        Flutter) echo "${SCRIPT_DIR}/../.flutter_error_handling_issues.txt" ;;
        Java) echo "${SCRIPT_DIR}/../.java_error_handling_issues.txt" ;;
        Python) echo "${SCRIPT_DIR}/../.python_error_handling_issues.txt" ;;
        Go) echo "${SCRIPT_DIR}/../.go_error_handling_issues.txt" ;;
        Cpp) echo "${SCRIPT_DIR}/../.cpp_error_handling_issues.txt" ;;
        Ruby) echo "${SCRIPT_DIR}/../.ruby_error_handling_issues.txt" ;;
        PHP) echo "${SCRIPT_DIR}/../.php_error_handling_issues.txt" ;;
        Rust) echo "${SCRIPT_DIR}/../.rust_error_handling_issues.txt" ;;
        *) echo "${SCRIPT_DIR}/../.js_error_handling_issues.txt" ;;
    esac
}

check_error_handling() {
    local project_type=$(detect_project_type)
    local result

    case "$project_type" in
        iOS)
            result=$(bash "${SCRIPT_DIR}/checkers/ios/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
        Flutter)
            result=$(bash "${SCRIPT_DIR}/checkers/flutter/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
        Java)
            result=$(bash "${SCRIPT_DIR}/checkers/java/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
        Python)
            result=$(bash "${SCRIPT_DIR}/checkers/python/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
        Go)
            result=$(bash "${SCRIPT_DIR}/checkers/go/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
        Cpp)
            result=$(bash "${SCRIPT_DIR}/checkers/cpp/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
        Ruby)
            result=$(bash "${SCRIPT_DIR}/checkers/ruby/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
        PHP)
            result=$(bash "${SCRIPT_DIR}/checkers/php/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
        Rust)
            result=$(bash "${SCRIPT_DIR}/checkers/rust/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
        *)
            result=$(bash "${SCRIPT_DIR}/checkers/js/error_handling.sh" 2>/dev/null || echo "0:0")
            ;;
    esac

    echo "${result%%:*}"
}

output_error_handling_details() {
    local issues_file=$(get_error_handling_issues_file)
    if [ -f "$issues_file" ] && [ -s "$issues_file" ]; then
        cat "$issues_file"
    fi
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    check_error_handling
fi