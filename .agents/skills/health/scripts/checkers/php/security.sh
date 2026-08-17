#!/bin/bash
# PHP 安全检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.php_security_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_php_security() {
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
        add_issue "P0" "$file" "$lineno" "硬编码敏感信息" "$content" "移至环境变量或配置文件"
        secrets_found=$((secrets_found + 1))
    done < <(grep -rnE "(api[_-]?key|secret|password|token|access[_-]?key)\s*=\s*[\"'][^\"']{8,}[\"']" \
        --include="*.php" . 2>/dev/null | grep -v vendor | grep -v "#" | head -15)

    # 检查配置文件
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P0" "$short_file" "N/A" "配置文件可能包含敏感信息" "" "检查并使用.env"
        secrets_found=$((secrets_found + 1))
    done < <(find . -name ".env" -o -name "config.php" -o -name "database.php" 2>/dev/null | \
        xargs grep -l "password\|secret\|key\|token" 2>/dev/null | head -5)

    [ "$secrets_found" -eq 0 ] && score=$((score + 5))
    issues_count=$((issues_count + secrets_found))

    # ============================================
    # 2. SQL注入检查 (5分)
    # ============================================

    local sql_injection=0

    # 检查直接拼接的 SQL
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 60)
        add_issue "P0" "$file" "$lineno" "可能存在SQL注入" "$content" "使用参数化查询"
        sql_injection=$((sql_injection + 1))
    done < <(grep -rnE "query\(.*\.\s*\$|execute\(.*\.\s*\$|DB::select\(.*\.\s*\$" \
        --include="*.php" . 2>/dev/null | grep -v vendor | head -10)

    # 检查用户输入直接使用
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P0" "$file" "$lineno" "可能存在不安全查询" "用户输入直接使用" "使用参数绑定"
        sql_injection=$((sql_injection + 1))
    done < <(grep -rnE "\$_GET\[|\$_POST\[|\$_REQUEST\[" --include="*.php" . 2>/dev/null | \
        grep -v "htmlspecialchars\|filter_input\|escape" | grep -v vendor | head -10)

    if [ "$sql_injection" -eq 0 ]; then
        score=$((score + 5))
    elif [ "$sql_injection" -lt 3 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + sql_injection))

    # ============================================
    # 3. 依赖安全扫描 (5分)
    # ============================================

    local vulns=0

    if [ -f "composer.json" ]; then
        # 检查是否有指定版本
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            [[ "$line" =~ ^#|^\s*// ]] && continue
            [[ "$line" =~ ^\s*"require"|\}\s*,?$ ]] && continue

            # 检查是否有版本约束
            if echo "$line" | grep -qE '"[a-zA-Z0-9/-]+":\s*"[*^>=<]'; then
                if echo "$line" | grep -qE '"\*"' || echo "$line" | grep -qE '"\^"'; then
                    add_issue "P1" "composer.json" "N/A" "依赖版本过于宽松" "$line" "指定具体版本号"
                    vulns=$((vulns + 1))
                fi
            fi
        done < <(cat composer.json 2>/dev/null | head -50)
    fi

    # 检查是否有 composer.lock
    if [ -f "composer.json" ] && [ ! -f "composer.lock" ]; then
        add_issue "P2" "composer.lock" "N/A" "缺少依赖锁定文件" "无composer.lock" "运行composer update"
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

check_php_security