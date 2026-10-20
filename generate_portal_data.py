#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
记忆库加密门户数据生成器
========================================
功能：
  1. 扫描 08-AI记忆 目录，生成明文 data.json（对话存档/技术决策/待办）
  2. 用密码（来自 .portal_key）AES-256-GCM 加密为 encrypted.bin
  3. 自动 git 提交并推送到 GitHub Pages 仓库

用法：
  python generate_portal_data.py          # 生成 + 加密 + 推送
  python generate_portal_data.py --no-push  # 只生成 + 加密，不推送

依赖：
  pip install pycryptodome
"""
import os
import re
import sys
import json
import glob
import base64
import subprocess
from datetime import datetime

# Windows 控制台 UTF-8 输出（修复 GBK 编码崩溃）
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ========== 路径配置 ==========
VAULT = r"C:\Users\叶伟峰\Documents\MyVault"
MEMORY_DIR = os.path.join(VAULT, "08-AI记忆")
ARCHIVE_DIR = os.path.join(MEMORY_DIR, "对话存档")
PORTAL_DIR = os.path.join(VAULT, "记忆库门户")
DATA_JSON = os.path.join(PORTAL_DIR, "data.json")
ENC_BIN = os.path.join(PORTAL_DIR, "encrypted.bin")
KEY_FILE = os.path.join(PORTAL_DIR, ".portal_key")

# ========== 加密参数（与 index.html 保持一致）==========
PBKDF2_ITERATIONS = 310000
SALT_LEN = 16
IV_LEN = 12
TAG_LEN = 16

# ========== 工具识别 ==========
TOOL_MAP = {
    "workbuddy": "WorkBuddy",
    "claude code": "Claude Code",
    "claude": "Claude Code",
    "opencode": "opencode",
    "deepseek": "DeepSeek",
    "deepseek harness": "DeepSeek Harness",
    "hermes": "DeepSeek Harness",
    "obsidian": "Obsidian AI",
}


def detect_tool(text):
    low = text.lower()
    for k, v in TOOL_MAP.items():
        if k in low:
            return v
    return "其他"


def parse_frontmatter(content):
    """解析 frontmatter，返回 (meta_dict, body)"""
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.S)
    if not m:
        return {}, content
    fm, body = m.group(1), m.group(2)
    meta = {}
    for line in fm.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip().lower()] = v.strip()
    return meta, body


def parse_archive(filepath):
    """解析单个对话存档，返回门户展示字段"""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    fname = os.path.basename(filepath).replace(".md", "")
    meta, body = parse_frontmatter(content)

    title = meta.get("title") or meta.get("topic") or fname
    tool = detect_tool(meta.get("tool", ""))
    created = meta.get("created", "")[:16]

    # 判断是否完整版：优先读 frontmatter 的 archive_type 字段
    archive_type = meta.get("archive_type", "")
    if not archive_type:
        is_full = ("完整对话记录" in content) or ("完整记录" in content)
        archive_type = "full" if is_full else "summary"

    # 提取摘要/详情
    if archive_type == "full":
        # 完整版：detail 为全文，summary 取开头几句
        summary = "（完整对话存档，展开查看全文）"
        detail = body.strip()
    else:
        # 摘要版：detail 为正文
        summary = "（摘要版存档，原始对话未保留）"
        detail = body.strip()

    return {
        "date": created or datetime.now().strftime("%Y-%m-%d %H:%M"),
        "tool": tool,
        "file": fname,
        "title": title,
        "archive_type": archive_type,
        "summary": summary,
        "detail": detail,
    }


def extract_sections(filepath, section_titles):
    """读取 md，按 ### 标题提取 section 内容"""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    items = []
    current_title = None
    current_body = []
    for line in content.splitlines():
        if line.startswith("### "):
            if current_title:
                items.append((current_title, " ".join(current_body).strip()))
            current_title = line[4:].strip()
            current_body = []
        elif current_title and line.strip() and not line.startswith("#"):
            current_body.append(line.strip())
    if current_title:
        items.append((current_title, " ".join(current_body).strip()))
    return items


def extract_todos(filepath):
    todos = {"high": [], "mid": [], "low": []}
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    current = None
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("### 高优先级"):
            current = "high"
        elif line.startswith("### 中优先级"):
            current = "mid"
        elif line.startswith("### 低优先级"):
            current = "low"
        elif line.startswith("### "):
            current = None
        elif current and line.startswith("- [ ]"):
            todos[current].append(line[5:].strip())
    return todos


# ========== 加密 ==========
def get_password():
    if not os.path.exists(KEY_FILE):
        print("[错误] 未找到密码文件 .portal_key")
        print(f"  请先创建 {KEY_FILE}，内容为门户解密密码（一行纯文本）。")
        sys.exit(2)
    with open(KEY_FILE, "r", encoding="utf-8") as f:
        pwd = f.read().strip()
    if not pwd or pwd.startswith("#"):
        print("[错误] .portal_key 内容为空或为注释，请填入实际密码。")
        sys.exit(2)
    return pwd


def encrypt_data(plaintext: bytes, password: str) -> bytes:
    from Crypto.Cipher import AES
    from Crypto.Protocol.KDF import PBKDF2
    from Crypto.Hash import SHA256, HMAC

    salt = os.urandom(SALT_LEN)
    iv = os.urandom(IV_LEN)
    # PBKDF2-HMAC-SHA256 派生 32 字节密钥（密码需 UTF-8 编码）
    key = PBKDF2(password.encode("utf-8"), salt, dkLen=32, count=PBKDF2_ITERATIONS, hmac_hash_module=SHA256)
    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
    ct, tag = cipher.encrypt_and_digest(plaintext)
    return salt + iv + tag + ct


# ========== 主流程 ==========
def main():
    no_push = "--no-push" in sys.argv

    print(f"扫描对话存档目录：{ARCHIVE_DIR}")
    conversations = []
    for filepath in sorted(glob.glob(os.path.join(ARCHIVE_DIR, "*.md"))):
        try:
            conv = parse_archive(filepath)
            conversations.append(conv)
            print(f"  ✅ {conv['file']} [{conv['archive_type']}] -> {conv['title']}")
        except Exception as e:
            print(f"  ⚠️ 跳过 {os.path.basename(filepath)}: {e}")

    conversations.sort(key=lambda x: x["date"], reverse=True)

    decisions = []
    for title, content in extract_sections(os.path.join(MEMORY_DIR, "技术决策.md"), []):
        decisions.append({"title": title, "content": content[:300]})
    print(f"技术决策：{len(decisions)} 条")

    todos = extract_todos(os.path.join(MEMORY_DIR, "待办与下一步.md"))
    print(f"待办：高{len(todos['high'])} 中{len(todos['mid'])} 低{len(todos['low'])}")

    data = {
        "lastUpdated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "conversations": conversations,
        "decisions": decisions,
        "todos": todos,
    }

    os.makedirs(PORTAL_DIR, exist_ok=True)
    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n✅ 明文 data.json 已生成：{DATA_JSON}")

    password = get_password()
    with open(DATA_JSON, "rb") as f:
        plaintext = f.read()
    blob = encrypt_data(plaintext, password)
    with open(ENC_BIN, "wb") as f:
        f.write(blob)
    print(f"✅ 已 AES-256-GCM 加密 -> {ENC_BIN} ({len(blob)} 字节)")

    if no_push:
        print("\n[--no-push] 跳过 git 推送。")
        return

    # git 提交 + 推送
    try:
        subprocess.run(["git", "add", "index.html", "encrypted.bin", "generate_portal_data.py", "README.md", ".gitignore"],
                       cwd=PORTAL_DIR, check=True, capture_output=True, text=True)
        subprocess.run(["git", "commit", "-m", f"portal update {data['lastUpdated']}"],
                       cwd=PORTAL_DIR, check=True, capture_output=True, text=True)
        print("\n✅ 已本地提交")
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        if "nothing to commit" in stderr or "nothing added" in stderr:
            print("\nℹ️ 无变更，无需提交")
        else:
            print("\n⚠️ git 提交失败：", stderr[-500:])

    try:
        r = subprocess.run(["git", "push"], cwd=PORTAL_DIR, check=True, capture_output=True, text=True)
        print("✅ 已推送到 GitHub，Pages 自动更新中")
    except subprocess.CalledProcessError as e:
        print("\n⚠️ git push 失败：", (e.stderr or "").strip()[-800:])
        print("   请先完成首次 git 授权（见 记忆库门户/README.md）")


if __name__ == "__main__":
    main()