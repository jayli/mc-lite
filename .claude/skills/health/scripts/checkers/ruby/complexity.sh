#!/bin/bash
# Ruby 结构复杂性检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ruby_complexity_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ruby_complexity() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 大文件检测 (2分) - 超过500行的文件
    # ============================================

    local large_files=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local lines=$(wc -l < "$file")
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P1" "$short_file" "N/A" "文件过大(${lines}行)" "" "拆分为多个模块"
        large_files=$((large_files + 1))
    done < <(find . -name "*.rb" -exec wc -l {} + 2>/dev/null | awk '$1 > 500 {print $2}' | head -10)

    if [ "$large_files" -eq 0 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + large_files))

    # ============================================
    # 2. 长方法检测 (2分) - 超过30行的方法
    # ============================================

    local long_methods=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查方法长度（Ruby方法以end结束）
        local method_count=$(grep -cE "^\s*def " "$file" 2>/dev/null || echo 0)

        if [ "$method_count" -gt 0 ]; then
            local total_lines=$(wc -l < "$file")
            local avg_method_len=$((total_lines / method_count))

            if [ "$avg_method_len" -gt 30 ]; then
                add_issue "P1" "$short_file" "N/A" "方法可能过长" "平均${avg_method_len}行" "提取子方法"
                long_methods=$((long_methods + 1))
            fi
        fi
    done < <(find . -name "*.rb" -not -path "*/test/*" 2>/dev/null | head -20)

    if [ "$long_methods" -lt 5 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + long_methods))

    # ============================================
    # 3. 类复杂度检查 (1分) - 方法数过多
    # ============================================

    local complex_classes=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local class_name=$(echo "$line" | cut -d: -f3- | grep -oE "class\s+\w+" | awk '{print $2}')
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 计算类内方法数（从class到end之间的def数量）
        local method_count=$(sed -n "${lineno},/^end/p" "$file" 2>/dev/null | grep -cE "^\s*def " || echo 0)

        if [ "$method_count" -gt 20 ]; then
            add_issue "P2" "$short_file" "$lineno" "类方法过多(${method_count}个)" "class $class_name" "拆分职责"
            complex_classes=$((complex_classes + 1))
        fi
    done < <(grep -rnE "^class " --include="*.rb" . 2>/dev/null | grep -v test | head -15)

    if [ "$complex_classes" -eq 0 ]; then
        score=$((score + 1))
    fi
    issues_count=$((issues_count + complex_classes))

    echo "$score:$issues_count"
}

check_ruby_complexity