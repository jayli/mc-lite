#!/bin/bash
# C/C++ 安全检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.cpp_security_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_cpp_security() {
    local score=0
    local issues_count=0

    # 1. 硬编码密钥检查 (5分)
    local secrets_found=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 60)
        add_issue "P0" "$file" "$lineno" "硬编码敏感信息" "$content" "移至配置文件或环境变量"
        secrets_found=$((secrets_found + 1))
    done < <(grep -rnE "(api[_-]?key|secret|password|token|access[_-]?key)\s*=\s*[\"'][^\"']{8,}[\"']|#define\s+\w*(KEY|SECRET|PASSWORD|TOKEN)\w*\s+[\"']" \
        --include="*.c" --include="*.cpp" --include="*.cc" --include="*.h" --include="*.hpp" . 2>/dev/null | \
        grep -v "//\|/\*" | head -15)

    [ "$secrets_found" -eq 0 ] && score=$((score + 5))
    issues_count=$((issues_count + secrets_found))

    # 2. 不安全函数检查 (5分)
    local unsafe_funcs=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 60)
        add_issue "P0" "$file" "$lineno" "使用不安全函数" "$content" "使用strncpy_s, snprintf等安全版本"
        unsafe_funcs=$((unsafe_funcs + 1))
    done < <(grep -rnE "\b(strcpy|strcat|sprintf|gets|scanf)\s*\(" \
        --include="*.c" --include="*.cpp" --include="*.cc" . 2>/dev/null | head -15)

    if [ "$unsafe_funcs" -eq 0 ]; then
        score=$((score + 5))
    elif [ "$unsafe_funcs" -lt 5 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + unsafe_funcs))

    # 3. 缓冲区溢出检查 (5分)
    local buffer_issues=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 60)
        add_issue "P1" "$file" "$lineno" "可能存在缓冲区溢出" "$content" "检查边界，使用安全函数"
        buffer_issues=$((buffer_issues + 1))
    done < <(grep -rnE "char\s+\w+\[\s*[0-9]+\s*\]|malloc\s*\(" \
        --include="*.c" --include="*.cpp" --include="*.cc" . 2>/dev/null | head -15)

    if [ "$buffer_issues" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$buffer_issues" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + buffer_issues))

    echo "$score:$issues_count"
}

# 执行检查
check_cpp_security
