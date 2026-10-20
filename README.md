# 🔐 记忆库加密门户

这是你的个人记忆库网页门户。所有 AI agent（Claude Code / opencode / WorkBuddy / DeepSeek）的对话、决策、待办都会汇总到这里。

## 多重加密

1. **HTTPS**：GitHub Pages 提供传输加密
2. **私有仓库**：源代码仓库为 Private
3. **AES-256-GCM 内容加密**：数据文件 `encrypted.bin` 用密码加密，服务端只有密文；浏览器端用 Web Crypto API 解密，密码不会发送到任何服务器

## 工作原理

```
对话归档 → generate_portal_data.py → data.json（明文，仅本地）
                                    → encrypted.bin（加密，上传）
                                    → git push → GitHub Pages 自动发布
```

## 使用方法

### 首次部署

1. 在 GitHub 创建私有仓库 `agent-`（已存在：https://github.com/Lyluna/agent-）
2. 在本目录执行 git 初始化并推送（见下）
3. 在 GitHub 仓库 Settings → Pages → Source 选择 `main` 分支 `/root` 保存

### 设置密码

创建文件 `记忆库门户\.portal_key`，内容为一行密码（不要带换行以外的字符）。

```bash
echo "你的密码" > .portal_key
```

密码保存在本地，不会上传。生成加密数据时用它加密；打开网页时输入同一个密码。

### 更新门户

每次对话归档后，运行：

```bash
python "C:\Users\叶伟峰\Documents\MyVault\记忆库门户\generate_portal_data.py"
```

脚本会自动：扫描记忆库 → 生成明文 data.json → AES-256-GCM 加密 → git 提交 → git push → GitHub Pages 自动更新。

### 推送命令

```bash
cd "C:\Users\叶伟峰\Documents\MyVault\记忆库门户"
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/Lyluna/agent-.git
git push -u origin main
```

> 首次推送时，Git Credential Manager 会弹出窗口，用浏览器登录 GitHub 授权（GitHub 已不支持密码推送，请使用 Personal Access Token 或浏览器登录）。

## 文件说明

| 文件 | 说明 |
| ---- | ---- |
| `index.html` | 门户页面（密码锁 + 解密 + 总览） |
| `encrypted.bin` | 加密后的记忆数据（上传到 GitHub） |
| `data.json` | 明文数据（仅本地，gitignore） |
| `generate_portal_data.py` | 生成 + 加密 + 推送脚本 |
| `.portal_key` | 门户密码（仅本地，gitignore） |
| `.gitignore` | 忽略敏感文件 |
