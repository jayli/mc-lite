#!/bin/bash
# C++ 技术栈健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.cpp_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_cpp_tech_stack() {
    local score=0
    local issues_count=0

    # 1. 框架一致性检查 (3分)
    local framework_issues=0

    # 检查构建系统一致性
    local has_cmake=0
    local has_makefile=0
    local has_meson=0
    local has_bazel=0

    [ -f "CMakeLists.txt" ] && has_cmake=1
    [ -f "Makefile" ] && has_makefile=1
    [ -f "meson.build" ] && has_meson=1
    [ -f "BUILD" ] || [ -f "WORKSPACE" ] && has_bazel=1

    local build_count=$((has_cmake + has_makefile + has_meson + has_bazel))

    if [ "$build_count" -gt 1 ]; then
        add_issue "P2" "项目配置" "N/A" "混用多个构建系统" "CMake+Makefile等" "统一构建系统"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查依赖管理
    local has_vcpkg=0
    local has_conan=0
    local has_brew=0

    [ -f "vcpkg.json" ] && has_vcpkg=1
    [ -f "conanfile.txt" ] || [ -f "conanfile.py" ] && has_conan=1

    local dep_count=$((has_vcpkg + has_conan))

    if [ "$dep_count" -gt 1 ]; then
        add_issue "P2" "项目配置" "N/A" "混用多个依赖管理" "vcpkg+conan" "统一依赖管理"
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

    # 检查C++标准
    if [ -f "CMakeLists.txt" ]; then
        if ! grep -qE "CMAKE_CXX_STANDARD|CXX_STANDARD|set\(CMAKE_CXX_STANDARD" CMakeLists.txt 2>/dev/null; then
            add_issue "P2" "CMakeLists.txt" "N/A" "未设置C++标准" "无CXX_STANDARD" "设置C++17或更高"
            version_issues=$((version_issues + 1))
        else
            local std_version=$(grep -oE "CXX_STANDARD.*[0-9]+" CMakeLists.txt 2>/dev/null | grep -oE "[0-9]+" | head -1)
            if [ -n "$std_version" ] && [ "$std_version" -lt 17 ]; then
                add_issue "P2" "CMakeLists.txt" "N/A" "C++标准版本过低" "C++${std_version}" "升级到C++17+"
                version_issues=$((version_issues + 1))
            fi
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

    if [ -f "vcpkg.json" ]; then
        dependency_count=$(grep -cE '"name"' vcpkg.json 2>/dev/null || echo 0)
    elif [ -f "conanfile.txt" ]; then
        dependency_count=$(grep -cE "^[a-zA-Z]" conanfile.txt 2>/dev/null || echo 0)
    elif [ -f "CMakeLists.txt" ]; then
        dependency_count=$(grep -cE "find_package|FetchContent" CMakeLists.txt 2>/dev/null || echo 0)
    fi

    if [ "$dependency_count" -gt 30 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量过多" "${dependency_count}个依赖" "清理未使用依赖"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 20 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量偏多" "${dependency_count}个依赖" "定期清理"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # 4. 技术选型合理性 (1分)
    local tech_issues=0

    # 检查是否使用现代C++特性
    local modern_cpp=0
    grep -rqE "std::unique_ptr|std::shared_ptr|std::move|constexpr|auto\s+\[" --include="*.cpp" --include="*.h" . 2>/dev/null && modern_cpp=1

    if [ "$modern_cpp" -eq 0 ]; then
        add_issue "P2" "项目全局" "N/A" "未使用现代C++特性" "无智能指针等" "使用C++11+特性"
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

check_cpp_tech_stack