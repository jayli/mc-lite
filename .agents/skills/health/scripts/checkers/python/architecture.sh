#!/bin/bash
# Python 架构设计质量检查
# 输出: 分数:问题数
# 检查项：分层架构规范(4分)、跨层调用检测(3分)、设计模式滥用(3分)、模块耦合度(2分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.python_architecture_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_python_architecture() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 分层架构规范检查 (4分)
    # ============================================

    # 检查是否有清晰的分层目录结构
    local has_controller=0
    local has_service=0
    local has_model=0
    local has_repository=0
    local has_api=0
    local has_agent=0
    local has_prompt=0
    local has_utils=0
    local has_common=0

    # 检查常见的分层目录名
    [ -d "app/controller" ] || [ -d "app/controllers" ] || [ -d "controllers" ] && has_controller=1
    [ -d "app/service" ] || [ -d "app/services" ] || [ -d "services" ] && has_service=1
    [ -d "app/model" ] || [ -d "app/models" ] || [ -d "models" ] && has_model=1
    [ -d "app/repository" ] || [ -d "app/repositories" ] || [ -d "repositories" ] && has_repository=1
    [ -d "app/api" ] || [ -d "api" ] && has_api=1
    [ -d "app/agent" ] || [ -d "app/agents" ] || [ -d "agents" ] && has_agent=1
    [ -d "app/prompt" ] || [ -d "app/prompts" ] || [ -d "prompts" ] && has_prompt=1
    [ -d "app/utils" ] || [ -d "utils" ] || [ -d "lib" ] && has_utils=1
    [ -d "app/common" ] || [ -d "common" ] || [ -d "core" ] && has_common=1

    # 计算分层得分
    local layer_count=$((has_controller + has_service + has_model + has_repository + has_api + has_agent + has_prompt + has_utils + has_common))

    if [ "$layer_count" -ge 4 ]; then
        score=$((score + 4))
    elif [ "$layer_count" -ge 3 ]; then
        score=$((score + 3))
        add_issue "P2" "项目结构" "N/A" "分层目录较少" "${layer_count}层" "补充缺失层(如utils/common)"
        issues_count=$((issues_count + 1))
    elif [ "$layer_count" -ge 2 ]; then
        score=$((score + 2))
        add_issue "P1" "项目结构" "N/A" "分层架构不清晰" "${layer_count}层" "建立清晰的分层目录"
        issues_count=$((issues_count + 1))
    else
        score=$((score + 1))
        add_issue "P0" "项目结构" "N/A" "缺乏分层架构" "仅${layer_count}层" "重构为分层架构(controller/service/model)"
        issues_count=$((issues_count + 1))
    fi

    # ============================================
    # 2. 跨层调用检测 (3分)
    # ============================================

    local cross_layer_issues=0

    # 检查是否存在不合理的跨层调用
    # 模式1: Controller 直接导入 model 层（合理）
    # 模式2: Model 导入 controller（不合理，反向调用）
    # 模式3: Utils 导入业务层（不合理，工具类不应依赖业务）

    # 检查 model/数据层是否导入了上层的模块
    if [ -d "app/model" ] || [ -d "app/models" ]; then
        local model_dir="app/model"
        [ -d "app/models" ] && model_dir="app/models"

        # 检查 model 层是否导入了 controller/service/agent
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            # 检查是否有向上层导入
            if grep -qE "from (controller|controllers|agent|agents|api)" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Model层反向导入上层" "from controller/agent" "Model不应依赖上层"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find "$model_dir" -name "*.py" 2>/dev/null | head -10)
    fi

    # 检查 utils 工具层是否导入了业务层
    if [ -d "app/utils" ] || [ -d "utils" ]; then
        local utils_dir="utils"
        [ -d "app/utils" ] && utils_dir="app/utils"

        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            # 检查 utils 是否导入业务模块
            if grep -qE "from (app\.|models|services|controllers|agent)" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Utils层依赖业务层" "from services/models" "Utils应为纯工具类"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find "$utils_dir" -name "*.py" 2>/dev/null | head -10)
    fi

    # 检查 common/core 层是否导入了业务层
    if [ -d "app/common" ] || [ -d "common" ] || [ -d "core" ]; then
        local common_dir="common"
        [ -d "app/common" ] && common_dir="app/common"
        [ -d "core" ] && common_dir="core"

        while IFS= read -r file; do
            [ -z "$file" ] && continue
            local short_file=$(echo "$file" | sed 's|^\./||')

            if grep -qE "from (app\.|models|services|controllers|agent|prompt)" "$file" 2>/dev/null; then
                add_issue "P1" "$short_file" "N/A" "Common层依赖业务层" "from services/models" "Common应为通用基础层"
                cross_layer_issues=$((cross_layer_issues + 1))
            fi
        done < <(find "$common_dir" -name "*.py" 2>/dev/null | head -10)
    fi

    # 计算跨层调用得分
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

    local singleton_count=0
    local pattern_issues=0

    # 检查单例模式滥用（过多的 __new__ 或 getInstance）
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查是否实现单例模式
        if grep -qE "def __new__|_instance|getInstance|@singleton" "$file" 2>/dev/null; then
            singleton_count=$((singleton_count + 1))
            if [ "$singleton_count" -gt 5 ]; then
                add_issue "P2" "$short_file" "N/A" "单例模式过多" "已发现${singleton_count}个" "评估是否必要"
            fi
        fi
    done < <(find . -name "*.py" -not -path "*/tests/*" -not -path "*/test/*" 2>/dev/null | head -50)

    # 检查是否有过度复杂的继承层级
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查继承深度（简单检测）
        local inheritance_depth=$(grep -cE "class.*\(.*\).*:" "$file" 2>/dev/null || echo 0)

        if [ "$inheritance_depth" -gt 5 ]; then
            add_issue "P2" "$short_file" "N/A" "继承层级复杂" "${inheritance_depth}层继承" "考虑使用组合替代继承"
            pattern_issues=$((pattern_issues + 1))
        fi
    done < <(find . -name "*.py" -not -path "*/tests/*" 2>/dev/null | head -20)

    # 计算设计模式得分
    if [ "$singleton_count" -le 3 ] && [ "$pattern_issues" -eq 0 ]; then
        score=$((score + 3))
    elif [ "$singleton_count" -le 5 ] && [ "$pattern_issues" -le 1 ]; then
        score=$((score + 2))
        issues_count=$((issues_count + singleton_count + pattern_issues))
    else
        score=$((score + 1))
        issues_count=$((issues_count + singleton_count + pattern_issues))
    fi

    # ============================================
    # 4. 模块耦合度检查 (2分)
    # ============================================

    local coupling_issues=0

    # 检查是否有循环导入（简单检测）
    # 查找同一文件中既导入又可能被导入的情况

    # 检查是否有文件导入过多外部模块（耦合度过高）
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 统计 import 语句数量
        local import_count=$(grep -cE "^(import|from)" "$file" 2>/dev/null || echo 0)

        if [ "$import_count" -gt 20 ]; then
            add_issue "P2" "$short_file" "N/A" "模块耦合度过高" "${import_count}个import" "拆分模块或减少依赖"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find . -name "*.py" -not -path "*/tests/*" -not -path "*/.venv/*" 2>/dev/null | head -30)

    # 检查是否有全局变量滥用
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查文件级别的全局变量（非函数内）
        local global_vars=$(grep -cE "^[a-zA-Z_][a-zA-Z0-9_]* = " "$file" 2>/dev/null || echo 0)

        if [ "$global_vars" -gt 10 ]; then
            add_issue "P2" "$short_file" "N/A" "全局变量过多" "${global_vars}个全局变量" "封装到类或模块中"
            coupling_issues=$((coupling_issues + 1))
        fi
    done < <(find . -name "*.py" -not -path "*/tests/*" 2>/dev/null | head -20)

    # 计算耦合度得分
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

# 执行检查
check_python_architecture