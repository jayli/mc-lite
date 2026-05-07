#!/bin/bash
# Python 结构复杂性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.python_complexity_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_python_complexity() {
    local score=0
    local issues_count=0

    # 1. 大文件检测 (2分) - 超过800行的文件
    local large_files=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local lines=$(wc -l < "$file")
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P1" "$short_file" "N/A" "文件过大(${lines}行)" "" "拆分为多个模块"
        large_files=$((large_files + 1))
    done < <(find . -name "*.py" -exec wc -l {} + 2>/dev/null | awk '$1 > 800 {print $2}' | head -10)

    if [ "$large_files" -eq 0 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + large_files))

    # 2. 长函数检测 (2分) - 超过50行的函数
    local long_funcs=0

    # 检查函数长度（通过计算def到下一个def或类之间的行数）
    while IFS= read -r file; do
        [ -z "$file" ] && continue

        # 简单估计：检查是否有超过50行的连续代码
        local func_lines=$(awk '/^def /,/^def |^class |^    def / {print NR": "$0}' "$file" 2>/dev/null | wc -l)

        if [ "$func_lines" -gt 50 ]; then
            local short_file=$(echo "$file" | sed 's|^\./||')
            add_issue "P1" "$short_file" "N/A" "函数可能过长" "" "提取子函数"
            long_funcs=$((long_funcs + 1))
        fi
    done < <(find . -name "*.py" 2>/dev/null | head -20)

    if [ "$long_funcs" -lt 5 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + long_funcs))

    # 3. 类复杂度检查 (1分)
    local complex_classes=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local class_name=$(echo "$line" | cut -d: -f3- | grep -oE "class\s+\w+" | awk '{print $2}')

        # 计算方法数
        local method_count=$(grep -cE "^    def " "$file" 2>/dev/null || echo 0)

        if [ "$method_count" -gt 20 ]; then
            local short_file=$(echo "$file" | sed 's|^\./||')
            add_issue "P2" "$short_file" "$lineno" "类方法过多(${method_count}个)" "class $class_name" "拆分职责"
            complex_classes=$((complex_classes + 1))
        fi
    done < <(grep -rnE "^class " --include="*.py" . 2>/dev/null | head -15)

    if [ "$complex_classes" -eq 0 ]; then
        score=$((score + 1))
    fi
    issues_count=$((issues_count + complex_classes))

    echo "$score:$issues_count"
}

# 执行检查
check_python_complexity
