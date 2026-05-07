#!/bin/bash
# PHP 技术栈健康度检查
# 输出: 分数:问题数
# 检查项：框架一致性(3分)、版本管理质量(2分)、依赖数量评估(2分)、技术选型合理性(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

ISSUES_FILE="${SCRIPT_DIR}/../../.php_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_php_tech_stack() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 框架一致性检查 (3分)
    # ============================================

    local framework_issues=0

    # 检查是否混用了多个框架
    local has_laravel=0
    local has_symfony=0
    local has_codeigniter=0
    local has_cakephp=0

    # 检查项目结构
    [ -f "artisan" ] && has_laravel=1
    [ -d "app/Http/Controllers" ] && has_laravel=1
    [ -f "bin/console" ] && has_symfony=1
    [ -d "src/Controller" ] && [ -f "symfony.lock" ] && has_symfony=1
    [ -f "system/CodeIgniter.php" ] && has_codeigniter=1
    [ -d "app/Config" ] && [ -f "cake" ] && has_cakephp=1

    # 检查 composer.json
    if [ -f "composer.json" ]; then
        grep -qiE "laravel/framework" composer.json && has_laravel=1
        grep -qiE "symfony/symfony|symfony/framework" composer.json && has_symfony=1
        grep -qiE "codeigniter" composer.json && has_codeigniter=1
        grep -qiE "cakephp" composer.json && has_cakephp=1
    fi

    local framework_count=$((has_laravel + has_symfony + has_codeigniter + has_cakephp))

    if [ "$framework_count" -gt 1 ]; then
        add_issue "P1" "项目依赖" "N/A" "混用多个框架" "Laravel+Symfony等" "统一使用单一框架"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查数据库访问层一致性
    local has_eloquent=0
    local has_doctrine=0
    local has_pdo=0

    grep -rqE "use Illuminate\\\\Database|Eloquent|Model::" --include="*.php" . 2>/dev/null && has_eloquent=1
    grep -rqE "use Doctrine|EntityManager" --include="*.php" . 2>/dev/null && has_doctrine=1
    grep -rqE "PDO::|new PDO" --include="*.php" . 2>/dev/null && has_pdo=1

    if [ "$has_eloquent" -eq 1 ] && [ "$has_doctrine" -eq 1 ]; then
        add_issue "P2" "项目依赖" "N/A" "混用多个ORM" "Eloquent+Doctrine" "统一ORM方案"
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

    if [ -f "composer.json" ]; then
        # 检查 PHP 版本约束
        local php_version=$(grep -oE '"php":\s*"[^"]+"' composer.json 2>/dev/null)

        if [ -z "$php_version" ]; then
            add_issue "P2" "composer.json" "N/A" "缺少PHP版本约束" "" "添加php版本要求"
            version_issues=$((version_issues + 1))
        fi
    fi

    # 检查是否有 composer.lock
    if [ -f "composer.json" ] && [ ! -f "composer.lock" ]; then
        add_issue "P2" "composer.lock" "N/A" "缺少依赖锁定文件" "无composer.lock" "运行composer update"
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

    if [ -f "composer.lock" ]; then
        dependency_count=$(grep -cE '"name":' composer.lock 2>/dev/null || echo 0)
    elif [ -f "composer.json" ]; then
        dependency_count=$(grep -cE '"[a-zA-Z0-9/-]+":\s*"' composer.json 2>/dev/null || echo 0)
    fi

    if [ "$dependency_count" -gt 50 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量过多" "${dependency_count}个包" "评估必要性"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 30 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量偏多" "${dependency_count}个包" "定期清理"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # ============================================
    # 4. 技术选型合理性检查 (1分)
    # ============================================

    local tech_selection_issues=0

    # 检查 PHP 版本
    if [ -f "composer.json" ]; then
        local php_constraint=$(grep -oE '"php":\s*"[^"]+"' composer.json 2>/dev/null)

        if echo "$php_constraint" | grep -qE "5\.[0-6]|7\.[0-3]"; then
            add_issue "P2" "composer.json" "N/A" "PHP版本约束较旧" "$php_constraint" "升级PHP版本要求"
            tech_selection_issues=$((tech_selection_issues + 1))
        fi
    fi

    # 检查项目规模与框架匹配度
    local file_count=$(find . -name "*.php" -not -path "*/vendor/*" -not -path "*/tests/*" 2>/dev/null | wc -l | tr -d ' ')

    if [ "$file_count" -lt 15 ] && [ "$has_laravel" -eq 1 ]; then
        add_issue "P2" "项目结构" "N/A" "小项目使用重型框架" "Laravel(${file_count}文件)" "考虑轻量方案"
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

check_php_tech_stack