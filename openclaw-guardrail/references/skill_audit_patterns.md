# Skill 供应链审计检测模式（企业版）

## 1) 命名仿冒（Typosquat）

| 技术 | 正规名 | 仿冒名 |
|------|--------|--------|
| 缺字符 | github-push | gihub-push |
| 多字符 | lodash | lodashs |
| 换字符 | code-reviewer | code-reveiw |
| 同形字 | babel | babe1 |
| 作用域混淆 | @types/node | @tyeps/node |

## 2) 危险权限组合

| 组合 | 风险 |
|------|------|
| network + fileRead | CRITICAL |
| network + shell | CRITICAL |
| shell + fileWrite | HIGH |
| 四权限全开 | CRITICAL |

## 3) Prompt Injection 模式

### 立即阻断（Critical）
- Ignore previous instructions / Forget everything above
- You are now / Your new role is
- System prompt override / Admin mode activated
- `[SYSTEM]` / `[ADMIN]` / `[ROOT]`

### 高风险（High）
- End of system prompt / ---END---
- Safety mode: off / Debug mode: enabled
- 注释中隐藏指令、零宽字符注入

### 中风险（Medium）
- Base64/Unicode 编码指令
- JSON/YAML 中嵌入命令
- “Note to AI” 类社工诱导

## 4) 网络外传模式

### 红线（Critical）
- 裸 IP 出站
- DNS 隧道
- 非标准端口长期出站
- 动态拼接外传 URL（含 env 凭证）

### 常见外传链路
1. 读文件 -> 发外网
2. fetch(url?key=${process.env.API_KEY})
3. base64 数据放 header

## 5) 内容红线

- 引用 `~/.ssh` / `~/.aws` / `~/.env`
- 可疑执行链：`curl|bash`、`wget|sh`、`bash -i`
- 禁用安全/沙箱指令
- 未声明外部服务器通信

## 6) 风险判定

| 判定 | 条件 |
|------|------|
| ✅ SAFE | 无异常 |
| ⚠️ SUSPICIOUS | 存在可疑点但无直接威胁证据 |
| 🟠 DANGEROUS | 明显高风险行为 |
| 🔴 BLOCK | 恶意证据明确，禁止安装 |
