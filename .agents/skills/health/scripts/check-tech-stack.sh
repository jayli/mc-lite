#!/bin/bash
# 技术栈健康度检查 - 主入口

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

get_tech_stack_issues_file() {
    local project_type=$(detect_project_type)
    case "$project_type" in
        iOS) echo "${SCRIPT_DIR}/../.ios_tech_stack_issues.txt" ;;
        Flutter) echo "${SCRIPT_DIR}/../.flutter_tech_stack_issues.txt" ;;
        Java) echo "${SCRIPT_DIR}/../.java_tech_stack_issues.txt" ;;
        Python) echo "${SCRIPT_DIR}/../.python_tech_stack_issues.txt" ;;
        Go) echo "${SCRIPT_DIR}/../.go_tech_stack_issues.txt" ;;
        Cpp) echo "${SCRIPT_DIR}/../.cpp_tech_stack_issues.txt" ;;
        Ruby) echo "${SCRIPT_DIR}/../.ruby_tech_stack_issues.txt" ;;
        PHP) echo "${SCRIPT_DIR}/../.php_tech_stack_issues.txt" ;;
        Rust) echo "${SCRIPT_DIR}/../.rust_tech_stack_issues.txt" ;;
        *) echo "${SCRIPT_DIR}/../.js_tech_stack_issues.txt" ;;
    esac
}

check_tech_stack() {
    local project_type=$(detect_project_type)
    local result

    case "$project_type" in
        iOS)
            result=$(bash "${SCRIPT_DIR}/checkers/ios/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
        Flutter)
            result=$(bash "${SCRIPT_DIR}/checkers/flutter/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
        Java)
            result=$(bash "${SCRIPT_DIR}/checkers/java/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
        Python)
            result=$(bash "${SCRIPT_DIR}/checkers/python/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
        Go)
            result=$(bash "${SCRIPT_DIR}/checkers/go/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
        Cpp)
            result=$(bash "${SCRIPT_DIR}/checkers/cpp/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
        Ruby)
            result=$(bash "${SCRIPT_DIR}/checkers/ruby/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
        PHP)
            result=$(bash "${SCRIPT_DIR}/checkers/php/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
        Rust)
            result=$(bash "${SCRIPT_DIR}/checkers/rust/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
        *)
            result=$(bash "${SCRIPT_DIR}/checkers/js/tech_stack.sh" 2>/dev/null || echo "0:0")
            ;;
    esac

    echo "${result%%:*}"
}

output_tech_stack_details() {
    local issues_file=$(get_tech_stack_issues_file)
    if [ -f "$issues_file" ] && [ -s "$issues_file" ]; then
        cat "$issues_file"
    fi
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    check_tech_stack
fi