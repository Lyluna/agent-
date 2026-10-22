#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
记忆库门户 · 本地服务（可写版）
========================================
比 `python -m http.server` 多两件事：
  1. 提供静态文件（index.html / styles.css / app.js / crypto.js / encrypted.bin）
  2. POST /api/close  → 把待办标记为「已结案」，写回 待办与下一步.md，并重新生成加密数据

安全边界：
  - 只监听 127.0.0.1，局域网内其他机器连不上
  - 只接受同源 POST（校验 Origin / Referer 主机名），挡掉网页跨站伪造
  - 只改 待办与下一步.md 里**精确匹配**的那一行，不做模糊替换
  - 不读也不返回 .portal_key，密码始终只在浏览器里

用法：
  python serve_portal.py            # 默认 8765
  python serve_portal.py 8888       # 指定端口
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PORTAL_DIR = os.path.dirname(os.path.abspath(__file__))
VAULT = os.path.dirname(PORTAL_DIR)
TODO_FILE = os.path.join(VAULT, "08-AI记忆", "待办与下一步.md")
GEN_SCRIPT = os.path.join(PORTAL_DIR, "generate_portal_data.py")

CLOSED_RE = re.compile(r"〔已结案\s*\d{4}-\d{2}-\d{2}〕")
TASK_RE = re.compile(r"^(\s*-\s*\[)( |x|X)(\]\s*)(.+)$")


def clean(text):
    """和生成器同口径的清洗，用来比对前端传来的任务文本。"""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[*_`>#|]+", "", text)
    return re.sub(r"\s+", " ", text).strip(" -—:：")


def close_task(task_text):
    """把匹配的那一行标记为已结案。返回 (是否成功, 说明)。"""
    if not os.path.exists(TODO_FILE):
        return False, "找不到 待办与下一步.md"

    want = clean(task_text)
    with open(TODO_FILE, "r", encoding="utf-8") as f:
        lines = f.read().split("\n")

    today = datetime.now().strftime("%Y-%m-%d")
    hits = 0
    for i, line in enumerate(lines):
        m = TASK_RE.match(line)
        if not m:
            continue
        body = m.group(4).strip()
        if CLOSED_RE.search(body):
            continue                      # 已经结案过
        if clean(CLOSED_RE.sub("", body)) != want:
            continue                      # 只认精确匹配
        lines[i] = line.rstrip() + " 〔已结案 " + today + "〕"
        hits += 1
        break

    if not hits:
        return False, "待办里没找到这一条（可能已被改动，刷新页面试试）"

    with open(TODO_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return True, "已结案"


def regenerate():
    """重新生成 data.json + encrypted.bin，不推送。"""
    try:
        r = subprocess.run([sys.executable, GEN_SCRIPT, "--no-push"],
                           cwd=PORTAL_DIR, capture_output=True, text=True,
                           timeout=180)
        return r.returncode == 0, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return False, "生成超时"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PORTAL_DIR, **kw)

    def log_message(self, fmt, *args):
        pass                              # 不刷屏

    def _same_origin(self):
        """挡掉别的网站偷偷 POST 过来改文件。"""
        ref = self.headers.get("Origin") or self.headers.get("Referer") or ""
        if not ref:
            return True                   # curl 等本机工具，没有 Origin
        host = urlparse(ref).hostname or ""
        return host in ("127.0.0.1", "localhost", "::1")

    def do_GET(self):
        if self.path == "/api/status":
            self._json({"writable": True, "port": self.server.server_address[1]})
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/close":
            self.send_error(404)
            return
        if not self._same_origin():
            self.send_error(403, "cross-origin")
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.send_error(400, "bad json")
            return

        task = (payload.get("task") or "").strip()
        if not task:
            self._json({"ok": False, "error": "缺少 task"}, 400)
            return

        ok, msg = close_task(task)
        if not ok:
            self._json({"ok": False, "error": msg}, 409)
            return

        gen_ok, log = regenerate()
        self._json({"ok": True, "regenerated": gen_ok,
                    "log": log[-400:] if not gen_ok else ""})

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("记忆库门户已启动：http://127.0.0.1:%d/" % port)
    print("  可写模式已开启 —— 待办「确认无后续」会直接写回 markdown")
    print("  关闭此窗口即停止")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
