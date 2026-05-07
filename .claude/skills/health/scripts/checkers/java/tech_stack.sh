#!/bin/bash
# Java 技术栈健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.java_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_tech_stack() {
    local score=0
    local issues_count=0

    # 1. 框架一致性检查 (3分)
    local framework_issues=0

    local has_spring=0
    local has_springboot=0
    local has_quarkus=0
    local has_micronaut=0
    local has_javalin=0

    if [ -f "pom.xml" ]; then
        grep -qE "spring-framework|spring-context" pom.xml && has_spring=1
        grep -qE "spring-boot" pom.xml && has_springboot=1
        grep -qE "quarkus" pom.xml && has_quarkus=1
        grep -qE "micronaut" pom.xml && has_micronaut=1
    fi

    if [ -f "build.gradle" ]; then
        grep -qE "spring-framework|spring-context" build.gradle && has_spring=1
        grep -qE "spring-boot" build.gradle && has_springboot=1
        grep -qE "quarkus" build.gradle && has_quarkus=1
        grep -qE "micronaut" build.gradle && has_micronaut=1
    fi

    # 检查是否混用框架
    local framework_count=$((has_spring + has_quarkus + has_micronaut))
    if [ "$framework_count" -gt 1 ]; then
        add_issue "P1" "项目依赖" "N/A" "混用多个框架" "Spring/Quarkus/Micronaut" "统一使用单一框架"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查ORM一致性
    local has_hibernate=0
    local has_mybatis=0
    local has_jooq=0
    local has_jdbi=0

    if [ -f "pom.xml" ]; then
        grep -qE "hibernate" pom.xml && has_hibernate=1
        grep -qE "mybatis" pom.xml && has_mybatis=1
        grep -qE "jooq" pom.xml && has_jooq=1
        grep -qE "jdbi" pom.xml && has_jdbi=1
    fi

    if [ -f "build.gradle" ]; then
        grep -qE "hibernate" build.gradle && has_hibernate=1
        grep -qE "mybatis" build.gradle && has_mybatis=1
        grep -qE "jooq" build.gradle && has_jooq=1
        grep -qE "jdbi" build.gradle && has_jdbi=1
    fi

    local orm_count=$((has_hibernate + has_mybatis + has_jooq + has_jdbi))
    if [ "$orm_count" -gt 1 ]; then
        add_issue "P2" "项目依赖" "N/A" "混用多个ORM" "Hibernate/MyBatis/JOOQ" "统一ORM方案"
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

    # 检查是否有版本范围声明
    if [ -f "pom.xml" ]; then
        local range_versions=$(grep -cE "\[.*\]|<version>\$\{" pom.xml 2>/dev/null || echo 0)
        if [ "$range_versions" -gt 10 ]; then
            add_issue "P2" "pom.xml" "N/A" "版本声明可能不稳定" "${range_versions}个范围/变量声明" "使用固定版本"
            version_issues=$((version_issues + 1))
        fi
    fi

    # 检查依赖管理
    if [ -f "pom.xml" ]; then
        if ! grep -qE "<dependencyManagement>" pom.xml 2>/dev/null; then
            add_issue "P2" "pom.xml" "N/A" "缺少依赖管理" "无dependencyManagement" "添加dependencyManagement"
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

    if [ -f "pom.xml" ]; then
        dependency_count=$(grep -cE "<dependency>" pom.xml 2>/dev/null || echo 0)
    elif [ -f "build.gradle" ]; then
        dependency_count=$(grep -cE "implementation|compileOnly|runtimeOnly" build.gradle 2>/dev/null || echo 0)
    fi

    if [ "$dependency_count" -gt 80 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量过多" "${dependency_count}个依赖" "清理未使用依赖"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 50 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量偏多" "${dependency_count}个依赖" "定期清理"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # 4. 技术选型合理性 (1分)
    local tech_issues=0

    # 检查Java版本
    if [ -f "pom.xml" ]; then
        local java_version=$(grep -oP "(?<=<java.version>)[^<]+" pom.xml 2>/dev/null || grep -oP "(?<=<maven.compiler.source>)[^<]+" pom.xml 2>/dev/null || echo "unknown")
        if [ "$java_version" != "unknown" ] && [ "$java_version" -lt 11 ]; then
            add_issue "P2" "pom.xml" "N/A" "Java版本过低" "Java ${java_version}" "升级到Java 11+"
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

check_java_tech_stack