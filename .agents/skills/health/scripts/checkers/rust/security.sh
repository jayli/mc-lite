#!/bin/bash
# Rust 安全检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_security_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_security() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 硬编码密钥检查 (5分)
    # ============================================

    local secrets_found=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 60)
        add_issue "P0" "$file" "$lineno" "硬编码敏感信息" "$content" "移至环境变量"
        secrets_found=$((secrets_found + 1))
    done < <(grep -rnE "(api[_-]?key|secret|password|token|access[_-]?key)\s*=\s*\"[^\"]{8,}\"" \
        --include="*.rs" src/ 2>/dev/null | head -15)

    # 检查配置文件
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P0" "$short_file" "N/A" "配置文件可能包含敏感信息" "" "检查并使用环境变量"
        secrets_found=$((secrets_found + 1))
    done < <(find . -name ".env" -o -name "config.toml" -o -name "settings.toml" 2>/dev/null | \
        xargs grep -l "password\|secret\|key\|token" 2>/dev/null | head -5)

    [ "$secrets_found" -eq 0 ] && score=$((score + 5))
    issues_count=$((issues_count + secrets_found))

    # ============================================
    # 2. unsafe 代码块检查 (5分)
    # ============================================

    local unsafe_issues=0

    # 检查 unsafe 块
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P0" "$file" "$lineno" "存在unsafe代码块" "unsafe {}" "评估安全性或移除"
        unsafe_issues=$((unsafe_issues + 1))
    done < <(grep -rnE "unsafe\s*\{" --include="*.rs" src/ 2>/dev/null | head -10)

    # 检查 unsafe 函数
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P1" "$file" "$lineno" "存在unsafe函数" "unsafe fn" "评估安全性"
        unsafe_issues=$((unsafe_issues + 1))
    done < <(grep -rnE "unsafe\s+fn " --include="*.rs" src/ 2>/dev/null | head -10)

    if [ "$unsafe_issues" -eq 0 ]; then
        score=$((score + 5))
    elif [ "$unsafe_issues" -lt 3 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + unsafe_issues))

    # ============================================
    # 3. 依赖安全扫描 (5分)
    # ============================================

    local vulns=0

    if [ -f "Cargo.toml" ]; then
        # 检查是否有 * 版本依赖
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            [[ "$line" =~ ^#|^\[ ]] && continue

            if echo "$line" | grep -qE '"\*"'; then
                add_issue "P1" "Cargo.toml" "N/A" "依赖版本未指定" "$line" "指定具体版本号"
                vulns=$((vulns + 1))
            fi
        done < <(cat Cargo.toml 2>/dev/null | head -50)
    fi

    # 检查是否有 Cargo.lock
    if [ -f "Cargo.toml" ] && [ ! -f "Cargo.lock" ]; then
        add_issue "P2" "Cargo.lock" "N/A" "缺少依赖锁定文件" "无Cargo.lock" "运行cargo build生成"
        vulns=$((vulns + 1))
    fi

    # 检查是否有安全审计配置
    if [ ! -f "cargo-audit.toml" ] && [ ! -d ".cargo/audit.toml" ]; then
        add_issue "P2" "项目配置" "N/A" "缺少安全审计配置" "无cargo-audit" "配置cargo audit"
        vulns=$((vulns + 1))
    fi

    if [ "$vulns" -eq 0 ]; then
        score=$((score + 5))
    elif [ "$vulns" -lt 5 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + vulns))

    echo "$score:$issues_count"
}

check_rust_security