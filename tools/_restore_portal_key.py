# -*- coding: utf-8 -*-
"""从 portal_key.enc 恢复 .portal_key（需要主密码）。

用法：
    python _restore_portal_key.py

主密码不会写入任何文件，只在本进程内存中使用。
"""
import getpass
from pathlib import Path

from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Hash import SHA256

PORTAL_DIR = Path(__file__).resolve().parent.parent
ENC_FILE = PORTAL_DIR / "portal_key.enc"
KEY_FILE = PORTAL_DIR / ".portal_key"

SALT_LEN, IV_LEN, ITERATIONS = 16, 12, 310000


def main():
    if not ENC_FILE.exists():
        print("未找到 portal_key.enc")
        return 1

    master = getpass.getpass("请输入主密码：").strip()
    blob = ENC_FILE.read_bytes()
    salt, iv, tag, ct = blob[:SALT_LEN], blob[16:28], blob[28:44], blob[44:]

    key = PBKDF2(master.encode("utf-8"), salt, dkLen=32,
                 count=ITERATIONS, hmac_hash_module=SHA256)
    try:
        plaintext = AES.new(key, AES.MODE_GCM, nonce=iv).decrypt_and_verify(ct, tag)
    except ValueError:
        print("❌ 主密码错误，或文件已损坏")
        return 1

    KEY_FILE.write_bytes(plaintext)
    print("✅ 已恢复 .portal_key（%d 字节）" % len(plaintext))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
