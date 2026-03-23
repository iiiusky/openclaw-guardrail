# Zero Trust 护栏（参考 slowmist v2.8）

## 红线（命中即中断并提示人工确认）

- 破坏性命令：`rm -rf /`、`mkfs`、`dd if=` 等
- 认证篡改：改 `openclaw.json` 关键认证字段
- 敏感外发：凭证/token/私钥向外发送
- 反弹 shell：`bash -i >& /dev/tcp/...`
- 隐蔽执行：`curl|bash`、`base64 -d | sh`、`eval $(curl ...)`

## 黄线（允许执行，但需记录）

- `sudo` 操作
- 安装依赖（`pip install` / `npm install -g`）
- `docker run`
- `openclaw cron add/edit/rm`
- `chattr -i` / `chattr +i`

## 安装前静态审计最小流程

1. 先拿到文件清单（禁止直接执行）
2. 扫描二次下载与动态执行模式
3. 检查高危文件类型（二进制、压缩包、混淆载荷）
4. 命中高危即阻断安装，交由人工放行

## 定时策略说明

定时扫描与定时上报统一由插件内部调度执行，本 skill 不单独注册 cron，避免重复执行。
