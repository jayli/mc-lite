#!/bin/bash
# Java 架构设计质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.java_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_architecture() {
    local score=0
    local issues_count=0

    # 1. 分层架构规范检查 (4分)
    local has_controller=0
    local has_service=0
    local has_repository=0
    local has_model=0
    local has_dto=0
    local has_config=0
    local has_util=0

    # 检查常见的分层目录
    find . -type d -name "controller" 2>/dev/null | head -1 | grep -q . && has_controller=1
    find . -type d -name "controllers" 2>/dev/null | head -1 | grep -q . && has_controller=1
    find . -type d -name "service" 2>/dev/null | head -1 | grep -q . && has_service=1
    find . -type d -name "services" 2>/dev/null | head -1 | grep -q . && has_service=1
    find . -type d -name "repository" 2>/dev/null | head -1 | grep -q . && has_repository=1
    find . -type d -name "repositories" 2>/dev/null | head -1 | grep -q . && has_repository=1
    find . -type d -name "model" 2>/dev/null | head -1 | grep -q . && has_model=1
    find . -type d -name "entity" 2>/dev/null | head -1 | grep -q . && has_model=1
    find . -type d -name "dto" 2>/dev/null | head -1 | grep -q . && has_dto=1
    find . -type d -name "config" 2>/dev/null | head -1 | grep -q . && has_config=1
    find . -type d -name "util" 2>/dev/null | head -1 | grep -q . && has_util=1
    find . -type d -name "utils" 2>/dev/null | head -1 | grep -q . && has_util=1

    local layer_count=$((has_controller + has_service + has_repository + has_model + has_dto + has_config + has_util))

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

    # 检查Entity是否导入了Controller
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        if grep -qE "import.*\.controller\.|import.*\.controllers\." "$file" 2>/dev/null; then
            add_issue "P1" "$short_file" "N/A" "Entity层反向导入Controller" "import controller" "Entity不应依赖Controller"
            cross_layer_issues=$((cross_layer_issues + 1))
        fi
    done < <(find . -path "*/entity/*" -name "*.java" 2>/dev/null | head -10)

    # 检查Util是否导入了业务层
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        if grep -qE "import.*\.service\.|import.*\.controller\.|import.*\.repository\." "$file" 2>/dev/null; then
            add_issue "P1" "$short_file" "N/A" "Util层依赖业务层" "import service/controller" "Util应为纯工具类"
            cross_layer_issues=$((cross_layer_issues + 1))
        fi
    done < <(find . -path "*/util/*" -o -path "*/utils/*" -name "*.java" 2>/dev/null | head -10)

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
    local singleton_count=$(grep -rE "private static.*instance|getInstance\(\)" --include="*.java" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$singleton_count" -gt 10 ]; then
        add_issue "P2" "项目全局" "N/A" "单例模式过多" "${singleton_count}个" "评估是否必要"
        pattern_issues=$((pattern_issues + 1))
    fi

    # 检查过度使用静态方法
    local static_method_count=$(grep -rE "public static [a-zA-Z]+ [a-zA-Z]+\(" --include="*.java" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$static_method_count" -gt 50 ]; then
        add_issue "P2" "项目全局" "N/A" "静态方法过多" "${static_method_count}个" "考虑使用依赖注入"
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

        local import_count=$(grep -cE "^import " "$file" 2>/dev/null || echo 0)

        if [ "$import_count" -gt 30 ]; then
            add_issue "P2" "$short_file" "N/A" "模块耦合度过高" "${import_count}个import" "拆分模块"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find . -name "*.java" 2>/dev/null | head -30)

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

check_java_architecture