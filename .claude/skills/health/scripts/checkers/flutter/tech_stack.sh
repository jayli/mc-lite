#!/bin/bash
# Flutter 技术栈健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.flutter_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_flutter_tech_stack() {
    local score=0
    local issues_count=0

    # 1. 框架一致性检查 (3分)
    local framework_issues=0

    # 检查状态管理一致性
    local has_provider=0
    local has_riverpod=0
    local has_bloc=0
    local has_getx=0
    local has_mobx=0

    if [ -f "pubspec.yaml" ]; then
        grep -qE "provider:" pubspec.yaml && has_provider=1
        grep -qE "riverpod|flutter_riverpod" pubspec.yaml && has_riverpod=1
        grep -qE "flutter_bloc|bloc:" pubspec.yaml && has_bloc=1
        grep -qE "get:|get:" pubspec.yaml && has_getx=1
        grep -qE "mobx|flutter_mobx" pubspec.yaml && has_mobx=1
    fi

    local state_count=$((has_provider + has_riverpod + has_bloc + has_getx + has_mobx))

    if [ "$state_count" -gt 2 ]; then
        add_issue "P1" "pubspec.yaml" "N/A" "混用多个状态管理" "Provider/Riverpod/Bloc混用" "统一状态管理方案"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查路由管理一致性
    local has_go_router=0
    local has_auto_route=0
    local has_get_router=0

    if [ -f "pubspec.yaml" ]; then
        grep -qE "go_router" pubspec.yaml && has_go_router=1
        grep -qE "auto_route" pubspec.yaml && has_auto_route=1
        grep -qE "get:" pubspec.yaml && has_get_router=1
    fi

    local router_count=$((has_go_router + has_auto_route + has_get_router))

    if [ "$router_count" -gt 1 ]; then
        add_issue "P2" "pubspec.yaml" "N/A" "混用多个路由方案" "多路由库混用" "统一路由方案"
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

    # 检查pubspec.lock
    if [ ! -f "pubspec.lock" ] && [ -f "pubspec.yaml" ]; then
        add_issue "P1" "项目依赖" "N/A" "缺少pubspec.lock" "无lock文件" "执行flutter pub get"
        version_issues=$((version_issues + 1))
    fi

    # 检查Flutter SDK版本
    if [ -f "pubspec.yaml" ]; then
        local sdk_constraint=$(grep -A1 "environment:" pubspec.yaml 2>/dev/null | grep "sdk:" | sed 's/.*sdk: //' | tr -d "'\"")

        if echo "$sdk_constraint" | grep -qE "<3.0.0|<2.19"; then
            add_issue "P2" "pubspec.yaml" "N/A" "SDK版本约束过低" "$sdk_constraint" "升级到Flutter 3+"
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

    if [ -f "pubspec.yaml" ]; then
        dependency_count=$(grep -cE "^\s+[a-z_]+:" pubspec.yaml 2>/dev/null || echo 0)
    fi

    if [ "$dependency_count" -gt 40 ]; then
        add_issue "P2" "pubspec.yaml" "N/A" "依赖数量过多" "${dependency_count}个依赖" "清理未使用依赖"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 25 ]; then
        add_issue "P2" "pubspec.yaml" "N/A" "依赖数量偏多" "${dependency_count}个依赖" "定期清理"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # 4. 技术选型合理性 (1分)
    local tech_issues=0

    # 检查是否使用了null safety
    if [ -f "pubspec.yaml" ]; then
        if grep -qE "sdk: '>=2.10|sdk: '>=2.11|sdk: '>=2.12" pubspec.yaml; then
            :
        else
            add_issue "P2" "pubspec.yaml" "N/A" "未启用null safety" "旧Dart版本" "升级到null safety"
            tech_issues=$((tech_issues + 1))
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

check_flutter_tech_stack