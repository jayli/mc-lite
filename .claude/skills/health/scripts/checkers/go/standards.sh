#!/bin/bash
# Go 代码规范检查
# 输出: 分数:问题数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.go_standards_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_go_standards() {
    local score=0
    local issues_count=0

    # 1. 命名规范检查 (4分)
    local naming_issues=0

    # 检查导出函数是否使用PascalCase
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P2" "$file" "$lineno" "导出函数应使用PascalCase" "$content" "导出函数首字母大写"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "^func [a-z]" --include="*.go" . 2>/dev/null | grep -v "func main\|func init\|func test" | head -10)

    # 检查包名是否使用小写
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 30)
        add_issue "P2" "$file" "$lineno" "包名应使用小写" "$content" "包名使用小写字母"
        naming_issues=$((naming_issues + 1))
    done < <(grep -rnE "^package [A-Z]" --include="*.go" . 2>/dev/null | head -5)

    if [ "$naming_issues" -eq 0 ]; then
        score=$((score + 4))
    elif [ "$naming_issues" -lt 5 ]; then
        score=$((score + 2))
    fi
    issues_count=$((issues_count + naming_issues))

    # 2. 错误处理检查 (3分)
    local error_issues=0

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1 | sed 's|^\./||')
        local lineno=$(echo "$line" | cut -d: -f2)
        local content=$(echo "$line" | cut -d: -f3- | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
        add_issue "P1" "$file" "$lineno" "错误被忽略" "$content" "处理错误或显式忽略"
        error_issues=$((error_issues + 1))
    done < <(grep -rnE "^\s*\w+.*=.*\(.*\).*$" --include="*.go" . 2>/dev/null | grep -v "err\|_" | head -15)

    if [ "$error_issues" -lt 5 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + error_issues))

    # 3. 代码格式检查 (3分) - 使用gofmt
    local fmt_issues=0

    # 检查是否有未格式化的文件
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        if command -v gofmt >/dev/null 2>&1; then
            if ! gofmt -l "$file" 2>/dev/null | grep -q "$file"; then
                continue
            fi
        fi
        local short_file=$(echo "$file" | sed 's|^\./||')
        add_issue "P2" "$short_file" "N/A" "代码可能需要格式化" "" "运行 gofmt -w"
        fmt_issues=$((fmt_issues + 1))
    done < <(find . -name "*.go" 2>/dev/null | head -10)

    if [ "$fmt_issues" -eq 0 ]; then
        score=$((score + 3))
    fi
    issues_count=$((issues_count + fmt_issues))

    echo "$score:$issues_count"
}

# 执行检查
check_go_standards
