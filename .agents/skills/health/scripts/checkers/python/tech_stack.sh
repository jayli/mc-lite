#!/bin/bash
# Python 技术栈健康度检查
# 输出: 分数:问题数
# 检查项：框架一致性(3分)、版本管理质量(2分)、依赖数量评估(2分)、技术选型合理性(1分)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../utils.sh"

# 问题详情输出文件
ISSUES_FILE="${SCRIPT_DIR}/../../.python_tech_stack_issues.txt"
> "$ISSUES_FILE"

add_issue() {
    echo "SEVERITY:$1|FILE:$2|LINE:$3|ISSUE:$4|CODE:$5|SUGGEST:$6" >> "$ISSUES_FILE"
}

check_python_tech_stack() {
    local score=0
    local issues_count=0

    # ============================================
    # 1. 框架一致性检查 (3分)
    # ============================================

    local framework_issues=0

    # 检查是否混用了多个Web框架
    local has_flask=0
    local has_django=0
    local has_fastapi=0
    local has_tornado=0
    local has_aiohttp=0

    # 检查 requirements.txt 或 pyproject.toml
    if [ -f "requirements.txt" ]; then
        grep -qiE "flask" requirements.txt && has_flask=1
        grep -qiE "django" requirements.txt && has_django=1
        grep -qiE "fastapi" requirements.txt && has_fastapi=1
        grep -qiE "tornado" requirements.txt && has_tornado=1
        grep -qiE "aiohttp" requirements.txt && has_aiohttp=1
    fi

    if [ -f "pyproject.toml" ]; then
        grep -qiE "flask" pyproject.toml && has_flask=1
        grep -qiE "django" pyproject.toml && has_django=1
        grep -qiE "fastapi" pyproject.toml && has_fastapi=1
        grep -qiE "tornado" pyproject.toml && has_tornado=1
        grep -qiE "aiohttp" pyproject.toml && has_aiohttp=1
    fi

    # 检查代码中的实际导入
    local flask_import=$(grep -rE "import flask|from flask" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')
    local django_import=$(grep -rE "import django|from django" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')
    local fastapi_import=$(grep -rE "import fastapi|from fastapi" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')
    local tornado_import=$(grep -rE "import tornado|from tornado" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')

    [ "$flask_import" -gt 0 ] && has_flask=1
    [ "$django_import" -gt 0 ] && has_django=1
    [ "$fastapi_import" -gt 0 ] && has_fastapi=1
    [ "$tornado_import" -gt 0 ] && has_tornado=1

    local web_framework_count=$((has_flask + has_django + has_fastapi + has_tornado + has_aiohttp))

    if [ "$web_framework_count" -gt 1 ]; then
        add_issue "P1" "项目依赖" "N/A" "混用多个Web框架" "Flask+Django+FastAPI等" "统一使用单一框架"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查数据库访问层一致性
    local has_sqlalchemy=0
    local has_django_db=0
    local has_peewee=0
    local has_pymongo=0
    local has_sqlite3=0

    if [ -f "requirements.txt" ]; then
        grep -qiE "sqlalchemy" requirements.txt && has_sqlalchemy=1
        grep -qiE "peewee" requirements.txt && has_peewee=1
        grep -qiE "pymongo" requirements.txt && has_pymongo=1
    fi

    local db_import_sqlalchemy=$(grep -rE "import sqlalchemy|from sqlalchemy" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')
    local db_import_peewee=$(grep -rE "import peewee|from peewee" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')
    local db_import_pymongo=$(grep -rE "import pymongo|from pymongo" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')
    local db_import_sqlite3=$(grep -rE "import sqlite3" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')

    [ "$db_import_sqlalchemy" -gt 0 ] && has_sqlalchemy=1
    [ "$db_import_peewee" -gt 0 ] && has_peewee=1
    [ "$db_import_pymongo" -gt 0 ] && has_pymongo=1
    [ "$db_import_sqlite3" -gt 0 ] && has_sqlite3=1

    local db_layer_count=$((has_sqlalchemy + has_django_db + has_peewee + has_pymongo + has_sqlite3))

    if [ "$db_layer_count" -gt 2 ]; then
        add_issue "P2" "项目依赖" "N/A" "混用多个数据库层" "SQLAlchemy+Peewee+Mongo等" "统一数据库访问方案"
        framework_issues=$((framework_issues + 1))
    fi

    # 检查HTTP客户端一致性
    local has_requests=0
    local has_httpx=0
    local has_aiohttp_client=0
    local has_urllib=0

    local http_requests=$(grep -rE "import requests|from requests" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')
    local http_httpx=$(grep -rE "import httpx|from httpx" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')
    local http_aiohttp=$(grep -rE "import aiohttp|from aiohttp" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')
    local http_urllib=$(grep -rE "import urllib|from urllib" --include="*.py" . 2>/dev/null | wc -l | tr -d ' ')

    [ "$http_requests" -gt 0 ] && has_requests=1
    [ "$http_httpx" -gt 0 ] && has_httpx=1
    [ "$http_aiohttp" -gt 0 ] && has_aiohttp_client=1
    [ "$http_urllib" -gt 0 ] && has_urllib=1

    local http_client_count=$((has_requests + has_httpx + has_aiohttp_client + has_urllib))

    if [ "$http_client_count" -gt 2 ]; then
        add_issue "P2" "项目依赖" "N/A" "混用多个HTTP客户端" "requests+httpx+urllib等" "统一HTTP请求方案"
        framework_issues=$((framework_issues + 1))
    fi

    # 计算框架一致性得分
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

    # 检查是否有版本范围声明（可能导致版本不确定性）
    if [ -f "requirements.txt" ]; then
        # 检查是否使用了 >= 或 ~= 等范围声明
        local range_versions=$(grep -cE ">[=]?|~=" requirements.txt 2>/dev/null || echo 0)

        if [ "$range_versions" -gt 5 ]; then
            add_issue "P2" "requirements.txt" "N/A" "版本声明过于宽松" "${range_versions}个范围声明" "使用固定版本号"
            version_issues=$((version_issues + 1))
        fi

        # 检查是否有未锁定版本（只有包名无版本）
        local unlocked=$(grep -cE "^[a-zA-Z][a-zA-Z0-9_-]*$" requirements.txt 2>/dev/null || echo 0)

        if [ "$unlocked" -gt 0 ]; then
            add_issue "P1" "requirements.txt" "N/A" "存在未锁定版本" "${unlocked}个无版本依赖" "添加具体版本号"
            version_issues=$((version_issues + 1))
        fi
    fi

    # 检查是否有lock文件
    local has_lock=0
    [ -f "requirements.lock" ] && has_lock=1
    [ -f "poetry.lock" ] && has_lock=1
    [ -f "Pipfile.lock" ] && has_lock=1

    if [ "$has_lock" -eq 0 ] && [ -f "requirements.txt" ]; then
        add_issue "P2" "项目依赖" "N/A" "缺少依赖锁定文件" "无requirements.lock" "生成锁定文件确保一致性"
        version_issues=$((version_issues + 1))
    fi

    # 计算版本管理得分
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

    # 计算依赖数量
    if [ -f "requirements.txt" ]; then
        dependency_count=$(grep -cE "^[a-zA-Z]" requirements.txt 2>/dev/null || echo 0)
    fi

    if [ -f "pyproject.toml" ]; then
        # 简单统计 pyproject.toml 中的依赖
        dependency_count=$(grep -cE "^\s*\"[a-zA-Z]" pyproject.toml 2>/dev/null || echo 0)
    fi

    # 评估依赖数量是否过多
    if [ "$dependency_count" -gt 50 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量过多" "${dependency_count}个依赖" "评估必要性，移除冗余"
        score=$((score + 0))
        issues_count=$((issues_count + 1))
    elif [ "$dependency_count" -gt 30 ]; then
        add_issue "P2" "项目依赖" "N/A" "依赖数量偏多" "${dependency_count}个依赖" "定期清理未使用依赖"
        score=$((score + 1))
        issues_count=$((issues_count + 1))
    else
        score=$((score + 2))
    fi

    # ============================================
    # 4. 技术选型合理性检查 (1分)
    # ============================================

    local tech_selection_issues=0

    # 检查项目规模与技术栈匹配度（简单检测）
    local file_count=$(find . -name "*.py" -not -path "*/tests/*" -not -path "*/.venv/*" 2>/dev/null | wc -l | tr -d ' ')

    # 小项目（<20文件）使用复杂框架
    if [ "$file_count" -lt 20 ]; then
        if [ "$has_django" -eq 1 ]; then
            add_issue "P2" "项目结构" "N/A" "小项目使用重型框架" "Django(${file_count}文件)" "考虑轻量级框架如Flask"
            tech_selection_issues=$((tech_selection_issues + 1))
        fi
    fi

    # 检查是否过度依赖第三方库（自研代码比例过低）
    if [ "$dependency_count" -gt 0 ] && [ "$file_count" -gt 0 ]; then
        local ratio=$((dependency_count * 100 / file_count))

        if [ "$ratio" -gt 100 ]; then
            add_issue "P2" "项目依赖" "N/A" "过度依赖第三方库" "依赖:${dependency_count},文件:${file_count}" "增加自研代码比例"
            tech_selection_issues=$((tech_selection_issues + 1))
        fi
    fi

    # 计算技术选型得分
    if [ "$tech_selection_issues" -eq 0 ]; then
        score=$((score + 1))
    else
        score=$((score + 0))
        issues_count=$((issues_count + tech_selection_issues))
    fi

    echo "$score:$issues_count"
}

# 执行检查
check_python_tech_stack