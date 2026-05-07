#!/bin/bash
# iOS/Objective-C 安全检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.ios_security_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_security() {
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
        add_issue "P0" "$file" "$lineno" "硬编码敏感信息" "$content" "移至Keychain或配置"
        secrets_found=$((secrets_found + 1))
    done < <(grep -rnE "(api[_-]?key|secret|password|token|access[_-]?key)\s*=\s*[@\"'][^\"']{8,}[\"']" \
        --include="*.m" --include="*.mm" --include="*.h" --include="*.swift" . 2>/dev/null | \
        grep -v "//\|/\*" | head -15)

    # 检查Info.plist
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P0" "$short_file" "N/A" "Plist可能包含敏感配置" "" "检查并移除敏感信息"
        secrets_found=$((secrets_found + 1))
    done < <(find . -name "Info.plist" -not -path "*/Pods/*" -not -path "*/build/*" 2>/dev/null | \
        xargs grep -l "APIKey\|Secret\|Password" 2>/dev/null | head -5)

    [ "$secrets_found" -eq 0 ] && score=$((score + 5))
    issues_count=$((issues_count + secrets_found))

    # 2. Pod依赖版本检查 (5分)
    local vulns=0
    if [ -f "Podfile" ]; then
        local unpinned_deps=$(grep -cE "^\s*pod\s+'[^']+'\s*$" Podfile 2>/dev/null || echo 0)

        while IFS= read -r line; do
            [ -z "$line" ] && continue
            local lineno=$(echo "$line" | grep -oE "^[0-9]+" || echo "N/A")
            local content=$(echo "$line" | sed 's/^[[:space:]]*/ /' | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
            add_issue "P1" "Podfile" "$lineno" "依赖未指定版本" "$content" "指定具体版本号"
            vulns=$((vulns + 1))
        done < <(grep -nE "^\s*pod\s+'[^']+'\s*$" Podfile 2>/dev/null | head -10)

        if [ "$unpinned_deps" -eq 0 ]; then
            score=$((score + 5))
        elif [ "$unpinned_deps" -lt 5 ]; then
            score=$((score + 3))
        fi
    else
        score=$((score + 5))
    fi
    issues_count=$((issues_count + vulns))

    # 3. 输入验证检查 (5分)
    local input_validation=$(grep -ric "validate\|sanitiz\|escape\|checkInput\|verify" \
        --include="*.m" --include="*.mm" --include="*.swift" . 2>/dev/null || echo 0)

    if [ "$input_validation" -eq 0 ]; then
        add_issue "P1" "项目整体" "N/A" "未发现输入验证逻辑" "" "添加输入校验防止注入"
        issues_count=$((issues_count + 1))
    else
        score=$((score + 5))
    fi

    echo "$score:$issues_count"
}

# 执行检查
check_ios_security
