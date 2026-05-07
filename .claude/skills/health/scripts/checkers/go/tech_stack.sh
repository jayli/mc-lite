#!/bin/bash
# Go 技术栈健康度检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.go_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_go_tech_stack() {
    local score=0
    local issues_count=0

    # 1. 框架一致性检查 (3分)
    local framework_issues=0

    # 检查Web框架一致性
    local has_gin=0
    local has_echo=0
    local has_fiber=0
    local has_chi=0
    local has_std=0

    if [ -f "go.mod" ]; then
        grep -qE "github.com/gin-gonic/gin" go.mod && has_gin=1
        grep -qE "github.com/labstack/echo" go.mod && has_echo=1
        grep -qE "github.com/gofiber/fiber" go.mod && has_fiber=1
        grep -qE "github.com/go-chi/chi" go.mod && has_chi=1
    fi

    # 检查是否混用框架
    local framework_count=$((has_gin + has_echo + has_fiber + has_chi))

    if [ "$framework_count" -gt 1 ]; then
        add_issue "P1" "go.mod" "N/A" "混用多个Web框架" "Gin/Echo/Fiber混用" "统一Web框架"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查ORM一致性
    local has_gorm=0
    local has_sqlc=0
    local has_sqlx=0
    local has_ent=0

    if [ -f "go.mod" ]; then
        grep -qE "gorm.io/gorm" go.mod && has_gorm=1
        grep -qE "github.com/kyleconroy/sqlc" go.mod && has_sqlc=1
        grep -qE "github.com/jmoiron/sqlx" go.mod && has_sqlx=1
        grep -qE "entgo.io/ent" go.mod && has_ent=1
    fi

    local orm_count=$((has_gorm + has_sqlc + has_sqlx + has_ent))

    if [ "$orm_count" -gt 1 ]; then
        add_issue "P2" "go.mod" "N/A" "混用多个ORM" "GORM/sqlc/sqlx等" "统一数据访问层"
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

    # 检查go.mod是否有indirect依赖过多
    if [ -f "go.mod" ]; then
        local indirect_count=$(grep -cE "// indirect" go.mod 2>/dev/null || echo 0)

        if [ "$indirect_count" -gt 30 ]; then
            add_issue "P2" "go.mod" "N/A" "间接依赖过多" "${indirect_count}个indirect" "运行go mod tidy"
            version_issues=$((version_issues + 1))
        fi
    fi

    # 检查Go版本
    if [ -f "go.mod" ]; then
        local go_version=$(grep -E "^go\s+" go.mod 2>/dev/null | awk '{print $2}')
        if [ -n "$go_version" ] && [ "${go_version%%.*}" -lt 1 ] && [ "${go_version#*.}" -lt 19 ]; then
            add_issue "P2" "go.mod" "N/A" "Go版本过低" "Go ${go_version}" "升级到Go 1.19+"
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

    if [ -f "go.mod" ]; then
        dependency_count=$(grep -cE "^\s+[a-zA-Z]" go.mod 2>/dev/null || echo 0)
    fi

    if [ "$dependency_count" -gt 50 ]; then
        add_issue "P2" "go.mod" "N/A" "依赖数量过多" "${dependency_count}个依赖" "清理未使用依赖"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 30 ]; then
        add_issue "P2" "go.mod" "N/A" "依赖数量偏多" "${dependency_count}个依赖" "定期清理"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # 4. 技术选型合理性 (1分)
    local tech_issues=0

    # 检查是否使用context传递
    local context_count=$(grep -rE "context\.Context" --include="*.go" . 2>/dev/null | wc -l | tr -d ' ')

    if [ "$context_count" -lt 5 ]; then
        add_issue "P2" "项目全局" "N/A" "缺少context使用" "context使用少" "使用context传递请求上下文"
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

check_go_tech_stack