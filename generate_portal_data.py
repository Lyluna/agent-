#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
记忆库加密门户数据生成器（白色门户 · 事实时间线 / 稳定认知 / 意图待办）
========================================
功能：
  1. 扫描 08-AI记忆 目录，生成明文 data.json
     - profile   画像（来自 长期背景.md）
     - facts     事实时间线（来自 对话存档/*.md，一条对话 = 一条事实）
     - beliefs   稳定认知（来自 技术决策.md）
     - intents   意图待办（来自 待办与下一步.md）
  2. 用密码（来自 .portal_key）AES-256-GCM 加密为 encrypted.bin
  3. 自动 git 提交并推送到 GitHub Pages 仓库

用法：
  python generate_portal_data.py            # 生成 + 加密 + 推送
  python generate_portal_data.py --no-push  # 只生成 + 加密，不推送

依赖：
  pycryptodome（仓库内 _pylibs/ 已自带一份，无需安装）
"""
import os
import re
import sys
import json
import glob
import subprocess
from datetime import datetime

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
SKILLS_DIR = os.path.join(VAULT, "09-技能库")
TOOLS_DIR = os.path.join(VAULT, "10-工具库")
DISTILL_DIR = os.path.join(VAULT, "11-蒸馏知识")

# 仓库内自带的依赖目录（pycryptodome），保证换机器也能加密
PYLIBS = os.path.join(PORTAL_DIR, "_pylibs")
if os.path.isdir(PYLIBS) and PYLIBS not in sys.path:
    sys.path.insert(0, PYLIBS)

# ========== 加密参数（与 index.html 保持一致）==========
PBKDF2_ITERATIONS = 310000
SALT_LEN = 16
IV_LEN = 12
TAG_LEN = 16

TOOL_MAP = {
    "workbuddy": "WorkBuddy",
    "claude code": "Claude Code",
    "claude": "Claude Code",
    "opencode": "opencode",
    "deepseek": "DeepSeek",
    "hermes": "DeepSeek Harness",
    "obsidian": "Obsidian AI",
}


def detect_tool(text):
    low = (text or "").lower()
    for k, v in TOOL_MAP.items():
        if k in low:
            return v
    return text.strip() or "其他"


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read().replace("\r\n", "\n").replace("\ufeff", "")
    except OSError:
        return ""


def parse_frontmatter(content):
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.S)
    if not m:
        return {}, content
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip().lower()] = v.strip().strip('"').strip("'")
    return meta, m.group(2)


def clean_inline(text, limit=None):
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)          # 图片
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)      # 链接
    text = re.sub(r"[*_`>#|]+", "", text)
    text = re.sub(r"\s+", " ", text).strip(" -—:：")
    if limit and len(text) > limit:
        text = text[:limit].rstrip() + "…"
    return text


# ========== 事实时间线：对话存档 ==========
def extract_fact_summary(body):
    """优先取「关键结论」；否则取最后一次助手回复的开头。"""
    m = re.search(r"#+\s*🔑\s*关键结论\s*\n(.*?)(?=\n#|\Z)", body, re.S)
    if m:
        bullets = [clean_inline(x) for x in re.findall(r"^[-*\d.]+\s+(.+)$", m.group(1), re.M)]
        bullets = [b for b in bullets if b]
        if bullets:
            return clean_inline("；".join(bullets[:3]), 200)

    parts = re.split(r"^##\s*助手回复[^\n]*\n", body, flags=re.M)
    if len(parts) > 1:
        last = parts[-1]
        last = re.split(r"\n---\n", last)[0]
        lines = []
        for line in last.splitlines():
            line = line.strip()
            if not line or line.startswith(("#", ">", "|", "---", "```")):
                continue
            lines.append(clean_inline(line))
            if len(" ".join(lines)) > 160:
                break
        if lines:
            return clean_inline(" ".join(lines), 200)

    for para in re.split(r"\n\s*\n", body):
        p = para.strip()
        if p and not p.startswith(("#", ">", "|", "---")):
            return clean_inline(p, 200)
    return "（暂无摘要，展开查看完整对话）"


def parse_archive(filepath):
    content = read_text(filepath)
    fname = os.path.basename(filepath).removesuffix(".md")
    meta, body = parse_frontmatter(content)

    # 兼容没有 frontmatter 的存档（其他 agent 生成）：从正文里找标题 / 工具 / 时间
    body_meta = {}
    if not meta:
        mh = re.search(r"^#\s+(.+)$", body, re.M)
        if mh:
            body_meta["title"] = clean_inline(mh.group(1), 80)
        mt = re.search(r"^-\s*工具[：:]\s*(.+)$", body, re.M)
        if mt:
            body_meta["tool"] = clean_inline(mt.group(1), 40)
        md = re.search(r"^-\s*(?:时间|日期)[：:]\s*(.+)$", body, re.M)
        if md:
            body_meta["created"] = clean_inline(md.group(1), 40)
        mtopic = re.search(r"^-\s*主题[：:]\s*(.+)$", body, re.M)
        if mtopic:
            body_meta["topic"] = clean_inline(mtopic.group(1), 80)
    meta = {**body_meta, **meta}

    title = meta.get("topic") or meta.get("title") or fname
    tool = detect_tool(meta.get("tool", ""))
    created = (meta.get("created") or "").strip()
    if not re.match(r"\d{4}-\d{2}-\d{2}", created):
        created = datetime.fromtimestamp(os.path.getmtime(filepath)).strftime("%Y-%m-%d %H:%M")
    status = meta.get("status", "")
    archive_type = meta.get("archive_type", "")
    if not archive_type:
        archive_type = "full" if ("完整对话记录" in content or "完整记录" in content) else "summary"

    # 去掉自动归档的头部说明，避免时间线摘要全是套话
    summary = extract_fact_summary(body)

    return {
        "date": created[:16],
        "tool": tool,
        "file": fname + ".md",   # 带扩展名：Worker 直接拼路径，前端展示时再去掉
        "title": title,
        "archive_type": archive_type,
        "status": status,
        "summary": summary,
        "detail": body.strip(),
    }


# 系统文件不是对话，不进时间线
SYSTEM_FILES = {"_已删除记录", "_索引"}


def load_facts():
    facts = []
    for filepath in glob.glob(os.path.join(ARCHIVE_DIR, "*.md")):
        name = os.path.basename(filepath).removesuffix(".md")
        if name in SYSTEM_FILES or name.startswith("_"):
            continue
        try:
            facts.append(parse_archive(filepath))
        except Exception as e:
            print(f"  [!] 跳过 {os.path.basename(filepath)}: {e}")
    facts.sort(key=lambda x: x["date"], reverse=True)
    return facts


# ========== 稳定认知：技术决策 ==========
DEFAULT_CATEGORY = "其他"


def parse_beliefs():
    content = read_text(os.path.join(MEMORY_DIR, "技术决策.md"))
    _, body = parse_frontmatter(content)
    beliefs = []
    current_date = ""
    current = None
    current_cat = ""
    buf = []

    def flush():
        nonlocal current, current_cat, buf
        if current:
            detail_lines = [clean_inline(x) for x in buf if clean_inline(x)]
            detail = "；".join(detail_lines)[:260]
            text = current + ("：" + detail if detail else "")
            confidence = 0.85
            if re.search(r"定案|定调|结论|已确认|必须|禁止", text):
                confidence = 0.95
            elif re.search(r"踩坑|报错|问题|不可用", text):
                confidence = 0.8
            beliefs.append({
                "statement": text,
                "title": current,
                "detail": detail,
                "category": current_cat or DEFAULT_CATEGORY,
                "updated": current_date,
                "confidence": confidence,
            })
        current, current_cat, buf = None, "", []

    for line in body.splitlines():
        s = line.strip()
        mdate = re.match(r"^##\s+(\d{4}-\d{2}-\d{2})\s*$", s)
        if mdate:
            flush()
            current_date = mdate.group(1)
            continue
        mh3 = re.match(r"^###\s+(.+)$", s)
        if mh3:
            flush()
            current = clean_inline(mh3.group(1), 80)
            continue
        if re.match(r"^##\s+", s):
            flush()
            continue
        # 分类写在标题下一行：分类：账号运营
        mcat = re.match(r"^分类[：:]\s*(.+)$", s)
        if current and mcat:
            current_cat = clean_inline(mcat.group(1), 20)
            continue
        if current and s:
            buf.append(s)
    flush()
    # 最新的排前面
    beliefs.sort(key=lambda b: b["updated"], reverse=True)
    return beliefs


def belief_categories(beliefs):
    """分类清单，按条目数降序；「其他」永远垫底。"""
    counts = {}
    for b in beliefs:
        c = b.get("category") or DEFAULT_CATEGORY
        counts[c] = counts.get(c, 0) + 1
    order = sorted(counts.items(),
                   key=lambda kv: (kv[0] == DEFAULT_CATEGORY, -kv[1], kv[0]))
    return [{"name": k, "count": v} for k, v in order]


# ========== 意图待办 ==========
# 三态，靠 待办与下一步.md 的行尾标记区分：
#   - [ ] 任务                        待办
#   - [x] 任务                        已完成，等你确认有没有后续
#   - [x] 任务 〔已结案 2026-10-22〕   已确认无后续，归档
CLOSED_RE = re.compile(r"〔已结案\s*(\d{4}-\d{2}-\d{2})〕")


def parse_intents():
    """解析待办。支持两种小标题：
      ### 高优先级 / 中优先级 / 低优先级   —— 定优先级
      ### 知识库结构                      —— 在所属优先级下再分组
    「## 下一步计划」之类的非优先级章节整块忽略。
    """
    content = read_text(os.path.join(MEMORY_DIR, "待办与下一步.md"))
    _, body = parse_frontmatter(content)
    intents = []
    current = None    # high / mid / low
    group = ""        # 子分组名，空表示直接挂在优先级下
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("### 高优先级"):
            current, group = "high", ""
        elif s.startswith("### 中优先级"):
            current, group = "mid", ""
        elif s.startswith("### 低优先级"):
            current, group = "low", ""
        elif s.startswith("### "):
            # 其他小标题：仍属于上一个优先级，作为分组名
            group = clean_inline(s[4:], 30) if current else ""
        elif s.startswith("## "):
            current, group = None, ""
        elif current:
            m = re.match(r"^-\s*\[( |x|X)\]\s*(.+)$", s)
            if m:
                raw = m.group(2).strip()
                mc = CLOSED_RE.search(raw)
                intents.append({
                    "task": clean_inline(CLOSED_RE.sub("", raw), 240),
                    "priority": current,
                    "group": group,
                    "done": m.group(1).lower() == "x",
                    "closed": bool(mc),
                    "closed_at": mc.group(1) if mc else "",
                })
    order = {"high": 0, "mid": 1, "low": 2}
    # 待办 → 待确认结案 → 已结案；同组内保持文件顺序
    intents.sort(key=lambda i: (
        i["closed"], i["done"], order.get(i["priority"], 9)))
    return intents


# ========== 画像 ==========
def parse_profile():
    content = read_text(os.path.join(MEMORY_DIR, "长期背景.md"))
    _, body = parse_frontmatter(content)

    def grab(pattern):
        m = re.search(pattern, body)
        return clean_inline(m.group(1), 120) if m else ""

    name = grab(r"\*\*姓名\*\*[：:]\s*(.+)")
    role = grab(r"\*\*职业\*\*[：:]\s*(.+)")
    focus = grab(r"\*\*主要工作\*\*[：:]\s*(.+)")

    tools = []
    for line in body.splitlines():
        m = re.match(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|", line)
        if m and "工具" not in m.group(1) and "---" not in m.group(1):
            tools.append({"name": m.group(1), "usage": m.group(2)})

    def section_bullets(title):
        m = re.search(r"^##\s*" + re.escape(title) + r"\s*\n(.*?)(?=\n##\s|\Z)", body, re.S | re.M)
        if not m:
            return []
        items = []
        for line in m.group(1).splitlines():
            s = line.strip()
            mb = re.match(r"^[-*]\s+(.+)$", s)
            mn = re.match(r"^\d+\.\s+(.+)$", s)
            if mb or mn:
                items.append(clean_inline((mb or mn).group(1), 100))
        return items

    return {
        "name": name or "用户",
        "role": " · ".join(x for x in [role, focus] if x) or "开发者",
        "focus": focus,
        "tools": tools,
        "preferences": section_bullets("沟通偏好"),
        "rules": section_bullets("需要 AI 记住的规则"),
    }


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
    from Crypto.Hash import SHA256

    salt = os.urandom(SALT_LEN)
    iv = os.urandom(IV_LEN)
    key = PBKDF2(password.encode("utf-8"), salt, dkLen=32,
                 count=PBKDF2_ITERATIONS, hmac_hash_module=SHA256)
    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
    ct, tag = cipher.encrypt_and_digest(plaintext)
    return salt + iv + tag + ct


# ========== 主流程 ==========
def parse_md_table_rows(path, section_title):
    """读索引页指定章节下的第一个 Markdown 表格，返回 (表头, [{列名: 值}])。"""
    content = read_text(path)
    if not content:
        return [], []
    m = re.search(r"^##\s*" + re.escape(section_title) + r"\s*\n(.*?)(?=^##\s|\Z)",
                  content, re.S | re.M)
    if not m:
        return [], []
    header, rows = [], []
    for line in m.group(1).splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [clean_inline(c, 300) for c in s.strip("|").split("|")]
        if not header:
            header = cells
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        if len(cells) != len(header):
            continue
        rows.append(dict(zip(header, cells)))
    return header, rows


def load_sections():
    """技能库 / 工具库 / 蒸馏知识 三个板块的索引表格。"""
    def one(dirpath, index_name, title):
        path = os.path.join(dirpath, index_name)
        header, rows = parse_md_table_rows(path, title)
        # 跳过「（待登记）」「（待沉淀）」这类占位行
        rows = [r for r in rows
                if not all(("待" in v or not v) for v in list(r.values())[:2])]
        return {"header": header, "rows": rows, "count": len(rows)}

    return {
        "skills": one(SKILLS_DIR, "技能库索引.md", "已登记技能"),
        "tools": one(TOOLS_DIR, "工具库索引.md", "已登记工具"),
        "distilled": one(DISTILL_DIR, "蒸馏知识索引.md", "知识条目"),
    }


def strip_code(text):
    """去掉代码块与行内代码。示例里的 [[双链]] 不是真链接。"""
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"`[^`\n]*`", "", text)
    return text


def read_frontmatter(text):
    """只读 YAML frontmatter 的顶层标量，不引入 yaml 依赖。"""
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if mm:
            out[mm.group(1)] = mm.group(2).strip().strip('"').strip("'")
    return out


def load_relations(facts):
    """从真实项目/知识笔记提取显式双链。只记链接事实，不做相似度推断。

    三条硬规则：
    1. 代码块/行内代码里的 [[...]] 是举例，不算关系
    2. 表格里 [[路径\\|别名]] 的反斜杠转义要还原，否则会造出幽灵节点
    3. 项目节点必须 frontmatter type == "项目"，索引与收件箱不是项目
    """
    fact_by_stem = {f["file"][:-3].lower(): f["title"] for f in facts}
    roots = [(os.path.join(VAULT, "04-项目"), "project"),
             (DISTILL_DIR, "knowledge")]
    documents = []
    for root, kind in roots:
        for filepath in glob.glob(os.path.join(root, "**", "*.md"), recursive=True):
            name = os.path.basename(filepath)
            if name.startswith("_") or name in ("蒸馏知识索引.md", "README.md"):
                continue
            stem = os.path.splitext(name)[0]
            raw = read_text(filepath)
            meta = read_frontmatter(raw)
            if kind == "project":
                # 索引、收件箱、方案草稿都不是项目本体
                if meta.get("type") != "项目":
                    continue
                if stem.startswith("收件箱"):
                    continue
            documents.append((kind, stem, raw, meta,
                              os.path.relpath(filepath, VAULT).replace("\\", "/")))

    known = {}
    for kind, stem, _, _, _ in documents:
        known[stem.lower()] = (kind, stem)

    # 全库 md 索引：目标只要是真实笔记，就允许连边（不再限制在项目/知识集合内）
    vault_stems = {}
    for filepath in glob.glob(os.path.join(VAULT, "**", "*.md"), recursive=True):
        if any(part in (".git", "_pylibs", "__pycache__") for part in filepath.split(os.sep)):
            continue
        stem = os.path.splitext(os.path.basename(filepath))[0]
        vault_stems.setdefault(stem.lower(), stem)
    # 事实存档与项目/知识笔记同名的，优先按事实处理
    nodes, links, seen = [], [], set()
    skipped = {"code": 0, "missing": 0}
    for kind, stem, raw, meta, path in documents:
        node = {"kind": kind, "title": stem, "source": path}
        if meta.get("status"):
            node["status"] = meta["status"]
        nodes.append(node)
        for raw_link in re.findall(r"\[\[([^\]]+)\]\]", strip_code(raw)):
            # 表格转义：[[路径\|别名]] -> 路径|别名
            cleaned = raw_link.replace("\\|", "|")
            target = cleaned.split("|", 1)[0].split("#", 1)[0].strip()
            if not target:
                continue
            key = target.split("/")[-1].removesuffix(".md").lower()
            if not key:
                continue
            if key in fact_by_stem:
                dest = {"kind": "fact", "title": fact_by_stem[key]}
            elif key in known:
                dest = {"kind": known[key][0], "title": known[key][1]}
            elif key in vault_stems:
                # 真实笔记但不在项目/知识集合：作为「关联笔记」连边
                dest = {"kind": "note", "title": vault_stems[key]}
            else:
                # 目标在整个库都不存在：不造假节点
                skipped["missing"] += 1
                continue
            edge = (kind, stem, dest["kind"], dest["title"])
            if edge not in seen:
                seen.add(edge)
                links.append({"sourceKind": kind, "sourceTitle": stem,
                              "targetKind": dest["kind"], "targetTitle": dest["title"],
                              "kind": "显式双链"})
    print(f"真实关系：{len(nodes)} 篇项目/知识笔记 · {len(links)} 条显式关联"
          f"（跳过 {skipped['missing']} 条指向不存在目标的链接）")
    return {"nodes": nodes, "links": links}


def main():
    no_push = "--no-push" in sys.argv

    facts = load_facts()
    in_progress = sum(1 for f in facts if f["status"] == "进行中")
    print(f"事实时间线：{len(facts)} 条（进行中 {in_progress}）")

    beliefs = parse_beliefs()
    cats = belief_categories(beliefs)
    print(f"稳定认知：{len(beliefs)} 条（{len(cats)} 个分类）")

    intents = parse_intents()
    pending = sum(1 for i in intents if not i["done"])
    to_confirm = sum(1 for i in intents if i["done"] and not i["closed"])
    print(f"意图待办：{len(intents)} 条（未完成 {pending}，待确认结案 {to_confirm}）")

    profile = parse_profile()
    print(f"画像：{profile['name']} · {profile['role']}")

    sections = load_sections()
    print(f"技能库：{sections['skills']['count']} 项 / 工具库：{sections['tools']['count']} 项 / "
          f"蒸馏知识：{sections['distilled']['count']} 条")

    data = {
        "updated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "profile": profile,
        "facts": facts,
        "beliefs": beliefs,
        "beliefCategories": cats,
        "intents": intents,
        "relations": load_relations(facts),
        "sections": sections,
    }

    # 最后一道防线：历史存档或外部 agent 写入的内容可能带明文密码，推送前统一脱敏
    try:
        sys.path.insert(0, os.path.join(MEMORY_DIR, "tools"))
        from sanitize_lib import sanitize_obj
        data = sanitize_obj(data)
    except Exception as e:
        print(f"⚠️ 脱敏模块不可用，跳过：{e}")

    os.makedirs(PORTAL_DIR, exist_ok=True)
    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n✅ 明文 data.json 已生成：{DATA_JSON} "
          f"({os.path.getsize(DATA_JSON) / 1024:.0f} KB)")

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

    try:
        subprocess.run(
            # 注意：serve_portal.py 是本地可写服务，含写文件逻辑，**不上传**。
            ["git", "add", "index.html", "styles.css", "app.js", "crypto.js",
             "graph-data.js", "graph.js", "encrypted.bin",
             "generate_portal_data.py", "README.md", ".gitignore"],
            cwd=PORTAL_DIR, check=True, capture_output=True, text=True)
        subprocess.run(
            ["git", "commit", "-m", f"portal update {data['updated']}"],
            cwd=PORTAL_DIR, check=True, capture_output=True, text=True)
        print("\n✅ 已本地提交")
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        if "nothing to commit" in stderr or "nothing added" in stderr:
            print("\nℹ️ 无变更，无需提交")
        else:
            print("\n⚠️ git 提交失败：", stderr[-500:])

    try:
        subprocess.run(["git", "push"], cwd=PORTAL_DIR,
                       check=True, capture_output=True, text=True)
        print("✅ 已推送到 GitHub，Pages 自动更新中")
    except subprocess.CalledProcessError as e:
        print("\n⚠️ git push 失败：", (e.stderr or "").strip()[-800:])
        print("   请先完成首次 git 授权（见 记忆库门户/README.md）")


if __name__ == "__main__":
    main()
