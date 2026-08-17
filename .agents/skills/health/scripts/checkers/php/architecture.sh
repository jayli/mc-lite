#!/bin/bash
# PHP 架构设计质量检查
# 输出: 分数:问题数
# 检查项：分层架构规范(4分)、跨层调用检测(3分)、设计模式滥用(3分)、模块耦合度(2分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.php_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_php_architecture() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 分层架构规范检查 (4分)
    # ============================================

    local has_controller=0
    local has_model=0
    local has_view=0
    local has_service=0
    local has_repository=0
    local has_helper=0

    # Laravel 目录结构检查
    [ -d "app/Http/Controllers" ] && has_controller=1
    [ -d "app/Models" ] && has_model=1
    [ -d "resources/views" ] && has_view=1
    [ -d "app/Services" ] && has_service=1
    [ -d "app/Repositories" ] && has_repository=1

    # Symfony 目录结构检查
    [ -d "src/Controller" ] && has_controller=1
    [ -d "src/Entity" ] && has_model=1
    [ -d "templates" ] || [ -d "src/Templates" ] && has_view=1
    [ -d "src/Service" ] && has_service=1
    [ -d "src/Repository" ] && has_repository=1

    # CodeIgniter/CakePHP 结构检查
    [ -d "app/Controllers" ] && has_controller=1
    [ -d "app/Models" ] && has_model=1
    [ -d "app/Views" ] && has_view=1

    local layer_count=$((has_controller + has_model + has_view + has_service + has_repository + has_helper))

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

    # 检查 Entity/Model 层是否导入了 Controller/View
    if [ -d "app/Models" ] || [ -d "src/Entity" ]; then
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            if grep -qE "use.*Controller|use.*View|use.*Http" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Model层反向导入上层" "use Controller/View" "Model不应依赖上层"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find app/Models src/Entity -name "*.php" 2>/dev/null | head -10)
    fi

    # 检查 Repository 是否导入了 Controller
    if [ -d "app/Repositories" ] || [ -d "src/Repository" ]; then
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            if grep -qE "use.*Controller|use.*Http" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Repository导入Controller" "use Controller" "Repository不应依赖Controller"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find app/Repositories src/Repository -name "*.php" 2>/dev/null | head -10)
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
    local singleton_count=$(grep -rE "private static.*instance|getInstance\(\)|Singleton::" --include="*.php" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$singleton_count" -gt 10 ]; then
        add_issue "P2" "项目全局" "N/A" "单例模式过多" "${singleton_count}个" "评估是否必要"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查过度使用静态方法
    local static_method_count=$(grep -rE "public static function" --include="*.php" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$static_method_count" -gt 30 ]; then
        add_issue "P2" "项目全局" "N/A" "静态方法过多" "${static_method_count}个" "考虑使用依赖注入"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查过度复杂的继承层级
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local extends_count=$(grep -cE "extends.*extends|implements.*implements" "$file" 2>/dev/null || echo 0)
        if [ "$extends_count" -gt 2 ]; then
            add_issue "P2" "$short_file" "N/A" "继承层级复杂" "多层继承" "考虑使用组合"
            pattern_issues=$((pattern_issues + 1))
        fi
    done < <(find . -name "*.php" -not -path "*/vendor/*" 2>/dev/null | head -20)

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

        local use_count=$(grep -cE "^use " "$file" 2>/dev/null || echo 0)

        if [ "$use_count" -gt 20 ]; then
            add_issue "P2" "$short_file" "N/A" "模块耦合度过高" "${use_count}个use" "拆分模块"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find . -name "*.php" -not -path "*/vendor/*" 2>/dev/null | head -30)

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

check_php_architecture