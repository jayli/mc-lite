#!/bin/bash
# Rust 技术栈健康度检查
# 输出: 分数:问题数
# 检查项：框架一致性(3分)、版本管理质量(2分)、依赖数量评估(2分)、技术选型合理性(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_tech_stack() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 框架一致性检查 (3分)
    # ============================================

    local framework_issues=0

    # 检查是否混用了多个Web框架
    local has_actix=0
    local has_rocket=0
    local has_axum=0
    local has_warp=0

    # 检查 Cargo.toml
    if [ -f "Cargo.toml" ]; then
        grep -qiE "actix-web" Cargo.toml && has_actix=1
        grep -qiE "rocket" Cargo.toml && has_rocket=1
        grep -qiE "axum" Cargo.toml && has_axum=1
        grep -qiE "warp" Cargo.toml && has_warp=1
    fi

    # 检查代码中的使用
    grep -rqE "actix_web|actix::" --include="*.rs" src/ 2>/dev/null && has_actix=1
    grep -rqE "rocket::" --include="*.rs" src/ 2>/dev/null && has_rocket=1
    grep -rqE "axum::" --include="*.rs" src/ 2>/dev/null && has_axum=1
    grep -rqE "warp::" --include="*.rs" src/ 2>/dev/null && has_warp=1

    local framework_count=$((has_actix + has_rocket + has_axum + has_warp))

    if [ "$framework_count" -gt 1 ]; then
        add_issue "P1" "项目依赖" "N/A" "混用多个Web框架" "actix+rocket等" "统一使用单一框架"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查数据库访问层一致性
    local has_diesel=0
    local has_sqlx=0
    local has_seaorm=0

    if [ -f "Cargo.toml" ]; then
        grep -qiE "diesel" Cargo.toml && has_diesel=1
        grep -qiE "sqlx" Cargo.toml && has_sqlx=1
        grep -qiE "sea-orm" Cargo.toml && has_seaorm=1
    fi

    local db_layer_count=$((has_diesel + has_sqlx + has_seaorm))

    if [ "$db_layer_count" -gt 1 ]; then
        add_issue "P2" "项目依赖" "N/A" "混用多个ORM" "Diesel+SQLx等" "统一数据库访问方案"
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

    # ============================================
    # 2. 版本管理质量检查 (2分)
    # ============================================

    local version_issues=0

    if [ -f "Cargo.toml" ]; then
        # 检查 Rust 版本约束
        local rust_version=$(grep -oE 'rust-version\s*=\s*"[^"]+"' Cargo.toml 2>/dev/null)

        if [ -z "$rust_version" ]; then
            add_issue "P2" "Cargo.toml" "N/A" "缺少Rust版本约束" "" "添加rust-version"
            version_issues=$((version_issues + 1))
        fi
    fi

    # 检查是否有 Cargo.lock
    if [ -f "Cargo.toml" ] && [ ! -f "Cargo.lock" ]; then
        add_issue "P2" "Cargo.lock" "N/A" "缺少依赖锁定文件" "无Cargo.lock" "运行cargo build"
        version_issues=$((version_issues + 1))
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

    # ============================================
    # 3. 依赖数量评估 (2分)
    # ============================================

    local dependency_count=0

    if [ -f "Cargo.lock" ]; then
        dependency_count=$(grep -cE "^name = " Cargo.lock 2>/dev/null || echo 0)
    elif [ -f "Cargo.toml" ]; then
        dependency_count=$(grep -cE "^\s*[a-zA-Z_-]+\s*=" Cargo.toml 2>/dev/null || echo 0)
    fi

    if [ "$dependency_count" -gt 100 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量过多" "${dependency_count}个crate" "评估必要性"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 50 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量偏多" "${dependency_count}个crate" "定期清理"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # ============================================
    # 4. 技术选型合理性检查 (1分)
    # ============================================

    local tech_selection_issues=0

    # 检查 Rust 版本
    if [ -f "Cargo.toml" ]; then
        local rust_constraint=$(grep -oE 'rust-version\s*=\s*"[^"]+"' Cargo.toml 2>/dev/null)

        if echo "$rust_constraint" | grep -qE "1\.[0-5][0-9]|1\.6[0-5]"; then
            add_issue "P2" "Cargo.toml" "N/A" "Rust版本约束较旧" "$rust_constraint" "升级Rust版本要求"
            tech_selection_issues=$((tech_selection_issues + 1))
        fi
    fi

    # 检查项目规模与框架匹配度
    local file_count=$(find src -name "*.rs" 2>/dev/null | wc -l | tr -d ' ')

    if [ "$file_count" -lt 10 ] && [ "$framework_count" -gt 0 ]; then
        add_issue "P2" "项目结构" "N/A" "小项目使用框架" "Web框架(${file_count}文件)" "考虑标准库"
        tech_selection_issues=$((tech_selection_issues + 1))
    fi

    if [ "$tech_selection_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + tech_selection_issues))
    fi

    echo "$score:$issues_count"
}

check_rust_tech_stack