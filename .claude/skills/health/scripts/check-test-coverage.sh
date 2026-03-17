#!/bin/bash
# 测试覆盖检查
# 返回得分 (0-20)

source "$(dirname "$0")/utils.sh"

# 检查测试框架和测试文件
check_test_coverage() {
  local score=0
  local test_files=$(find . -name "*.test.js" -o -name "*.spec.js" -o -path "*/tests/*" 2>/dev/null | wc -l)
  local test_dir=$(find . -type d -name "test" -o -type d -name "tests" 2>/dev/null | wc -l)

  # 测试文件存在（5分）
  [ "$test_files" -gt 0 ] && score=$((score + 5))

  # 核心功能有测试（10分）- 检查关键文件
  local core_tests=0
  [ -f "src/tests/test-world.js" ] && core_tests=$((core_tests + 1))
  [ -f "src/tests/test-chunk.js" ] && core_tests=$((core_tests + 1))
  [ -f "src/tests/test-entity-system.js" ] && core_tests=$((core_tests + 1))
  score=$((score + core_tests * 3))
  [ $score -gt 15 ] && score=15

  # 测试可运行（5分）
  [ -f "src/tests/index.html" ] && score=$((score + 5))

  echo $score
}

# 检查是否完全没有测试用例（减分项）
# 返回扣分值 (0 或 10)
check_no_tests_deduction() {
  local deduction=0

  # 查找各种测试文件
  local test_count=$(find . -type f \( \
    -name "*.test.js" -o -name "*.test.ts" -o \
    -name "*.spec.js" -o -name "*.spec.ts" -o \
    -name "*_test.go" -o \
    -name "test_*.py" -o -name "*_test.py" -o \
    -path "*/tests/*" -o -path "*/__tests__/*" \
  \) 2>/dev/null | wc -l)

  # 检查测试目录
  local test_dirs=$(find . -type d \( \
    -name "test" -o -name "tests" -o \
    -name "__tests__" -o -name "spec" -o \
    -name "specs" \
  \) 2>/dev/null | wc -l)

  # 如果完全没有任何测试文件，扣10分
  if [ "$test_count" -eq 0 ] && [ "$test_dirs" -eq 0 ]; then
    deduction=10
  fi

  echo "$deduction"
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  echo "测试覆盖得分: $(check_test_coverage)"
  echo "无测试扣分: $(check_no_tests_deduction)"
fi
