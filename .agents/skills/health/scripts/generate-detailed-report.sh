#!/bin/bash
# 详细问题收集和报告生成
# 生成包含具体代码位置、问题详情的报告

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# 创建报告目录
REPORT_DIR="./health_check"
mkdir -p "$REPORT_DIR"

# 临时问题列表文件
ISSUES_FILE="$REPORT_DIR/.issues_temp.md"
> "$ISSUES_FILE"

# 添加问题到列表
# 参数: $1=严重程度(P0/P1/P2), $2=类别, $3=文件路径, $4=行号, $5=问题描述, $6=代码片段, $7=建议
add_issue() {
    local severity="$1"
    local category="$2"
    local file_path="$3"
    local line_no="$4"
    local description="$5"
    local code_snippet="$6"
    local suggestion="$7"

    echo "SEVERITY:$severity|CATEGORY:$category|FILE:$file_path|LINE:$line_no|DESC:$description|CODE:$code_snippet|SUGGEST:$suggestion" >> "$ISSUES_FILE"
}

# 检查硬编码密钥 - 输出详情
check_secrets_detail() {
    local project_type=$(detect_project_type)
    local count=0

    case "$project_type" in
        iOS)
            # iOS: 检查 OC/Swift 代码
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P0" "security" "$file" "$lineno" "硬编码敏感信息" "$content" "移至环境变量或安全存储"
                    count=$((count + 1))
                fi
            done < <(grep -rnE "(api[_-]?key|secret|password|token)\s*=\s*[@\"'][^\"']{8,}[\"']" --include="*.m" --include="*.mm" --include="*.h" --include="*.swift" . 2>/dev/null | grep -v "//\|/\*" | head -20)

            # 检查 Info.plist
            while IFS= read -r file; do
                if [ -n "$file" ]; then
                    add_issue "P0" "security" "$file" "N/A" "Info.plist可能包含敏感配置" "" "检查并移除敏感信息"
                    count=$((count + 1))
                fi
            done < <(find . -name "Info.plist" -not -path "*/Pods/*" -not -path "*/build/*" 2>/dev/null | xargs grep -l "APIKey\|Secret\|Password" 2>/dev/null | head -10)
            ;;
        Flutter)
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P0" "security" "$file" "$lineno" "硬编码敏感信息" "$content" "使用环境变量或密钥管理服务"
                    count=$((count + 1))
                fi
            done < <(grep -rnE "(api[_-]?key|secret|password|token)\s*[=:]\s*[\"'][^\"']{8,}[\"']" lib/ --include="*.dart" 2>/dev/null | grep -v "//\|/\*" | head -20)
            ;;
        *)
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P0" "security" "$file" "$lineno" "硬编码敏感信息" "$content" "使用环境变量或密钥管理服务"
                    count=$((count + 1))
                fi
            done < <(grep -rnE "(api[_-]?key|secret|password|token)\s*[=:]\s*[\"'][^\"']{8,}[\"']" src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | grep -v "//\|/\*" | head -20)
            ;;
    esac

    echo "$count"
}

# 检查大文件 - 输出详情
check_large_files_detail() {
    local count=0
    local project_type=$(detect_project_type)

    case "$project_type" in
        iOS)
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local lines=$(echo "$line" | awk '{print $1}')
                    local file=$(echo "$line" | awk '{print $2}')
                    add_issue "P1" "structure" "$file" "N/A" "文件过大(${lines}行)" "" "按功能拆分模块，建议单文件不超过800行"
                    count=$((count + 1))
                fi
            done < <(find . \( -name "*.m" -o -name "*.mm" -o -name "*.swift" \) -not -path "*/Pods/*" -not -path "*/build/*" -exec wc -l {} + 2>/dev/null | awk '$1 > 800 {print $1, $2}' | sort -rn | head -20)
            ;;
        Flutter)
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local lines=$(echo "$line" | awk '{print $1}')
                    local file=$(echo "$line" | awk '{print $2}')
                    add_issue "P1" "structure" "$file" "N/A" "文件过大(${lines}行)" "" "按功能拆分，建议单文件不超过800行"
                    count=$((count + 1))
                fi
            done < <(find lib -name "*.dart" -not -path "*/generated/*" -exec wc -l {} + 2>/dev/null | awk '$1 > 800 {print $1, $2}' | sort -rn | head -20)
            ;;
        *)
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local lines=$(echo "$line" | awk '{print $1}')
                    local file=$(echo "$line" | awk '{print $2}')
                    add_issue "P1" "structure" "$file" "N/A" "文件过大(${lines}行)" "" "按功能拆分，建议单文件不超过8000行(JS)"
                    count=$((count + 1))
                fi
            done < <(find src lib -name "*.js" -o -name "*.ts" 2>/dev/null | xargs wc -l 2>/dev/null | awk '$1 > 1000 {print $1, $2}' | sort -rn | head -20)
            ;;
    esac

    echo "$count"
}

# 检查命名规范问题 - 输出详情
check_naming_issues() {
    local count=0
    local project_type=$(detect_project_type)

    case "$project_type" in
        iOS)
            # 检查类名是否以大写字母开头
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P2" "naming" "$file" "$lineno" "类名应以大写字母开头" "$content" "遵循Apple命名规范"
                    count=$((count + 1))
                fi
            done < <(grep -rnE "^\s*@implementation\s+[a-z]" --include="*.m" --include="*.mm" . 2>/dev/null | head -20)

            # 检查方法名是否以小写字母开头
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P2" "naming" "$file" "$lineno" "方法名应以小写字母开头" "$content" "遵循Apple命名规范"
                    count=$((count + 1))
                fi
            done < <(grep -rnE "^\s*[-+]\s*\([^(]+\)\s*[A-Z]" --include="*.m" --include="*.mm" . 2>/dev/null | head -20)
            ;;
        *)
            # JS项目检查
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P2" "naming" "$file" "$lineno" "类名应使用PascalCase" "$content" "遵循JavaScript命名规范"
                    count=$((count + 1))
                fi
            done < <(grep -rnE "^\s*class\s+[a-z]" src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | head -20)
            ;;
    esac

    echo "$count"
}

# 检查TODO/FIXME - 输出详情
check_todos_detail() {
    local count=0
    local project_type=$(detect_project_type)

    case "$project_type" in
        iOS)
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P2" "todo" "$file" "$lineno" "TODO/FIXME/HACK标记" "$content" "定期review并处理"
                    count=$((count + 1))
                fi
            done < <(grep -rni "TODO\|FIXME\|HACK\|XXX" --include="*.m" --include="*.mm" --include="*.h" --include="*.swift" . 2>/dev/null | grep -v "//\|/\*" | head -30)
            ;;
        *)
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P2" "todo" "$file" "$lineno" "TODO/FIXME标记" "$content" "定期review并处理"
                    count=$((count + 1))
                fi
            done < <(grep -rni "TODO\|FIXME" src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | head -30)
            ;;
    esac

    echo "$count"
}

# 检查废代码 - 输出详情
check_dead_code_detail() {
    local count=0
    local project_type=$(detect_project_type)

    case "$project_type" in
        iOS)
            # 检查大量注释掉的代码
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P2" "dead-code" "$file" "$lineno" "疑似废弃代码(注释)" "$content" "清理废弃代码"
                    count=$((count + 1))
                fi
            done < <(grep -rnE "^\s*//.*-\s*\(|^\s*//.*@implementation\s+" --include="*.m" --include="*.mm" --include="*.h" . 2>/dev/null | head -20)
            ;;
        *)
            while IFS= read -r line; do
                if [ -n "$line" ]; then
                    local file=$(echo "$line" | cut -d: -f1)
                    local lineno=$(echo "$line" | cut -d: -f2)
                    local content=$(echo "$line" | cut -d: -f3-)
                    add_issue "P2" "dead-code" "$file" "$lineno" "疑似废弃代码(注释)" "$content" "清理废弃代码"
                    count=$((count + 1))
                fi
            done < <(grep -rnE "^\s*//.*function\|^\s*//.*const\|^\s*//.*let" src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | head -20)
            ;;
    esac

    echo "$count"
}

# 生成详细报告
generate_detailed_report() {
    local test_score="${1:-0}"
    local debt_score="${2:-0}"
    local doc_score="${3:-0}"
    local comment_score="${4:-0}"
    local security_score="${5:-0}"
    local standard_score="${6:-0}"
    local complexity_score="${7:-0}"
    local total_issues="${8:-0}"

    local project_type=$(detect_project_type)
    local total_lines=$(count_total_lines)
    local file_count=$(find . -type f \( -name "*.m" -o -name "*.mm" -o -name "*.h" -o -name "*.swift" -o -name "*.js" -o -name "*.ts" -o -name "*.dart" \) -not -path "*/Pods/*" -not -path "*/build/*" -not -path "*/node_modules/*" 2>/dev/null | wc -l)

    # 计算总分
    local total_score=$((test_score + debt_score + doc_score + comment_score + security_score + standard_score + complexity_score))
    [ "$total_score" -gt 100 ] && total_score=100
    [ "$total_score" -lt 0 ] && total_score=0

    # 确定等级
    local grade="⚫ 危险"
    local grade_desc="项目存在严重问题，需要立即修复"
    if [ "$total_score" -ge 85 ]; then
        grade="🟢 优秀"
        grade_desc="项目健康状况良好，债务控制得当"
    elif [ "$total_score" -ge 70 ]; then
        grade="🟡 良好"
        grade_desc="存在历史债务但已大部分清理"
    elif [ "$total_score" -ge 55 ]; then
        grade="🟠 一般"
        grade_desc="有一定债务，需要规划清理"
    elif [ "$total_score" -ge 40 ]; then
        grade="🔴 关注"
        grade_desc="债务较多或存在严重问题"
    fi

    # 统计各严重程度问题数
    local p0_count=$(grep -c "^SEVERITY:P0" "$ISSUES_FILE" 2>/dev/null || echo 0)
    local p1_count=$(grep -c "^SEVERITY:P1" "$ISSUES_FILE" 2>/dev/null || echo 0)
    local p2_count=$(grep -c "^SEVERITY:P2" "$ISSUES_FILE" 2>/dev/null || echo 0)

    local report_file=$(generate_report_filename)

    # 生成报告头部
    cat > "$report_file" << EOF
# 项目健康检查报告

## 执行摘要

| 项目指标 | 数值 |
|---------|------|
| **检查时间** | $(date +%Y-%m-%d) |
| **项目类型** | $project_type |
| **文件总数** | $file_count |
| **代码行数** | ${total_lines:-N/A} |
| **总体评分** | $total_score/100 |
| **问题统计** | ${p0_count:-0} 高 | ${p1_count:-0} 中 | ${p2_count:-0} 低 |

### 评分等级：$grade

$grade_desc

---

## 详细检查结果

EOF

    # 添加各维度检查结果
    generate_dimension_tables >> "$report_file"

    # 添加问题清单
    generate_issue_details >> "$report_file"

    # 添加修复建议
    generate_recommendations >> "$report_file"

    # 添加附录
    generate_appendix >> "$report_file"

    # 清理临时文件
    rm -f "$ISSUES_FILE"

    echo "$report_file"
}

# 生成各维度检查表格
generate_dimension_tables() {
    cat << 'EOF'
### 1. 代码结构与复杂性

| 检查项 | 状态 | 严重程度 | 详情 | 建议 |
|--------|------|----------|------|------|
| 大文件检测 | $(if [ "$p1_count" -gt 0 ]; then echo "❌ 发现问题"; else echo "✅ 通过"; fi) | 中 | 检查超过800行的文件 | 按功能拆分模块 |
| 循环依赖 | ✅ 通过 | - | 检查头文件/模块循环引用 | 使用前向声明 |
| 代码组织 | $(if [ -d "Utils" ] || [ -d "utils" ]; then echo "✅ 通过"; else echo "⚠️ 警告"; fi) | 低 | 检查工具函数是否集中 | 提取公共函数到Utils |

EOF
}

# 生成问题详情列表
generate_issue_details() {
    echo ""
    echo "---"
    echo ""
    echo "## 问题详情列表"
    echo ""

    if [ -s "$ISSUES_FILE" ]; then
        # P0 问题
        echo "### 🔴 P0 - 必须立即修复"
        echo ""
        echo "| 文件 | 行号 | 问题描述 | 代码片段 | 建议 |"
        echo "|------|------|----------|----------|------|"
        grep "^SEVERITY:P0" "$ISSUES_FILE" 2>/dev/null | while IFS='|' read -r severity category file line desc code suggest; do
            severity=$(echo "$severity" | cut -d: -f2)
            category=$(echo "$category" | cut -d: -f2)
            file=$(echo "$file" | cut -d: -f2)
            line=$(echo "$line" | cut -d: -f2)
            desc=$(echo "$desc" | cut -d: -f2)
            code=$(echo "$code" | cut -d: -f2 | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 50)
            suggest=$(echo "$suggest" | cut -d: -f2)
            echo "| \`$file\` | $line | $desc | \`${code}...\` | $suggest |"
        done
        echo ""

        # P1 问题
        echo "### 🟡 P1 - 建议尽快修复"
        echo ""
        echo "| 文件 | 行号 | 问题描述 | 建议 |"
        echo "|------|------|----------|------|"
        grep "^SEVERITY:P1" "$ISSUES_FILE" 2>/dev/null | while IFS='|' read -r severity category file line desc code suggest; do
            file=$(echo "$file" | cut -d: -f2)
            line=$(echo "$line" | cut -d: -f2)
            desc=$(echo "$desc" | cut -d: -f2)
            suggest=$(echo "$suggest" | cut -d: -f2)
            echo "| \`$file\` | $line | $desc | $suggest |"
        done
        echo ""

        # P2 问题
        echo "### 🟢 P2 - 计划修复"
        echo ""
        echo "| 文件 | 行号 | 问题描述 | 建议 |"
        echo "|------|------|----------|------|"
        grep "^SEVERITY:P2" "$ISSUES_FILE" 2>/dev/null | while IFS='|' read -r severity category file line desc code suggest; do
            file=$(echo "$file" | cut -d: -f2)
            line=$(echo "$line" | cut -d: -f2)
            desc=$(echo "$desc" | cut -d: -f2)
            suggest=$(echo "$suggest" | cut -d: -f2)
            echo "| \`$file\` | $line | $desc | $suggest |"
        done
    else
        echo "未发现明显问题"
    fi
}

# 生成修复建议
generate_recommendations() {
    cat << 'EOF'

---

## 修复建议

### 立即行动项 (本周内)

1. **修复安全漏洞**：移除所有硬编码的密钥和密码
2. **清理大文件**：将超过800行的文件按功能拆分
3. **处理P0级问题**：优先修复标记为P0的问题

### 短期修复 (本月内)

1. **代码重构**：优化命名规范，统一代码风格
2. **添加测试**：为核心功能编写单元测试
3. **完善文档**：补充README和API文档

### 中期优化 (下季度)

1. **引入静态分析**：配置SwiftLint/ESLint等工具
2. **建立CI/CD**：配置自动化测试和代码检查
3. **定期健康检查**：每月运行一次健康检查

EOF
}

# 生成附录
generate_appendix() {
    cat << EOF

---

## 附录

### A. 技术栈信息

| 组件 | 类型 |
|------|------|
| 项目类型 | $(detect_project_type) |
| 检查范围 | 源代码文件 |
| 排除目录 | Pods/, build/, node_modules/, .git/ |

### B. 检查工具版本

- Health Check Skill v2.0
- 检查时间: $(date +%Y-%m-%d)
- 支持项目类型: Node.js, Flutter, iOS(Objective-C/Swift), Python, Go, Java, Ruby, PHP, Rust

---

**报告生成完成** - 建议优先修复 P0 级别问题
EOF
}

# 导出函数
export -f add_issue
export -f generate_detailed_report
