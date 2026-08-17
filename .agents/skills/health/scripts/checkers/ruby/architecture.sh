#!/bin/bash
# Ruby 架构设计质量检查
# 输出: 分数:问题数
# 检查项：分层架构规范(4分)、跨层调用检测(3分)、设计模式滥用(3分)、模块耦合度(2分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ruby_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ruby_architecture() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 分层架构规范检查 (4分)
    # ============================================

    local has_controller=0
    local has_model=0
    local has_view=0
    local has_service=0
    local has_helper=0
    local has_lib=0
    local has_config=0

    # Rails 目录结构检查
    [ -d "app/controllers" ] && has_controller=1
    [ -d "app/models" ] && has_model=1
    [ -d "app/views" ] && has_view=1
    [ -d "app/services" ] || [ -d "app/service_objects" ] && has_service=1
    [ -d "app/helpers" ] && has_helper=1
    [ -d "lib" ] && has_lib=1
    [ -d "config" ] && has_config=1

    # Sinatra 目录结构检查
    [ -d "controllers" ] && has_controller=1
    [ -d "models" ] && has_model=1
    [ -d "views" ] && has_view=1
    [ -d "services" ] && has_service=1
    [ -d "helpers" ] && has_helper=1

    local layer_count=$((has_controller + has_model + has_view + has_service + has_helper + has_lib + has_config))

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
        add_issue "P0" "项目结构" "N/A" "缺乏分层架构" "仅${layer_count}层" "重构为分层架构"
        issues_count=$((issues_count + 1))
    fi

    # ============================================
    # 2. 跨层调用检测 (3分)
    # ============================================

    local cross_layer_issues=0

    # 检查 Model 层是否导入了 Controller/View
    if [ -d "app/models" ]; then
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            if grep -qE "require.*controller|require.*view|include.*Controller" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Model层反向导入上层" "require controller/view" "Model不应依赖上层"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find app/models -name "*.rb" 2>/dev/null | head -10)
    fi

    # 检查 lib 目录是否导入了业务层
    if [ -d "lib" ]; then
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            if grep -qE "require.*app/|require_relative.*app/" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Lib层依赖业务层" "require app/" "Lib应为通用工具"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find lib -name "*.rb" 2>/dev/null | head -10)
    fi

    if [ "$cross_layer_issues" -eq 0 ]; then
        score=$((score + 3))
    elif [ "$cross_layer_issues" -le 2 ]; then
        score=$((score + 2))
        issues_count=$((issues_count + cross_layer_issues))
    else
        score=$((score + 1))
        issues_count=$((issues_count + cross_layer_issues))
    fi

    # ============================================
    # 3. 设计模式滥用检查 (3分)
    # ============================================

    local pattern_issues=0

    # 检查单例模式滥用
    local singleton_count=$(grep -rE "include Singleton|\.instance" --include="*.rb" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$singleton_count" -gt 10 ]; then
        add_issue "P2" "项目全局" "N/A" "单例模式过多" "${singleton_count}个" "评估是否必要"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查过度使用全局变量
    local global_vars=$(grep -rE "^\s*\$[a-zA-Z]" --include="*.rb" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$global_vars" -gt 10 ]; then
        add_issue "P2" "项目全局" "N/A" "全局变量过多" "${global_vars}个\$变量" "使用类实例变量替代"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查过度复杂的继承层级
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local inheritance_count=$(grep -cE "class.*<.*<" "$file" 2>/dev/null || echo 0)
        if [ "$inheritance_count" -gt 3 ]; then
            add_issue "P2" "$short_file" "N/A" "继承层级复杂" "多层继承" "考虑使用组合替代继承"
            pattern_issues=$((pattern_issues + 1))
        fi
    done < <(find . -name "*.rb" -not -path "*/test/*" 2>/dev/null | head -20)

    if [ "$pattern_issues" -eq 0 ]; then
        score=$((score + 3))
    elif [ "$pattern_issues" -eq 1 ]; then
        score=$((score + 2))
        issues_count=$((issues_count + pattern_issues))
    else
        score=$((score + 1))
        issues_count=$((issues_count + pattern_issues))
    fi

    # ============================================
    # 4. 模块耦合度检查 (2分)
    # ============================================

    local coupling_issues=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local require_count=$(grep -cE "^require|^require_relative|^include" "$file" 2>/dev/null || echo 0)

        if [ "$require_count" -gt 20 ]; then
            add_issue "P2" "$short_file" "N/A" "模块耦合度过高" "${require_count}个require" "拆分模块"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find . -name "*.rb" -not -path "*/test/*" 2>/dev/null | head -30)

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

check_ruby_architecture