/* ============================================================
   解密层
   与 generate_portal_data.py 的 encrypt_data() 严格对应：
     [ salt 16 ][ iv 12 ][ tag 16 ][ ciphertext ]
   PBKDF2-SHA256 / 310000 次 / 派生 256-bit AES-GCM 密钥
   密码只在本页内存里使用，不上传、不写入任何存储。
   ============================================================ */
(function (global) {
  'use strict';

  var PBKDF2_ITERATIONS = 310000;
  var SALT_LEN = 16, IV_LEN = 12, TAG_LEN = 16;

  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  async function deriveKey(password, salt) {
    var enc = new TextEncoder();
    var baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  /**
   * 取回并解密 encrypted.bin
   * @param {string} password
   * @param {string} url
   * @returns {Promise<object>} 明文 JSON
   */
  async function decryptPortal(password, url) {
    var resp = await fetch(url || 'encrypted.bin', { cache: 'no-cache' });
    if (!resp.ok) throw new Error('FETCH_FAILED');

    var buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.length < SALT_LEN + IV_LEN + TAG_LEN + 1) throw new Error('BAD_FORMAT');

    var salt = buf.slice(0, SALT_LEN);
    var iv = buf.slice(SALT_LEN, SALT_LEN + IV_LEN);
    var tag = buf.slice(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
    var ct = buf.slice(SALT_LEN + IV_LEN + TAG_LEN);

    var key = await deriveKey(password, salt);
    var plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv, tagLength: 128 }, key, concat(ct, tag)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  global.PortalCrypto = { decryptPortal: decryptPortal };
})(window);
