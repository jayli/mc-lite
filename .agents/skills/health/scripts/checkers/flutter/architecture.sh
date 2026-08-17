#!/bin/bash
# Flutter/Dart 架构设计质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_architecture() {
    local score=0
    local issues_count=0

    # 1. 分层架构规范检查 (4分)
    local has_lib=0
    local has_models=0
    local has_views=0
    local has_widgets=0
    local has_controllers=0
    local has_providers=0
    local has_services=0
    local has_utils=0

    [ -d "lib" ] && has_lib=1
    [ -d "lib/models" ] || [ -d "lib/model" ] && has_models=1
    [ -d "lib/views" ] || [ -d "lib/view" ] || [ -d "lib/screens" ] || [ -d "lib/pages" ] && has_views=1
    [ -d "lib/widgets" ] || [ -d "lib/widget" ] && has_widgets=1
    [ -d "lib/controllers" ] || [ -d "lib/controller" ] && has_controllers=1
    [ -d "lib/providers" ] || [ -d "lib/provider" ] && has_providers=1
    [ -d "lib/services" ] || [ -d "lib/service" ] && has_services=1
    [ -d "lib/utils" ] || [ -d "lib/util" ] || [ -d "lib/helpers" ] && has_utils=1

    local layer_count=$((has_models + has_views + has_widgets + has_controllers + has_providers + has_services + has_utils))

    if [ "$has_lib" -eq 0 ]; then
        score=$((score + 1))
        add_issue "P0" "项目结构" "N/A" "非标准Flutter项目" "无lib目录" "使用flutter create"
        issues_count=$((issues_count + 1))
    elif [ "$layer_count" -ge 5 ]; then
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

    # 检查models是否导入了UI层
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        if grep -qE "import.*widgets|import.*screens|import.*pages" "$file" 2>/dev/null; then
            add_issue "P1" "$short_file" "N/A" "Model层依赖UI层" "import widgets/screens" "Model应为纯数据"
            cross_layer_issues=$((cross_layer_issues + 1))
        fi
    done < <(find lib/models -name "*.dart" 2>/dev/null | head -10)

    # 检查utils是否导入了业务层
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        if grep -qE "import.*models|import.*services|import.*providers" "$file" 2>/dev/null; then
            add_issue "P1" "$short_file" "N/A" "Utils层依赖业务层" "import models/services" "Utils应为纯工具"
            cross_layer_issues=$((cross_layer_issues + 1))
        fi
    done < <(find lib/utils -name "*.dart" 2>/dev/null | head -10)

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

    # 检查是否过度使用GlobalKey
    local global_key_count=$(grep -rE "GlobalKey<" --include="*.dart" lib/ 2>/dev/null | wc -l | tr -d ' ')

    if [ "$global_key_count" -gt 10 ]; then
        add_issue "P2" "项目全局" "N/A" "GlobalKey过多" "${global_key_count}个" "评估是否必要"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查Build方法过长
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local build_lines=$(grep -A100 "Widget build" "$file" 2>/dev/null | grep -c "^\s" || echo 0)

        if [ "$build_lines" -gt 100 ]; then
            add_issue "P1" "$short_file" "N/A" "build方法过长" ">${build_lines}行" "拆分为多个Widget"
            pattern_issues=$((pattern_issues + 1))
        fi
    done < <(find lib -name "*.dart" 2>/dev/null | head -20)

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

        local import_count=$(grep -cE "^import " "$file" 2>/dev/null || echo 0)

        if [ "$import_count" -gt 20 ]; then
            add_issue "P2" "$short_file" "N/A" "模块耦合度过高" "${import_count}个import" "拆分模块"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find lib -name "*.dart" 2>/dev/null | head -30)

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

check_flutter_architecture