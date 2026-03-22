#!/bin/bash
# 生成健康检查报告

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# 生成 Markdown 报告
generate_health_report() {
  local test_score=$1
  local debt_score=$2
  local doc_score=$3
  local comment_score=$4
  local security_score=$5
  local standard_score=$6
  local complexity_score=$7
  local debt_bonus=$8
  local unused_deduction=$9
  local style_deduction=$10
  local no_tests_deduction=$11

  local total_score=$((test_score + debt_score + doc_score + comment_score + security_score + standard_score + complexity_score + debt_bonus - unused_deduction - style_deduction - no_tests_deduction))

  # 确保分数在 0-100 范围内
  [ "$total_score" -gt 100 ] && total_score=100
  [ "$total_score" -lt 0 ] && total_score=0

  # 确定等级
  local grade="⚫ 危险"
  if [ "$total_score" -ge 85 ]; then
    grade="🟢 优秀"
  elif [ "$total_score" -ge 70 ]; then
    grade="🟡 良好"
  elif [ "$total_score" -ge 55 ]; then
    grade="🟠 一般"
  elif [ "$total_score" -ge 40 ]; then
    grade="🔴 关注"
  fi

  local project_type=$(detect_project_type)
  local total_lines=$(count_total_lines)
  local report_file=$(generate_report_filename)

  mkdir -p ./health_check

  cat > "$report_file" << EOF
# 项目健康检查报告

## 执行摘要
- **检查时间**: $(date +%Y-%m-%d)
- **项目类型**: $project_type
- **代码行数**: $total_lines
- **总体评分**: $total_score/100 $grade

## 评分详情

| 维度 | 权重 | 得分 | 状态 | 说明 |
|------|------|------|------|------|
| 测试覆盖 | 20% | $test_score/20 | $(get_status_icon $test_score 20) | 测试覆盖情况 |
| 代码债务 | 20% | $debt_score/20 | $(get_status_icon $debt_score 20) | 历史债务清理程度 |
| 文档完整度 | 15% | $doc_score/15 | $(get_status_icon $doc_score 15) | 文档齐全程度 |
| 注释完整度 | 15% | $comment_score/15 | $(get_status_icon $comment_score 15) | 代码注释质量 |
| 安全依赖 | 15% | $security_score/15 | $(get_status_icon $security_score 15) | 安全状况 |
| 代码规范 | 10% | $standard_score/10 | $(get_status_icon $standard_score 10) | 规范遵循情况 |
| 结构复杂性 | 5% | $complexity_score/5 | $(get_status_icon $complexity_score 5) | 代码复杂度 |
| **总分** | 100% | **$total_score/100** | $grade | 综合评估 |

## 调整项

### 加分项
- 债务清理加分: +$debt_bonus 分

### 减分项
- 废代码/死代码: -$unused_deduction 分
- 风格不一致: -$style_deduction 分
- 无测试用例: -$no_tests_deduction 分

## 等级划分参考

| 分数 | 等级 | 建议 |
|------|------|------|
| 85-100 | 🟢 优秀 | 保持当前节奏 |
| 70-84 | 🟡 良好 | 持续优化，关注测试 |
| 55-69 | 🟠 一般 | 制定债务清理计划 |
| 40-54 | 🔴 关注 | 优先处理安全/测试 |
| 0-39 | ⚫ 危险 | 立即修复安全问题 |

---
*由 health skill 自动生成*
EOF

  echo "$report_file"
}

# 根据得分获取状态图标
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

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  # 示例用法
  echo "Usage: source $0 && generate_health_report <scores...>"
fi
