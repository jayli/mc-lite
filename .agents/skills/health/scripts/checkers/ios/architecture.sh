#!/bin/bash
# iOS (Objective-C/Swift) 架构设计质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ios_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_architecture() {
    local score=0
    local issues_count=0

    # 1. 分层架构规范检查 (4分)
    local has_viewcontroller=0
    local has_model=0
    local has_view=0
    local has_viewmodel=0
    local has_service=0
    local has_utils=0
    local has_categories=0
    local has_managers=0

    # 检查常见的分层目录
    find . -type d -name "ViewController*" 2>/dev/null | head -1 | grep -q . && has_viewcontroller=1
    find . -type d -name "Controllers" 2>/dev/null | head -1 | grep -q . && has_viewcontroller=1
    find . -type d -name "Model*" 2>/dev/null | head -1 | grep -q . && has_model=1
    find . -type d -name "Models" 2>/dev/null | head -1 | grep -q . && has_model=1
    find . -type d -name "View*" 2>/dev/null | grep -v ViewController | head -1 | grep -q . && has_view=1
    find . -type d -name "Views" 2>/dev/null | head -1 | grep -q . && has_view=1
    find . -type d -name "ViewModel*" 2>/dev/null | head -1 | grep -q . && has_viewmodel=1
    find . -type d -name "ViewModels" 2>/dev/null | head -1 | grep -q . && has_viewmodel=1
    find . -type d -name "Service*" 2>/dev/null | head -1 | grep -q . && has_service=1
    find . -type d -name "Services" 2>/dev/null | head -1 | grep -q . && has_service=1
    find . -type d -name "Utils" 2>/dev/null | head -1 | grep -q . && has_utils=1
    find . -type d -name "Categories" 2>/dev/null | head -1 | grep -q . && has_categories=1
    find . -type d -name "Managers" 2>/dev/null | head -1 | grep -q . && has_managers=1

    local layer_count=$((has_viewcontroller + has_model + has_view + has_viewmodel + has_service + has_utils + has_categories + has_managers))

    if [ "$layer_count" -ge 5 ]; then
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
        add_issue "P0" "项目结构" "N/A" "缺乏分层架构" "仅${layer_count}层" "重构为分层架构"
        issues_count=$((issues_count + 1))
    fi

    # 2. 跨层调用检测 (3分)
    local cross_layer_issues=0

    # 检查Model是否导入了ViewController
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        if grep -qE "#import.*ViewController|#import.*Controller" "$file" 2>/dev/null; then
            add_issue "P1" "$short_file" "N/A" "Model层反向导入Controller" "#import Controller" "Model不应依赖Controller"
            cross_layer_issues=$((cross_layer_issues + 1))
        fi
    done < <(find . -path "*/Model*" -name "*.m" -o -path "*/Model*" -name "*.swift" 2>/dev/null | head -10)

    # 检查Utils/Categories是否导入了业务层
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        if grep -qE "#import.*ViewController|#import.*Service|#import.*Manager" "$file" 2>/dev/null; then
            add_issue "P1" "$short_file" "N/A" "Utils/Categories依赖业务层" "#import Service/Controller" "Utils应为纯工具类"
            cross_layer_issues=$((cross_layer_issues + 1))
        fi
    done < <(find . -path "*/Utils/*" -name "*.m" -o -path "*/Categories/*" -name "*.m" 2>/dev/null | head -10)

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
    local singleton_count=$(grep -rE "sharedInstance|sharedManager|shared\(\)|defaultCenter" --include="*.m" --include="*.swift" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$singleton_count" -gt 15 ]; then
        add_issue "P2" "项目全局" "N/A" "单例模式过多" "${singleton_count}个" "评估是否必要"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查 Massive ViewController
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')
        local lines=$(wc -l < "$file")

        if [ "$lines" -gt 1000 ]; then
            add_issue "P1" "$short_file" "N/A" "Massive ViewController" "${lines}行" "拆分到ViewModel/Service"
            pattern_issues=$((pattern_issues + 1))
        fi
    done < <(find . -name "*ViewController*.m" -o -name "*ViewController*.swift" 2>/dev/null | head -10)

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

    # 检查头文件依赖
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local import_count=$(grep -cE "#import|#include" "$file" 2>/dev/null || echo 0)

        if [ "$import_count" -gt 25 ]; then
            add_issue "P2" "$short_file" "N/A" "模块耦合度过高" "${import_count}个import" "使用@class前向声明"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find . -name "*.h" 2>/dev/null | head -30)

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

check_ios_architecture