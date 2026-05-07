#!/bin/bash
# 检查债务清理证据
# 返回加分值 (0-5)

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# ============================================================
# iOS 债务清理检测
# ============================================================

check_ios_debt() {
  local score=0

  # 配置已集中化 - 检查 Configs、Constants、Settings 目录或文件
  local const_files=0
  [ -d "Configs" ] && const_files=$((const_files + $(find Configs -name "*.h" -o -name "*.m" -o -name "*.plist" 2>/dev/null | wc -l)))
  [ -d "Constants" ] && const_files=$((const_files + $(find Constants -name "*.h" -o -name "*.m" 2>/dev/null | wc -l)))
  [ -d "Resources" ] && const_files=$((const_files + 1))
  [ "$const_files" -gt 2 ] && score=$((score + 2))

  # 工具函数已提取 - 检查 Utils、Helpers、Categories 目录
  local util_files=0
  [ -d "Utils" ] && util_files=$((util_files + $(find Utils -name "*.h" -o -name "*.m" -o -name "*.swift" 2>/dev/null | wc -l)))
  [ -d "Helpers" ] && util_files=$((util_files + $(find Helpers -name "*.h" -o -name "*.m" -o -name "*.swift" 2>/dev/null | wc -l)))
  [ -d "Categories" ] && util_files=$((util_files + $(find Categories -name "*.h" -o -name "*.m" 2>/dev/null | wc -l)))
  [ -d "Extensions" ] && util_files=$((util_files + $(find Extensions -name "*.swift" 2>/dev/null | wc -l)))
  [ "$util_files" -gt 3 ] && score=$((score + 2))

  echo $score
}

# ============================================================
# Flutter 债务检测
# ============================================================

check_flutter_debt() {
  local score=0

  # 配置已集中化 - 检查 lib/config 和 lib/constants 目录
  local const_files=0
  [ -d "lib/config" ] && const_files=$((const_files + $(ls lib/config/*.dart 2>/dev/null | wc -l)))
  [ -d "lib/constants" ] && const_files=$((const_files + $(ls lib/constants/*.dart 2>/dev/null | wc -l)))
  [ "$const_files" -gt 2 ] && score=$((score + 2))

  # 工具函数已提取 - 检查 lib/utils 和 lib/common 目录
  local util_files=0
  [ -d "lib/utils" ] && util_files=$((util_files + $(ls lib/utils/*.dart 2>/dev/null | wc -l)))
  [ -d "lib/common" ] && util_files=$((util_files + $(ls lib/common/*.dart 2>/dev/null | wc -l)))
  [ "$util_files" -gt 3 ] && score=$((score + 2))

  echo $score
}

# ============================================================
# JS 债务检测
# ============================================================

check_js_debt() {
  local score=0

  # 配置已集中化 - 检查 src/constants 目录
  if [ -d "src/constants" ]; then
    local const_files=$(ls src/constants/*.js 2>/dev/null | wc -l)
    [ "$const_files" -gt 2 ] && score=$((score + 2))
  fi

  # 工具函数已提取 - 检查 src/utils 目录
  if [ -d "src/utils" ]; then
    local util_files=$(ls src/utils/*.js 2>/dev/null | wc -l)
    [ "$util_files" -gt 3 ] && score=$((score + 2))
  fi

  echo $score
}

# 通用债务检测（所有项目类型共用）
check_common_debt() {
  local score=0

  # 近期有重构记录
  if git log --oneline --since="3 months ago" 2>/dev/null | grep -iE "(refactor|extract|cleanup|debt)" | head -5 | grep -q .; then
    score=$((score + 1))
  fi

  echo $score
}

# 检查债务清理证据
check_debt_cleanup() {
  local project_type=$(detect_project_type)
  local score=0

  # 根据项目类型检测特定债务
  case "$project_type" in
    Flutter)
      score=$((score + $(check_flutter_debt)))
      ;;
    iOS)
      score=$((score + $(check_ios_debt)))
      ;;
    *)
      score=$((score + $(check_js_debt)))
      ;;
  esac

  # 加上通用检测分数
  score=$((score + $(check_common_debt)))

  # 确保不超过5分上限
  [ $score -gt 5 ] && score=5

  echo $score
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_debt_cleanup
fi
