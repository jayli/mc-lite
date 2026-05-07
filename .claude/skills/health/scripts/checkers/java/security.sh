#!/bin/bash
# Java 安全检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.java_security_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_security() {
    local score=0
    local issues_count=0

    # 1. 硬编码密钥检查 (5分)
    local secrets_found=0

    # 检查代码中的硬编码敏感信息
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 60)
        add_issue "P0" "$file" "$lineno" "硬编码敏感信息" "$content" "移至配置文件或环境变量"
        secrets_found=$((secrets_found + 1))
    done < <(grep -rnE "(api[_-]?key|secret|password|token|access[_-]?key)\s*=\s*\"[^\"]{8,}\"|(api[_-]?key|secret|password|token|access[_-]?key)\s*=" \
        --include="*.java" . 2>/dev/null | \
        grep -v "//\|/\*" | head -15)

    # 检查 properties 文件
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P0" "$short_file" "N/A" "配置文件可能包含敏感信息" "" "检查并移至安全存储"
        secrets_found=$((secrets_found + 1))
    done < <(find . -name "*.properties" -not -path "*/build/*" -not -path "*/.gradle/*" 2>/dev/null | \
        xargs grep -l "password\|secret\|key\|token" 2>/dev/null | head -5)

    [ "$secrets_found" -eq 0 ] && score=$((score + 5))
    issues_count=$((issues_count + secrets_found))

    # 2. SQL注入检查 (5分)
    local sql_injection=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 60)
        add_issue "P0" "$file" "$lineno" "可能存在SQL注入风险" "$content" "使用PreparedStatement"
        sql_injection=$((sql_injection + 1))
    done < <(grep -rnE "Statement\.execute.*\+|createStatement.*\+|executeQuery.*\+" \
        --include="*.java" . 2>/dev/null | head -10)

    if [ "$sql_injection" -eq 0 ]; then
        score=$((score + 5))
    elif [ "$sql_injection" -lt 3 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + sql_injection))

    # 3. 依赖版本检查 (5分)
    local vulns=0
    if [ -f "pom.xml" ]; then
        # 检查 Maven 依赖是否有版本号
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            local lineno=$(echo "$line" | grep -oE "^[0-9]+" || echo "N/A")
            local content=$(echo "$line" | sed 's/^[[:space:]]*/ /' | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
            add_issue "P1" "pom.xml" "$lineno" "依赖未指定版本" "$content" "指定具体版本号"
            vulns=$((vulns + 1))
        done < <(grep -nE "<dependency>" -A3 pom.xml 2>/dev/null | grep -B1 "</dependency>" | grep -v "<version>" | head -10)

        if [ "$vulns" -eq 0 ]; then
            score=$((score + 5))
        elif [ "$vulns" -lt 5 ]; then
            score=$((score + 3))
        fi
    elif [ -f "build.gradle" ]; then
        # 检查 Gradle 依赖
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            local lineno=$(echo "$line" | grep -oE "^[0-9]+" || echo "N/A")
            local content=$(echo "$line" | sed 's/^[[:space:]]*/ /' | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
            add_issue "P1" "build.gradle" "$lineno" "依赖未指定版本" "$content" "指定具体版本号"
            vulns=$((vulns + 1))
        done < <(grep -nE "implementation\s+|compile\s+" build.gradle 2>/dev/null | grep -v "version" | head -10)

        if [ "$vulns" -eq 0 ]; then
            score=$((score + 5))
        elif [ "$vulns" -lt 5 ]; then
            score=$((score + 3))
        fi
    else
        score=$((score + 5))
    fi
    issues_count=$((issues_count + vulns))

    echo "$score:$issues_count"
}

# 执行检查
check_java_security
