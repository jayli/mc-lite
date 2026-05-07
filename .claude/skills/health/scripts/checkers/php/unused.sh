#!/bin/bash
# PHP 废代码检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.php_unused_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_php_unused() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 未使用的导入检查 (5分)
    # ============================================

    local unused_imports=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "可能存在未使用的use" "$content" "检查并删除"
        unused_imports=$((unused_imports + 1))
    done < <(grep -rnE "^use " --include="*.php" . 2>/dev/null | grep -v vendor | head -20)

    if [ "$unused_imports" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$unused_imports" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + unused_imports))

    # ============================================
    # 2. 未使用的变量检查 (5分)
    # ============================================

    local unused_vars=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "变量定义后可能未使用" "$content" "删除或使用该变量"
        unused_vars=$((unused_vars + 1))
    done < <(grep -rnE "^\s*\$[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*[^=]" --include="*.php" . 2>/dev/null | \
        grep -v vendor | grep -v "return\|echo\|print" | head -15)

    if [ "$unused_vars" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$unused_vars" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + unused_vars))

    # ============================================
    # 3. 注释掉的代码检查 (5分)
    # ============================================

    local commented_code=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "注释掉的代码" "$content" "删除或恢复使用"
        commented_code=$((commented_code + 1))
    done < <(grep -rnE "^\s*//.*function|^\s*//.*class|^\s*//.*use|^\s*#.*function" --include="*.php" . 2>/dev/null | grep -v vendor | head -15)

    if [ "$commented_code" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$commented_code" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + commented_code))

    echo "$score:$issues_count"
}

check_php_unused