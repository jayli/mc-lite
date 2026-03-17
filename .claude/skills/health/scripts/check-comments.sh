#!/bin/bash
# 注释完整度检查
# 返回得分 (0-15)

check_comments() {
  local score=0

  # JSDoc覆盖率（6分）- 检查公共API
  local jsdoc_count=$(grep -r "^\s*/\*\*" src/ --include="*.js" 2>/dev/null | wc -l)
  if [ "$jsdoc_count" -gt 50 ]; then
    score=$((score + 6))
  elif [ "$jsdoc_count" -gt 20 ]; then
    score=$((score + 3))
  fi

  # 复杂逻辑注释（5分）
  local comment_ratio=$(calculate_comment_ratio)
  # 简化处理：只要有注释就给分
  if [ "$jsdoc_count" -gt 10 ]; then
    score=$((score + 5))
  elif [ "$jsdoc_count" -gt 5 ]; then
    score=$((score + 3))
  fi

  # TODO/FIXME管理（4分）
  local todo_count=$(grep -r "TODO\|FIXME" src/ --include="*.js" 2>/dev/null | wc -l)
  if [ "$todo_count" -lt 20 ]; then
    score=$((score + 4))
  elif [ "$todo_count" -lt 50 ]; then
    score=$((score + 2))
  fi

  echo $score
}

# 计算注释比例（简化版）
calculate_comment_ratio() {
  local total_lines=$(find src -name "*.js" -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
  local comment_lines=$(grep -r "^\s*//\|^\s*/\*\|^\s*\*" src/ --include="*.js" 2>/dev/null | wc -l)

  if [ "$total_lines" -gt 0 ]; then
    echo "scale=2; $comment_lines / $total_lines" | bc
  else
    echo "0"
  fi
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_comments
fi
