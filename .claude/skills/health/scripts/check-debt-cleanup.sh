#!/bin/bash
# 检查债务清理证据
# 返回加分值 (0-5)

check_debt_cleanup() {
  local score=0

  # 配置已集中化
  if [ -d "src/constants" ]; then
    local const_files=$(ls src/constants/*.js 2>/dev/null | wc -l)
    [ "$const_files" -gt 2 ] && score=$((score + 2))
  fi

  # 工具函数已提取
  if [ -d "src/utils" ]; then
    local util_files=$(ls src/utils/*.js 2>/dev/null | wc -l)
    [ "$util_files" -gt 3 ] && score=$((score + 2))
  fi

  # 近期有重构记录
  if git log --oneline --since="3 months ago" 2>/dev/null | grep -iE "(refactor|extract|cleanup|debt)" | head -5 | grep -q .; then
    score=$((score + 1))
  fi

  echo $score
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_debt_cleanup
fi
