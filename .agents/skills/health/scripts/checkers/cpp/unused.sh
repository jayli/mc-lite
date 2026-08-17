#!/bin/bash
# C/C++ 废代码检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.cpp_unused_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_cpp_unused() {
    local score=0
    local issues_count=0

    # 1. 未使用的头文件包含 (5分)
    local unused_includes=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "可能存在未使用的头文件" "$content" "检查并删除"
        unused_includes=$((unused_includes + 1))
    done < <(grep -rnE "^#include" --include="*.c" --include="*.cpp" --include="*.cc" --include="*.h" --include="*.hpp" . 2>/dev/null | head -30)

    if [ "$unused_includes" -lt 15 ]; then
        score=$((score + 5))
    elif [ "$unused_includes" -lt 30 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + unused_includes))

    # 2. 未使用的宏定义 (5分)
    local unused_macros=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "宏定义可能未使用" "$content" "检查并删除未使用的宏"
        unused_macros=$((unused_macros + 1))
    done < <(grep -rnE "^#define\s+\w+" --include="*.h" --include="*.hpp" . 2>/dev/null | head -20)

    if [ "$unused_macros" -lt 10 ]; then
        score=$((score + 5))
    elif [ "$unused_macros" -lt 20 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + unused_macros))

    # 3. 注释掉的代码 (5分)
    local commented_code=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "大量注释代码" "$content" "删除或恢复使用"
        commented_code=$((commented_code + 1))
    done < <(grep -rnE "^\s*/\*|^\s*\*/|^\s*//.*[;{}]" --include="*.c" --include="*.cpp" --include="*.cc" . 2>/dev/null | head -20)

    if [ "$commented_code" -lt 15 ]; then
        score=$((score + 5))
    elif [ "$commented_code" -lt 25 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + commented_code))

    echo "$score:$issues_count"
}

# 执行检查
check_cpp_unused
