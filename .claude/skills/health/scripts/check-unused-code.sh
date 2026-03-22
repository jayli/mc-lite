#!/bin/bash
# 废代码/未引用代码检查（减分项）

# 检查未引用的函数和变量
# 返回扣分值 (0-15)
check_unused_code() {
  local deduction=0

  # 通过 ESLint 检测未使用的变量和函数
  local unused_vars=0
  local unused_funcs=0
  local commented_blocks=0

  if [ -f "package.json" ]; then
    unused_vars=$(npm run lint -- --rule 'no-unused-vars: error' 2>&1 | grep -c "'.*' is assigned a value but never used" || true)
    unused_funcs=$(npm run lint -- --rule 'no-unused-vars: error' 2>&1 | grep -c "'.*' is defined but never used" || true)
    [ -z "$unused_vars" ] && unused_vars=0
    [ -z "$unused_funcs" ] && unused_funcs=0
  fi

  # 通过 grep 检查大量注释掉的代码块（可能是废弃代码）
  commented_blocks=$(grep -r '^\s*/\*\|^\s*\*\|^\s*//.*function\|^\s*//.*const\|^\s*//.*let\|^\s*//.*var' src/ --include="*.js" 2>/dev/null | wc -l)

  # 检查未引用的导出（可能通过 tree-shaking 检测）
  local unreferenced_exports=0
  if command -v npx &> /dev/null && [ -f "tsconfig.json" ]; then
    unreferenced_exports=$(npx ts-prune --project tsconfig.json 2>/dev/null | wc -l || echo 0)
    [ -z "$unreferenced_exports" ] && unreferenced_exports=0
  fi

  # 计算减分
  local total_unused=$((unused_vars + unused_funcs + commented_blocks / 5))

  if [ "$total_unused" -gt 50 ]; then
    deduction=15
  elif [ "$total_unused" -gt 30 ]; then
    deduction=10
  elif [ "$total_unused" -gt 15 ]; then
    deduction=5
  fi

  echo "$deduction"
}

# 检查代码中未引用的文件
# 返回扣分值 (0, 4, 或 8)
check_orphaned_files() {
  local js_files=$(find src -name "*.js" -o -name "*.ts" 2>/dev/null | wc -l)
  local imported_count=0

  for file in $(find src -name "*.js" -o -name "*.ts" 2>/dev/null); do
    local basename=$(basename "$file" | sed 's/\.[^.]*$//')
    # 检查该文件名是否被其他文件引用
    if grep -r "from.*$basename\|require.*$basename" src/ --include="*.js" --include="*.ts" 2>/dev/null | grep -v "$file" | grep -q .; then
      imported_count=$((imported_count + 1))
    fi
  done

  # 计算未被引用的文件比例
  if [ "$js_files" -gt 0 ]; then
    local orphan_ratio=$((100 - (imported_count * 100 / js_files)))
    if [ "$orphan_ratio" -gt 20 ]; then
      echo 8
    elif [ "$orphan_ratio" -gt 10 ]; then
      echo 4
    else
      echo 0
    fi
  else
    echo 0
  fi
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  echo "废代码扣分: $(check_unused_code)"
  echo "孤立文件扣分: $(check_orphaned_files)"
fi
