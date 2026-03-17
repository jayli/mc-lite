#!/bin/bash
# 文档完整度检查
# 返回得分 (0-15)

check_documentation() {
  local score=0

  # README.md（4分）
  if [ -f "README.md" ]; then
    local readme_lines=$(wc -l < README.md)
    [ "$readme_lines" -gt 20 ] && score=$((score + 4))
  fi

  # CLAUDE.md 或 GEMINI.md（4分）
  [ -f "CLAUDE.md" ] && score=$((score + 4))

  # 架构/API文档（4分）
  local doc_count=$(find . -name "README_*.md" -o -name "API.md" -o -name "ARCHITECTURE.md" 2>/dev/null | wc -l)
  [ "$doc_count" -gt 0 ] && score=$((score + 4))

  # CHANGELOG（3分）
  [ -f "CHANGELOG.md" ] && score=$((score + 3))

  echo $score
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_documentation
fi
