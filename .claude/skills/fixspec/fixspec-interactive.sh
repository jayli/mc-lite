#!/bin/bash

# fixspec 交互式脚本
# 用法：./fixspec-interactive.sh [<spec-name>]

SPECS_DIR="specs"

# 如果带了参数，直接处理
if [ -n "$1" ]; then
    SPEC_NAME="$1"
    echo "DIRECT_MODE:$SPEC_NAME"
    exit 0
fi

# 交互模式：输出所有 specs 列表
SPECS=$(ls -d $SPECS_DIR/*/ 2>/dev/null | xargs -I {} basename {} | sort)

if [ -z "$SPECS" ]; then
    echo "ERROR:No specs found"
    exit 1
fi

# 输出列表供 skill 解析
echo "LIST_MODE"
i=1
while IFS= read -r spec; do
    if [ -n "$spec" ]; then
        # 尝试从 spec.md 提取描述
        desc=""
        if [ -f "$SPECS_DIR/$spec/spec.md" ]; then
            desc=$(head -1 "$SPECS_DIR/$spec/spec.md" 2>/dev/null | sed 's/^# *//' | cut -c1-50)
        fi
        echo "$i|$spec|$desc"
        i=$((i+1))
    fi
done <<< "$SPECS"
