# 门户密码备份（加密）

本文件是门户密码 ``.portal_key` 的**加密备份**，可安全地存放在公开仓库中。

## 这是什么

- `portal_key.enc` —— 用**主密码**加密后的门户密码
- 加密算法：AES-256-GCM + PBKDF2-SHA256（310000 次迭代）
- 文件结构：`salt(16) + iv(12) + tag(16) + ciphertext`

**没有主密码，这个文件毫无用处。** 主密码只在你手里，不在任何仓库或文档里。

## 如何恢复密码

如果本地 `.portal_key` 丢失或换电脑，用下面的脚本恢复：

```python
# pip install pycryptodome
from pathlib import Path
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Hash import SHA256

MASTER = input("请输入主密码：")

blob = Path("portal_key.enc").read_bytes()
salt, iv, tag, ct = blob[:16], blob[16:28], blob[28:44], blob[44:]

key = PBKDF2(MASTER.encode(), salt, dkLen=32,
             count=310000, hmac_hash_module=SHA256)
plaintext = AES.new(key, AES.MODE_GCM, nonce=iv).decrypt_and_verify(ct, tag)

Path(".portal_key").write_bytes(plaintext)
print("已恢复 .portal_key")
```

或者直接用仓库里的 `tools/_restore_portal_key.py`。

## 主密码丢失怎么办

**无法恢复。** 只能重新生成门户密码：

1. 生成新的随机密码，写入 `记忆库门户/.portal_key`
2. 运行 `python 记忆库门户/generate_portal_data.py` 重新加密并推送
3. 用新主密码重新生成本备份文件

## 安全提示

- 主密码**不要**和门户密码相同
- 主密码**不要**和 GitHub / 邮箱等账号密码相同
- 建议把主密码存进密码管理器（Bitwarden / 1Password / 浏览器密码库）
- 主密码一旦泄露，等同于门户密码泄露

---

*最后更新：2026-10-22*
