#!/bin/bash
# 代码规范检查
# 返回得分 (0-10)

check_code_standards() {
  local score=0

  # ESLint配置（3分）
  if [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ] || [ -f "eslint.config.js" ]; then
    score=$((score + 3))
  fi

  # 命名一致性（2分）- 简化检查
  # 检查是否符合 camelCase 命名规范
  local camelCase_violations=$(grep -r "function\s\+_[a-z]\|const\s\+_[a-z]" src/ --include="*.js" 2>/dev/null | wc -l)
  [ "$camelCase_violations" -lt 10 ] && score=$((score + 2))

  # 未使用变量（2分）
  local unused=0
  if [ -f "package.json" ]; then
    unused=$(npm run lint 2>&1 | grep -c "no-unused-vars" || echo 0)
  fi

  if [ "$unused" -lt 20 ]; then
    score=$((score + 2))
  elif [ "$unused" -lt 40 ]; then
    score=$((score + 1))
  fi

  # Git提交规范（3分）- Conventional Commits
  local conventional_ratio=$(check_conventional_commits)
  if [ "$conventional_ratio" -gt 70 ]; then
    score=$((score + 3))
  elif [ "$conventional_ratio" -gt 40 ]; then
    score=$((score + 2))
  elif [ "$conventional_ratio" -gt 20 ]; then
    score=$((score + 1))
  fi

  echo $score
}

check_conventional_commits() {
  # 检查最近100条提交中符合 Conventional Commits 的比例
  local total=$(git log --oneline -100 2>/dev/null | wc -l)
  [ "$total" -eq 0 ] && echo 0 && return

  local conventional=$(git log --oneline -100 2>/dev/null | grep -cE "^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?:" || echo 0)
  echo $((conventional * 100 / total))
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_code_standards
fi
