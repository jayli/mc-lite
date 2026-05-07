#!/bin/bash
# Java 结构复杂性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.java_complexity_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_complexity() {
    local score=0
    local issues_count=0

    # 1. 大文件检测 (2分) - 超过800行的类
    local large_files=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local lines=$(wc -l < "$file")
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P1" "$short_file" "N/A" "文件过大(${lines}行)" "" "按功能拆分为多个类"
        large_files=$((large_files + 1))
    done < <(find . -name "*.java" -not -path "*/build/*" -exec wc -l {} + 2>/dev/null | awk '$1 > 800 {print $2}' | head -10)

    if [ "$large_files" -eq 0 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + large_files))

    # 2. 长方法检测 (2分) - 超过100行的方法
    local long_methods=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P1" "$file" "$lineno" "方法可能过长" "$content" "提取子方法，保持方法简洁"
        long_methods=$((long_methods + 1))
    done < <(grep -rnE "(public|private|protected)\s+(void|[A-Za-z]+)\s+\w+\s*\(.*\)\s*\{" --include="*.java" . 2>/dev/null | head -15)

    if [ "$long_methods" -lt 10 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + long_methods))

    # 3. 类复杂度 - 检查方法数量
    local complex_classes=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local method_count=$(grep -cE "(public|private|protected)\s+" "$file" 2>/dev/null || echo 0)
        if [ "$method_count" -gt 30 ]; then
            local short_file=$(echo "$file" | sed 's|^\./||')
            add_issue "P2" "$short_file" "N/A" "类方法过多(${method_count}个)" "" "考虑拆分职责"
            complex_classes=$((complex_classes + 1))
        fi
    done < <(find . -name "*.java" -not -path "*/build/*" 2>/dev/null | head -20)

    if [ "$complex_classes" -eq 0 ]; then
        score=$((score + 1))
    fi
    issues_count=$((issues_count + complex_classes))

    echo "$score:$issues_count"
}

# 执行检查
check_java_complexity
