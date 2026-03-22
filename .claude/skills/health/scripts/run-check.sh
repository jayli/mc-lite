#!/bin/bash
# 主执行脚本：运行所有健康检查

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
source "$SCRIPT_DIR/generate-report.sh"

# 主函数
run_health_check() {
  echo "🔍 开始项目健康检查..."
  echo ""

  # 执行各项检查
  echo "📊 评估债务清理程度..."
  local debt_bonus=$(check_debt_cleanup)
  echo "   债务清理加分: $debt_bonus"

  echo "🧪 检查测试覆盖..."
  local test_score=$(check_test_coverage)
  local no_tests_deduction=$(check_no_tests_deduction)
  echo "   测试得分: $test_score"
  echo "   无测试扣分: $no_tests_deduction"

  echo "🗑️  检查废代码..."
  local unused_deduction=$(check_unused_code)
  local orphan_deduction=$(check_orphaned_files)
  echo "   废代码扣分: $unused_deduction"
  echo "   孤立文件扣分: $orphan_deduction"
  unused_deduction=$((unused_deduction + orphan_deduction))

  echo "📝 检查文档完整度..."
  local doc_score=$(check_documentation)
  echo "   文档得分: $doc_score"

  echo "💬 检查注释完整度..."
  local comment_score=$(check_comments)
  echo "   注释得分: $comment_score"

  echo "🔒 检查安全依赖..."
  local security_score=$(check_security)
  echo "   安全得分: $security_score"

  echo "📏 检查代码规范..."
  local standard_score=$(check_code_standards)
  echo "   规范得分: $standard_score"

  echo "👥 检查风格一致性..."
  local style_deduction=$(check_style_consistency)
  echo "   风格扣分: $style_deduction"

  echo "🏗️  检查结构复杂性..."
  local complexity_score=$(check_complexity)
  echo "   复杂度得分: $complexity_score"

  # 代码债务得分（简化版，主要基于清理程度）
  local debt_score=$((15 + debt_bonus))
  [ "$debt_score" -gt 20 ] && debt_score=20

  echo ""
  echo "📈 生成报告..."
  local report_file=$(generate_health_report \
    "$test_score" \
    "$debt_score" \
    "$doc_score" \
    "$comment_score" \
    "$security_score" \
    "$standard_score" \
    "$complexity_score" \
    "$debt_bonus" \
    "$unused_deduction" \
    "$style_deduction" \
    "$no_tests_deduction")

  echo ""
  echo "✅ 健康检查完成！"
  echo "📄 报告保存至: $report_file"
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  run_health_check
fi
