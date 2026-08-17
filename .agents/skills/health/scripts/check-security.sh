#!/bin/bash
# 安全依赖检查 - 主入口
# 根据项目类型调用对应的检查脚本

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# 问题详情文件路径
get_security_issues_file() {
    local project_type=$(detect_project_type)
    case "$project_type" in
        iOS) echo "${SCRIPT_DIR}/../.ios_security_issues.txt" ;;
        Flutter) echo "${SCRIPT_DIR}/../.flutter_security_issues.txt" ;;
        Java) echo "${SCRIPT_DIR}/../.java_security_issues.txt" ;;
        Python) echo "${SCRIPT_DIR}/../.python_security_issues.txt" ;;
        Go) echo "${SCRIPT_DIR}/../.go_security_issues.txt" ;;
        Cpp) echo "${SCRIPT_DIR}/../.cpp_security_issues.txt" ;;
        Ruby) echo "${SCRIPT_DIR}/../.ruby_security_issues.txt" ;;
        PHP) echo "${SCRIPT_DIR}/../.php_security_issues.txt" ;;
        Rust) echo "${SCRIPT_DIR}/../.rust_security_issues.txt" ;;
        *) echo "${SCRIPT_DIR}/../.js_security_issues.txt" ;;
    esac
}

check_security() {
    local project_type=$(detect_project_type)
    local result

    case "$project_type" in
        iOS)
            result=$(bash "${SCRIPT_DIR}/checkers/ios/security.sh" 2>/dev/null || echo "0:0")
            ;;
        Flutter)
            result=$(bash "${SCRIPT_DIR}/checkers/flutter/security.sh" 2>/dev/null || echo "0:0")
            ;;
        Java)
            result=$(bash "${SCRIPT_DIR}/checkers/java/security.sh" 2>/dev/null || echo "0:0")
            ;;
        Python)
            result=$(bash "${SCRIPT_DIR}/checkers/python/security.sh" 2>/dev/null || echo "0:0")
            ;;
        Go)
            result=$(bash "${SCRIPT_DIR}/checkers/go/security.sh" 2>/dev/null || echo "0:0")
            ;;
        Cpp)
            result=$(bash "${SCRIPT_DIR}/checkers/cpp/security.sh" 2>/dev/null || echo "0:0")
            ;;
        Ruby)
            result=$(bash "${SCRIPT_DIR}/checkers/ruby/security.sh" 2>/dev/null || echo "0:0")
            ;;
        PHP)
            result=$(bash "${SCRIPT_DIR}/checkers/php/security.sh" 2>/dev/null || echo "0:0")
            ;;
        Rust)
            result=$(bash "${SCRIPT_DIR}/checkers/rust/security.sh" 2>/dev/null || echo "0:0")
            ;;
        *)
            result=$(bash "${SCRIPT_DIR}/checkers/js/security.sh" 2>/dev/null || echo "0:0")
            ;;
    esac

    # 输出分数
    echo "${result%%:*}"
}

# 输出安全问题详情
output_security_details() {
    local issues_file=$(get_security_issues_file)
    if [ -f "$issues_file" ] && [ -s "$issues_file" ]; then
        cat "$issues_file"
    fi
}

# 如果直接执行
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    check_security
fi
