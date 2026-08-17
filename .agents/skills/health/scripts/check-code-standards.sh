#!/bin/bash
# 代码规范检查 - 主入口

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

get_standards_issues_file() {
    local project_type=$(detect_project_type)
    case "$project_type" in
        iOS) echo "${SCRIPT_DIR}/../.ios_standards_issues.txt" ;;
        Flutter) echo "${SCRIPT_DIR}/../.flutter_standards_issues.txt" ;;
        Java) echo "${SCRIPT_DIR}/../.java_standards_issues.txt" ;;
        Python) echo "${SCRIPT_DIR}/../.python_standards_issues.txt" ;;
        Go) echo "${SCRIPT_DIR}/../.go_standards_issues.txt" ;;
        Cpp) echo "${SCRIPT_DIR}/../.cpp_standards_issues.txt" ;;
        Ruby) echo "${SCRIPT_DIR}/../.ruby_standards_issues.txt" ;;
        PHP) echo "${SCRIPT_DIR}/../.php_standards_issues.txt" ;;
        Rust) echo "${SCRIPT_DIR}/../.rust_standards_issues.txt" ;;
        *) echo "${SCRIPT_DIR}/../.js_standards_issues.txt" ;;
    esac
}

check_code_standards() {
    local project_type=$(detect_project_type)
    local result

    case "$project_type" in
        iOS)
            result=$(bash "${SCRIPT_DIR}/checkers/ios/standards.sh" 2>/dev/null || echo "0:0")
            ;;
        Flutter)
            result=$(bash "${SCRIPT_DIR}/checkers/flutter/standards.sh" 2>/dev/null || echo "0:0")
            ;;
        Java)
            result=$(bash "${SCRIPT_DIR}/checkers/java/standards.sh" 2>/dev/null || echo "0:0")
            ;;
        Python)
            result=$(bash "${SCRIPT_DIR}/checkers/python/standards.sh" 2>/dev/null || echo "0:0")
            ;;
        Go)
            result=$(bash "${SCRIPT_DIR}/checkers/go/standards.sh" 2>/dev/null || echo "0:0")
            ;;
        Cpp)
            result=$(bash "${SCRIPT_DIR}/checkers/cpp/standards.sh" 2>/dev/null || echo "0:0")
            ;;
        Ruby)
            result=$(bash "${SCRIPT_DIR}/checkers/ruby/standards.sh" 2>/dev/null || echo "0:0")
            ;;
        PHP)
            result=$(bash "${SCRIPT_DIR}/checkers/php/standards.sh" 2>/dev/null || echo "0:0")
            ;;
        Rust)
            result=$(bash "${SCRIPT_DIR}/checkers/rust/standards.sh" 2>/dev/null || echo "0:0")
            ;;
        *)
            result=$(bash "${SCRIPT_DIR}/checkers/js/standards.sh" 2>/dev/null || echo "0:0")
            ;;
    esac

    echo "${result%%:*}"
}

output_standards_details() {
    local issues_file=$(get_standards_issues_file)
    if [ -f "$issues_file" ] && [ -s "$issues_file" ]; then
        cat "$issues_file"
    fi
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    check_code_standards
fi
