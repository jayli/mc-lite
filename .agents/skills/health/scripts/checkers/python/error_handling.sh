#!/bin/bash
# Python 错误处理质量检查
# 输出: 分数:问题数
# 检查项：异常处理完整性(1分)、错误信息质量(1分)、日志记录(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.python_error_handling_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_python_error_handling() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 异常处理完整性检查 (1分)
    # ============================================

    local exception_issues=0

    # 检查是否有裸露的 except（捕获所有异常但不处理）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查是否有 except: 或 except Exception: 后只有 pass
        local next_line=$(sed -n "${lineno}p" "$file" 2>/dev/null | head -1)
        if echo "$next_line" | grep -qE "^\s*pass\s*$"; then
            add_issue "P1" "$short_file" "$lineno" "异常处理为空" "except: pass" "记录日志或合理处理"
            exception_issues=$((exception_issues + 1))
        fi
    done < <(grep -rnE "except\s*:|except\s+Exception\s*:" --include="*.py" . 2>/dev/null | head -10)

    # 检查关键操作是否有异常处理（文件操作、网络请求、数据库操作）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查上下文是否有 try
        local context=$(sed -n "$((lineno-5)),${lineno}p" "$file" 2>/dev/null)
        if ! echo "$context" | grep -qE "try\s*:|try\s*\("; then
            add_issue "P1" "$short_file" "$lineno" "关键操作无异常处理" "open/file/network" "添加try-except"
            exception_issues=$((exception_issues + 1))
        fi
    done < <(grep -rnE "\.open\(|\.read\(|\.write\(|requests\.|\.query\(|\.execute\(" --include="*.py" . 2>/dev/null | head -10)

    # 计算异常处理得分
    if [ "$exception_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$exception_issues" -le 2 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + exception_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + exception_issues))
    fi

    # ============================================
    # 2. 错误信息质量检查 (1分)
    # ============================================

    local error_info_issues=0

    # 检查是否有过于简单的错误信息（只有字符串没有上下文）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查 raise 语句是否有足够信息
        local raise_content=$(echo "$line" | grep -oE "raise\s+\w+Error\s*\(['\"]([^'\"]+)['\"]\)" | sed "s/.*['\"]//;s/['\"]$//")

        # 简单的错误信息（少于5个字符）
        if [ -n "$raise_content" ] && [ "${#raise_content}" -lt 5 ]; then
            add_issue "P2" "$short_file" "$lineno" "错误信息过于简单" "raise Error('$raise_content')" "添加详细错误描述"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "raise\s+\w+Error\s*\(" --include="*.py" . 2>/dev/null | head -10)

    # 检查是否有硬编码的错误信息（无变量）
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        if echo "$line" | grep -qE "raise\s+\w+Error\s*\(['\"][^'\"]{20,}['\"]\)" && ! echo "$line" | grep -qE "f['\"]|%|format"; then
            # 硬编码长字符串，无格式化变量
            add_issue "P2" "$short_file" "$lineno" "错误信息无上下文变量" "硬编码错误信息" "添加变量使错误更具体"
            error_info_issues=$((error_info_issues + 1))
        fi
    done < <(grep -rnE "raise\s+\w+Error\s*\(" --include="*.py" . 2>/dev/null | head -10)

    # 计算错误信息得分
    if [ "$error_info_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$error_info_issues" -le 1 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + error_info_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + error_info_issues))
    fi

    # ============================================
    # 3. 日志记录检查 (1分)
    # ============================================

    local logging_issues=0

    # 检查是否配置了日志系统
    local has_logging_config=0
    local has_loguru=0
    local has_structlog=0

    grep -rqE "logging\.basicConfig|logging\.config" --include="*.py" . 2>/dev/null && has_logging_config=1
    grep -rqE "import loguru|from loguru" --include="*.py" . 2>/dev/null && has_loguru=1
    grep -rqE "import structlog|from structlog" --include="*.py" . 2>/dev/null && has_structlog=1

    local has_any_logging=$((has_logging_config + has_loguru + has_structlog))

    if [ "$has_any_logging" -eq 0 ]; then
        add_issue "P2" "项目配置" "N/A" "缺少日志配置" "无logging配置" "配置logging.basicConfig"
        logging_issues=$((logging_issues + 1))
    fi

    # 检查异常块内是否有日志记录
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file=$(echo "$line" | cut -d: -f1)
        local lineno=$(echo "$line" | cut -d: -f2)
        local short_file=$(echo "$file" | sed 's|^\./||')

        # 检查 except 块内是否有 logging/logger/log
        local except_block=$(sed -n "${lineno},$((lineno+10))p" "$file" 2>/dev/null | head -10)
        if ! echo "$except_block" | grep -qE "logging\.|logger\.|log\.|\.error\(|\.exception\("; then
            add_issue "P2" "$short_file" "$lineno" "异常块无日志记录" "except无logging" "添加logger.error/exception"
            logging_issues=$((logging_issues + 1))
        fi
    done < <(grep -rnE "except\s+.*:" --include="*.py" . 2>/dev/null | head -10)

    # 计算日志记录得分
    if [ "$logging_issues" -eq 0 ]; then
        score=$((score + 1))
    elif [ "$logging_issues" -le 1 ]; then
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + logging_issues))
    fi

    echo "$score:$issues_count"
}

# 执行检查
check_python_error_handling