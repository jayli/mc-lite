#!/bin/bash
# Flutter/Dart 安全检查

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_security_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_security() {
    local score=0
    local issues_count=0

    # 1. 硬编码密钥 (5分)
    local secrets_found=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 60)
        add_issue "P0" "$file" "$lineno" "硬编码敏感信息" "$content" "使用环境变量或flutter_secure_storage"
        secrets_found=$((secrets_found + 1))
    done < <(grep -rnE "(api[_-]?key|secret|password|token|access[_-]?key)\s*[=:]\s*[\"'][^\"']{8,}[\"']" \
        lib/ --include="*.dart" 2>/dev/null | grep -v "//\|/\*" | head -15)

    [ "$secrets_found" -eq 0 ] && score=$((score + 5))
    issues_count=$((issues_count + secrets_found))

    # 2. 依赖版本 (5分)
    local vulns=0
    if [ -f "pubspec.yaml" ]; then
        vulns=$(grep -cE ':\s*any\s*$' pubspec.yaml 2>/dev/null || echo 0)

        while IFS= read -r line; do
            [ -z "$line" ] && continue
            local lineno=$(echo "$line" | cut -d: -f1)
            local content=$(echo "$line" | cut -d: -f2- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
            add_issue "P1" "pubspec.yaml" "$lineno" "依赖版本使用'any'" "$content" "指定具体版本号"
        done < <(grep -nE ':\s*any\s*$' pubspec.yaml 2>/dev/null | head -10)
    fi

    if [ "$vulns" -eq 0 ]; then
        score=$((score + 5))
    elif [ "$vulns" -lt 3 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + vulns))

    # 3. 输入验证 (5分)
    local input_validation=$(grep -r "validator\|validate\|FormField\|TextFormField" \
        lib/ --include="*.dart" 2>/dev/null | wc -l)

    if [ "$input_validation" -gt 0 ]; then
        score=$((score + 5))
    else
        add_issue "P1" "lib/" "N/A" "未发现输入验证逻辑" "" "使用TextFormField和validator"
        issues_count=$((issues_count + 1))
    fi

    echo "$score:$issues_count"
}

check_flutter_security
