/* ============================================================
   解密层
   与 generate_portal_data.py 的 encrypt_data() 严格对应：
     [ salt 16 ][ iv 12 ][ tag 16 ][ ciphertext ]
   PBKDF2-SHA256 / 310000 次 / 派生 256-bit AES-GCM 密钥
   密码只在本页内存里使用，不上传、不写入任何存储。

   数据分两类，用同一把密码、同一个格式：
     encrypted.bin     索引（事实标题/摘要，首屏要的）
     facts/YYYY-MM.bin 事实正文，按月分片，点开才取
   密码在 unlock 后留在本模块内，分片解密不需要再问一次。
   ============================================================ */
(function (global) {
  'use strict';

  var PBKDF2_ITERATIONS = 310000;
  var SALT_LEN = 16, IV_LEN = 12, TAG_LEN = 16;

  var _password = null;     // 只在内存，不落 localStorage / sessionStorage
  var _keyCache = {};       // salt 十六进制 -> CryptoKey，同一分片重复打开不重复派生

  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function hex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
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

  async function decryptBuffer(buf, password) {
    if (buf.length < SALT_LEN + IV_LEN + TAG_LEN + 1) throw new Error('BAD_FORMAT');

    var salt = buf.slice(0, SALT_LEN);
    var iv = buf.slice(SALT_LEN, SALT_LEN + IV_LEN);
    var tag = buf.slice(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
    var ct = buf.slice(SALT_LEN + IV_LEN + TAG_LEN);

    // 每个文件各自的 salt，所以 key 不能跨文件复用；按 salt 缓存即可，
    // 同一分片第二次打开就不用再跑 31 万次 PBKDF2。
    var cacheKey = hex(salt);
    var key = _keyCache[cacheKey];
    if (!key) {
      key = await deriveKey(password, salt);
      _keyCache[cacheKey] = key;
    }

    var plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv, tagLength: 128 }, key, concat(ct, tag)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function fetchBin(url) {
    var resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) throw new Error('FETCH_FAILED');
    return new Uint8Array(await resp.arrayBuffer());
  }

  /**
   * 取回并解密 encrypted.bin（索引）
   * @param {string} password
   * @param {string} url
   * @returns {Promise<object>} 明文 JSON
   */
  async function decryptPortal(password, url) {
    var data = await decryptBuffer(await fetchBin(url || 'encrypted.bin'), password);
    _password = password;   // 解密成功才记住，密码错了不留脏值
    return data;
  }

  /**
   * 取回并解密一个事实正文分片，例：decryptChunk('2026-10') / ('2026-10-3')
   *
   * 分片名就是文件名，直接来自索引里每条事实的 `chunk` 字段：正常是 YYYY-MM，
   * 一个月超过 700 KB 会续编成 YYYY-MM-2、YYYY-MM-3；日期解析不出来的落 unknown。
   * @param {string} shard
   * @returns {Promise<object>} { 文件名: 正文 }
   */
  async function decryptChunk(shard) {
    if (!_password) throw new Error('LOCKED');
    if (!/^(\d{4}-\d{2}(-\d+)?|unknown)$/.test(shard)) throw new Error('BAD_CHUNK');
    return decryptBuffer(await fetchBin('facts/' + shard + '.bin'), _password);
  }

  function lock() {
    _password = null;
    _keyCache = {};
  }

  global.PortalCrypto = {
    decryptPortal: decryptPortal,
    decryptChunk: decryptChunk,
    lock: lock
  };
})(window);
