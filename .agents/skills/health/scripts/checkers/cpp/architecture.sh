#!/bin/bash
# C++ 架构设计质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.cpp_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_cpp_architecture() {
    local score=0
    local issues_count=0

    # 1. 分层架构规范检查 (4分)
    local has_include=0
    local has_src=0
    local has_lib=0
    local has_core=0
    local has_utils=0
    local has_modules=0

    [ -d "include" ] && has_include=1
    [ -d "src" ] && has_src=1
    [ -d "lib" ] && has_lib=1
    [ -d "core" ] && has_core=1
    [ -d "utils" ] || [ -d "util" ] && has_utils=1
    [ -d "modules" ] || [ -d "module" ] && has_modules=1

    local layer_count=$((has_include + has_src + has_lib + has_core + has_utils + has_modules))

    if [ "$layer_count" -ge 4 ]; then
        score=$((score + 4))
    elif [ "$layer_count" -ge 3 ]; then
        score=$((score + 3))
        add_issue "P2" "项目结构" "N/A" "分层目录较少" "${layer_count}层" "补充缺失层"
        issues_count=$((issues_count + 1))
    elif [ "$layer_count" -ge 2 ]; then
        score=$((score + 2))
        add_issue "P1" "项目结构" "N/A" "分层架构不清晰" "${layer_count}层" "建立清晰的分层目录"
        issues_count=$((issues_count + 1))
    else
        score=$((score + 1))
        add_issue "P1" "项目结构" "N/A" "缺乏分层架构" "仅${layer_count}层" "重构为分层架构"
        issues_count=$((issues_count + 1))
    fi

    # 2. 跨层调用检测 (3分)
    local cross_layer_issues=0

    # 检查头文件依赖
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查是否include了实现文件
        if grep -qE '#include.*\.cpp|#include.*\.cc' "$file" 2>/dev/null; then
            add_issue "P1" "$short_file" "N/A" "头文件包含实现文件" "#include *.cpp" "只包含头文件"
            cross_layer_issues=$((cross_layer_issues + 1))
        fi
    done < <(find . -name "*.h" -o -name "*.hpp" 2>/dev/null | head -20)

    if [ "$cross_layer_issues" -eq 0 ]; then
        score=$((score + 3))
    elif [ "$cross_layer_issues" -le 2 ]; then
        score=$((score + 2))
        issues_count=$((issues_count + cross_layer_issues))
    else
        score=$((score + 1))
        issues_count=$((issues_count + cross_layer_issues))
    fi

    # 3. 设计模式滥用检查 (3分)
    local pattern_issues=0

    # 检查单例模式滥用
    local singleton_count=$(grep -rE "static.*instance|getInstance|Singleton" --include="*.h" --include="*.hpp" --include="*.cpp" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$singleton_count" -gt 10 ]; then
        add_issue "P2" "项目全局" "N/A" "单例模式过多" "${singleton_count}个" "评估是否必要"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查全局变量
    local global_count=$(grep -rE "^[a-zA-Z_][a-zA-Z0-9_]*\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=" --include="*.cpp" --include="*.cc" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$global_count" -gt 20 ]; then
        add_issue "P2" "项目全局" "N/A" "全局变量过多" "${global_count}个" "封装到命名空间或类"
        pattern_issues=$((pattern_issues + 1))
    fi

    if [ "$pattern_issues" -eq 0 ]; then
        score=$((score + 3))
    elif [ "$pattern_issues" -eq 1 ]; then
        score=$((score + 2))
        issues_count=$((issues_count + pattern_issues))
    else
        score=$((score + 1))
        issues_count=$((issues_count + pattern_issues))
    fi

    # 4. 模块耦合度检查 (2分)
    local coupling_issues=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local include_count=$(grep -cE "#include" "$file" 2>/dev/null || echo 0)

        if [ "$include_count" -gt 25 ]; then
            add_issue "P2" "$short_file" "N/A" "模块耦合度过高" "${include_count}个include" "拆分模块或使用前向声明"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find . -name "*.h" -o -name "*.hpp" 2>/dev/null | head -30)

    if [ "$coupling_issues" -eq 0 ]; then
        score=$((score + 2))
    elif [ "$coupling_issues" -le 2 ]; then
        score=$((score + 1))
        issues_count=$((issues_count + coupling_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + coupling_issues))
    fi

    echo "$score:$issues_count"
}

check_cpp_architecture