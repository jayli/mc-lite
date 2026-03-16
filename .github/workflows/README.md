# GitHub Actions CI/CD 说明

本项目配置了 GitHub Actions 用于自动化代码质量检查和部署。

## 工作流说明

### 1. CI 工作流 (`ci.yml`)

**触发条件**: 每次 push 到 main/develop 分支，或创建 pull request

**执行任务**:
- **代码检查 (lint)**: 运行 ESLint 检查代码规范
- **构建检查 (build-check)**: 确保项目可以正常启动

### 2. 部署工作流 (`deploy.yml`)

**触发条件**: 每次 push 到 main 分支，或手动触发

**执行任务**:
- 运行 ESLint 检查
- 部署到 GitHub Pages

## 如何启用部署

1. 进入 GitHub 仓库设置: `Settings > Pages`
2. Source 选择 `GitHub Actions`
3. 下次 push 到 main 分支时会自动部署

## 查看运行状态

- 点击仓库首页的 Actions 标签
- 可以看到所有工作流的运行历史和日志

## 本地测试

在提交前，建议先在本地运行检查:

```bash
# 代码检查
npm run lint

# 自动修复
npm run lint:fix

# 启动服务器测试
npm start
```
