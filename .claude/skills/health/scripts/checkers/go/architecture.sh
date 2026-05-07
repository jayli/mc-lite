#!/bin/bash
# Go 架构设计质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.go_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_go_architecture() {
    local score=0
    local issues_count=0

    # 1. 分层架构规范检查 (4分)
    local has_cmd=0
    local has_internal=0
    local has_pkg=0
    local has_api=0
    local has_service=0
    local has_repo=0
    local has_model=0
    local has_handler=0

    [ -d "cmd" ] && has_cmd=1
    [ -d "internal" ] && has_internal=1
    [ -d "pkg" ] && has_pkg=1
    [ -d "api" ] || [ -d "api/v1" ] && has_api=1
    find . -type d -name "service*" 2>/dev/null | head -1 | grep -q . && has_service=1
    find . -type d -name "repository*" 2>/dev/null | head -1 | grep -q . && has_repo=1
    find . -type d -name "model*" 2>/dev/null | head -1 | grep -q . && has_model=1
    find . -type d -name "handler*" 2>/dev/null | head -1 | grep -q . && has_handler=1

    local layer_count=$((has_cmd + has_internal + has_pkg + has_api + has_service + has_repo + has_model + has_handler))

    if [ "$layer_count" -ge 5 ]; then
        score=$((score + 4))
    elif [ "$layer_count" -ge 3 ]; then
        score=$((score + 3))
        add_issue "P2" "项目结构" "N/A" "分层目录较少" "${layer_count}层" "补充缺失层"
        issues_count=$((issues_count + 1))
    elif [ "$layer_count" -ge 2 ]; then
        score=$((score + 2))
        add_issue "P1" "项目结构" "N/A" "分层架构不清晰" "${layer_count}层" "遵循Go项目布局"
        issues_count=$((issues_count + 1))
    else
        score=$((score + 1))
        add_issue "P1" "项目结构" "N/A" "缺乏分层架构" "仅${layer_count}层" "使用标准Go项目布局"
        issues_count=$((issues_count + 1))
    fi

    # 2. 跨层调用检测 (3分)
    local cross_layer_issues=0

    # 检查internal外的包是否导入了internal
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        if echo "$short_file" | grep -vqE "^internal/"; then
            if grep -qE "import.*\"github\.com/[^\"]+/internal" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "外部包导入internal" "import internal" "internal应为私有"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        fi
    done < <(find . -name "*.go" -not -path "./internal/*" 2>/dev/null | head -20)

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

    # 检查全局变量滥用
    local global_var_count=$(grep -rE "^[a-z]+\s+var|var\s+[A-Z][a-zA-Z]+\s*=" --include="*.go" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$global_var_count" -gt 20 ]; then
        add_issue "P2" "项目全局" "N/A" "全局变量过多" "${global_var_count}个" "使用依赖注入"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查interface滥用
    local interface_count=$(grep -cE "^type\s+\w+\s+interface\s*\{" --include="*.go" . -r 2>/dev/null | awk -F: '{sum+=$NF} END {print sum}' || echo 0)

    if [ "$interface_count" -gt 30 ]; then
        add_issue "P2" "项目全局" "N/A" "interface过多" "${interface_count}个" "按需定义interface"
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

        local import_count=$(grep -cE "^\t\"|^\t\t\"" "$file" 2>/dev/null || echo 0)

        if [ "$import_count" -gt 20 ]; then
            add_issue "P2" "$short_file" "N/A" "模块耦合度过高" "${import_count}个import" "拆分模块"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find . -name "*.go" 2>/dev/null | head -30)

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

check_go_architecture