#!/bin/bash
# Java 注释完整度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.java_comments_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_comments() {
    local score=0
    local issues_count=0

    # 1. 类文档注释检查 (5分)
    local total_classes=0
    local documented_classes=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        total_classes=$((total_classes + 1))

        # 检查类是否有Javadoc注释
        if head -30 "$file" 2>/dev/null | grep -qE "/\*\*|@author|@version|@since"; then
            documented_classes=$((documented_classes + 1))
        else
            local short_file=$(echo "$file" | sed 's|^\./||')
            add_issue "P2" "$short_file" "N/A" "类缺少Javadoc文档" "" "添加类级别文档注释"
        fi
    done < <(find . -name "*.java" -not -path "*/build/*" 2>/dev/null | head -20)

    if [ "$total_classes" -gt 0 ]; then
        local class_doc_ratio=$((documented_classes * 5 / total_classes))
        score=$((score + class_doc_ratio))
    fi
    issues_count=$((issues_count + total_classes - documented_classes))

    # 2. 公共方法注释检查 (5分)
    local total_methods=0
    local documented_methods=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        total_methods=$((total_methods + 1))

        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)

        # 检查方法前10行是否有Javadoc
        local start_line=$((lineno - 10))
        [ "$start_line" -lt 1 ] && start_line=1

        if sed -n "${start_line},${lineno}p" "$file" 2>/dev/null | grep -qE "/\*\*|@param|@return"; then
            documented_methods=$((documented_methods + 1))
        else
            local short_file=$(echo "$file" | sed 's|^\./||')
            local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 40)
            add_issue "P2" "$short_file" "$lineno" "公共方法缺少文档" "$content" "添加Javadoc注释"
        fi
    done < <(grep -rnE "^\s*public\s+(static\s+)?(void|[A-Za-z]+)\s+\w+\s*\(" --include="*.java" . 2>/dev/null | grep -v "main\|test" | head -30)

    if [ "$total_methods" -gt 0 ]; then
        local method_doc_ratio=$((documented_methods * 5 / total_methods))
        score=$((score + method_doc_ratio))
    fi
    issues_count=$((issues_count + total_methods - documented_methods))

    # 3. TODO/FIXME检查 (5分)
    local todo_count=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "存在待处理标记" "$content" "及时处理或记录到Issue跟踪"
        todo_count=$((todo_count + 1))
    done < <(grep -rnE "TODO|FIXME|XXX|HACK" --include="*.java" . 2>/dev/null | head -15)

    if [ "$todo_count" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$todo_count" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + todo_count))

    echo "$score:$issues_count"
}

# 执行检查
check_java_comments
