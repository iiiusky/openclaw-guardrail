# 贡献指南

感谢你对 OpenClaw 安全围栏系统的关注！欢迎任何形式的贡献。

## 如何贡献

### 报告问题

- 使用 [Issues](../../issues) 提交 Bug 或功能建议
- 请包含：复现步骤、期望行为、实际行为、环境信息（OS、OpenClaw 版本、插件版本）

### 提交代码

1. Fork 仓库
2. 创建分支：`git checkout -b feat/your-feature`
3. 编写代码和测试
4. 确保构建通过：
   ```bash
   # 前端
   cd web && npm run build

   # 服务端
   cd server && python3 -m py_compile main.py

   # 插件 TypeScript 检查
   cd openclaw-guardrail-plugin && npx tsc --noEmit
   ```
5. 提交：`git commit -m "feat: 你的改动描述"`
6. 推送并创建 Pull Request

### Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `refactor:` 重构（不改变行为）
- `chore:` 构建/工具/依赖变更

### 代码风格

- **TypeScript (插件)**：无 `as any`、无 `@ts-ignore`、使用严格类型
- **Python (服务端)**：遵循 PEP 8，函数有类型标注
- **Vue (前端)**：`<script setup lang="ts">` + Composition API，Naive UI 组件显式导入
- **Shell (脚本)**：`set -eo pipefail`，非 DEBUG 模式精简输出

## 项目结构

| 目录 | 说明 | 语言 |
|------|------|------|
| `openclaw-guardrail-plugin/` | OpenClaw 插件 | TypeScript |
| `openclaw-guardrail/` | 安全体检 Skill | Markdown |
| `server/` | 安全围栏服务端 | Python (FastAPI) |
| `web/` | 管理后台 | Vue 3 + Naive UI |
| `tools/` | 辅助工具 | Python |

## 开发环境搭建

### 服务端

```bash
cd server
uv sync              # 安装依赖
uv run uvicorn main:app --reload --port 9720
```

需要 MySQL 和 Redis。可用 Docker：

```bash
docker compose up mysql redis -d
```

### 前端

```bash
cd web
npm install
npm run dev          # 自动代理到 http://127.0.0.1:80
```

### 插件

插件是 TypeScript 源码，由 OpenClaw 运行时直接加载（不需要编译）。修改后重启 Gateway 生效：

```bash
openclaw gateway restart
```

## 安全漏洞

如果你发现安全漏洞，**请勿公开提交 Issue**。请通过以下方式私下报告：

- 在 [Issues](../../issues) 中创建标题以 `[Security]` 开头的 Issue，并标记为 `security` 标签
- 请勿在 Issue 中包含完整的漏洞利用细节，仅描述问题概要

我们会在 48 小时内确认收到，并在 7 天内提供修复计划。

## 许可证

贡献的代码将遵循本项目的 [BSL 1.1](LICENSE) 许可证。
