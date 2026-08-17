#!/bin/bash
# Post-task lint hook
# 检测 src 目录是否有修改，如果有则运行 lint

if git diff --name-only | grep -q "^src/.*\.js$"; then
  echo "🔍 检测到 JS 文件修改，运行 lint 检查..."
  npm run lint
  LINT_EXIT=$?
  if [ $LINT_EXIT -ne 0 ]; then
    echo "⚠️  Lint 发现警告，建议修复"
  fi
fi
