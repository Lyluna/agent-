/* ============================================================
   门户主逻辑
   六个分区各自是一个视图；顶部命令面板做跨分区搜索。
   ============================================================ */
(function () {
  'use strict';

  // ---------- 状态 ----------
  var MEM = { profile: {}, facts: [], beliefs: [], beliefCategories: [],
              intents: [], sections: {} };
  var state = {
    view: 'overview',
    tool: 'all',
    category: 'all',
    theme: 'light',
    paletteIndex: 0,
    paletteHits: []
  };

  var VIEWS = [
    { id: 'overview',  label: '概览',   icon: 'grid' },
    { id: 'facts',     label: '事实',   icon: 'clock' },
    { id: 'beliefs',   label: '认知',   icon: 'bulb' },
    { id: 'intents',   label: '待办',   icon: 'check' },
    { id: 'skills',    label: '技能与工具', icon: 'tool' },
    { id: 'knowledge', label: '知识', icon: 'drop' },
    { id: 'graph', label: '关系', icon: 'graph' }
  ];

  var ICONS = {
    graph: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="17" r="2.5"/><path d="m10.5 7-4 7.5m7-7.5 4 7.5M7.5 17h9"/>',
    grid:  '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    bulb:  '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    tool:  '<path d="M14.5 6.5a4 4 0 0 0 5 5L10 21l-4-4 9.5-9.5z"/><path d="M6 6l3 3"/>',
    drop:  '<path d="M12 3.5s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10z"/>'
  };

  // ---------- 工具函数 ----------
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || '') + '</svg>';
  }

  function plural(n, unit) { return n + ' ' + unit; }

  // 非阻塞提示：右下角浮出一条，几秒后自己消失。
  // 不用 alert()——它会打断操作，也不该在每次写完都弹窗。
  function toast(msg, isError) {
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toastBox';
      box.className = 'toast-box';
      document.body.appendChild(box);
    }
    var item = document.createElement('div');
    item.className = 'toast' + (isError ? ' toast-error' : '');
    item.textContent = msg;
    box.appendChild(item);
    setTimeout(function () {
      item.classList.add('toast-out');
      setTimeout(function () { item.remove(); }, 300);
    }, isError ? 6000 : 3500);
  }

  // 简单的高亮：把查询词包进 <strong>
  function mark(text, q) {
    var safe = esc(text);
    if (!q) return safe;
    var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<strong>$1</strong>');
  }

  // ---------- 主题 ----------
  function applyTheme(t) {
    state.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    $('themeLabel').textContent = t === 'dark' ? '深色' : '浅色';
    try { localStorage.setItem('portal-theme', t); } catch (e) {}
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('portal-theme'); } catch (e) {}
    if (!saved) {
      saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    applyTheme(saved);
  }

  // ---------- 导航 ----------
  function renderRail() {
    var counts = {
      overview: null,
      facts: MEM.facts.length,
      beliefs: MEM.beliefs.length,
      intents: MEM.intents.filter(isPending).length,
      skills: (MEM.sections.skills ? MEM.sections.skills.count : 0) +
              (MEM.sections.tools ? MEM.sections.tools.count : 0),
      knowledge: MEM.sections.distilled ? MEM.sections.distilled.count : 0,
      graph: null
    };

    $('railNav').innerHTML = VIEWS.map(function (v) {
      var n = counts[v.id];
      return '<button class="rail-item" data-view="' + v.id + '" ' +
        'aria-current="' + (state.view === v.id) + '">' +
        icon(v.icon) + '<span>' + esc(v.label) + '</span>' +
        (n ? '<span class="n num">' + n + '</span>' : '') +
        '</button>';
    }).join('');

    Array.prototype.forEach.call(
      $('railNav').querySelectorAll('.rail-item'),
      function (el) {
        el.addEventListener('click', function () { setView(el.dataset.view); });
      }
    );
  }

  function setView(id) {
    state.view = id;
    Array.prototype.forEach.call(
      document.querySelectorAll('.view'),
      function (el) { el.classList.toggle('active', el.id === 'view-' + id); }
    );
    Array.prototype.forEach.call(
      document.querySelectorAll('.rail-item'),
      function (el) { el.setAttribute('aria-current', el.dataset.view === id); }
    );

    var v = VIEWS.filter(function (x) { return x.id === id; })[0];
    $('pageTitle').textContent = v ? v.label : '概览';
    renderHead();
    // 工具筛选只在「事实」视图有意义
    $('toolFilter').style.display = id === 'facts' ? '' : 'none';
    $('searchBtn').style.display = id === 'facts' || id === 'graph' ? 'none' : '';
    document.body.dataset.view = id;
    if (id === 'graph' && globalThis.PortalGraph) PortalGraph.refresh();
    try { history.replaceState(null, '', location.pathname + '#view=' + id); } catch (e) {}

    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // ---------- 页头：一句话说清这一屏在回答什么 ----------
  function renderHead() {
    var p = MEM.profile || {};
    var pending = MEM.intents.filter(isPending);
    var live = MEM.facts.filter(function (f) { return f.status === '进行中'; });
    var high = pending.filter(function (i) { return i.priority === 'high'; });

    var finding = '';
    if (state.view === 'overview') {
      finding = '<b class="num">' + MEM.facts.length + '</b> 次对话，' +
        '<b class="num">' + MEM.beliefs.length + '</b> 条结论，' +
        '<b class="num">' + pending.length + '</b> 项待办。';
    } else if (state.view === 'facts') {
      finding = '最近一次归档在 <b>' + esc((MEM.facts[0] || {}).date || '-') + '</b>' +
        (live.length ? '，<b class="num">' + live.length + '</b> 个对话仍在进行' : '') + '。';
    } else if (state.view === 'beliefs') {
      finding = '从对话里沉淀下来的结论，越靠前越新。';
    } else if (state.view === 'intents') {
      finding = pending.length
        ? '<b class="num">' + pending.length + '</b> 项未完成' +
          (high.length ? '，<b class="num">' + high.length + '</b> 项高优先级' : '') + '。'
        : '所有待办已完成。';
    } else if (state.view === 'skills') {
      var sk = MEM.sections.skills || { count: 0 };
      var tl = MEM.sections.tools || { count: 0 };
      finding = '<b class="num">' + sk.count + '</b> 个技能 · <b class="num">' +
        tl.count + '</b> 个工具。';
    } else if (state.view === 'knowledge') {
      var ds = MEM.sections.distilled || { count: 0 };
      finding = '<b class="num">' + ds.count + '</b> 条可复用结论。';
    } else if (state.view === 'graph') {
      finding = '从一条对话或知识出发，沿着真实关联找到它的来源。';
    }

    $('pageFinding').innerHTML = finding;

    var meta = [];
    if (p.name) meta.push(esc(p.name));
    if (p.role) meta.push(esc(p.role));
    if (MEM.updated) meta.push('更新于 ' + esc(MEM.updated));
    $('pageMeta').innerHTML = meta.map(function (m) { return '<span>' + m + '</span>'; }).join('');
  }

  // ---------- 工具筛选 ----------
  function renderToolFilter() {
    var tools = [];
    MEM.facts.forEach(function (f) {
      if (f.tool && tools.indexOf(f.tool) === -1) tools.push(f.tool);
    });

    var html = '<button class="chip" data-tool="all" aria-pressed="' +
      (state.tool === 'all') + '">全部<span class="c">' + MEM.facts.length + '</span></button>';

    tools.forEach(function (t) {
      var n = MEM.facts.filter(function (f) { return f.tool === t; }).length;
      html += '<button class="chip" data-tool="' + esc(t) + '" aria-pressed="' +
        (state.tool === t) + '">' + esc(t) + '<span class="c">' + n + '</span></button>';
    });

    $('toolFilter').innerHTML = html;
    Array.prototype.forEach.call(
      $('toolFilter').querySelectorAll('.chip'),
      function (el) {
        el.addEventListener('click', function () {
          state.tool = el.dataset.tool;
          renderToolFilter();
          renderFacts();
        });
      }
    );
  }

  // ---------- 概览 ----------
  function renderOverview() {
    var p = MEM.profile || {};
    var high = MEM.intents.filter(function (i) { return isPending(i) && i.priority === 'high'; }).slice(0, 4);
    var live = MEM.facts.filter(function (f) { return f.status === '进行中'; }).length;
    var latest = MEM.facts[0] || {};
    var ds = MEM.sections.distilled || { count: 0 };
    var html = '<section class="welcome">' +
      '<div class="welcome-copy"><span class="eyebrow">个人工作系统 · 记忆与知识</span>' +
      '<h2>继续上次的思考，<br>找到这次能用的答案。</h2>' +
      '<p>' + esc(p.name || '') + '，这里是各 Agent 共用的记忆与知识工作台。对话有来处，结论能复用，下一步有落点。</p>' +
      '<div class="welcome-actions"><button class="action-btn" data-go="facts">浏览最近对话</button>' +
      '<button class="text-btn" data-go="graph">探索内容关系 <span aria-hidden="true">↗</span></button></div></div>' +
      '<div class="pulse-panel" aria-label="当前工作状态">' +
        '<div class="pulse-top"><span class="status-dot"></span><span>自动归档运行中</span><span class="pulse-date">' + esc(MEM.updated || '') + '</span></div>' +
        '<div class="pulse-flow"><div><b>' + MEM.facts.length + '</b><span>对话已留档</span></div><i></i><div><b>' + MEM.beliefs.length + '</b><span>结论可回看</span></div><i></i><div><b>' + (ds.count || 0) + '</b><span>知识待复用</span></div></div>' +
        '<div class="pulse-foot">' + (live ? live + ' 个对话仍在继续' : '当前没有进行中的对话') + '<span>' + (cloudReady() ? '云端写入已连接' : '只读浏览') + '</span></div>' +
      '</div></section>';

    html += '<div class="overview-grid"><section class="overview-focus"><div class="section-heading"><span class="section-number">01</span><h2>接着处理</h2>' +
      '<button class="text-btn" data-go="intents">全部待办</button></div>' +
      (high.length ? '<div class="intents">' + high.map(intentRow).join('') + '</div>' : '<div class="empty"><strong>高优先级已清空</strong>可以从最近沉淀的内容继续整理。</div>') + '</section>' +
      '<aside class="overview-latest"><div class="section-heading"><span class="section-number">02</span><h2>最新留档</h2></div>' +
      '<button class="latest-conversation" data-go="facts"><span>' + esc(latest.date || '等待第一次归档') + '</span><strong>' + esc(latest.title || '新的对话会出现在这里') + '</strong><span>打开完整记录 ↗</span></button>' +
      '<div class="latest-note">不只是存下对话，也留下以后用得上的判断。</div></aside></div>';

    html += '<section class="overview-stream"><div class="section-heading"><span class="section-number">03</span><h2>最近的思考轨迹</h2>' +
      '<button class="text-btn" data-go="facts">查看全部</button></div><div class="facts">' +
      MEM.facts.slice(0, 4).map(factRow).join('') + '</div></section>';

    html += '<details class="profile-details"><summary>关于这个工作台 <span>共享工具、沟通偏好与使用规则</span></summary>' +
      '<div class="profile"><div class="profile-cell"><h3>使用者</h3><div class="val">' + esc(p.name || '—') + '</div><div class="sub">' + esc(p.role || '') + '</div></div>' +
      '<div class="profile-cell"><h3>接入工具</h3><ul>' + (p.tools || []).map(function (t) { return '<li>' + esc(t.name) + ' · ' + esc(t.usage || '') + '</li>'; }).join('') + '</ul></div>' +
      '<div class="profile-cell"><h3>沟通偏好</h3><ul>' + (p.preferences || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div></details>';

    $('view-overview').innerHTML = html;
    bindFacts($('view-overview'));
    bindIntentActions($('view-overview'));
    Array.prototype.forEach.call($('view-overview').querySelectorAll('[data-go]'), function (el) {
      el.addEventListener('click', function () { setView(el.dataset.go); });
    });
  }

  // ---------- 事实 ----------
  // 只有事实可以删：有些对话不值得留。删除走本地服务移进 _已作废/，线上降级为复制指令。
  var pickMode = false;      // 合并选择模式
  var picked = [];           // 选中的文件名

  function factRow(f, i) {
    var live = f.status === '进行中';
    var canPick = pickMode && (canWrite || cloudReady());
    var on = picked.indexOf(f.file) !== -1;
    var cls = 'fact' + (on ? ' picked' : '');
    var pick = canPick
      ? '<button class="pick-box" data-file="' + esc(f.file) + '" aria-pressed="' + on + '" ' +
        'aria-label="选择合并" title="选择合并"></button>'
      : '';
    var del = '';
    if (canWrite || cloudReady()) {
      del = '<button class="del-btn" data-file="' + esc(f.file) + '" data-title="' +
        esc(f.title) + '" aria-label="删除这条存档" title="删除这条存档">删除</button>';
    }
    return '<div class="' + cls + '" tabindex="0" data-idx="' + i + '">' +
      '<div class="fact-date">' + esc(f.date) + '</div>' +
      '<div class="fact-main">' +
        '<div class="fact-title">' + pick + esc(f.title) + '</div>' +
        '<div class="fact-sum">' + esc(f.summary) + '</div>' +
        // 内层再包一层：grid-template-rows 0fr→1fr 只能撑开一行，
        // 直接放两个子元素会留下一条隐式 auto 行，收起时高度不为 0。
        '<div class="fact-detail"><div class="detail-inner">' +
          '<div class="detail-bar"><span>完整对话存档</span>' +
          '<span>' + esc(f.tool) + '</span></div>' +
          // 正文按需渲染：32 条存档合计 38 万字符，一次性塞进 DOM 会让首屏卡住。
          // 用文件名做键：列表可能被工具筛选过，下标对不上 MEM.facts。
          '<div class="detail-body" data-file="' + esc(f.file) + '"></div>' +
        '</div></div>' +
      '</div>' +
      '<div class="fact-side">' +
        (live ? '<span class="live">进行中</span>' : '') +
        '<span class="src">' + esc(f.tool) + '</span>' +
        del +
      '</div>' +
    '</div>';
  }

  function bindFacts(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.fact'), function (el) {
      function toggle() {
        el.classList.toggle('open');
        // 首次展开时才填正文：首屏只渲染摘要，避免一次解析几十万字符
        if (el.classList.contains('open')) {
          var body = el.querySelector('.detail-body');
          if (body && !body.dataset.filled) {
            var f = MEM.facts.filter(function (x) { return x.file === body.dataset.file; })[0];
            if (f) body.textContent = f.detail || '';
            body.dataset.filled = '1';
          }
        }
      }
      el.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;   // 删除/勾选按钮不展开
        toggle();
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      // 指针柔光的坐标。只在精确指向设备上生效，触屏的 pointermove 会被 CSS 挡掉。
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }, { passive: true });
    });

    Array.prototype.forEach.call(root.querySelectorAll('.del-btn'), function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        if (canWrite || cloudReady()) {
          if (!confirm('删除这条对话存档？\n\n「' + el.dataset.title +
            '」\n\n会移进 _已作废/，可随时恢复。')) return;
          if (canWrite) writeDelete(el.dataset.file, el);
          else writeDeleteCloud(el.dataset.file, el);
        } else {
          copyInstruction(el.dataset.file, 'delete', el);
        }
      });
    });

    Array.prototype.forEach.call(root.querySelectorAll('.pick-box'), function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var file = el.dataset.file;
        var at = picked.indexOf(file);
        if (at === -1) picked.push(file); else picked.splice(at, 1);
        renderFacts();
      });
    });
  }

  function writeDelete(file, el) {
    var restore = el.textContent;
    el.disabled = true;
    el.textContent = '删除中…';
    fetch('/api/archive/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: file })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) throw new Error(res.error || '删除失败');
      MEM.facts = MEM.facts.filter(function (f) { return f.file !== file; });
      renderFacts();
      renderRail();
      renderHead();
      if (state.view === 'overview') renderOverview();
    }).catch(function (err) {
      el.disabled = false;
      el.textContent = restore;
      toast('删除失败：' + err.message, true);
    });
  }

  function writeDeleteCloud(file, el) {
    var restore = el.textContent;
    el.disabled = true;
    el.textContent = '删除中…';
    cloudPost('/delete', { file: file }).then(function (res) {
      if (!res.ok) throw new Error(res.error || '删除失败');
      MEM.facts = MEM.facts.filter(function (f) { return f.file !== file; });
      renderFacts();
      renderRail();
      renderHead();
      if (state.view === 'overview') renderOverview();
    }).catch(function (err) {
      el.disabled = false;
      el.textContent = restore;
      toast('删除失败：' + err.message, true);
    });
  }

  function togglePickMode() {
    pickMode = !pickMode;
    if (!pickMode) picked = [];
    renderFacts();
  }

  function mergePicked() {
    if (picked.length < 2) { toast('至少选两条才能合并', true); return; }
    var first = MEM.facts.filter(function (f) { return f.file === picked[0]; })[0];
    var name = prompt('把选中的 ' + picked.length + ' 条合成一条存档。\n\n合并后的主题：',
      (first && first.title) || '合并对话');
    if (name === null) return;
    var url = canWrite ? '/api/archive/merge' : (cloud.base + '/merge');
    var opts = canWrite
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: picked.slice(), title: name }) }
      : { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Portal-Secret': cloud.secret },
          body: JSON.stringify({ files: picked.slice(), title: name }) };
    fetch(url, opts).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) throw new Error(res.error || '合并失败');
      // 本地即时生效：移除来源条目、插入合并后的新条目。
      // 不 location.reload()——那会清掉内存里的密码，把用户踢回登录页。
      var removed = picked.slice();
      var first0 = MEM.facts.filter(function (f) { return f.file === removed[0]; })[0];
      MEM.facts = MEM.facts.filter(function (f) { return removed.indexOf(f.file) === -1; });
      if (first0) {
        MEM.facts.unshift({
          date: first0.date, tool: first0.tool, file: res.merged,
          title: name || first0.title, archive_type: 'full', status: '',
          summary: '由 ' + removed.length + ' 段对话合并而成（刷新页面后可见完整正文）',
          detail: ''
        });
      }
      pickMode = false;
      picked = [];
      renderFacts();
      renderRail();
      renderHead();
      if (state.view === 'overview') renderOverview();
      toast('已合并为：' + res.merged + '（来源已移进 _已作废/）');
    }).catch(function (err) {
      toast('合并失败：' + err.message, true);
    });
  }

  function renderFacts() {
    var list = MEM.facts.filter(function (f) {
      return state.tool === 'all' || f.tool === state.tool;
    });

    var html = '<div class="sec-label"><h2>事实时间线</h2>' +
      '<span class="count">' + list.length + ' 条</span></div>';

    var bar = '';
    if (canWrite || cloudReady()) {
      bar = '<div class="fact-tools">' +
        '<button class="ghost-btn' + (pickMode ? ' on' : '') + '" id="pickToggle">' +
        (pickMode ? '退出合并选择' : '合并多条') + '</button>' +
        (pickMode ? '<button class="ghost-btn primary" id="mergeGo"' +
          (picked.length < 2 ? ' disabled' : '') + '>合并选中的 ' + picked.length + ' 条</button>' : '') +
        '</div>';
    }
    html += bar;
    html += '<p class="sec-note">由自动归档实时写入。点击任一条展开完整对话。' +
      (canWrite || cloudReady() ? '同一次对话被拆成多条时，用「合并多条」把它们并成一条。' : '') + '</p>';

    if (!list.length) {
      html += '<div class="empty"><strong>没有匹配的对话</strong>换个工具筛选试试。</div>';
    } else {
      html += '<div class="facts">' + list.map(factRow).join('') + '</div>';
    }

    $('view-facts').innerHTML = html;
    bindFacts($('view-facts'));

    if ($('pickToggle')) $('pickToggle').addEventListener('click', togglePickMode);
    if ($('mergeGo')) $('mergeGo').addEventListener('click', mergePicked);
  }

  // ---------- 认知 ----------
  function renderBeliefs() {
    var cats = MEM.beliefCategories || [];
    var list = MEM.beliefs.filter(function (b) {
      return state.category === 'all' || (b.category || '其他') === state.category;
    });

    var html = '<div class="sec-label"><h2>稳定认知</h2>' +
      '<span class="count">' + list.length + ' 条</span></div>';
    html += '<p class="sec-note">技术决策、踩坑经验、已确认的做法。分类写在 技术决策.md 每个标题下一行「分类：xxx」。</p>';

    // 分类筛选
    html += '<div class="chip-row cat-row">';
    html += '<button class="chip" data-cat="all" aria-pressed="' +
      (state.category === 'all') + '">全部<span class="c">' + MEM.beliefs.length + '</span></button>';
    cats.forEach(function (c) {
      html += '<button class="chip" data-cat="' + esc(c.name) + '" aria-pressed="' +
        (state.category === c.name) + '">' + esc(c.name) +
        '<span class="c">' + c.count + '</span></button>';
    });
    html += '</div>';

    if (!list.length) {
      html += '<div class="empty"><strong>这个分类下还没有结论</strong>换个分类看看。</div>';
    } else {
      html += '<div class="beliefs">' + list.map(function (b) {
        var conf = Math.round((b.confidence || 0) * 100);
        return '<div class="belief">' +
          '<div class="stmt">' + esc(b.title || b.statement) + '</div>' +
          (b.detail ? '<div class="det">' + esc(b.detail) + '</div>' : '') +
          '<div class="foot"><span class="cat">' + esc(b.category || '其他') + '</span>' +
          '<span class="conf">' + esc(b.updated || '') + ' · ' + conf + '%' +
            '<span class="conf-track"><span class="conf-fill' +
            (conf >= 90 ? ' hi' : '') + '" style="width:' + conf + '%"></span></span>' +
          '</span></div>' +
        '</div>';
      }).join('') + '</div>';
    }

    $('view-beliefs').innerHTML = html;

    Array.prototype.forEach.call(
      $('view-beliefs').querySelectorAll('.chip'),
      function (el) {
        el.addEventListener('click', function () {
          state.category = el.dataset.cat;
          renderBeliefs();
        });
      }
    );
  }

  // ---------- 待办 ----------
  // 三态：待办 → 已完成（等确认有没有后续）→ 已结案
  // 本地服务可写时，点击直接写回 markdown；线上静态站降级为复制指令。
  var canWrite = false;   // 由 detectWritable() 探测
  var override = {};      // task -> {done, closed}，本次会话的乐观状态

  function eff(i, key) {
    var o = override[i.task];
    if (o && key in o) return o[key];
    return key === 'closed' ? !!i.closed : !!i.done;
  }
  function isClosed(i) { return eff(i, 'closed'); }
  function isDone(i) { return eff(i, 'done'); }
  function isPending(i) { return !isDone(i) && !isClosed(i); }
  function isToConfirm(i) { return isDone(i) && !isClosed(i); }

  function intentRow(t) {
    var label = { high: '高', mid: '中', low: '低' }[t.priority] || t.priority || '';
    var done = isDone(t);
    var closed = isClosed(t);
    var cls = 'intent' + (done ? ' done' : '') + (closed ? ' closed' : '');

    // 复选框本身可点：未完成 ↔ 已完成
    var boxTitle = closed ? '撤销结案'
      : done ? '改回未完成'
      : '标记为已完成';
    var box = '<button class="intent-box" data-task="' + esc(t.task) + '" ' +
      'data-action="' + (done ? (closed ? 'reopen' : 'undone') : 'done') + '" ' +
      'aria-label="' + esc(boxTitle) + '" title="' + esc(boxTitle) + '"></button>';

    var action = '';
    if (closed) {
      action = '<span class="closed-tag">已结案' +
        (t.closed_at ? ' ' + esc(t.closed_at) : '') + '</span>';
    } else if (done) {
      action = (canWrite || cloudReady())
        ? '<button class="close-btn" data-task="' + esc(t.task) + '" data-action="close">确认无后续</button>'
        : '<button class="close-btn copy" data-task="' + esc(t.task) + '" data-action="close">复制结案指令</button>';
    }

    return '<div class="' + cls + '" data-task-row="' + esc(t.task) + '" tabindex="-1">' +
      box +
      '<div class="intent-text">' + esc(t.task) + '</div>' +
      '<div class="intent-act">' + action + '</div>' +
      '<div class="intent-prio ' + esc(t.priority || '') + '">' + esc(label) + '</div>' +
    '</div>';
  }

  // 同一优先级下再按 group 分组，组标题就是 markdown 里的 ### 小标题
  function groupByLabel(list) {
    var groups = [], index = {};
    list.forEach(function (i) {
      var key = i.group || '';
      if (!(key in index)) { index[key] = groups.length; groups.push({ label: key, items: [] }); }
      groups[index[key]].items.push(i);
    });
    return groups;
  }

  function renderGrouped(list) {
    return groupByLabel(list).map(function (g) {
      var head = g.label
        ? '<div class="group-label">' + esc(g.label) +
          '<span class="count">' + g.items.length + '</span></div>'
        : '';
      return head + '<div class="intents">' + g.items.map(intentRow).join('') + '</div>';
    }).join('');
  }

  function renderIntents() {
    var pending = MEM.intents.filter(isPending);
    var confirm = MEM.intents.filter(isToConfirm);
    var closed = MEM.intents.filter(isClosed);

    var html = '<div class="sec-label"><h2>意图待办</h2>' +
      '<span class="count">' + pending.length + ' 项未完成</span></div>';
    html += '<p class="sec-note">' +
      (canWrite ? '点复选框标记完成或改回；已完成的需要你确认「没有后续」才会归档。'
        : cloudReady() ? '点复选框标记完成或改回，改动会直接写回仓库。'
        : '线上是只读的：点复选框或按钮会复制一条指令，粘给任意 AI 执行。') +
      '</p>';

    if (!pending.length && !confirm.length && !closed.length) {
      html += '<div class="empty"><strong>没有待办</strong>有新计划时会出现在这里。</div>';
    } else {
      if (pending.length) html += renderGrouped(pending);

      if (confirm.length) {
        html += '<div class="sec-label" style="margin-top:30px"><h2>待确认结案</h2>' +
          '<span class="count">' + confirm.length + ' 项</span></div>';
        html += '<p class="sec-note">做完的条目先停这里。确认没有后续就点「确认无后续」，之后不再提醒。</p>';
        html += renderGrouped(confirm);
      }

      if (closed.length) {
        html += '<div class="sec-label" style="margin-top:30px"><h2>已结案</h2>' +
          '<span class="count">' + closed.length + ' 项</span></div>';
        html += renderGrouped(closed);
      }
    }

    $('view-intents').innerHTML = html;
    bindIntentActions($('view-intents'));
  }

  // ---------- 云端写模式 ----------
  // 线上门户通过 Cloudflare Worker 改仓库，浏览器不持有 GitHub token。
  // Worker 地址与共享密钥由用户在页面上填一次，存在 localStorage。
  var cloud = { base: '', secret: '' };

  function loadCloud() {
    try {
      var raw = localStorage.getItem('portal-cloud');
      if (raw) { var o = JSON.parse(raw); cloud.base = o.base || ''; cloud.secret = o.secret || ''; }
    } catch (e) {}
  }

  function saveCloud(base, secret) {
    cloud.base = (base || '').replace(/\/+$/, '');
    cloud.secret = secret || '';
    try { localStorage.setItem('portal-cloud', JSON.stringify(cloud)); } catch (e) {}
  }

  function cloudReady() { return !!(cloud.base && cloud.secret); }

  function cloudPost(path, payload) {
    return fetch(cloud.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Portal-Secret': cloud.secret },
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
    });
  }

  function updateCloudLabel() {
    var el = $('cloudLabel');
    if (el) el.textContent = cloudReady() ? '云端已连' : '云端';
  }

  // 页面内面板，不用 prompt()：部分浏览器会静默拦截系统弹窗
  function openCloudSettings() {
    var old = document.getElementById('cloudPanel');
    if (old) old.remove();

    var panel = document.createElement('div');
    panel.id = 'cloudPanel';
    panel.className = 'cloud-panel';
    panel.innerHTML =
      '<h3>云端写入</h3>' +
      '<p class="hint">填 Cloudflare Worker 地址和共享密钥。只在浏览器本地保存。</p>' +
      '<label>Worker 地址</label>' +
      '<input id="cloudBase" type="url" placeholder="https://memory-portal.xxx.workers.dev" value="' +
        esc(cloud.base) + '">' +
      '<label>共享密钥</label>' +
      '<input id="cloudSecret" type="password" placeholder="SHARED_SECRET 的值" value="' +
        esc(cloud.secret) + '">' +
      '<div class="cloud-actions">' +
        '<button class="ghost-btn" id="cloudCancel">取消</button>' +
        '<button class="ghost-btn" id="cloudClear">清除</button>' +
        '<button class="ghost-btn primary" id="cloudSave">保存</button>' +
      '</div>' +
      '<div class="cloud-msg" id="cloudMsg"></div>';
    document.body.appendChild(panel);

    function close() { panel.remove(); }

    document.getElementById('cloudCancel').addEventListener('click', close);
    document.getElementById('cloudClear').addEventListener('click', function () {
      saveCloud('', '');
      updateCloudLabel();
      renderFacts();
      close();
    });
    document.getElementById('cloudSave').addEventListener('click', function () {
      var base = document.getElementById('cloudBase').value.trim();
      var secret = document.getElementById('cloudSecret').value.trim();
      var msg = document.getElementById('cloudMsg');
      if (!base) { msg.textContent = '请填 Worker 地址'; msg.className = 'cloud-msg err'; return; }
      if (!secret) { msg.textContent = '请填共享密钥'; msg.className = 'cloud-msg err'; return; }
      saveCloud(base, secret);
      updateCloudLabel();
      renderFacts();
      msg.textContent = '已保存，正在测试连接…';
      msg.className = 'cloud-msg';
      fetch(base.replace(/\/+$/, '') + '/health', { cache: 'no-store' })
        .then(function (r) { return r.json(); }).then(function (r) {
        if (r && (r.ok || r.repo)) {
          msg.textContent = '连接成功。删除、合并、改待办会直接写云端。';
          msg.className = 'cloud-msg ok';
        } else {
          msg.textContent = '连上了但返回异常：' + JSON.stringify(r);
          msg.className = 'cloud-msg err';
        }
      }).catch(function (e) {
        msg.textContent = '连接失败：' + e.message + '（检查地址和密钥）';
        msg.className = 'cloud-msg err';
      });
    });
  }

  // 统一处理复选框和结案按钮：本地写文件 / 云端走 Worker / 都没有就复制指令
  function bindIntentActions(root) {
    Array.prototype.forEach.call(
      root.querySelectorAll('[data-task][data-action]'),
      function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          var task = el.dataset.task;
          var action = el.dataset.action;
          if (canWrite) {
            writeStatus(task, action, el);
          } else if (cloudReady()) {
            writeStatusCloud(task, action, el);
          } else {
            copyInstruction(task, action, el);
          }
        });
      }
    );
  }

  function writeStatus(task, action, el) {
    var restore = el.textContent;
    if (el.classList.contains('close-btn')) {
      el.disabled = true;
      el.textContent = '写入中…';
    }
    fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: task, action: action })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) throw new Error(res.error || '写入失败');
      applyOverride(task, action);
      renderIntents();
      renderRail();
      renderHead();
      if (state.view === 'overview') renderOverview();
      if (!res.regenerated) console.warn('数据未重新生成：', res.log);
    }).catch(function (err) {
      if (el.classList.contains('close-btn')) {
        el.disabled = false;
        el.textContent = restore;
      }
      toast('写入失败：' + err.message, true);
    });
  }

  function writeStatusCloud(task, action, el) {
    var restore = el.textContent;
    if (el.classList.contains('close-btn')) {
      el.disabled = true;
      el.textContent = '写入中…';
    }
    cloudPost('/todo', { task: task, action: action }).then(function (res) {
      if (!res.ok) throw new Error(res.error || '写入失败');
      applyOverride(task, action);
      renderIntents();
      renderRail();
      renderHead();
      if (state.view === 'overview') renderOverview();
    }).catch(function (err) {
      if (el.classList.contains('close-btn')) {
        el.disabled = false;
        el.textContent = restore;
      }
      toast('云端写入失败：' + err.message + '（数据可能 1 分钟后才重新加密）', true);
    });
  }

  // 乐观更新：先把界面切过去，避免等重新生成
  function applyOverride(task, action) {
    var o = override[task] || (override[task] = {});
    if (action === 'done') { o.done = true; o.closed = false; }
    else if (action === 'undone') { o.done = false; o.closed = false; }
    else if (action === 'close') { o.done = true; o.closed = true; }
    else if (action === 'reopen') { o.done = true; o.closed = false; }
  }

  var ACTION_TEXT = {
    done: '标记为已完成',
    undone: '改回未完成',
    close: '标记为已结案',
    reopen: '撤销结案'
  };

  function copyInstruction(task, action, el) {
    var line = ACTION_TEXT[action] || action;
    var text;
    if (action === 'delete') {
      text = '把 08-AI记忆/对话存档/ 里的这条存档删掉（移进 _已作废/），并在 ' +
        'tools/archive_state.json 里把对应会话标记 deleted: true，防止定时扫描重建：\n- ' + task;
    } else {
      text = '把 08-AI记忆/待办与下一步.md 里这条待办' + line + '：\n- ' + task;
      if (action === 'close') text += '\n（行尾追加 〔已结案 ' + todayStr() + '〕）';
    }


    // 复选框里没有文字，用 title 和描边提示；按钮才换文案
    var isBox = el.classList.contains('intent-box');
    var oldTitle = el.title;
    var oldText = el.textContent;
    var done = function () {
      el.classList.add('flash');
      if (isBox) el.title = '已复制指令';
      else el.textContent = '已复制';
      setTimeout(function () {
        el.classList.remove('flash');
        if (isBox) el.title = oldTitle;
        else el.textContent = oldText;
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { alert(text); }
    document.body.removeChild(ta);
  }

  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function detectWritable() {
    if (!/^https?:$/.test(location.protocol)) return;
    if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return;
    fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.writable) {
          canWrite = true;
          // 事实视图的删除 / 合并按钮只在可写时出现，探测完要重绘一次
          if (state.view === 'intents') renderIntents();
          else if (state.view === 'facts') renderFacts();
          else if (state.view === 'overview') renderOverview();
        }
      })
      .catch(function () {});
  }

  // ---------- 表格 ----------
  function tableSection(sec, emptyMsg) {
    if (!sec || !sec.rows || !sec.rows.length) {
      return '<div class="empty"><strong>' + esc(emptyMsg) + '</strong>' +
        '在对应索引页登记后会显示在这里。</div>';
    }
    var cols = sec.header;
    var html = '<div class="table-wrap"><table><thead><tr>' +
      cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>';

    sec.rows.forEach(function (r) {
      html += '<tr>' + cols.map(function (c) {
        var val = r[c] || '—';
        var isPath = /路径|文件|入口/.test(c);
        var isStatus = /状态/.test(c);
        if (isStatus) {
          // 状态列：emoji 换成文字状态，去掉重复的括号说明
          var ok = /🟢|✅|在用/.test(val);
          var label = val.replace(/[🟢✅⚠️🔴]\s*/g, '').replace(/（[^）]*junction[^）]*）/g, '').trim();
          return '<td><span class="state' + (ok ? ' on' : '') + '">' + esc(label || '在用') + '</span></td>';
        }
        return '<td' + (isPath ? ' class="mono"' : '') + '>' + esc(val) + '</td>';
      }).join('') + '</tr>';
    });

    return html + '</tbody></table></div>';
  }

  function renderSkills() {
    var sk = MEM.sections.skills || { rows: [], count: 0 };
    var tl = MEM.sections.tools || { rows: [], count: 0 };

    var html = '<div class="sec-label"><h2>技能</h2>' +
      '<span class="count">' + (sk.count || 0) + ' 个</span></div>';
    html += '<p class="sec-note">Agent 可复用的流程。一个技能一个目录，里面是 SKILL.md。</p>';
    html += tableSection(sk, '还没有登记技能');

    html += '<div class="sec-label" style="margin-top:34px"><h2>工具</h2>' +
      '<span class="count">' + (tl.count || 0) + ' 个</span></div>';
    html += '<p class="sec-note">拿来就能跑的东西：命令行、脚本、外部服务、API。</p>';
    html += tableSection(tl, '还没有登记工具');

    $('view-skills').innerHTML = html;
  }

  function renderKnowledge() {
    var ds = MEM.sections.distilled || { rows: [], count: 0 };

    var html = '<div class="sec-label"><h2>知识条目</h2>' +
      '<span class="count">' + (ds.count || 0) + ' 条</span></div>';
    html += '<p class="sec-note">一条知识一个文件。过不了「换场景还用得上吗」这三问的，留在项目笔记里。</p>';
    html += tableSection(ds, '还没有蒸馏知识');

    $('view-knowledge').innerHTML = html;
  }

  // ---------- 命令面板 ----------
  function buildIndex() {
    var rows = [];
    MEM.facts.forEach(function (f, i) {
      rows.push({
        kind: '事实', view: 'facts',
        text: f.title, sub: f.summary + ' ' + f.tool,
        target: { type: 'fact', idx: i }
      });
    });
    MEM.beliefs.forEach(function (b) {
      rows.push({
        kind: '认知', view: 'beliefs',
        text: b.title || b.statement, sub: b.detail || '',
        target: { type: 'view', view: 'beliefs' }
      });
    });
    MEM.intents.forEach(function (t) {
      rows.push({
        kind: '待办', view: 'intents',
        text: t.task, sub: (t.priority || '') + (t.done ? ' 已完成' : ''),
        target: { type: 'intent', task: t.task }
      });
    });
    ['skills', 'tools'].forEach(function (k) {
      var sec = MEM.sections[k];
      if (!sec || !sec.rows) return;
      sec.rows.forEach(function (r) {
        var vals = Object.keys(r).map(function (x) { return r[x]; });
        rows.push({
          kind: k === 'skills' ? '技能' : '工具', view: 'skills',
          text: vals[0], sub: vals.slice(1).join(' · '),
          target: { type: 'view', view: 'skills' }
        });
      });
    });
    var ds = MEM.sections.distilled;
    if (ds && ds.rows) {
      ds.rows.forEach(function (r) {
        var vals = Object.keys(r).map(function (x) { return r[x]; });
        rows.push({
          kind: '知识', view: 'knowledge',
          text: vals[1] || vals[0], sub: vals[2] || '',
          target: { type: 'view', view: 'knowledge' }
        });
      });
    }
    return rows;
  }

  var INDEX = [];

  function openPalette() {
    $('palette').classList.add('open');
    $('paletteInput').value = '';
    state.paletteIndex = 0;
    renderPalette('');
    setTimeout(function () { $('paletteInput').focus(); }, 0);
  }

  function closePalette() {
    $('palette').classList.remove('open');
  }

  function renderPalette(q) {
    var ql = q.trim().toLowerCase();
    var hits = ql
      ? INDEX.filter(function (r) {
          return (r.text + ' ' + r.sub + ' ' + r.kind).toLowerCase().indexOf(ql) !== -1;
        }).slice(0, 40)
      : INDEX.slice(0, 12);

    state.paletteHits = hits;
    if (state.paletteIndex >= hits.length) state.paletteIndex = Math.max(0, hits.length - 1);

    if (!hits.length) {
      $('paletteList').innerHTML = '<div class="palette-empty">没有匹配项</div>';
      return;
    }

    $('paletteList').innerHTML = hits.map(function (r, i) {
      return '<div class="palette-row" role="option" data-i="' + i + '" ' +
        'aria-selected="' + (i === state.paletteIndex) + '">' +
        '<span class="palette-kind">' + esc(r.kind) + '</span>' +
        '<span class="palette-text">' + mark(r.text, ql) + '</span>' +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(
      $('paletteList').querySelectorAll('.palette-row'),
      function (el) {
        el.addEventListener('click', function () {
          choosePalette(parseInt(el.dataset.i, 10));
        });
      }
    );
  }

  function choosePalette(i) {
    var hit = state.paletteHits[i];
    if (!hit) return;
    closePalette();

    if (hit.target.type === 'view') {
      setView(hit.target.view);
    } else if (hit.target.type === 'fact') {
      setView('facts');
      // 视图只切换 class，DOM 已存在，直接定位；不依赖 rAF（后台标签页会暂停）
      var factRow = document.querySelectorAll('#view-facts .fact')[hit.target.idx];
      if (factRow) {
        factRow.classList.add('open');
        factRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
        factRow.focus();
      }
    } else if (hit.target.type === 'intent') {
      setView('intents');
      var taskRow = Array.prototype.filter.call(
        document.querySelectorAll('#view-intents .intent'),
        function (el) { return el.dataset.taskRow === hit.target.task; }
      )[0];
      if (taskRow) {
        taskRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
        taskRow.focus();
        taskRow.classList.add('located');
        setTimeout(function () { taskRow.classList.remove('located'); }, 1600);
      }
    }
  }

  function bindPalette() {
    var input = $('paletteInput');

    input.addEventListener('input', function () {
      state.paletteIndex = 0;
      renderPalette(input.value);
    });

    input.addEventListener('keydown', function (e) {
      var n = state.paletteHits.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.paletteIndex = Math.min(n - 1, state.paletteIndex + 1);
        renderPalette(input.value);
        var sel = $('paletteList').querySelector('[aria-selected="true"]');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.paletteIndex = Math.max(0, state.paletteIndex - 1);
        renderPalette(input.value);
        var sel2 = $('paletteList').querySelector('[aria-selected="true"]');
        if (sel2) sel2.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choosePalette(state.paletteIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      }
    });

    $('palette').addEventListener('click', function (e) {
      if (e.target === $('palette')) closePalette();
    });

    $('searchBtn').addEventListener('click', openPalette);

    document.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('palette').classList.contains('open') ? closePalette() : openPalette();
      }
      if (e.key === 'Escape' && $('palette').classList.contains('open')) closePalette();
      // 数字键 1-7 跳分区（不在输入框里时）
      if (!mod && /^[1-7]$/.test(e.key) &&
          !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
        setView(VIEWS[parseInt(e.key, 10) - 1].id);
      }
    });
  }

  // ---------- 解锁 ----------
  async function unlock() {
    var input = $('passwordInput');
    var err = $('lockErr');
    var btn = $('unlockBtn');
    var pw = input.value;

    if (!pw) { err.textContent = '请输入密码'; input.focus(); return; }

    btn.disabled = true;
    btn.textContent = '解密中…';
    err.textContent = '';

    try {
      var data = await PortalCrypto.decryptPortal(pw, 'encrypted.bin');

      adopt(data);
      INDEX = buildIndex();

      $('lock').style.display = 'none';
      $('app').classList.add('ready');

      renderAll();
      setView('overview');
      detectWritable();

      input.value = '';
    } catch (e) {
      console.error(e);
      err.textContent = e.message === 'FETCH_FAILED'
        ? '无法读取 encrypted.bin，请用本地门户脚本打开'
        : '密码错误或数据损坏';
      input.select();
    } finally {
      btn.disabled = false;
      btn.textContent = '解密进入';
    }
  }

  // ---------- 启动 ----------
  function adopt(data) {
    MEM = data || {};
    MEM.profile = MEM.profile || {};
    MEM.facts = MEM.facts || [];
    MEM.beliefs = MEM.beliefs || [];
    MEM.beliefCategories = MEM.beliefCategories || [];
    MEM.intents = MEM.intents || [];
    MEM.sections = MEM.sections || {};
    MEM.relations = MEM.relations || { nodes: [], links: [] };
  }

  function renderAll() {
    renderRail();
    renderToolFilter();
    renderOverview();
    renderFacts();
    renderBeliefs();
    renderIntents();
    renderSkills();
    renderKnowledge();
    if (globalThis.PortalGraph) PortalGraph.init(MEM);
  }

  function init() {
    initTheme();

    $('unlockBtn').addEventListener('click', unlock);
    $('passwordInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') unlock();
    });

    $('themeBtn').addEventListener('click', function () {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    loadCloud();
    updateCloudLabel();
    $('cloudBtn').addEventListener('click', openCloudSettings);

    bindPalette();

    var query = location.search || '';
    var shot = query.match(/[?&]shot=([a-z]*)/);
    var shotTheme = query.match(/[?&]theme=(dark|light)/);
    if (shotTheme) applyTheme(shotTheme[1]);
    if (shot) {
      shotMode(shot[1] || 'overview');
      if (/openpalette/.test(query)) setTimeout(openPalette, 600);
    }

    // 支持 index.html#pw=密码 自动解锁（片段不会发送到服务器）
    var m = (location.hash || '').match(/pw=([^&]+)/);
    if (m) {
      $('passwordInput').value = decodeURIComponent(m[1]);
      unlock();
    }
  }

  // 设计验收专用：?shot=<view> 直接载入 data.json 明文渲染，跳过解密
  function shotMode(viewId) {
    fetch('data.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        adopt(data);
        INDEX = buildIndex();

        $('lock').style.display = 'none';
        $('app').classList.add('ready');
        renderAll();
        setView(viewId || 'overview');
        detectWritable();
        document.documentElement.setAttribute('data-shot', 'done');
      })
      .catch(function () {
        // 线上没有明文 data.json（已 gitignore），?shot= 落到这里就退回正常锁屏
        document.documentElement.removeAttribute('data-shot');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
