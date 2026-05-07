#!/bin/bash
# 废代码检查 - 主入口

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

get_unused_issues_file() {
    local project_type=$(detect_project_type)
    case "$project_type" in
        iOS) echo "${SCRIPT_DIR}/../.ios_unused_issues.txt" ;;
        Flutter) echo "${SCRIPT_DIR}/../.flutter_unused_issues.txt" ;;
        Java) echo "${SCRIPT_DIR}/../.java_unused_issues.txt" ;;
        Python) echo "${SCRIPT_DIR}/../.python_unused_issues.txt" ;;
        Go) echo "${SCRIPT_DIR}/../.go_unused_issues.txt" ;;
        Cpp) echo "${SCRIPT_DIR}/../.cpp_unused_issues.txt" ;;
        Ruby) echo "${SCRIPT_DIR}/../.ruby_unused_issues.txt" ;;
        PHP) echo "${SCRIPT_DIR}/../.php_unused_issues.txt" ;;
        Rust) echo "${SCRIPT_DIR}/../.rust_unused_issues.txt" ;;
        *) echo "${SCRIPT_DIR}/../.js_unused_issues.txt" ;;
    esac
}

check_unused_code() {
    local project_type=$(detect_project_type)
    local result

    case "$project_type" in
        iOS)
            result=$(bash "${SCRIPT_DIR}/checkers/ios/unused.sh" 2>/dev/null || echo "0:0")
            ;;
        Flutter)
            result=$(bash "${SCRIPT_DIR}/checkers/flutter/unused.sh" 2>/dev/null || echo "0:0")
            ;;
        Java)
            result=$(bash "${SCRIPT_DIR}/checkers/java/unused.sh" 2>/dev/null || echo "0:0")
            ;;
        Python)
            result=$(bash "${SCRIPT_DIR}/checkers/python/unused.sh" 2>/dev/null || echo "0:0")
            ;;
        Go)
            result=$(bash "${SCRIPT_DIR}/checkers/go/unused.sh" 2>/dev/null || echo "0:0")
            ;;
        Cpp)
            result=$(bash "${SCRIPT_DIR}/checkers/cpp/unused.sh" 2>/dev/null || echo "0:0")
            ;;
        Ruby)
            result=$(bash "${SCRIPT_DIR}/checkers/ruby/unused.sh" 2>/dev/null || echo "0:0")
            ;;
        PHP)
            result=$(bash "${SCRIPT_DIR}/checkers/php/unused.sh" 2>/dev/null || echo "0:0")
            ;;
        Rust)
            result=$(bash "${SCRIPT_DIR}/checkers/rust/unused.sh" 2>/dev/null || echo "0:0")
            ;;
        *)
            result=$(bash "${SCRIPT_DIR}/checkers/js/unused.sh" 2>/dev/null || echo "0:0")
            ;;
    esac

    echo "${result%%:*}"
}

output_unused_details() {
    local issues_file=$(get_unused_issues_file)
    if [ -f "$issues_file" ] && [ -s "$issues_file" ]; then
        cat "$issues_file"
    fi
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    check_unused_code
fi
