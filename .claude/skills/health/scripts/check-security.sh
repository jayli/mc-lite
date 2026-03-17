#!/bin/bash
# 安全依赖检查
# 返回得分 (0-15)

check_security() {
  local score=0

  # 硬编码密钥（5分）- 红线检查
  local secrets=$(grep -riE "(api[_-]?key|secret|password|token)\s*[=:]\s*[\"'][^\"']{8,}[\"']" src/ --include="*.js" 2>/dev/null | grep -v "//\|/\*" | wc -l)
  [ "$secrets" -eq 0 ] && score=$((score + 5))

  # 依赖漏洞（5分）
  local vulns=0
  if [ -f "package.json" ] && command -v npm &>/dev/null; then
    npm audit --json > /tmp/audit.json 2>/dev/null
    vulns=$(cat /tmp/audit.json 2>/dev/null | grep -c "severity.*high\|severity.*critical" || echo 0)
  fi

  if [ "$vulns" -eq 0 ]; then
    score=$((score + 5))
  elif [ "$vulns" -lt 3 ]; then
    score=$((score + 3))
  fi

  # 输入校验（5分）
  local input_validation=$(grep -r "validateInput\|sanitize\|escapeHtml" src/ --include="*.js" 2>/dev/null | wc -l)
  [ "$input_validation" -gt 0 ] && score=$((score + 5))

  echo $score
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_security
fi
