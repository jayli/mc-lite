#!/bin/bash
# JavaScript/TypeScript 架构设计质量检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.js_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_js_architecture() {
    local score=0
    local issues_count=0

    # 1. 分层架构规范检查 (4分)
    local has_components=0
    local has_services=0
    local has_utils=0
    local has_hooks=0
    local has_pages=0
    local has_api=0
    local has_store=0
    local has_types=0

    [ -d "src/components" ] || [ -d "components" ] && has_components=1
    [ -d "src/services" ] || [ -d "src/api" ] || [ -d "services" ] && has_services=1
    [ -d "src/utils" ] || [ -d "src/lib" ] || [ -d "utils" ] || [ -d "lib" ] && has_utils=1
    [ -d "src/hooks" ] || [ -d "hooks" ] && has_hooks=1
    [ -d "src/pages" ] || [ -d "pages" ] || [ -d "src/views" ] || [ -d "views" ] && has_pages=1
    [ -d "src/api" ] || [ -d "api" ] && has_api=1
    [ -d "src/store" ] || [ -d "store" ] && has_store=1
    [ -d "src/types" ] || [ -d "types" ] || [ -d "src/@types" ] && has_types=1

    local layer_count=$((has_components + has_services + has_utils + has_hooks + has_pages + has_api + has_store + has_types))

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

    # 检查 utils/lib 是否导入了业务层
    if [ -d "src/utils" ] || [ -d "utils" ]; then
        local utils_dir="src/utils"
        [ -d "utils" ] && utils_dir="utils"

        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            if grep -qE "from ['\"](\.\./)*components|from ['\"](\.\./)*pages|from ['\"](\.\./)*store" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Utils层依赖业务层" "import components/pages" "Utils应为纯工具"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find "$utils_dir" -name "*.ts" -o -name "*.js" 2>/dev/null | head -10)
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

    # 3. 设计模式滥用检查 (3分)
    local pattern_issues=0
    local singleton_count=0

    # 检查单例模式滥用
    singleton_count=$(grep -rE "new (class|function)|Object\.freeze|Symbol\(" --include="*.ts" --include="*.js" . 2>/dev/null | grep -c "instance" || echo 0)

    if [ "$singleton_count" -gt 10 ]; then
        add_issue "P2" "项目全局" "N/A" "单例模式过多" "${singleton_count}个" "评估是否必要"
        pattern_issues=$((pattern_issues + 1))
    fi

    if [ "$pattern_issues" -eq 0 ]; then
        score=$((score + 3))
    else
        score=$((score + 2))
        issues_count=$((issues_count + pattern_issues))
    fi

    # 4. 模块耦合度检查 (2分)
    local coupling_issues=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        local import_count=$(grep -cE "^import |^export |from ['\"]" "$file" 2>/dev/null || echo 0)

        if [ "$import_count" -gt 25 ]; then
            add_issue "P2" "$short_file" "N/A" "模块耦合度过高" "${import_count}个import" "拆分模块"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | grep -v node_modules | head -30)

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

check_js_architecture