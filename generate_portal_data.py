#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
门户部署入口（本机）
====================
这个文件不再自己解析 Markdown，也不再自己维护前端副本。

原来有两条独立的生成链路：
  portal/generate.py            → GitHub Actions 用
  记忆库门户/generate_portal_data.py → 本机 hooks 用
两边各写一份 data.json、各带一套前端，任何一边改了不同步，就会把线上
覆盖回旧版（用户看到的「记忆库又变回原样了」）。

现在只有一条：
  1. 调用 portal/generate.py（唯一生成逻辑），输出到本目录
  2. 把 portal/ 的前端文件同步过来（唯一前端来源）
  3. git 提交并推送

用法：
  python generate_portal_data.py            # 生成 + 加密 + 同步 + 推送
  python generate_portal_data.py --no-push  # 只生成 + 加密 + 同步
"""
import os
import sys
import shutil
import subprocess

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
VAULT = os.path.dirname(HERE)
SOURCE_DIR = os.path.join(VAULT, "portal")
SOURCE_GEN = os.path.join(SOURCE_DIR, "generate.py")
NO_PUSH = "--no-push" in sys.argv

# 前端只有 portal/ 这一份来源；顺序无关，缺文件只警告不中断
FRONTEND_FILES = ["index.html", "app.js", "styles.css", "crypto.js",
                  "graph-data.js", "graph.js"]


def run_generator():
    if not os.path.isfile(SOURCE_GEN):
        print(f"[错误] 找不到唯一生成器：{SOURCE_GEN}")
        return False
    env = os.environ.copy()
    env["PORTAL_OUT"] = HERE
    env["PORTAL_KEY_FILE"] = os.path.join(HERE, ".portal_key")
    # 不能用 -I：它会忽略上面注入的环境变量
    proc = subprocess.run([sys.executable, SOURCE_GEN, "--no-push"],
                          env=env, cwd=VAULT)
    return proc.returncode == 0


def sync_frontend():
    missing = []
    for name in FRONTEND_FILES:
        src = os.path.join(SOURCE_DIR, name)
        if not os.path.isfile(src):
            missing.append(name)
            continue
        dst = os.path.join(HERE, name)
        # 内容相同就不动，避免每次生成都制造无意义的 mtime 变化
        if os.path.isfile(dst):
            with open(src, "rb") as f:
                a = f.read()
            with open(dst, "rb") as f:
                b = f.read()
            if a == b:
                continue
        shutil.copy2(src, dst)
        print(f"  同步前端：{name}")
    if missing:
        print(f"⚠️ portal/ 缺少前端文件：{', '.join(missing)}（已跳过）")
    return not missing


def git_publish():
    files = FRONTEND_FILES + ["encrypted.bin", "generate_portal_data.py",
                              "README.md", ".gitignore"]
    try:
        subprocess.run(["git", "add"] + files, cwd=HERE, check=True,
                       capture_output=True, text=True)
        subprocess.run(["git", "commit", "-m", "portal update"],
                       cwd=HERE, check=True, capture_output=True, text=True)
        print("\n✅ 已本地提交")
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        if "nothing to commit" in stderr or "nothing added" in stderr:
            print("\nℹ️ 无变更，无需提交")
            return True
        print("\n⚠️ git 提交失败：", stderr[-500:])
        return False

    try:
        subprocess.run(["git", "push"], cwd=HERE, check=True,
                       capture_output=True, text=True)
        print("✅ 已推送到 GitHub，Pages 自动更新中")
        return True
    except subprocess.CalledProcessError as e:
        print("\n⚠️ git push 失败：", (e.stderr or "").strip()[-800:])
        print("   检查代理 127.0.0.1:7897 是否在运行")
        return False


def main():
    if not run_generator():
        print("\n[中止] 生成失败，不提交、不推送。")
        return 1
    if not sync_frontend():
        print("\n[中止] 前端来源不完整，不推送，避免线上缺文件。")
        return 1
    if NO_PUSH:
        print("\n[--no-push] 跳过 git 提交与推送。")
        return 0
    return 0 if git_publish() else 1


if __name__ == "__main__":
    sys.exit(main())
