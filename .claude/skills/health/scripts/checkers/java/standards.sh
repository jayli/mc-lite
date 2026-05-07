#!/bin/bash
# Java 代码规范检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.java_standards_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_standards() {
    local score=0
    local issues_count=0

    # 1. 命名规范检查 (4分) - 类名应使用PascalCase
    local naming_issues=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local filename=$(basename "$file" .java)
        # 检查类名是否以小写字母开头（应为PascalCase）
        if echo "$filename" | grep -qE "^[a-z]"; then
            add_issue "P1" "$file" "N/A" "类名应使用PascalCase" "$filename" "首字母大写"
            naming_issues=$((naming_issues + 1))
        fi
    done < <(find . -name "*.java" -not -path "*/build/*" 2>/dev/null | head -20)

    if [ "$naming_issues" -eq 0 ]; then
        score=$((score + 4))
    elif [ "$naming_issues" -lt 5 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + naming_issues))

    # 2. 代码格式检查 (3分) - 使用4空格缩进
    local format_issues=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P2" "$file" "$lineno" "使用Tab而非空格缩进" "" "统一使用4空格缩进"
        format_issues=$((format_issues + 1))
    done < <(grep -rn $'\t' --include="*.java" . 2>/dev/null | head -10)

    if [ "$format_issues" -eq 0 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + format_issues))

    # 3. 常量命名检查 (3分) - 常量应使用UPPER_SNAKE_CASE
    local const_issues=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "常量命名不规范" "$content" "使用UPPER_SNAKE_CASE"
        const_issues=$((const_issues + 1))
    done < <(grep -rnE "static\s+final\s+(int|String|long|double|boolean)\s+[a-z]" --include="*.java" . 2>/dev/null | head -10)

    if [ "$const_issues" -eq 0 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + const_issues))

    echo "$score:$issues_count"
}

# 执行检查
check_java_standards
