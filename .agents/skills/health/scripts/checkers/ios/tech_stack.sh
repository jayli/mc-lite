#!/bin/bash
# iOS 技术栈健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ios_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ios_tech_stack() {
    local score=0
    local issues_count=0

    # 1. 框架一致性检查 (3分)
    local framework_issues=0

    # 检查UI框架一致性（SwiftUI vs UIKit）
    local has_swiftui=0
    local has_uikit=0

    grep -rqE "import SwiftUI|@main|View\s*\{" --include="*.swift" . 2>/dev/null && has_swiftui=1
    grep -rqE "import UIKit|UIView|UIViewController" --include="*.swift" --include="*.m" . 2>/dev/null && has_uikit=1

    # 混用不是问题，但需要了解
    if [ "$has_swiftui" -eq 1 ] && [ "$has_uikit" -eq 1 ]; then
        # 检查是否大量混用
        local swiftui_count=$(grep -rE "import SwiftUI" --include="*.swift" . 2>/dev/null | wc -l | tr -d ' ')
        local uikit_count=$(grep -rE "import UIKit" --include="*.swift" . 2>/dev/null | wc -l | tr -d ' ')

        if [ "$swiftui_count" -gt 5 ] && [ "$uikit_count" -gt 20 ]; then
            add_issue "P2" "项目全局" "N/A" "SwiftUI与UIKit混用" "考虑统一UI框架" "逐步迁移到SwiftUI"
            framework_issues=$((framework_issues + 1))
        fi
    fi

    # 检查网络库一致性
    local has_afnetworking=0
    local has_alamofire=0
    local has_urlsession=0

    if [ -f "Podfile" ]; then
        grep -qE "AFNetworking" Podfile && has_afnetworking=1
        grep -qE "Alamofire" Podfile && has_alamofire=1
    fi

    grep -rqE "import Alamofire|Alamofire\." --include="*.swift" . 2>/dev/null && has_alamofire=1
    grep -rqE "#import.*AFNetworking|AFHTTPSessionManager" --include="*.m" . 2>/dev/null && has_afnetworking=1
    grep -rqE "URLSession|NSURLSession" --include="*.swift" --include="*.m" . 2>/dev/null && has_urlsession=1

    local network_count=$((has_afnetworking + has_alamofire))

    if [ "$network_count" -gt 1 ]; then
        add_issue "P2" "项目依赖" "N/A" "混用多个网络库" "AFNetworking+Alamofire" "统一网络库"
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

    # 检查Podfile版本锁定
    if [ -f "Podfile" ]; then
        # 检查是否有版本范围
        local range_versions=$(grep -cE "~>|'>|'~'|'>=" Podfile 2>/dev/null || echo 0)

        if [ "$range_versions" -gt 10 ]; then
            add_issue "P2" "Podfile" "N/A" "版本声明过于宽松" "${range_versions}个范围声明" "使用固定版本"
            version_issues=$((version_issues + 1))
        fi
    fi

    # 检查Podfile.lock
    if [ ! -f "Podfile.lock" ] && [ -f "Podfile" ]; then
        add_issue "P1" "项目依赖" "N/A" "缺少Podfile.lock" "无lock文件" "执行pod install"
        version_issues=$((version_issues + 1))
    fi

    # 检查Swift版本
    if [ -f ".swift-version" ]; then
        local swift_version=$(cat .swift-version 2>/dev/null || echo "unknown")
        if [ "$swift_version" != "unknown" ] && [ "${swift_version%%.*}" -lt 5 ]; then
            add_issue "P2" ".swift-version" "N/A" "Swift版本过低" "Swift ${swift_version}" "升级到Swift 5+"
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

    if [ -f "Podfile" ]; then
        dependency_count=$(grep -cE "^pod " Podfile 2>/dev/null || echo 0)
    elif [ -f "Cartfile" ]; then
        dependency_count=$(grep -cE "^[^#]" Cartfile 2>/dev/null || echo 0)
    fi

    if [ "$dependency_count" -gt 50 ]; then
        add_issue "P2" "Podfile" "N/A" "依赖数量过多" "${dependency_count}个Pod" "清理未使用依赖"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 30 ]; then
        add_issue "P2" "Podfile" "N/A" "依赖数量偏多" "${dependency_count}个Pod" "定期清理"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # 4. 技术选型合理性 (1分)
    local tech_issues=0

    # 检查是否使用了废弃的API
    if grep -rqE "UIAlertView|UIActionSheet" --include="*.m" . 2>/dev/null; then
        add_issue "P2" "项目全局" "N/A" "使用废弃API" "UIAlertView已废弃" "使用UIAlertController"
        tech_issues=$((tech_issues + 1))
    fi

    if [ "$tech_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + tech_issues))
    fi

    echo "$score:$issues_count"
}

check_ios_tech_stack