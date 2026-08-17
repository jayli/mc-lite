#!/bin/bash
# Rust 架构设计质量检查
# 输出: 分数:问题数
# 检查项：分层架构规范(4分)、跨层调用检测(3分)、设计模式滥用(3分)、模块耦合度(2分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_architecture() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 分层架构规范检查 (4分)
    # ============================================

    local has_handler=0
    local has_model=0
    local has_service=0
    local has_repo=0
    local has_utils=0
    local has_config=0

    # 检查常见目录结构
    [ -d "src/handlers" ] || [ -d "src/controllers" ] && has_handler=1
    [ -d "src/models" ] || [ -d "src/entities" ] && has_model=1
    [ -d "src/services" ] && has_service=1
    [ -d "src/repositories" ] || [ -d "src/repos" ] && has_repo=1
    [ -d "src/utils" ] || [ -d "src/lib" ] && has_utils=1
    [ -d "src/config" ] && has_config=1

    local layer_count=$((has_handler + has_model + has_service + has_repo + has_utils + has_config))

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

    # 检查 models/entities 是否导入了 handlers
    if [ -d "src/models" ] || [ -d "src/entities" ]; then
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            if grep -qE "use.*handlers|use.*controllers" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Model层反向导入Handler" "use handlers" "Model不应依赖Handler"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find src/models src/entities -name "*.rs" 2>/dev/null | head -10)
    fi

    # 检查 utils 是否导入了业务层
    if [ -d "src/utils" ]; then
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            if grep -qE "use.*handlers|use.*services|use.*models" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Utils层依赖业务层" "use services/models" "Utils应为纯工具"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find src/utils -name "*.rs" 2>/dev/null | head -10)
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

    # 检查过多使用 Arc<Mutex>（可能是设计问题）
    local arc_mutex_count=$(grep -rE "Arc<Mutex|Arc<RwLock" --include="*.rs" src/ 2>/dev/null | wc -l | tr -d ' ')

    if [ "$arc_mutex_count" -gt 10 ]; then
        add_issue "P2" "项目全局" "N/A" "过度使用Arc<Mutex>" "${arc_mutex_count}处" "评估是否需要重构"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查过多使用 unsafe 代码块
    local unsafe_count=$(grep -rE "unsafe\s*\{" --include="*.rs" src/ 2>/dev/null | wc -l | tr -d ' ')

    if [ "$unsafe_count" -gt 5 ]; then
        add_issue "P2" "项目全局" "N/A" "过多unsafe代码块" "${unsafe_count}处" "评估安全性"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查过度使用 clone()
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local clone_count=$(grep -cE "\.clone\(\)" "$file" 2>/dev/null || echo 0)
        if [ "$clone_count" -gt 15 ]; then
            add_issue "P2" "$short_file" "N/A" "过多clone()调用" "${clone_count}处" "考虑使用引用"
            pattern_issues=$((pattern_issues + 1))
        fi
    done < <(find src -name "*.rs" 2>/dev/null | head -20)

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
    done < <(find src -name "*.rs" 2>/dev/null | head -30)

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

check_rust_architecture