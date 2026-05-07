#!/bin/bash
# 结构复杂性检查 - 主入口

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

get_complexity_issues_file() {
    local project_type=$(detect_project_type)
    case "$project_type" in
        iOS) echo "${SCRIPT_DIR}/../.ios_complexity_issues.txt" ;;
        Flutter) echo "${SCRIPT_DIR}/../.flutter_complexity_issues.txt" ;;
        Java) echo "${SCRIPT_DIR}/../.java_complexity_issues.txt" ;;
        Python) echo "${SCRIPT_DIR}/../.python_complexity_issues.txt" ;;
        Go) echo "${SCRIPT_DIR}/../.go_complexity_issues.txt" ;;
        Cpp) echo "${SCRIPT_DIR}/../.cpp_complexity_issues.txt" ;;
        Ruby) echo "${SCRIPT_DIR}/../.ruby_complexity_issues.txt" ;;
        PHP) echo "${SCRIPT_DIR}/../.php_complexity_issues.txt" ;;
        Rust) echo "${SCRIPT_DIR}/../.rust_complexity_issues.txt" ;;
        *) echo "${SCRIPT_DIR}/../.js_complexity_issues.txt" ;;
    esac
}

check_complexity() {
    local project_type=$(detect_project_type)
    local result

    case "$project_type" in
        iOS)
            result=$(bash "${SCRIPT_DIR}/checkers/ios/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
        Flutter)
            result=$(bash "${SCRIPT_DIR}/checkers/flutter/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
        Java)
            result=$(bash "${SCRIPT_DIR}/checkers/java/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
        Python)
            result=$(bash "${SCRIPT_DIR}/checkers/python/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
        Go)
            result=$(bash "${SCRIPT_DIR}/checkers/go/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
        Cpp)
            result=$(bash "${SCRIPT_DIR}/checkers/cpp/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
        Ruby)
            result=$(bash "${SCRIPT_DIR}/checkers/ruby/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
        PHP)
            result=$(bash "${SCRIPT_DIR}/checkers/php/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
        Rust)
            result=$(bash "${SCRIPT_DIR}/checkers/rust/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
        *)
            result=$(bash "${SCRIPT_DIR}/checkers/js/complexity.sh" 2>/dev/null || echo "0:0")
            ;;
    esac

    echo "${result%%:*}"
}

output_complexity_details() {
    local issues_file=$(get_complexity_issues_file)
    if [ -f "$issues_file" ] && [ -s "$issues_file" ]; then
        cat "$issues_file"
    fi
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    check_complexity
fi
