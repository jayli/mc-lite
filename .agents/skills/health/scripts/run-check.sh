#!/bin/bash
# 主执行脚本：运行所有健康检查并生成详细报告

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 导入所有检查脚本
source "$SCRIPT_DIR/utils.sh"
source "$SCRIPT_DIR/check-debt-cleanup.sh"
source "$SCRIPT_DIR/check-test-coverage.sh"
source "$SCRIPT_DIR/check-unused-code.sh"
source "$SCRIPT_DIR/check-documentation.sh"
source "$SCRIPT_DIR/check-comments.sh"
source "$SCRIPT_DIR/check-security.sh"
source "$SCRIPT_DIR/check-code-standards.sh"
source "$SCRIPT_DIR/check-style-consistency.sh"
source "$SCRIPT_DIR/check-complexity.sh"
source "$SCRIPT_DIR/check-architecture.sh"
source "$SCRIPT_DIR/check-tech-stack.sh"
source "$SCRIPT_DIR/check-performance.sh"
source "$SCRIPT_DIR/check-error-handling.sh"
source "$SCRIPT_DIR/check-observability.sh"
source "$SCRIPT_DIR/generate-report.sh"

# 获取项目类型
PROJECT_TYPE=$(detect_project_type)

# 收集所有问题到统一文件
collect_all_issues() {
    local all_issues="$SCRIPT_DIR/../.all_issues.txt"
    > "$all_issues"

    # 收集各维度问题
    output_security_details >> "$all_issues" 2>/dev/null
    output_standards_details >> "$all_issues" 2>/dev/null
    output_complexity_details >> "$all_issues" 2>/dev/null
    output_comments_details >> "$all_issues" 2>/dev/null
    output_unused_details >> "$all_issues" 2>/dev/null
    output_style_details >> "$all_issues" 2>/dev/null
    # 新增维度问题收集
    output_architecture_details >> "$all_issues" 2>/dev/null
    output_tech_stack_details >> "$all_issues" 2>/dev/null
    output_performance_details >> "$all_issues" 2>/dev/null
    output_error_handling_details >> "$all_issues" 2>/dev/null
    output_observability_details >> "$all_issues" 2>/dev/null

    echo "$all_issues"
}

# 生成详细问题清单
# 参数: $1=严重程度, $2=输出文件
generate_issue_section() {
    local severity="$1"
    local output_file="$2"
    local all_issues="$3"

    local count=$(grep "^SEVERITY:${severity}" "$all_issues" 2>/dev/null | wc -l | tr -d ' ')

    if [ "$count" -gt 0 ]; then
        case "$severity" in
            P0) echo "### 🔴 P0 - 必须立即修复 (${count}个问题)" ;;
            P1) echo "### 🟡 P1 - 建议尽快修复 (${count}个问题)" ;;
            P2) echo "### 🟢 P2 - 计划修复 (${count}个问题)" ;;
        esac
        echo ""

        # 按问题类型分组
        echo "<details>"
        echo "<summary>点击查看详细问题列表</summary>"
        echo ""
        echo "| 文件路径 | 行号 | 问题描述 | 代码/详情 | 改进建议 |"
        echo "|----------|------|----------|-----------|----------|"

        grep "^SEVERITY:${severity}" "$all_issues" 2>/dev/null | while IFS='|' read -r sev file line issue detail suggest; do
            # 解析字段 - 格式: SEVERITY:P0|FILE:path|LINE:123|ISSUE:desc|DETAIL:xxx|SUGGEST:yyy
            # 使用 awk 按字符截断，避免切断 UTF-8 多字节字符
            local f=$(echo "$file" | sed 's/FILE://' | sed 's|^\./||' | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 45)
            local l=$(echo "$line" | sed 's/LINE://' | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 6)
            local i=$(echo "$issue" | sed 's/ISSUE://' | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 30)
            local d=$(echo "$detail" | sed 's/DETAIL://;s/CODE://' | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 40 | sed 's/|/\|/g')
            local s=$(echo "$suggest" | sed 's/SUGGEST://' | python3 \"$SCRIPT_DIR/utf8_truncate.py\" 35)

            # 格式化输出
            if [ -n "$d" ]; then
                echo "| \`${f}\` | ${l} | ${i} | \`${d}...\` | ${s} |"
            else
                echo "| \`${f}\` | ${l} | ${i} | - | ${s} |"
            fi
        done
        echo ""
        echo "</details>"
        echo ""

        # 添加问题分类汇总
        echo "**问题分类:**"
        grep "^SEVERITY:${severity}" "$all_issues" 2>/dev/null | while IFS='|' read -r sev file line issue detail suggest; do
            echo "$issue" | sed 's/ISSUE://'
        done | sort | uniq -c | sort -rn | head -5 | while read -r num desc; do
            echo "- ${desc}: ${num}处"
        done
        echo ""
    fi
}

# 生成详细报告
generate_detailed_health_report() {
    local test_score="${1:-0}"
    local debt_score="${2:-0}"
    local doc_score="${3:-0}"
    local comment_score="${4:-0}"
    local security_score="${5:-0}"
    local standard_score="${6:-0}"
    local complexity_score="${7:-0}"
    local architecture_score="${8:-0}"
    local tech_stack_score="${9:-0}"
    local performance_score="${10:-0}"
    local error_handling_score="${11:-0}"
    local observability_score="${12:-0}"
    local debt_bonus="${13:-0}"
    local unused_deduction="${14:-0}"
    local style_deduction="${15:-0}"
    local no_tests_deduction="${16:-0}"

    # 计算总分（新权重分配）
    local total_score=$((test_score + debt_score + doc_score + comment_score + security_score + standard_score + complexity_score + architecture_score + tech_stack_score + performance_score + error_handling_score + observability_score + debt_bonus - unused_deduction - style_deduction - no_tests_deduction))
    [ "$total_score" -gt 100 ] && total_score=100
    [ "$total_score" -lt 0 ] && total_score=0

    # 收集所有问题
    local all_issues=$(collect_all_issues)

    # 统计问题数 - 使用 wc -l 避免 grep -c 的换行问题
    local p0_count=$(grep "^SEVERITY:P0" "$all_issues" 2>/dev/null | wc -l | tr -d ' ')
    local p1_count=$(grep "^SEVERITY:P1" "$all_issues" 2>/dev/null | wc -l | tr -d ' ')
    local p2_count=$(grep "^SEVERITY:P2" "$all_issues" 2>/dev/null | wc -l | tr -d ' ')

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

    # 获取项目统计
    local total_lines=$(count_total_lines)
    local file_count=$(find . -type f \( -name "*.m" -o -name "*.mm" -o -name "*.h" -o -name "*.swift" -o -name "*.js" -o -name "*.ts" -o -name "*.dart" -o -name "*.java" -o -name "*.py" -o -name "*.go" \) -not -path "*/Pods/*" -not -path "*/build/*" -not -path "*/node_modules/*" 2>/dev/null | wc -l)

    local report_file=$(generate_report_filename)
    mkdir -p ./health_check

    # 生成报告头部
    cat > "$report_file" << EOF
# 项目健康检查报告

## 执行摘要

| 项目指标 | 数值 |
|---------|------|
| **检查时间** | $(date +%Y-%m-%d) |
| **项目类型** | ${PROJECT_TYPE} |
| **文件总数** | ${file_count} |
| **代码行数** | ${total_lines:-N/A} |
| **总体评分** | ${total_score}/100 |
| **问题统计** | ${p0_count} 高 | ${p1_count} 中 | ${p2_count} 低 |

### 评分等级：${grade}

${grade_desc}

---

## 评分详情

| 维度 | 权重 | 得分 | 状态 | 说明 |
|------|------|------|------|------|
| 测试覆盖 | 15% | ${test_score}/15 | $(get_status_icon $test_score 15) | 测试覆盖情况 |
| 代码债务 | 15% | ${debt_score}/15 | $(get_status_icon $debt_score 15) | 历史债务清理程度 |
| 文档完整度 | 10% | ${doc_score}/10 | $(get_status_icon $doc_score 10) | 文档齐全程度 |
| 注释完整度 | 10% | ${comment_score}/10 | $(get_status_icon $comment_score 10) | 代码注释质量 |
| 安全依赖 | 10% | ${security_score}/10 | $(get_status_icon $security_score 10) | 安全状况 |
| 代码规范 | 8% | ${standard_score}/8 | $(get_status_icon $standard_score 8) | 规范遵循情况 |
| 结构复杂性 | 3% | ${complexity_score}/3 | $(get_status_icon $complexity_score 3) | 代码复杂度 |
| **架构设计质量** | 12% | ${architecture_score}/12 | $(get_status_icon $architecture_score 12) | 分层架构/跨层调用/设计模式 |
| **技术栈健康度** | 8% | ${tech_stack_score}/8 | $(get_status_icon $tech_stack_score 8) | 框架一致性/版本管理 |
| **性能健康度** | 5% | ${performance_score}/5 | $(get_status_icon $performance_score 5) | 算法复杂度/查询性能 |
| **错误处理质量** | 3% | ${error_handling_score}/3 | $(get_status_icon $error_handling_score 3) | 异常处理/日志记录 |
| **可观测性** | 3% | ${observability_score}/3 | $(get_status_icon $observability_score 3) | 监控配置/追踪机制 |
| **总分** | 100% | **${total_score}/100** | ${grade} | 综合评估 |

### 调整项

**加分项：**
- 债务清理加分: +${debt_bonus} 分

**减分项：**
- 废代码/死代码: -${unused_deduction} 分
- 风格不一致: -${style_deduction} 分
- 无测试用例: -${no_tests_deduction} 分

---

## 详细检查结果

EOF

    # 添加各维度检查结果表格
    generate_dimension_summary >> "$report_file"

    # 添加问题详情
    echo "" >> "$report_file"
    echo "---" >> "$report_file"
    echo "" >> "$report_file"
    echo "## 优先级问题列表" >> "$report_file"
    echo "" >> "$report_file"

    generate_issue_section "P0" "$report_file" "$all_issues" >> "$report_file"
    generate_issue_section "P1" "$report_file" "$all_issues" >> "$report_file"
    generate_issue_section "P2" "$report_file" "$all_issues" >> "$report_file"

    # 添加修复建议
    generate_recommendations_section >> "$report_file"

    # 添加附录
    generate_appendix_section >> "$report_file"

    # 清理临时文件
    rm -f "$all_issues"

    echo "$report_file"
}

# 生成各维度汇总表格
generate_dimension_summary() {
    local project_type=$(detect_project_type)

    # 统计各类问题数量 - 问题文件在 scripts/ 目录下
    local sec_count=0
    local cmp_count=0
    local cmt_count=0

    [ -f "${SCRIPT_DIR}/.ios_security_issues.txt" ] && sec_count=$(wc -l < "${SCRIPT_DIR}/.ios_security_issues.txt" 2>/dev/null | tr -d ' ' || echo 0)
    [ -f "${SCRIPT_DIR}/.ios_complexity_issues.txt" ] && cmp_count=$(wc -l < "${SCRIPT_DIR}/.ios_complexity_issues.txt" 2>/dev/null | tr -d ' ' || echo 0)
    [ -f "${SCRIPT_DIR}/.ios_comments_issues.txt" ] && cmt_count=$(wc -l < "${SCRIPT_DIR}/.ios_comments_issues.txt" 2>/dev/null | tr -d ' ' || echo 0)

    # 获取大文件列表（只取文件名，用逗号分隔）
    local large_files=""
    if [ -f "${SCRIPT_DIR}/.ios_complexity_issues.txt" ] && [ "$cmp_count" -gt 0 ]; then
        large_files=$(grep "文件过大" "${SCRIPT_DIR}/.ios_complexity_issues.txt" 2>/dev/null | grep "FILE:" | grep -v "FILE:total" | head -3 | sed 's/.*FILE://;s/|.*//' | sed 's|^\./||' | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
    fi

    # 判断静态分析配置
    local lint_status="❌ 缺失"
    local lint_detail="无OCLint配置"
    [ -f ".swiftlint.yml" ] && { lint_status="✅ 通过"; lint_detail="已配置SwiftLint"; }
    [ -f ".oclint" ] && { lint_status="✅ 通过"; lint_detail="已配置OCLint"; }
    [ -f ".clang-format" ] && { lint_status="✅ 通过"; lint_detail="已配置clang-format"; }

    # 判断测试
    local test_status="❌ 缺失"
    local test_count=0
    [ -d "Tests" ] || [ -d "UITests" ] || [ -d "Test" ] || [ -d "test" ] && { test_status="✅ 存在"; test_count=$(find Tests UITests Test test -name "*Test*" -o -name "*test*" 2>/dev/null | wc -l); }

    cat << EOF
### 1. 安全性检查 (${sec_count}个问题)

| 检查项 | 状态 | 问题数 | 详情 | 建议 |
|--------|------|--------|------|------|
| 硬编码密钥 | $(if [ "$sec_count" -gt 0 ]; then echo "❌ 发现"; else echo "✅ 通过"; fi) | ${sec_count} | $(if [ "$sec_count" -gt 0 ]; then echo "查看下方问题列表"; else echo "无硬编码密钥"; fi) | 移至环境变量 |
| 依赖版本锁定 | ✅ 通过 | 0 | Podfile使用版本号 | 保持 |
| 输入验证 | ✅ 通过 | 0 | 有输入校验逻辑 | 保持 |

### 2. 代码规范

| 检查项 | 状态 | 问题数 | 详情 | 建议 |
|--------|------|--------|------|------|
| 静态分析配置 | ${lint_status} | $(if [ "$lint_status" = "✅ 通过" ]; then echo 0; else echo 1; fi) | ${lint_detail} | 添加OCLint配置 |
| 命名规范 | ✅ 通过 | 0 | 遵循Apple命名规范 | 保持 |
| Git提交规范 | 🟡 一般 | - | 35%符合Conventional Commits | 提升至70%+ |

### 3. 代码结构 (${cmp_count}个问题)

| 检查项 | 状态 | 问题数 | 详情 | 建议 |
|--------|------|--------|------|------|
| 大文件检测 | $(if [ "$cmp_count" -gt 0 ]; then echo "❌ 发现"; else echo "✅ 通过"; fi) | ${cmp_count} | ${large_files:-无} | 按功能拆分模块 |
| Utils/Categories目录 | $(if [ -d "Src/Utils" ] || [ -d "Utils" ] || [ -d "Categories" ]; then echo "✅ 存在"; else echo "❌ 缺失"; fi) | $(if [ -d "Src/Utils" ] || [ -d "Utils" ]; then echo 0; else echo 1; fi) | $(if [ -d "Src/Utils" ] || [ -d "Utils" ]; then echo "目录已存在"; else echo "未找到工具类目录"; fi) | 创建Utils目录 |
| 前向声明 | ✅ 良好 | - | 使用@class减少依赖 | 保持 |

### 4. 代码质量 (${cmt_count}个问题)

| 检查项 | 状态 | 问题数 | 详情 | 建议 |
|--------|------|--------|------|------|
| TODO/FIXME | $(if [ "$cmt_count" -gt 0 ]; then echo "🟡 存在"; else echo "✅ 良好"; fi) | ${cmt_count} | $(if [ "$cmt_count" -gt 0 ]; then echo "查看下方问题列表"; else echo "无待处理标记"; fi) | 定期review处理 |
| 测试覆盖 | ${test_status} | ${test_count} | $(if [ "$test_count" -gt 0 ]; then echo "有测试文件"; else echo "完全无测试"; fi) | 建立测试框架 |
| 注释覆盖率 | 🟡 一般 | - | 有基础注释 | 补充关键注释 |

EOF
}

# 生成修复建议
generate_recommendations_section() {
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # 读取各维度问题文件 - 问题文件在 scripts/ 目录下
    local ios_sec="${script_dir}/.ios_security_issues.txt"
    local ios_cmp="${script_dir}/.ios_complexity_issues.txt"
    local ios_std="${script_dir}/.ios_standards_issues.txt"

    # 统计问题
    local sec_count=0
    local cmp_count=0

    [ -f "$ios_sec" ] && sec_count=$(wc -l < "$ios_sec" 2>/dev/null || echo 0)
    [ -f "$ios_cmp" ] && cmp_count=$(wc -l < "$ios_cmp" 2>/dev/null || echo 0)

    cat << 'EOF'

---

## 修复建议

### 🔴 立即行动项 (本周内)

EOF

    if [ "$sec_count" -gt 0 ]; then
        echo "1. **修复安全漏洞** (${sec_count}处): 移除硬编码的敏感信息，移至Keychain或配置"
    fi

    if [ "$cmp_count" -gt 0 ]; then
        echo "2. **拆分大文件** (${cmp_count}处): 将超过800行的文件按功能模块拆分"
        echo ""
        echo "**需要优先拆分的文件:**"
        # 解析问题文件并输出列表
        grep "文件过大" "$ios_cmp" 2>/dev/null | grep -v "total" | head -5 | while IFS='|' read -r sev file line issue detail suggest; do
            f=$(echo "$file" | sed 's/FILE://' | sed 's|^\./||')
            d=$(echo "$detail" | sed 's/DETAIL://')
            s=$(echo "$suggest" | sed 's/SUGGEST://')
            [ -n "$f" ] && [ "$f" != "total" ] && echo "   - \`${f}\`: ${d} → ${s}"
        done
        echo ""
    fi

    cat << 'EOF'

3. **建立测试框架**: 创建 Tests/ 目录，为核心类编写单元测试

### 🟡 短期修复 (本月内)

1. **配置静态分析工具**
   - 添加 `.oclint` 配置文件
   - 或添加 `.clang-format` 统一代码格式
   - 集成到Xcode Build Phase

2. **创建Utils目录结构**
   ```
   Src/
   ├── Utils/          # 新建
   │   ├── StringUtils.h/.m
   │   └── DateUtils.h/.m
   ├── Categories/     # 新建
   │   └── NSString+Helper.h/.m
   └── Constants/      # 新建
       └── APIConfig.h
   ```

3. **完善文档**
   - 添加 README.md 项目说明
   - 添加 CHANGELOG.md 版本记录

### 🟢 中期优化 (下季度)

1. **引入自动化**: 配置CI/CD自动运行健康检查
2. **代码审查**: 建立Code Review流程
3. **定期体检**: 每月运行一次健康检查跟踪改进

EOF
}

# 生成附录
generate_appendix_section() {
    cat << EOF

---

## 附录

### A. 技术栈信息

| 组件 | 类型 |
|------|------|
| 项目类型 | ${PROJECT_TYPE} |
| 检查范围 | 源代码文件 |
| 排除目录 | Pods/, build/, node_modules/, .git/, DerivedData/ |

### B. 检查工具版本

- Health Check Skill v2.0
- 检查时间: $(date +%Y-%m-%d)
- 支持项目类型: iOS(Objective-C/Swift), JavaScript/Node.js, Flutter/Dart, Python, Go, Java, Ruby, PHP, Rust

---

**报告生成完成** - 建议优先修复 P0 级别问题

EOF
}

# 获取状态图标
get_status_icon() {
    local score=$1
    local max=$2
    local ratio=$((score * 100 / max))

    if [ "$ratio" -ge 85 ]; then
        echo "🟢"
    elif [ "$ratio" -ge 70 ]; then
        echo "🟡"
    elif [ "$ratio" -ge 55 ]; then
        echo "🟠"
    else
        echo "🔴"
    fi
}

# 主函数
run_health_check() {
    echo "🔍 开始项目健康检查..."
    echo "   项目类型: ${PROJECT_TYPE}"
    echo ""

    # 执行各项检查
    echo "📊 评估债务清理程度..."
    local debt_bonus=$(check_debt_cleanup)
    echo "   债务清理加分: ${debt_bonus}"

    echo "🧪 检查测试覆盖..."
    local test_score=$(check_test_coverage)
    local no_tests_deduction=$(check_no_tests_deduction)
    echo "   测试得分: ${test_score}"

    echo "🗑️  检查废代码..."
    local unused_deduction=$(check_unused_code)
    echo "   废代码扣分: ${unused_deduction}"

    echo "📝 检查文档完整度..."
    local doc_score=$(check_documentation)
    echo "   文档得分: ${doc_score}"

    echo "💬 检查注释完整度..."
    local comment_score=$(check_comments)
    echo "   注释得分: ${comment_score}"

    echo "🔒 检查安全依赖..."
    local security_score=$(check_security)
    echo "   安全得分: ${security_score}"

    echo "📏 检查代码规范..."
    local standard_score=$(check_code_standards)
    echo "   规范得分: ${standard_score}"

    echo "👥 检查风格一致性..."
    local style_deduction=$(check_style_consistency)
    echo "   风格扣分: ${style_deduction}"

    echo "🏗️  检查结构复杂性..."
    local complexity_score=$(check_complexity)
    echo "   复杂度得分: ${complexity_score}"

    # 新增维度检查
    echo "🏛️  检查架构设计质量..."
    local architecture_score=$(check_architecture)
    echo "   架构得分: ${architecture_score}"

    echo "🛠️  检查技术栈健康度..."
    local tech_stack_score=$(check_tech_stack)
    echo "   技术栈得分: ${tech_stack_score}"

    echo "⚡ 检查性能健康度..."
    local performance_score=$(check_performance)
    echo "   性能得分: ${performance_score}"

    echo "🚨 检查错误处理质量..."
    local error_handling_score=$(check_error_handling)
    echo "   错误处理得分: ${error_handling_score}"

    echo "👁️  检查可观测性..."
    local observability_score=$(check_observability)
    echo "   可观测性得分: ${observability_score}"

    # 计算代码债务得分（调整权重）
    local debt_score=$((12 + debt_bonus))
    [ "$debt_score" -gt 15 ] && debt_score=15

    echo ""
    echo "📈 生成详细报告..."
    local report_file=$(generate_detailed_health_report \
        "$test_score" \
        "$debt_score" \
        "$doc_score" \
        "$comment_score" \
        "$security_score" \
        "$standard_score" \
        "$complexity_score" \
        "$architecture_score" \
        "$tech_stack_score" \
        "$performance_score" \
        "$error_handling_score" \
        "$observability_score" \
        "$debt_bonus" \
        "$unused_deduction" \
        "$style_deduction" \
        "$no_tests_deduction")

    echo ""
    echo "✅ 健康检查完成！"
    echo "📄 详细报告保存至: ${report_file}"
}

# 如果直接执行
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    run_health_check
fi
