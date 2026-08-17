#!/bin/bash
# Ruby 技术栈健康度检查
# 输出: 分数:问题数
# 检查项：框架一致性(3分)、版本管理质量(2分)、依赖数量评估(2分)、技术选型合理性(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.ruby_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_ruby_tech_stack() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 框架一致性检查 (3分)
    # ============================================

    local framework_issues=0

    # 检查是否混用了多个框架
    local has_rails=0
    local has_sinatra=0
    local has_grape=0

    # 检查项目结构
    [ -f "config/application.rb" ] && has_rails=1
    [ -d "app/controllers" ] && [ -d "app/models" ] && [ -d "app/views" ] && has_rails=1
    [ -f "app.rb" ] && grep -qE "Sinatra|sinatra" app.rb 2>/dev/null && has_sinatra=1
    grep -rqE "require.*sinatra|Sinatra::Base" --include="*.rb" . 2>/dev/null && has_sinatra=1
    grep -rqE "require.*grape|Grape::API" --include="*.rb" . 2>/dev/null && has_grape=1

    # 检查 Gemfile
    if [ -f "Gemfile" ]; then
        grep -qiE "rails" Gemfile && has_rails=1
        grep -qiE "sinatra" Gemfile && has_sinatra=1
        grep -qiE "grape" Gemfile && has_grape=1
    fi

    local framework_count=$((has_rails + has_sinatra + has_grape))

    if [ "$framework_count" -gt 1 ]; then
        add_issue "P1" "项目依赖" "N/A" "混用多个Web框架" "Rails+Sinatra等" "统一使用单一框架"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查数据库访问层一致性
    local has_ar=0
    local has_sequel=0

    grep -rqE "ActiveRecord| ApplicationRecord" --include="*.rb" . 2>/dev/null && has_ar=1
    grep -rqE "Sequel::|require.*sequel" --include="*.rb" . 2>/dev/null && has_sequel=1

    if [ -f "Gemfile" ]; then
        grep -qiE "activerecord|pg|mysql2" Gemfile && has_ar=1
        grep -qiE "sequel" Gemfile && has_sequel=1
    fi

    if [ "$has_ar" -eq 1 ] && [ "$has_sequel" -eq 1 ]; then
        add_issue "P2" "项目依赖" "N/A" "混用多个ORM" "ActiveRecord+Sequel" "统一ORM方案"
        framework_issues=$((framework_issues + 1))
    fi

    if [ "$framework_issues" -eq 0 ]; then
        score=$((score + 3))
    elif [ "$framework_issues" -eq 1 ]; then
        score=$((score + 2))
        issues_count=$((issues_count + framework_issues))
    else
        score=$((score + 1))
        issues_count=$((issues_count + framework_issues))
    fi

    # ============================================
    # 2. 版本管理质量检查 (2分)
    # ============================================

    local version_issues=0

    if [ -f "Gemfile" ]; then
        # 检查是否缺少版本锁定
        local unlocked=$(grep -cE "gem\s+'[^']+'\s*$|gem\s+'[^']+',\s*:$" Gemfile 2>/dev/null || echo 0)

        if [ "$unlocked" -gt 3 ]; then
            add_issue "P1" "Gemfile" "N/A" "存在未锁定版本" "${unlocked}个无版本gem" "添加具体版本号"
            version_issues=$((version_issues + 1))
        fi
    fi

    # 检查是否有 Gemfile.lock
    if [ -f "Gemfile" ] && [ ! -f "Gemfile.lock" ]; then
        add_issue "P2" "Gemfile.lock" "N/A" "缺少依赖锁定文件" "无Gemfile.lock" "运行bundle install"
        version_issues=$((version_issues + 1))
    fi

    if [ "$version_issues" -eq 0 ]; then
        score=$((score + 2))
    elif [ "$version_issues" -eq 1 ]; then
        score=$((score + 1))
        issues_count=$((issues_count + version_issues))
    else
        score=$((score + 0))
        issues_count=$((issues_count + version_issues))
    fi

    # ============================================
    # 3. 依赖数量评估 (2分)
    # ============================================

    local dependency_count=0

    if [ -f "Gemfile.lock" ]; then
        dependency_count=$(grep -cE "^\s+[a-zA-Z]" Gemfile.lock 2>/dev/null || echo 0)
    elif [ -f "Gemfile" ]; then
        dependency_count=$(grep -cE "gem\s+'" Gemfile 2>/dev/null || echo 0)
    fi

    if [ "$dependency_count" -gt 50 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量过多" "${dependency_count}个gem" "评估必要性"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 30 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量偏多" "${dependency_count}个gem" "定期清理"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # ============================================
    # 4. 技术选型合理性检查 (1分)
    # ============================================

    local tech_selection_issues=0

    # 检查 Ruby 版本
    if [ -f ".ruby-version" ]; then
        local ruby_version=$(cat .ruby-version 2>/dev/null)
        # 简单检查是否是较新版本
        if echo "$ruby_version" | grep -qE "^2\.[0-5]|^1\."; then
            add_issue "P2" ".ruby-version" "N/A" "Ruby版本较旧" "$ruby_version" "升级到较新版本"
            tech_selection_issues=$((tech_selection_issues + 1))
        fi
    fi

    # 检查项目规模与框架匹配度
    local file_count=$(find . -name "*.rb" -not -path "*/test/*" -not -path "*/spec/*" 2>/dev/null | wc -l | tr -d ' ')

    if [ "$file_count" -lt 10 ] && [ "$has_rails" -eq 1 ]; then
        add_issue "P2" "项目结构" "N/A" "小项目使用重型框架" "Rails(${file_count}文件)" "考虑Sinatra"
        tech_selection_issues=$((tech_selection_issues + 1))
    fi

    if [ "$tech_selection_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + tech_selection_issues))
    fi

    echo "$score:$issues_count"
}

check_ruby_tech_stack