#!/bin/bash
# Ruby 注释完整度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ruby_comments_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ruby_comments() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 类/模块文档注释检查 (5分)
    # ============================================

    local total_classes=0
    local documented_classes=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        total_classes=$((total_classes + 1))

        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查类定义前是否有 YARD/RDoc 注释
        local prev_lines=$(sed -n "$((lineno-5)),${lineno}p" "$file" 2>/dev/null)

        if echo "$prev_lines" | grep -qE "^#|^# @|^\s*#"; then
            documented_classes=$((documented_classes + 1))
        else
            add_issue "P2" "$short_file" "$lineno" "类缺少文档注释" "" "添加YARD文档注释"
        fi
    done < <(grep -rnE "^class |^module " --include="*.rb" . 2>/dev/null | grep -v test | head -20)

    if [ "$total_classes" -gt 0 ]; then
        local class_doc_ratio=$((documented_classes * 5 / total_classes))
        score=$((score + class_doc_ratio))
    fi
    issues_count=$((issues_count + total_classes - documented_classes))

    # ============================================
    # 2. 方法文档注释检查 (5分)
    # ============================================

    local total_methods=0
    local documented_methods=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        total_methods=$((total_methods + 1))

        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查方法定义前是否有注释
        local prev_lines=$(sed -n "$((lineno-3)),${lineno}p" "$file" 2>/dev/null)

        if echo "$prev_lines" | grep -qE "^#|^\s*# @param|^\s*# @return"; then
            documented_methods=$((documented_methods + 1))
        else
            local method_name=$(echo "$line" | cut -d: -f3- | grep -oE "def\s+\w+" | awk '{print $2}')
            add_issue "P2" "$short_file" "$lineno" "方法缺少文档注释" "def $method_name" "添加YARD注释"
        fi
    done < <(grep -rnE "^\s*def " --include="*.rb" . 2>/dev/null | grep -v "test\|spec" | head -30)

    if [ "$total_methods" -gt 0 ]; then
        local method_doc_ratio=$((documented_methods * 5 / total_methods))
        score=$((score + method_doc_ratio))
    fi
    issues_count=$((issues_count + total_methods - documented_methods))

    # ============================================
    # 3. TODO/FIXME检查 (5分)
    # ============================================

    local todo_count=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "存在待处理标记" "$content" "及时处理或记录到Issue"
        todo_count=$((todo_count + 1))
    done < <(grep -rnE "# TODO|# FIXME|# XXX|# HACK" --include="*.rb" . 2>/dev/null | head -15)

    if [ "$todo_count" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$todo_count" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + todo_count))

    echo "$score:$issues_count"
}

check_ruby_comments