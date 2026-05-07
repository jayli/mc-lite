#!/bin/bash
# JavaScript/TypeScript 技术栈健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.js_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_js_tech_stack() {
    local score=0
    local issues_count=0

    # 1. 框架一致性检查 (3分)
    local framework_issues=0

    local has_react=0
    local has_vue=0
    local has_angular=0
    local has_svelte=0
    local has_next=0
    local has_nuxt=0

    if [ -f "package.json" ]; then
        grep -qE '"react"|"react-dom"' package.json && has_react=1
        grep -qE '"vue"' package.json && has_vue=1
        grep -qE '"@angular/' package.json && has_angular=1
        grep -qE '"svelte"' package.json && has_svelte=1
        grep -qE '"next"' package.json && has_next=1
        grep -qE '"nuxt"' package.json && has_nuxt=1
    fi

    local framework_count=$((has_react + has_vue + has_angular + has_svelte))

    if [ "$framework_count" -gt 1 ]; then
        add_issue "P0" "package.json" "N/A" "混用多个前端框架" "React/Vue/Angular混用" "统一使用单一框架"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查状态管理一致性
    local has_redux=0
    local has_mobx=0
    local has_vuex=0
    local has_pinia=0
    local has_zustand=0
    local has_recoil=0

    if [ -f "package.json" ]; then
        grep -qE '"redux"|"@reduxjs' package.json && has_redux=1
        grep -qE '"mobx"' package.json && has_mobx=1
        grep -qE '"vuex"' package.json && has_vuex=1
        grep -qE '"pinia"' package.json && has_pinia=1
        grep -qE '"zustand"' package.json && has_zustand=1
        grep -qE '"recoil"' package.json && has_recoil=1
    fi

    local state_count=$((has_redux + has_mobx + has_vuex + has_pinia + has_zustand + has_recoil))

    if [ "$state_count" -gt 2 ]; then
        add_issue "P1" "package.json" "N/A" "混用多个状态管理" "Redux/MobX/Vuex等混用" "统一状态管理方案"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查UI库一致性
    local has_ant=0
    local has_element=0
    local has_material=0
    local has_chakra=0

    if [ -f "package.json" ]; then
        grep -qE '"antd"|"ant-design"' package.json && has_ant=1
        grep -qE '"element-ui"|"element-plus"' package.json && has_element=1
        grep -qE '"@mui|"@material-ui"' package.json && has_material=1
        grep -qE '"@chakra-ui"' package.json && has_chakra=1
    fi

    local ui_count=$((has_ant + has_element + has_material + has_chakra))

    if [ "$ui_count" -gt 1 ]; then
        add_issue "P2" "package.json" "N/A" "混用多个UI组件库" "AntD/Element/MUI等混用" "统一UI组件库"
        framework_issues=$((framework_issues + 1))
    fi

    if [ "$framework_issues" -eq 0 ]; then
        score=$((score + 3))
    elif [ "$framework_issues" -eq 1 ]; then
        score=$((score + 2))
        issues_count=$((issues_count + framework_issues))
    else
        score=$((score + 1))
        issues_count=$((issues_count + framework_issues))
    fi

    # 2. 版本管理质量检查 (2分)
    local version_issues=0

    # 检查lock文件
    local has_lock=0
    [ -f "package-lock.json" ] && has_lock=1
    [ -f "yarn.lock" ] && has_lock=1
    [ -f "pnpm-lock.yaml" ] && has_lock=1

    if [ "$has_lock" -eq 0 ]; then
        add_issue "P1" "项目依赖" "N/A" "缺少依赖锁定文件" "无lock文件" "生成lock文件"
        version_issues=$((version_issues + 1))
    fi

    # 检查是否有版本范围声明
    if [ -f "package.json" ]; then
        local range_versions=$(grep -cE '"\^|"~' package.json 2>/dev/null || echo 0)
        if [ "$range_versions" -gt 20 ]; then
            add_issue "P2" "package.json" "N/A" "版本声明过于宽松" "${range_versions}个范围声明" "考虑锁定版本"
            version_issues=$((version_issues + 1))
        fi
    fi

    if [ "$version_issues" -eq 0 ]; then
        score=$((score + 2))
    elif [ "$version_issues" -eq 1 ]; then
        score=$((score + 1))
        issues_count=$((issues_count + version_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + version_issues))
    fi

    # 3. 依赖数量评估 (2分)
    local dependency_count=0

    if [ -f "package.json" ]; then
        dependency_count=$(grep -cE '"[^"]+":' package.json 2>/dev/null || echo 0)
        dependency_count=$((dependency_count / 2))  # 粗略估计
    fi

    if [ "$dependency_count" -gt 100 ]; then
        add_issue "P2" "package.json" "N/A" "依赖数量过多" ">${dependency_count}个依赖" "清理未使用依赖"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 50 ]; then
        add_issue "P2" "package.json" "N/A" "依赖数量偏多" "${dependency_count}个依赖" "定期清理"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # 4. 技术选型合理性 (1分)
    local tech_issues=0

    if [ -f "package.json" ]; then
        # 检查是否同时有ESM和CJS配置
        if grep -q '"type": "module"' package.json && [ -f "tsconfig.json" ]; then
            if grep -q '"module": "commonjs"' tsconfig.json 2>/dev/null; then
                add_issue "P2" "项目配置" "N/A" "模块系统不一致" "ESM与CJS混用" "统一模块系统"
                tech_issues=$((tech_issues + 1))
            fi
        fi
    fi

    if [ "$tech_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + tech_issues))
    fi

    echo "$score:$issues_count"
}

check_js_tech_stack