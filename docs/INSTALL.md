# OpenClaw Guardrail 安装与部署指南

本文档详细介绍了 OpenClaw 安全围栏系统的部署、安装及分发流程。

## 目录

1. [Docker 部署（推荐）](#1-docker-部署推荐)
2. [手动部署](#2-手动部署)
3. [插件安装（给终端用户）](#3-插件安装给终端用户)
4. [打包与分发](#4-打包与分发)
5. [环境变量参考](#5-环境变量参考)
6. [需要自定义的占位符](#6-需要自定义的占位符)
7. [常见问题](#7-常见问题)

---

## 1. Docker 部署（推荐）

这是最简单、最快捷的部署方式，适合测试和生产环境。

### 前置条件
- Docker Engine 19.03+
- Docker Compose V2

### 快速开始

只需三条命令即可启动完整服务：

```bash
# 1. 克隆代码库
git clone https://github.com/iiiusky/openclaw-guardrail.git
cd openclaw-guardrail

# 2. 启动服务 (后台运行)
docker compose up -d
```

启动后：
- **Web 管理后台**: `http://localhost`
- **服务端 API**: `http://localhost/api/v1/...`
- **数据库**: 自动创建并初始化

### 查看管理密钥

系统首次启动时会自动生成一个安全的 Admin API Key。您可以通过以下命令查看：

```bash
docker compose exec server cat /app/secret.txt
# 输出示例: 550e8400-e29b-41d4-a716-446655440000
```

使用此 Key 登录 Web 管理后台。

### 自定义配置

您可以通过环境变量覆盖默认配置：

```bash
# 示例：修改端口并设置固定 Admin Key
SERVER_PORT=8080 ADMIN_API_KEY=my-secret-key docker compose up -d
```

---

## 2. 手动部署

如果您需要更精细的控制，或者在不支持 Docker 的环境中部署，可以按照以下步骤操作。

### 前置条件
- **Python**: 3.10+
- **Node.js**: 22+ (用于构建前端)
- **MySQL**: 8.0+
- **Redis**: 7.0+ (可选，推荐安装)

### 步骤 1: 克隆代码

```bash
git clone https://github.com/iiiusky/openclaw-guardrail.git
cd openclaw-guardrail
```

### 步骤 2: 准备数据库

在 MySQL 中创建数据库：

```sql
CREATE DATABASE openclaw_security CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 步骤 3: 部署前端 (Web)

```bash
cd web

# 安装依赖并构建
npm install
npm run build

# 构建产物位于 web/dist/ 目录
# 记下此路径，稍后服务端启动需要使用
```

### 步骤 4: 部署服务端 (Server)

```bash
cd ../server

# 安装依赖 (推荐使用 uv，也可以用 pip)
pip install uv
uv sync

# 启动服务
# 请替换下面的数据库配置
MYSQL_HOST=127.0.0.1 \
MYSQL_USER=root \
MYSQL_PASSWORD=your_password \
MYSQL_DB=openclaw_security \
WEB_DIST_DIR=../web/dist \
uv run uvicorn main:app --host 0.0.0.0 --port 8000
```

访问 `http://127.0.0.1:8000` 即可看到管理后台。

---

## 3. 插件安装（给终端用户）

作为管理员，您需要将插件安装脚本分发给终端用户（开发者）。

### 获取激活 Key

1. 登录 Web 管理后台。
2. 进入 "Key 管理" 页面。
3. 生成一个新的激活 Key（Activation Key）。

### 安装命令

用户在终端执行以下命令即可安装 OpenClaw 安全围栏插件：

```bash
# 替换 <YOUR_COS_URL> 为您的插件分发地址
# 替换 <ACTIVATION_KEY> 为您生成的 Key
curl -sL https://<YOUR_COS_URL>/install.sh | KEY=<ACTIVATION_KEY> bash
```

如果您的 COS URL 尚未配置，可以直接使用本地服务地址进行测试（需确保用户能访问）：

```bash
curl -sL http://<SERVER_IP>/install.sh | KEY=<ACTIVATION_KEY> bash
```

---

## 4. 打包与分发

管理员可以使用 `package.sh` 脚本将插件打包并上传到对象存储（如腾讯云 COS、AWS S3），以便分发。

### 准备工作

- 确保已安装 `coscli` 或其他上传工具（脚本默认使用 `coscli`）。
- 确保有 COS 桶的写权限。

### 打包命令

```bash
# 语法
./package.sh --server <SERVER_URL> --enterprise <COS_BASE_URL> [--preview]

# 示例：发布正式版
./package.sh \
  --server http://security.example.com \
  --enterprise https://example-bucket.cos.ap-beijing.myqcloud.com
```

### 参数说明

- `--server`: 插件连接的安全服务端地址（终端用户需能访问此地址）。
- `--enterprise`: 用于存放插件包的 COS 基础 URL。
- `--preview`: （可选）打包为预览版，上传至 `.../openclaw-guardrail-preview/` 路径。

### 预览版 vs 正式版

- **正式版**: 路径为 `/openclaw-guardrail/`，稳定渠道。
- **预览版**: 路径为 `/openclaw-guardrail-preview/`，用于灰度测试。

---

## 5. 环境变量参考

服务端支持以下环境变量配置。在 `docker-compose.yml` 或启动命令中设置。

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ADMIN_API_KEY` | (自动生成 UUID) | 管理后台登录凭证。若未设置，首次启动会生成到 `secret.txt`。 |
| `SERVER_PORT` | `80` | 服务端监听端口 (Docker 外部映射端口)。 |
| `MYSQL_HOST` | `127.0.0.1` | MySQL 数据库地址。Docker 中通常为服务名 `mysql`。 |
| `MYSQL_PORT` | `3306` | MySQL 端口。 |
| `MYSQL_USER` | `root` | MySQL 用户名。 |
| `MYSQL_PASSWORD` | (空) | MySQL 密码。 |
| `MYSQL_DB` | `openclaw_security` | 数据库名称。 |
| `REDIS_HOST` | `127.0.0.1` | Redis 地址。留空则禁用 Redis。 |
| `REDIS_PORT` | `6379` | Redis 端口。 |
| `REDIS_PASSWORD` | (空) | Redis 密码。 |
| `COS_PLUGIN_URL` | (空) | 插件分发的 COS/CDN 根地址，用于版本检查。 |
| `WEB_DIST_DIR` | `../web/dist` | 前端构建产物目录 (绝对路径)。 |

---

## 6. 需要自定义的占位符

在部署和使用过程中，请务必替换以下占位符为您的实际值：

| 占位符 | 出现位置 | 替换为 |
|--------|----------|--------|
| `<YOUR_COS_URL>` | 安装命令, 插件配置 | 您的对象存储（COS/S3）访问域名 |
| `http://security.example.com` | 打包命令 | 您的安全服务端实际访问地址 (IP 或域名) |
| `<ACTIVATION_KEY>` | 安装命令 | 管理后台生成的有效激活 Key |
| `your_password` | 数据库配置 | 您设置的强密码 |
| `example-bucket` | COS 配置 | 您的存储桶名称 |

---

## 7. 常见问题

### Redis 不可用怎么办？

系统会自动降级。如果未配置 `REDIS_HOST` 或连接失败，将直接使用 MySQL，不影响核心功能。

### 如何查看管理密钥？

- Docker 部署：`docker compose exec server cat /app/secret.txt`
- 手动部署：查看 `server/secret.txt` 文件

### 策略在哪里配置？

登录 Web 管理后台 → 策略管理页面。策略支持版本控制，修改后自动下发给所有在线设备。数据存储在 MySQL `policy_versions` 表中。

### 插件安装后怎么验证？

在终端运行 `openclaw plugins list`，检查列表中是否包含 `openclaw-guardrail`。

### 如何查看插件日志？

需要先在管理后台的"设备策略覆盖"中开启对应开关：

- **审计日志**（开启 `audit_log`）：`~/.openclaw/openclaw-guardrail/audit/audit.jsonl`
- **通信日志**（开启 `comm_log`）：`~/.openclaw/openclaw-guardrail/logs/report_log.jsonl`
