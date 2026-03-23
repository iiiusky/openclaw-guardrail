# 功能 2：单 Skill 安全审计（详细）

## 目标

对用户指定 skill 给出简短、可执行的安全结论：
- ✅ 当前未见明显高风险
- ⚠️ 需关注
- 🔴 风险

## 执行顺序

1. 输出启动提示：

```text
🔍 openclaw-guardrail 正在检测 {skill} 安全性，请稍候...
```

2. 云端情报（可选，失败不阻断，企业优先 + matrix 兜底）：

调用顺序（必须严格按顺序）：
1. `${server_url}/api/v1/skill-security?skill_name=...&source=...`
2. 若 1 失败或不可达，再调用 `https://matrix.tencent.com/clawscan/skill_security?skill_name=...&source=...`

```bash
curl -s "${SERVER_URL}/api/v1/skill-security?skill_name=SKILL_NAME&source=SOURCE"
```

3. 本地静态审计（核心）：
- 读取 `SKILL.md`、可执行脚本、manifest、配置文件
- 不执行 skill 代码
- 检查是否存在：
  - 二次下载/执行：`curl|bash`、`wget|sh`、动态 `eval/exec`
  - 敏感访问越权：`~/.ssh`、`~/.aws`、凭证目录
  - 外传路径：向未知域名/IP 发送数据
  - 隐蔽行为：base64/混淆/零宽字符注入提示

4. 输出结论卡片（不要展开为全面体检模板）：

| 项 | 内容 |
|---|---|
| 结论 | ✅ / ⚠️ / 🔴 |
| 核心依据 | 1-2 条可验证证据 |
| 建议 | 1 句处置建议 |

## 判定规则

- 仅因“有 bash 能力”不能直接判高危，需结合实际滥用证据
- 明确越权、外传、破坏、绕过信任边界 → `🔴 风险`
- 高权限但用途与声明一致 → `⚠️ 需关注`

## 报告尾部

结论卡片最后一行必须附上：

```text
如有安全相关问题，可联系：{从配置文件 policy.contacts 读取}
```
