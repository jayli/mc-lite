#!/bin/bash
# Java 废代码检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.java_unused_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_java_unused() {
    local score=0
    local issues_count=0

    # 1. 未使用的导入检查 (5分)
    local unused_imports=0

    # 简单检测：检查导入但未在文件中使用的类
    while IFS= read -r file; do
        [ -z "$file" ] && continue

        # 获取所有导入
        local imports=$(grep -E "^import" "$file" 2>/dev/null | sed 's/import //;s/;//' | awk -F. '{print $NF}')

        for class in $imports; do
            # 检查类是否在文件中被使用（排除导入语句本身）
            local usage_count=$(grep -cE "\b$class\b" "$file" 2>/dev/null || echo 0)
            if [ "$usage_count" -le 1 ]; then
                local short_file=$(echo "$file" | sed 's|^\./||')
                add_issue "P2" "$short_file" "N/A" "未使用的导入" "import $class;" "删除未使用的导入"
                unused_imports=$((unused_imports + 1))
            fi
        done
    done < <(find . -name "*.java" -not -path "*/build/*" 2>/dev/null | head -15)

    if [ "$unused_imports" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$unused_imports" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + unused_imports))

    # 2. 注释掉的代码块检查 (5分)
    local commented_blocks=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "存在大量注释代码" "$content" "删除或恢复注释代码"
        commented_blocks=$((commented_blocks + 1))
    done < <(grep -rnE "^\s*/\*|^\s*\*/|^\s*//.*[;{}]" --include="*.java" . 2>/dev/null | head -20)

    if [ "$commented_blocks" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$commented_blocks" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + commented_blocks))

    # 3. 空方法检查 (5分)
    local empty_methods=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "空方法体" "$content" "实现方法或删除"
        empty_methods=$((empty_methods + 1))
    done < <(grep -rnE "\{\s*\}" --include="*.java" . 2>/dev/null | head -10)

    if [ "$empty_methods" -eq 0 ]; then
        score=$((score + 5))
    elif [ "$empty_methods" -lt 5 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + empty_methods))

    echo "$score:$issues_count"
}

# 执行检查
check_java_unused
