#!/bin/bash
# Rust 废代码检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.rust_unused_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_rust_unused() {
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
    done < <(grep -rnE "^use " --include="*.rs" src/ 2>/dev/null | head -20)

    if [ "$unused_imports" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$unused_imports" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + unused_imports))

    # ============================================
    # 2. 未使用的变量/函数检查 (5分)
    # ============================================

    local unused_items=0

    # 检查未使用的变量（以 _ 开头的除外）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 "$SCRIPT_DIR/../../utf8_truncate.py" 50)
        add_issue "P2" "$file" "$lineno" "变量可能未使用" "$content" "删除或添加_前缀"
        unused_items=$((unused_items + 1))
    done < <(grep -rnE "let [a-zA-Z_][a-zA-Z0-9_]*\s*=" --include="*.rs" src/ 2>/dev/null | \
        grep -v "let _" | head -15)

    # 检查未使用的公共函数（在库中）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        add_issue "P2" "$file" "$lineno" "公共函数可能未被使用" "pub fn" "检查是否需要pub"
        unused_items=$((unused_items + 1))
    done < <(grep -rnE "pub fn " --include="*.rs" src/ 2>/dev/null | head -15)

    if [ "$unused_items" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$unused_items" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + unused_items))

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
    done < <(grep -rnE "^\s*//.*fn |^\s*//.*use |^\s*//.*struct |^\s*//.*impl " --include="*.rs" src/ 2>/dev/null | head -15)

    if [ "$commented_code" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$commented_code" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + commented_code))

    echo "$score:$issues_count"
}

check_rust_unused