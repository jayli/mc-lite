#!/bin/bash
# 多人协作风格一致性检查（减分项）
# 返回扣分值 (0-10)

check_style_consistency() {
  local deduction=0

  # 检查项目贡献者数量
  local contributors=$(git log --format='%an' --since="6 months ago" 2>/dev/null | sort -u | wc -l)

  # 单人项目不检查风格一致性
  if [ "$contributors" -lt 2 ]; then
    echo 0
    return
  fi

  # 检查命名风格不一致
  local snake_case_count=$(grep -r "function\s\+\w\+_\w\+\|const\s\+\w\+_\w\+\|let\s\+\w\+_\w\+" src/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)
  local camelCase_count=$(grep -r "function\s\+\w\+[A-Z]\w*\|const\s\+\w\+[A-Z]\w*\|let\s\+\w\+[A-Z]\w*" src/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)

  # 如果同时存在大量 snake_case 和 camelCase，说明风格不一致
  if [ "$snake_case_count" -gt 20 ] && [ "$camelCase_count" -gt 50 ]; then
    deduction=$((deduction + 5))
  elif [ "$snake_case_count" -gt 10 ] && [ "$camelCase_count" -gt 30 ]; then
    deduction=$((deduction + 3))
  fi

  # 检查缩进不一致（空格 vs Tab）
  local tab_indented=$(grep -r "^\t" src/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)
  local space_indented=$(grep -r "^  " src/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)

  if [ "$tab_indented" -gt 50 ] && [ "$space_indented" -gt 50 ]; then
    deduction=$((deduction + 3))
  fi

  # 检查引号风格不一致
  local single_quotes=$(grep -r "'[^']*'" src/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)
  local double_quotes=$(grep -r '"[^"]*"' src/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)

  if [ "$single_quotes" -gt 100 ] && [ "$double_quotes" -gt 100 ]; then
    local ratio=$((single_quotes * 100 / (single_quotes + double_quotes)))
    if [ "$ratio" -gt 30 ] && [ "$ratio" -lt 70 ]; then
      deduction=$((deduction + 2))
    fi
  fi

  # 检查是否配置了代码格式化工具
  local has_formatter=false
  if [ -f ".prettierrc" ] || [ -f ".prettierrc.json" ] || [ -f "prettier.config.js" ]; then
    has_formatter=true
  fi
  if [ -f "package.json" ] && grep -q "prettier" package.json 2>/dev/null; then
    has_formatter=true
  fi

  # 如果多人项目且没有格式化工具，增加扣分
  if [ "$contributors" -gt 3 ] && [ "$has_formatter" = "false" ]; then
    deduction=$((deduction + 3))
  fi

  # 限制最大扣分为10分
  [ "$deduction" -gt 10 ] && deduction=10

  echo "$deduction"
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_style_consistency
fi
