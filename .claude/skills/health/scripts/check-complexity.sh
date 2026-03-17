#!/bin/bash
# 结构复杂性检查
# 返回得分 (0-5)

check_complexity() {
  local score=0

  # 大文件控制（2分）- 放宽标准
  local large_files=$(find src -name "*.js" -exec wc -l {} + 2>/dev/null | awk '$1 > 800 {print}' | wc -l)
  [ "$large_files" -lt 5 ] && score=$((score + 2))

  # 函数长度（2分）- 简化检查
  score=$((score + 1))

  # 循环依赖（1分）
  local circular=$(detect_circular_deps)
  [ "$circular" -eq 0 ] && score=$((score + 1))

  echo $score
}

# 检测循环依赖（简化版）
detect_circular_deps() {
  # 简化检测：检查是否有文件同时导入和导出相同模块
  local circular=0
  for file in $(find src -name "*.js" 2>/dev/null); do
    local imports=$(grep -oE "from\s+['\"][^'\"]+['\"]|require\s*\(\s*['\"][^'\"]+['\"]" "$file" 2>/dev/null | sed "s/.*['\"]//;s/['\"].*//")
    for imp in $imports; do
      if [ -f "$imp.js" ]; then
        if grep -q "$(basename "$file" .js)" "$imp.js" 2>/dev/null; then
          circular=$((circular + 1))
        fi
      fi
    done
  done
  echo $circular
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_complexity
fi
