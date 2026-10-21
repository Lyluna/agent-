# 🔐 共享记忆库 · 加密门户

所有 AI agent（Claude Code / opencode / WorkBuddy / DeepSeek）共享的单一记忆源。
白色主题网页门户，按三层记忆组织：

| 板块 | 来源 | 说明 |
| --- | --- | --- |
| **画像** | `长期背景.md` | 你是谁、用什么工具、沟通偏好、记忆规则 |
| **事实时间线** | `对话存档/*.md` | 每次对话 = 一条事实，可展开看完整对话 |
| **稳定认知** | `技术决策.md` | 沉淀下来的技术结论、踩坑、已确认做法 |
| **意图待办** | `待办与下一步.md` | 下一步要做的事（高/中/低 + 完成状态） |

## 自动归档（不用再提醒 AI「记住进度」）

Claude Code 通过全局 hooks 自动归档，配置在 `C:\Users\叶伟峰\.claude\settings.json`：

| Hook | 触发时机 | 动作 |
| --- | --- | --- |
| `Stop` | 每轮回复结束 | 把完整对话写入/更新 `08-AI记忆/对话存档/对话存档-YYYY-MM-DD-HHmm.md` |
| `StopFailure` | 回复异常中断 | 同上，尽量保住已发生的对话 |
| `PreCompact` | 上下文压缩前 | 压缩前先落盘 |
| `SessionEnd` | 会话结束 | 标记「已归档」+ 写对话日志 + 同步门户 |
| `SessionStart` | 新会话开始 | 兜底扫描最近活跃会话，补归档 |

- 同一会话始终写同一个文件，每轮覆盖为最新完整内容，所以**中断后不会丢**。
- 存档状态为「进行中」时，门户时间线会显示绿色圆点 + 「进行中」标签。
- 也可以手动补跑：`python "C:\Users\叶伟峰\Documents\MyVault\08-AI记忆\tools\auto_archive.py" --scan`

## 多重加密

1. **HTTPS**：GitHub Pages 提供传输加密
2. **AES-256-GCM 内容加密**：`encrypted.bin` 用密码加密，服务端只有密文
3. **浏览器端解密**：密码不发送到任何服务器
4. **密码只存本地**：`.portal_key`（gitignore，不上传）

## 本地预览

双击 `打开本地门户.bat` → 自动起本地服务器并打开浏览器 → 输入 `.portal_key` 里的密码。
（直接双击 `index.html` 时浏览器会因 file:// 限制无法读取 `encrypted.bin`。）

在线地址：https://lyluna.github.io/agent-/

## 更新门户

每次归档后，`auto_archive.py` 会自动（最多每 10 分钟一次）运行：

```bash
python "C:\Users\叶伟峰\Documents\MyVault\记忆库门户\generate_portal_data.py"
```

脚本：扫描记忆库 → 生成 `data.json` → AES-256-GCM 加密 → git 提交 → git push → Pages 自动更新。

只想本地更新、不推送：

```bash
python "C:\Users\叶伟峰\Documents\MyVault\记忆库门户\generate_portal_data.py" --no-push
```

> 推送失败通常是本地代理没开。git 配置走 `127.0.0.1:7897`，开启代理后再运行一次即可。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.html` | 白色门户（密码锁 + 客户端解密 + 三板块视图） |
| `encrypted.bin` | 加密后的记忆数据（上传到 GitHub） |
| `data.json` | 明文数据（仅本地，gitignore） |
| `generate_portal_data.py` | 生成 + 加密 + 推送脚本 |
| `打开本地门户.bat` | 本地预览入口（自动起 HTTP 服务） |
| `.portal_key` | 门户密码（仅本地，gitignore） |
| `_pylibs/` | 自带的 pycryptodome，换机器也能加密 |
