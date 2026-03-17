#!/bin/bash
# Health Check Utility Functions
# 通用工具函数

# 生成带自增编号的报告文件名
generate_report_filename() {
  local date_str=$(date +%Y-%m-%d)
  local max_num=0

  for file in ./health_check/${date_str}-*-health-check.md 2>/dev/null; do
    if [ -f "$file" ]; then
      local num=$(basename "$file" | grep -oE '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}-[0-9]{3}' | tail -1 | cut -d'-' -f4)
      if [[ "$num" =~ ^[0-9]+$ ]] && [ "$num" -gt "$max_num" ]; then
        max_num="$num"
      fi
    fi
  done

  local next_num=$(printf "%03d" $((max_num + 1)))
  echo "./health_check/${date_str}-${next_num}-health-check.md"
}

# 检测项目类型
detect_project_type() {
  if [ -f "package.json" ]; then
    echo "Node.js"
  elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
    echo "Python"
  elif [ -f "go.mod" ]; then
    echo "Go"
  elif [ -f "pom.xml" ] || [ -f "build.gradle" ]; then
    echo "Java"
  elif [ -f "Gemfile" ]; then
    echo "Ruby"
  elif [ -f "composer.json" ]; then
    echo "PHP"
  elif [ -f "Cargo.toml" ]; then
    echo "Rust"
  else
    echo "Unknown"
  fi
}

# 计算代码总行数
count_total_lines() {
  find . -type f \( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.java" -o -name "*.rb" \) \
    -not -path "*/node_modules/*" \
    -not -path "*/.git/*" \
    -not -path "*/dist/*" \
    -not -path "*/build/*" \
    2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}'
}
