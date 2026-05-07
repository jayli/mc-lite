#!/bin/bash
# 多人协作风格一致性检查（减分项）

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# 问题详情输出文件
STYLE_ISSUES="${SCRIPT_DIR}/../.style_issues.txt"
> "$STYLE_ISSUES"

# 添加风格问题
add_style_issue() {
    local severity="$1"
    local file="$2"
    local line="$3"
    local issue="$4"
    local detail="$5"
    local suggestion="$6"
    echo "SEVERITY:${severity}|FILE:${file}|LINE:${line}|ISSUE:${issue}|DETAIL:${detail}|SUGGEST:${suggestion}" >> "$STYLE_ISSUES"
}

# ============================================================
# iOS 风格一致性检测
# ============================================================

check_ios_style_consistency() {
    local deduction=0
    local issues_count=0

    # 检查项目贡献者数量
    local contributors=$(git log --format='%an' --since="6 months ago" 2>/dev/null | sort -u | wc -l)

    # 单人项目不检查风格一致性
    if [ "$contributors" -lt 2 ]; then
        echo 0
        return
    fi

    # 检查命名风格不一致（Objective-C 规范）
    # 类名应以大写字母开头，方法名以小写字母开头
    local uppercase_methods=$(grep -rE "^\s*[-+]\s*\([^(]+\)\s*[A-Z][a-zA-Z]+" --include="*.m" --include="*.mm" --include="*.h" . 2>/dev/null | wc -l)
    local lowercase_methods=$(grep -rE "^\s*[-+]\s*\([^(]+\)\s*[a-z][a-zA-Z]+" --include="*.m" --include="*.mm" --include="*.h" . 2>/dev/null | wc -l)

    if [ "$uppercase_methods" -gt 20 ] && [ "$lowercase_methods" -gt 50 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "方法命名风格不一致" "${uppercase_methods}处大写方法名，${lowercase_methods}处小写方法名" "统一方法命名风格(小写开头)"
    fi

    # 检查缩进不一致（空格 vs Tab）
    local tab_indented=$(grep -rE "^\t" --include="*.m" --include="*.mm" --include="*.h" --include="*.swift" . 2>/dev/null | wc -l)
    local space_indented=$(grep -rE "^  " --include="*.m" --include="*.mm" --include="*.h" --include="*.swift" . 2>/dev/null | wc -l)

    if [ "$tab_indented" -gt 50 ] && [ "$space_indented" -gt 50 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缩进风格不一致" "Tab:${tab_indented}处, 空格:${space_indented}处" "统一使用空格或Tab缩进"
    fi

    # 检查括号风格不一致
    local same_line_brace=$(grep -rE "^\s*\{\s*$" --include="*.m" --include="*.mm" --include="*.h" . 2>/dev/null | wc -l)
    local new_line_brace=$(grep -rE "\{\s*$" --include="*.m" --include="*.mm" --include="*.h" . 2>/dev/null | wc -l)

    if [ "$same_line_brace" -gt 50 ] && [ "$new_line_brace" -gt 50 ]; then
        deduction=$((deduction + 2))
        add_style_issue "P2" "项目整体" "N/A" "括号风格不一致" "同行和新行括号混用" "统一括号风格"
    fi

    # 检查是否配置了代码格式化工具
    local has_formatter=false
    if [ -f ".clang-format" ] || [ -f ".swiftlint.yml" ] || [ -f ".oclint" ]; then
        has_formatter=true
    fi

    # 如果多人项目且没有格式化配置，增加扣分
    if [ "$contributors" -gt 3 ] && [ "$has_formatter" = "false" ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缺少代码格式化配置" "多人项目无统一规范" "配置.clang-format或SwiftLint"
    fi

    # 限制最大扣分为10分
    [ "$deduction" -gt 10 ] && deduction=10

    echo "$deduction"
}

# ============================================================
# Flutter 风格一致性检测
# ============================================================

check_flutter_style_consistency() {
    local deduction=0
    local issues_count=0

    # 检查项目贡献者数量
    local contributors=$(git log --format='%an' --since="6 months ago" 2>/dev/null | sort -u | wc -l)

    # 单人项目不检查风格一致性
    if [ "$contributors" -lt 2 ]; then
        echo 0
        return
    fi

    # 检查命名风格不一致
    local screaming_caps=$(grep -rE 'const\s+[A-Z][A-Z_]{2,}\s*=' lib/ --include="*.dart" 2>/dev/null | wc -l)
    local camelCase_count=$(grep -rE 'const\s+[a-z][a-zA-Z]*\s*=' lib/ --include="*.dart" 2>/dev/null | wc -l)

    if [ "$screaming_caps" -gt 20 ] && [ "$camelCase_count" -gt 50 ]; then
        deduction=$((deduction + 5))
        add_style_issue "P2" "lib/" "N/A" "常量命名风格不一致" "SCREAMING_CAPS:${screaming_caps}处, camelCase:${camelCase_count}处" "统一使用camelCase常量命名"
    elif [ "$screaming_caps" -gt 10 ] && [ "$camelCase_count" -gt 30 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "lib/" "N/A" "常量命名风格不一致" "SCREAMING_CAPS:${screaming_caps}处" "统一使用camelCase常量命名"
    fi

    # 检查缩进不一致（空格 vs Tab）
    local tab_indented=$(grep -r "^\t" lib/ --include="*.dart" 2>/dev/null | wc -l)
    local space_indented=$(grep -r "^  " lib/ --include="*.dart" 2>/dev/null | wc -l)

    if [ "$tab_indented" -gt 50 ] && [ "$space_indented" -gt 50 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "lib/" "N/A" "缩进风格不一致" "Tab:${tab_indented}处, 空格:${space_indented}处" "统一使用空格缩进"
    fi

    # 检查引号风格不一致（Dart 中单引号和双引号均合法，但应统一）
    local single_quotes=$(grep -r "'[^']*'" lib/ --include="*.dart" 2>/dev/null | wc -l)
    local double_quotes=$(grep -r '"[^"]*"' lib/ --include="*.dart" 2>/dev/null | wc -l)

    if [ "$single_quotes" -gt 100 ] && [ "$double_quotes" -gt 100 ]; then
        local ratio=$((single_quotes * 100 / (single_quotes + double_quotes)))
        if [ "$ratio" -gt 30 ] && [ "$ratio" -lt 70 ]; then
            deduction=$((deduction + 2))
            add_style_issue "P2" "lib/" "N/A" "引号风格不一致" "单引号:${single_quotes}处, 双引号:${double_quotes}处" "统一使用单引号或双引号"
        fi
    fi

    # 检查是否配置了代码格式化工具
    local has_formatter=false
    if [ -f "analysis_options.yaml" ]; then
        has_formatter=true
    fi

    # 如果多人项目且没有格式化配置，增加扣分
    if [ "$contributors" -gt 3 ] && [ "$has_formatter" = "false" ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缺少代码格式化配置" "多人项目无analysis_options.yaml" "创建analysis_options.yaml配置"
    fi

    # 限制最大扣分为10分
    [ "$deduction" -gt 10 ] && deduction=10

    echo "$deduction"
}

# ============================================================
# JS/Node.js 风格一致性检测
# ============================================================

check_js_style_consistency() {
    local deduction=0
    local issues_count=0

    # 检查项目贡献者数量
    local contributors=$(git log --format='%an' --since="6 months ago" 2>/dev/null | sort -u | wc -l)

    # 单人项目不检查风格一致性
    if [ "$contributors" -lt 2 ]; then
        echo 0
        return
    fi

    # 检查命名风格不一致
    local snake_case_count=$(grep -r "function\s\+\w\+_\w\+\|const\s\+\w\+_\w\+\|let\s\+\w\+_\w\+" src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)
    local camelCase_count=$(grep -r "function\s\+\w\+[A-Z]\w*\|const\s\+\w\+[A-Z]\w*\|let\s\+\w\+[A-Z]\w*" src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)

    # 如果同时存在大量 snake_case 和 camelCase，说明风格不一致
    if [ "$snake_case_count" -gt 20 ] && [ "$camelCase_count" -gt 50 ]; then
        deduction=$((deduction + 5))
        add_style_issue "P2" "src/" "N/A" "命名风格不一致(snake_case vs camelCase)" "snake_case:${snake_case_count}处, camelCase:${camelCase_count}处" "统一使用camelCase"
    elif [ "$snake_case_count" -gt 10 ] && [ "$camelCase_count" -gt 30 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "src/" "N/A" "命名风格不一致" "snake_case:${snake_case_count}处" "统一使用camelCase"
    fi

    # 检查缩进不一致（空格 vs Tab）
    local tab_indented=$(grep -r "^\t" src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)
    local space_indented=$(grep -r "^  " src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)

    if [ "$tab_indented" -gt 50 ] && [ "$space_indented" -gt 50 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "src/" "N/A" "缩进风格不一致" "Tab:${tab_indented}处, 空格:${space_indented}处" "统一使用空格缩进(2或4个)"
    fi

    # 检查引号风格不一致
    local single_quotes=$(grep -r "'[^']*'" src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)
    local double_quotes=$(grep -r '"[^"]*"' src/ lib/ --include="*.js" --include="*.ts" 2>/dev/null | wc -l)

    if [ "$single_quotes" -gt 100 ] && [ "$double_quotes" -gt 100 ]; then
        local ratio=$((single_quotes * 100 / (single_quotes + double_quotes)))
        if [ "$ratio" -gt 30 ] && [ "$ratio" -lt 70 ]; then
            deduction=$((deduction + 2))
            add_style_issue "P2" "src/" "N/A" "引号风格不一致" "单引号:${single_quotes}处, 双引号:${double_quotes}处" "统一使用单引号或双引号"
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
        add_style_issue "P2" "项目整体" "N/A" "缺少代码格式化配置" "多人项目无Prettier配置" "配置Prettier统一代码风格"
    fi

    # 限制最大扣分为10分
    [ "$deduction" -gt 10 ] && deduction=10

    echo "$deduction"
}

# ============================================================n# 通用风格检查函数（适用于多种语言）n# ============================================================n
check_generic_style() {
    local deduction=0
    local extensions="$1"
    local search_dirs="$2"
    local has_formatter_file="$3"
    local formatter_name="$4"

    # 检查项目贡献者数量
    local contributors=$(git log --format='%an' --since="6 months ago" 2>/dev/null | sort -u | wc -l)

    # 单人项目不检查风格一致性
    if [ "$contributors" -lt 2 ]; then
        echo 0
        return
    fi

    # 检查缩进不一致
    local tab_cmd="grep -r '^\\\\t'"
    local space_cmd="grep -r '^  '"

    for ext in $extensions; do
        tab_cmd="$tab_cmd --include=\"*.$ext\""
        space_cmd="$space_cmd --include=\"*.$ext\""
    done

    for dir in $search_dirs; do
        if [ -d "$dir" ]; then
            tab_cmd="$tab_cmd $dir/"
            space_cmd="$space_cmd $dir/"
        fi
    done

    tab_cmd="$tab_cmd 2>/dev/null | wc -l"
    space_cmd="$space_cmd 2>/dev/null | wc -l"

    local tab_indented=$(eval $tab_cmd)
    local space_indented=$(eval $space_cmd)

    if [ "$tab_indented" -gt 50 ] && [ "$space_indented" -gt 50 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缩进风格不一致" "Tab:${tab_indented}处, 空格:${space_indented}处" "统一使用空格或Tab缩进"
    fi

    # 检查是否有格式化配置
    local has_formatter=false
    if [ -n "$has_formatter_file" ] && [ -f "$has_formatter_file" ]; then
        has_formatter=true
    fi

    # 多人项目且没有格式化配置
    if [ "$contributors" -gt 3 ] && [ "$has_formatter" = "false" ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缺少代码格式化配置" "多人项目无${formatter_name}配置" "配置${formatter_name}统一代码风格"
    fi

    # 限制最大扣分为10分
    [ "$deduction" -gt 10 ] && deduction=10

    echo "$deduction"
}

# ============================================================n# Java 风格一致性检测n# ============================================================

check_java_style_consistency() {
    local deduction=0
    local issues_count=0

    # 检查项目贡献者数量
    local contributors=$(git log --format='%an' --since="6 months ago" 2>/dev/null | sort -u | wc -l)

    if [ "$contributors" -lt 2 ]; then
        echo 0
        return
    fi

    # 检查命名风格不一致（snake_case vs camelCase）
    local snake_case=$(find . -name "*.java" 2>/dev/null | xargs grep -l "^[a-z_]*_[a-z_]*\.java$" 2>/dev/null | wc -l)
    local camelCase=$(find . -name "*.java" 2>/dev/null | xargs grep -l "^[A-Z][a-zA-Z]*\.java$" 2>/dev/null | wc -l)

    if [ "$snake_case" -gt 10 ] && [ "$camelCase" -gt 20 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "src/" "N/A" "文件名命名风格不一致" "混合使用不同命名规范" "统一使用PascalCase类名"
    fi

    # 检查缩进不一致
    local tab_indented=$(grep -r $'\t' --include="*.java" src/ 2>/dev/null | wc -l)
    local space_indented=$(grep -r "^  " --include="*.java" src/ 2>/dev/null | wc -l)

    if [ "$tab_indented" -gt 50 ] && [ "$space_indented" -gt 50 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "src/" "N/A" "缩进风格不一致" "Tab:${tab_indented}处, 空格:${space_indented}处" "统一使用4空格缩进"
    fi

    # 检查是否有代码格式化配置
    local has_formatter=false
    if [ -f "checkstyle.xml" ] || [ -f ".editorconfig" ]; then
        has_formatter=true
    fi

    if [ "$contributors" -gt 3 ] && [ "$has_formatter" = "false" ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缺少代码格式化配置" "多人项目无checkstyle配置" "配置checkstyle或editorconfig"
    fi

    [ "$deduction" -gt 10 ] && deduction=10
    echo "$deduction"
}

# ============================================================n# Python 风格一致性检测n# ============================================================

check_python_style_consistency() {
    local deduction=0
    local issues_count=0

    # 检查项目贡献者数量
    local contributors=$(git log --format='%an' --since="6 months ago" 2>/dev/null | sort -u | wc -l)

    if [ "$contributors" -lt 2 ]; then
        echo 0
        return
    fi

    # 检查命名风格不一致
    local snake_case_funcs=$(grep -rE "^def [a-z_]+_\w+" --include="*.py" . 2>/dev/null | wc -l)
    local camelCase_funcs=$(grep -rE "^def [a-z]+[A-Z]\w+" --include="*.py" . 2>/dev/null | wc -l)

    if [ "$snake_case_funcs" -gt 20 ] && [ "$camelCase_funcs" -gt 10 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "函数命名风格不一致" "snake_case与camelCase混用" "统一使用snake_case"
    fi

    # 检查缩进不一致
    local tab_indented=$(grep -r $'\t' --include="*.py" . 2>/dev/null | wc -l)
    local space_indented=$(grep -r "^  " --include="*.py" . 2>/dev/null | wc -l)

    if [ "$tab_indented" -gt 50 ] && [ "$space_indented" -gt 50 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缩进风格不一致" "Tab:${tab_indented}处, 空格:${space_indented}处" "统一使用4空格缩进(PEP 8)"
    fi

    # 检查引号风格不一致
    local single_quotes=$(grep -r "'[^']*'" --include="*.py" . 2>/dev/null | wc -l)
    local double_quotes=$(grep -r '"[^"]*"' --include="*.py" . 2>/dev/null | wc -l)

    if [ "$single_quotes" -gt 100 ] && [ "$double_quotes" -gt 100 ]; then
        local ratio=$((single_quotes * 100 / (single_quotes + double_quotes)))
        if [ "$ratio" -gt 30 ] && [ "$ratio" -lt 70 ]; then
            deduction=$((deduction + 2))
            add_style_issue "P2" "项目整体" "N/A" "引号风格不一致" "单双引号混用" "统一使用一种引号风格"
        fi
    fi

    # 检查格式化配置
    local has_formatter=false
    if [ -f "setup.cfg" ] || [ -f "pyproject.toml" ] || [ -f ".flake8" ] || [ -f ".pylintrc" ]; then
        has_formatter=true
    fi

    if [ "$contributors" -gt 3 ] && [ "$has_formatter" = "false" ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缺少代码格式化配置" "多人项目无flake8/pylint配置" "配置flake8或black"
    fi

    [ "$deduction" -gt 10 ] && deduction=10
    echo "$deduction"
}

# ============================================================n# Go 风格一致性检测n# ============================================================

check_go_style_consistency() {
    local deduction=0
    local issues_count=0

    # 检查项目贡献者数量
    local contributors=$(git log --format='%an' --since="6 months ago" 2>/dev/null | sort -u | wc -l)

    if [ "$contributors" -lt 2 ]; then
        echo 0
        return
    fi

    # 检查缩进不一致（Go应使用Tab）
    local tab_indented=$(grep -r $'\t' --include="*.go" . 2>/dev/null | wc -l)
    local space_indented=$(grep -r "^  " --include="*.go" . 2>/dev/null | wc -l)

    # Go标准使用Tab，但混合使用也是问题
    if [ "$tab_indented" -gt 50 ] && [ "$space_indented" -gt 50 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缩进风格不一致" "Tab与空格混用" "统一使用Tab(gofmt标准)"
    fi

    # 检查是否使用gofmt
    if ! command -v gofmt >/dev/null 2>&1; then
        deduction=$((deduction + 2))
        add_style_issue "P2" "项目整体" "N/A" "未安装gofmt" "" "安装gofmt并格式化代码"
    fi

    [ "$deduction" -gt 10 ] && deduction=10
    echo "$deduction"
}

# ============================================================n# C/C++ 风格一致性检测n# ============================================================

check_cpp_style_consistency() {
    local deduction=0
    local issues_count=0

    # 检查项目贡献者数量
    local contributors=$(git log --format='%an' --since="6 months ago" 2>/dev/null | sort -u | wc -l)

    if [ "$contributors" -lt 2 ]; then
        echo 0
        return
    fi

    # 检查命名风格不一致
    local snake_case=$(grep -rE "(int|void|char|double)\s+[a-z_]+\s*\(" --include="*.c" --include="*.cpp" . 2>/dev/null | wc -l)
    local camelCase=$(grep -rE "(int|void|char|double)\s+[a-z]+[A-Z]\w*\s*\(" --include="*.c" --include="*.cpp" . 2>/dev/null | wc -l)

    if [ "$snake_case" -gt 50 ] && [ "$camelCase" -gt 30 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "函数命名风格不一致" "snake_case与camelCase混用" "统一命名风格"
    fi

    # 检查缩进不一致
    local tab_indented=$(grep -r $'\t' --include="*.c" --include="*.cpp" --include="*.h" --include="*.hpp" . 2>/dev/null | wc -l)
    local space_indented=$(grep -r "^  " --include="*.c" --include="*.cpp" --include="*.h" --include="*.hpp" . 2>/dev/null | wc -l)

    if [ "$tab_indented" -gt 50 ] && [ "$space_indented" -gt 50 ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缩进风格不一致" "Tab:${tab_indented}处, 空格:${space_indented}处" "统一使用空格或Tab"
    fi

    # 检查括号风格不一致
    local same_line=$(grep -rE "^\s*\w+.*\{" --include="*.c" --include="*.cpp" . 2>/dev/null | wc -l)
    local new_line=$(grep -rE "^\s*\{$" --include="*.c" --include="*.cpp" . 2>/dev/null | wc -l)

    if [ "$same_line" -gt 50 ] && [ "$new_line" -gt 50 ]; then
        deduction=$((deduction + 2))
        add_style_issue "P2" "项目整体" "N/A" "括号风格不一致" "同行与新行括号混用" "统一括号风格"
    fi

    # 检查格式化配置
    local has_formatter=false
    if [ -f ".clang-format" ] || [ -f ".astylerc" ]; then
        has_formatter=true
    fi

    if [ "$contributors" -gt 3 ] && [ "$has_formatter" = "false" ]; then
        deduction=$((deduction + 3))
        add_style_issue "P2" "项目整体" "N/A" "缺少代码格式化配置" "多人项目无.clang-format配置" "配置clang-format统一风格"
    fi

    [ "$deduction" -gt 10 ] && deduction=10
    echo "$deduction"
}

# ============================================================
# 主入口函数（按项目类型分派，可扩展）
# ============================================================

check_style_consistency() {
    local project_type=$(detect_project_type)

    case "$project_type" in
        Flutter)
            check_flutter_style_consistency
            ;;
        iOS)
            check_ios_style_consistency
            ;;
        Java)
            check_java_style_consistency
            ;;
        Python)
            check_python_style_consistency
            ;;
        Go)
            check_go_style_consistency
            ;;
        Cpp)
            check_cpp_style_consistency
            ;;
        *)
            check_js_style_consistency
            ;;
    esac
}

# 获取风格详情文件路径
get_style_issues_file() {
    echo "$STYLE_ISSUES"
}

# 输出风格详情到stdout
output_style_details() {
    if [ -f "$STYLE_ISSUES" ] && [ -s "$STYLE_ISSUES" ]; then
        cat "$STYLE_ISSUES"
    fi
}

# 如果直接执行此脚本
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    check_style_consistency
fi
