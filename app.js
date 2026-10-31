/* ============================================================
   门户主逻辑
   六个导航入口；「记忆」「系统」各带 tab，tab 才是真正的渲染面板。
   旧的分区 id（facts / beliefs / intents / usage / disk / work）仍然有效，
   深链和命令面板都按别名解析到新入口，不会因为合并而失效。
   ============================================================ */
(function () {
  'use strict';

  // ---------- 状态 ----------
  var MEM = { profile: {}, facts: [], beliefs: [], beliefCategories: [],
              intents: [], sections: {} };
  var state = {
    view: 'overview',      // 导航入口（6 个之一）
    panel: 'overview',     // 真正在渲染的分区；等于 state.view 时没有 tab
    tabs: {},              // 每个入口上次打开的 tab，切回去还停在原处
    tool: 'all',
    agent: 'all',
    category: 'all',
    theme: 'light',
    railCollapsed: false,
    paletteIndex: 0,
    paletteHits: []
  };

  // 10 个分区收成 6 个入口。合并的原则是「回答同一个问题」：
  // 事实 / 认知 / 待办都在回答「我记得什么」，使用 / 磁盘都在回答「这套系统自己怎么样」。
  // 「要求」不并进「知识」——它是用户提过什么，和总结出来的知识不是一回事（用户 2026-10-28 定）。
  var VIEWS = [
    { id: 'overview',  label: '概览', icon: 'grid',  panels: ['overview'] },
  { id: 'work',      label: '项目', icon: 'board', panels: ['work'] },
    { id: 'memory',    label: '记忆', icon: 'clock', panels: ['facts', 'beliefs', 'intents'] },
    { id: 'knowledge', label: '知识', icon: 'drop',  panels: ['knowledge'] },
    { id: 'requests',  label: '要求', icon: 'check', panels: ['requests'] },
    { id: 'graph',     label: '关系', icon: 'graph', panels: ['graph'] },
    { id: 'system',    label: '系统', icon: 'pulse', panels: ['usage', 'disk', 'agents'] }
  ];

  var PANEL_LABEL = {
    overview: '概览', work: '项目',
    facts: '事实', beliefs: '认知', intents: '待办',
    knowledge: '知识', requests: '要求', graph: '关系',
    usage: '使用', disk: '磁盘', agents: '协作'
  };

  // 旧分区 id → 新入口。深链 #view=facts、命令面板、data-go 都靠这张表找回位置
  var PANEL_OF = {};
  VIEWS.forEach(function (v) {
    v.panels.forEach(function (p) { PANEL_OF[p] = v.id; });
  });

  var ICONS = {
    disk:  '<rect x="3" y="5" width="18" height="6" rx="2"/><rect x="3" y="13" width="18" height="6" rx="2"/><path d="M7 8h.01M7 16h.01"/>',
    graph: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="17" r="2.5"/><path d="m10.5 7-4 7.5m7-7.5 4 7.5M7.5 17h9"/>',
    grid:  '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    board: '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3z"/><path d="m4 12 8 4.5 8-4.5"/><path d="m4 16.5 8 4.5 8-4.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    bulb:  '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    tool:  '<path d="M14.5 6.5a4 4 0 0 0 5 5L10 21l-4-4 9.5-9.5z"/><path d="M6 6l3 3"/>',
    drop:  '<path d="M12 3.5s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10z"/>',
    pulse: '<path d="M3 12h3.5l2-5 3 10 2.5-5H21"/>'
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

  // ---------- 侧边栏收起 ----------
  // 只换 grid 的列宽，不搬内容。手机端 .rail-brand 本来就隐藏，
  // 所以按钮在窄屏自然不出现（横向导航没有「收起」的意义）。
  function syncRailTitles() {
    var labels = {};
    VIEWS.forEach(function (v) { labels[v.id] = v.label; });
    Array.prototype.forEach.call(document.querySelectorAll('.rail-item'), function (el) {
      // 收起后文字被视觉隐藏，靠 title 补回悬停提示
      el.title = state.railCollapsed ? (labels[el.dataset.view] || '') : '';
    });
  }

  function applyRail(collapsed) {
    state.railCollapsed = collapsed;
    var app = $('app');
    if (app) app.classList.toggle('rail-collapsed', collapsed);
    var btn = $('railToggle');
    if (btn) {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('aria-label', collapsed ? '展开侧边栏' : '收起侧边栏');
      btn.title = collapsed ? '展开侧边栏' : '收起侧边栏';
    }
    syncRailTitles();
    try { localStorage.setItem('portal-rail', collapsed ? 'collapsed' : 'open'); } catch (e) {}
  }

  function initRail() {
    var saved = null;
    try { saved = localStorage.getItem('portal-rail'); } catch (e) {}
    applyRail(saved === 'collapsed');
    var btn = $('railToggle');
    if (btn) {
      btn.addEventListener('click', function () { applyRail(!state.railCollapsed); });
    }
  }

  // ---------- 导航 ----------
  // 数字标在入口上：概览看「卡住的项目」，记忆看「没做完的事」，
  // 其余按各自的主要计数。0 不显示——一个空计数的角标只是噪音。
  function renderRail() {
    var pending = MEM.intents.filter(isPending).length;
    var counts = {
      overview: (MEM.projects || []).filter(function (p) { return p.blocked && p.blocked !== '无'; }).length,
      work: (MEM.projects || []).length,
      memory: pending,
      knowledge: (MEM.sections.distilled ? MEM.sections.distilled.count : 0) +
                 (MEM.sections.skills ? MEM.sections.skills.count : 0) +
                 (MEM.sections.tools ? MEM.sections.tools.count : 0),
      requests: (MEM.requests || []).filter(function (r) { return r.kind === 'request'; }).length,
      graph: 0,
      system: (MEM.usage && MEM.usage.coverage ? MEM.usage.coverage.sessions : 0) || 0
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
    // 重渲染会把 title 冲掉，收起状态要补回来
    syncRailTitles();
  }

  // 入口和面板都能传进来：setView('memory') 打开记忆入口上次的 tab，
  // setView('beliefs') 直接落到「认知」tab。旧链接靠的就是这一点。
  function setView(id) {
    var entry = VIEWS.filter(function (v) { return v.id === id; })[0];
    var asked = PANEL_OF[id] ? id : null;   // 传进来的是某个面板（旧链接 / tab / data-go）
    var view = entry ? entry.id : (asked ? PANEL_OF[asked] : 'overview');
    var g = VIEWS.filter(function (v) { return v.id === view; })[0];
    // 没指名面板就回到这个入口上次待过的那一个
    var panel = asked || state.tabs[view] || g.panels[0];

    state.view = view;
    state.panel = panel;
    state.tabs[view] = panel;

    Array.prototype.forEach.call(
      document.querySelectorAll('.view'),
      function (el) { el.classList.toggle('active', el.id === 'view-' + panel); }
    );
    Array.prototype.forEach.call(
      document.querySelectorAll('.rail-item'),
      function (el) { el.setAttribute('aria-current', el.dataset.view === state.view); }
    );

    renderTabs();
    var v = VIEWS.filter(function (x) { return x.id === state.view; })[0];
    $('pageTitle').textContent = v ? v.label : '概览';
    renderHead();
    // 工具筛选只在「事实」面板有意义
    $('toolFilter').style.display = panel === 'facts' ? '' : 'none';
    $('searchBtn').style.display = panel === 'facts' || panel === 'graph' || panel === 'agents' ? 'none' : '';
    document.body.dataset.view = panel;
    if (panel === 'graph' && globalThis.PortalGraph) PortalGraph.refresh();
    // 地址栏记面板 id 而不是入口 id：老链接照样能还原到具体的 tab
    try { history.replaceState(null, '', location.pathname + location.search + '#view=' + panel); } catch (e) {}

    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // 只有多面板的入口才有 tab；单面板入口的标题已经说清了是什么，再排一行 tab 是重复
  function renderTabs() {
    var v = VIEWS.filter(function (x) { return x.id === state.view; })[0];
    var box = $('viewTabs');
    if (!v || v.panels.length < 2) {
      box.innerHTML = '';
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = v.panels.map(function (p) {
      var on = p === state.panel;
      return '<button class="tab" role="tab" data-panel="' + p + '" ' +
        'aria-selected="' + on + '">' + esc(PANEL_LABEL[p] || p) + '</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.tab'), function (el) {
      el.addEventListener('click', function () { setView(el.dataset.panel); });
    });
  }

  // ---------- 页头：一句话说清这一屏在回答什么 ----------
  function renderHead() {
    var p = MEM.profile || {};
    var pending = MEM.intents.filter(isPending);
    var live = MEM.facts.filter(function (f) { return f.status === '进行中'; });
    var high = pending.filter(function (i) { return i.priority === 'high'; });

    var finding = '';
    if (state.panel === 'overview') {
      finding = '<b class="num">' + MEM.facts.length + '</b> 次对话，' +
        '<b class="num">' + MEM.beliefs.length + '</b> 条结论，' +
        '<b class="num">' + pending.length + '</b> 项待办。';
    } else if (state.panel === 'work') {
      var ps = MEM.projects || [];
      var blocked = ps.filter(function (p) { return p.blocked && p.blocked !== '无'; });
      finding = '<b class="num">' + ps.length + '</b> 个项目，' +
        '<b class="num">' + blocked.length + '</b> 个卡着，' +
        '<b class="num">' + pending.length + '</b> 项待办。';
    } else if (state.panel === 'facts') {
      finding = '最近一次归档在 <b>' + esc((MEM.facts[0] || {}).date || '-') + '</b>' +
        (live.length ? '，<b class="num">' + live.length + '</b> 个对话仍在进行' : '') + '。';
    } else if (state.panel === 'beliefs') {
      finding = '从对话里沉淀下来的结论，越靠前越新。';
    } else if (state.panel === 'intents') {
      finding = pending.length
        ? '<b class="num">' + pending.length + '</b> 项未完成' +
          (high.length ? '，<b class="num">' + high.length + '</b> 项高优先级' : '') + '。'
        : '所有待办已完成。';
    } else if (state.panel === 'knowledge') {
      var sk = MEM.sections.skills || { count: 0 };
      var tl = MEM.sections.tools || { count: 0 };
      var ds = MEM.sections.distilled || { count: 0 };
      finding = '<b class="num">' + ds.count + '</b> 条可复用结论 · ' +
        '<b class="num">' + sk.count + '</b> 个技能 · <b class="num">' +
        tl.count + '</b> 个工具。';
    } else if (state.panel === 'requests') {
      renderRequests();
    } else if (state.panel === 'usage') {
      var uc = (MEM.usage && MEM.usage.coverage) || {};
      finding = uc.calls
        ? '<b class="num">' + uc.sessions + '</b> 次会话里，' +
          '<b class="num">' + uc.detailed + '</b> 次有工具明细，共 ' +
          '<b class="num">' + uc.calls + '</b> 次调用、' +
          '<b class="num">' + uc.fails + '</b> 次失败。'
        : '还没有使用数据。';
      renderUsage();
    } else if (state.panel === 'disk') {
      renderDisk();
    } else if (state.panel === 'agents') {
      var ac = MEM.agentChains || {};
      var multiCount = (ac.chains || []).filter(function (c) { return c.size > 1; }).length;
      finding = ac.total
        ? '<b class="num">' + ac.total + '</b> 个会话连成 <b class="num">' + (ac.chains || []).length +
          '</b> 条链，其中 <b class="num">' + multiCount + '</b> 条是并行或接力。条越短，说明那段只是打了一两个来回。'
        : '还没有协作数据。在本机跑一次 <code>python 08-AI记忆/tools/agent_chains.py write</code> 再生成门户。';
      renderAgents();
    } else if (state.panel === 'graph') {
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
      '<div class="welcome-copy">' +
      '<h2>继续上次的思考，<br>找到这次能用的答案。</h2>' +
      '<p>' + esc(p.name || '') + '，这里是各 Agent 共用的记忆与知识工作台。对话有来处，结论能复用，下一步有落点。</p>' +
      '<div class="welcome-actions"><button class="action-btn" data-go="facts">浏览最近对话</button>' +
      '<button class="text-btn" data-go="graph">探索内容关系 <span aria-hidden="true">↗</span></button></div></div>' +
      '<div class="pulse-panel" aria-label="当前工作状态">' +
        '<div class="pulse-top"><span class="status-dot"></span><span>自动归档运行中</span><span class="pulse-date">' + esc(MEM.updated || '') + '</span></div>' +
        '<div class="metrics">' +
          '<div class="metric"><span class="m-label">对话已留档</span><b class="num">' + MEM.facts.length + '</b><span class="m-sub">条完整记录</span></div>' +
          '<div class="metric"><span class="m-label">结论可回看</span><b class="num">' + MEM.beliefs.length + '</b><span class="m-sub">条稳定认知</span></div>' +
          '<div class="metric"><span class="m-label">知识待复用</span><b class="num">' + (ds.count || 0) + '</b><span class="m-sub">条蒸馏结论</span></div>' +
        '</div>' +
        '<div class="pulse-foot">' + (live ? live + ' 个对话仍在继续' : '当前没有进行中的对话') + '<span>' + (canWrite ? '本地可写 · 能开终端' : cloudReady() ? '云端写入已连接' : '只读浏览') + '</span></div>' +
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

  // ---------- 工作台：项目 → 任务 → Agent 运行 ----------
  // 只展示真实字段：项目来自 04-项目 的 frontmatter，任务来自待办，运行来自对话存档。
  // 不推算「进度百分比」，也不给没有数据的项目补状态。
  // 关系表里的项目名是笔记文件名（stem），而卡片标题是 frontmatter title，两者都要认
  function projectActivity(p) {
    var stem = p && p.stem;
    var title = p && p.title;
    var links = (MEM.relations && MEM.relations.links) || [];
    var out = [];
    links.forEach(function (l) {
      if (l.sourceTitle !== stem && l.sourceTitle !== title) return;
      if (l.targetKind !== 'fact') return;
      var f = MEM.facts.filter(function (x) { return x.title === l.targetTitle; })[0];
      if (f) out.push(f);
    });
    out.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    return out;
  }

  // ── 项目详情抽屉：5W / 进度 / 验收 / 相关对话 ──
  function projectPrompt(p) {
    var d = p.detail || {};
    return [
      '继续项目：' + p.title,
      '项目笔记：' + (p.path || ''),
      '状态：' + (p.status || '—') + ' · 优先级：' + (p.priority || '—') +
        ' · 最近更新：' + (p.updated || '—'),
      d.acceptTotal ? '验收进度：' + d.acceptDone + ' / ' + d.acceptTotal : '',
      p.next ? '下一步：' + p.next : '',
      (p.blocked && p.blocked !== '无') ? '卡点：' + p.blocked : '',
      '',
      '请先读项目笔记和最近相关对话，再在此基础上继续推进，不要从头重来。'
    ].filter(Boolean).join('\n');
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done && done(true); })
        .catch(function () { done && done(false); });
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done && done(ok);
  }

  // 从一条事实接着干：把存档位置和摘要打包成一段可直接粘给任意 Agent 的指令
  function factPrompt(f) {
    return [
      '继续这件事：' + f.title,
      '时间：' + f.date + ' · 工具：' + f.tool,
      '存档：08-AI记忆/对话存档/' + f.file,
      f.summary ? '摘要：' + f.summary : '',
      '',
      '请先读这份存档，在它的基础上继续推进，不要从头重来。'
    ].filter(Boolean).join('\n');
  }

  function isLocalServer() {
    return /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
  }

  // 存档文件名里有空格和中文，CSS.escape 拼选择器会多出反斜杠；
  // 直接用 dataset 比对，稳。
  function findFactRow(file) {
    return Array.prototype.filter.call(
      document.querySelectorAll('.fact'),
      function (r) { return r.dataset.file === file; })[0];
  }

  function closeDrawer() {    var el = $('projectDrawer');
    if (!el) return;
    el.hidden = true;
    document.body.classList.remove('drawer-open');
  }

  function openProject(stem) {
    var p = (MEM.projects || []).filter(function (x) { return x.stem === stem; })[0];
    if (!p) return;
    var d = p.detail || {};
    var acts = projectActivity(p);
    var tools = {};
    acts.forEach(function (a) { if (a.tool) tools[a.tool] = true; });
    var who = Object.keys(tools);

    var mentions = d.mentions || [];
    function mentionLine(kind) {
      return mentions.filter(function (m) { return m.kind === kind; })
        .map(function (m) { return '· ' + m.name; }).join('\n');
    }
    var stackText = d.stack || (mentions.length ? '笔记里提到的：\n' +
      mentions.map(function (m) { return '· ' + m.name + '（' + m.kind + '）'; }).join('\n') : '');
    var toolsText = d.newTools || (mentionLine('工具') ? '笔记里提到的：\n' + mentionLine('工具') : '');
    var skillsText = d.newSkills || (mentionLine('技能') ? '笔记里提到的：\n' + mentionLine('技能') : '');
    // 做到哪一步：笔记里的「当前进度」+ 验收完成度，两者都真实才算
    var progressText = [d.progress || '',
      d.acceptTotal ? '验收：' + d.acceptDone + ' / ' + d.acceptTotal + ' 条完成' : ''
    ].filter(Boolean).join('\n');
    // 「怎么做」优先用笔记里的下一步清单，没有再退回 frontmatter 的一行 next
    var howText = d.how || (p.next ? '下一步：' + p.next : '');

    var rows = [
      ['是什么', d.what, '项目笔记加「## 项目简介」'],
      ['做到哪一步', progressText, '项目笔记加「## 当前进度」'],
      ['运用了什么', stackText, '项目笔记加「## 用了什么」'],
      ['为什么', d.why, '项目笔记加「## 为什么这样选」'],
      ['新增工具', toolsText, '项目笔记加「## 新增工具」'],
      ['新增技能', skillsText, '项目笔记加「## 新增技能」'],
      ['谁在做', who.length ? '你 + ' + who.join('、') : '你', ''],
      ['什么时候', [p.updated ? '最近更新 ' + p.updated : '',
                    p.status ? '状态 ' + p.status : ''].filter(Boolean).join(' · '), ''],
      ['在哪', p.path || '', ''],
      ['怎么做', howText, '项目笔记加「## 实施方案」或「## 下一步」']
    ];

    var html = '<div class="drawer-head">' +
      '<span class="chip chip-status">' + esc(p.status || '未标注') + '</span>' +
      '<span class="drawer-folder">' + esc(p.folder || '') + '</span></div>' +
      '<h2 id="drawerTitle">' + esc(p.title) + '</h2>';

    if (d.acceptTotal) {
      var pct = Math.round(d.acceptDone / d.acceptTotal * 100);
      html += '<div class="drawer-progress"><div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<span>' + d.acceptDone + ' / ' + d.acceptTotal + ' 条验收完成</span></div>';
    }

    // AI 归纳的近况：只显示在门户，不写回笔记；标明依据与时间
    if (d.digest && d.digest.text) {
      var meta = [d.digest.by, d.digest.generatedAt].filter(Boolean).join(' · ');
      var based = (d.digest.basedOn || []).length;
      if (based) meta += (meta ? ' · ' : '') + '依据 ' + based + ' 份存档';
      html += '<div class="drawer-digest"><b>最近进展</b>' +
        '<p>' + esc(d.digest.text) + '</p>' +
        (meta ? '<span class="digest-meta">' + esc(meta) + '</span>' : '') + '</div>';
    }

    html += '<dl class="w5">';
    rows.forEach(function (r) {
      html += '<div class="w5-row"><dt>' + esc(r[0]) + '</dt><dd>' +
        (r[1] ? esc(r[1]) : '<em class="muted">' + esc(r[2] || '笔记里还没写') + '</em>') +
        '</dd></div>';
    });
    html += '</dl>';

    if (d.checklist && d.checklist.length) {
      html += '<h3>验收清单</h3><ul class="drawer-check">' + d.checklist.map(function (c) {
        return '<li class="' + (c.done ? 'done' : '') + '"><i></i>' + esc(c.text) + '</li>';
      }).join('') + '</ul>';
    }

    if (p.blocked && p.blocked !== '无') {
      html += '<div class="drawer-block"><b>卡在哪</b><span>' + esc(p.blocked) + '</span></div>';
    }

    // 相关对话：显式双链 + 关键词挂接，来源分开标注，不混为一谈
    var relFiles = {};
    acts.forEach(function (f) { relFiles[f.file] = true; });
    var kwFacts = (d.relatedFacts || []).filter(function (f) { return !relFiles[f.file]; });
    var runs = acts.map(function (f) {
      return { file: f.file, date: f.date, tool: f.tool, title: f.title, why: '显式链接' };
    }).concat(kwFacts.map(function (f) {
      return { file: f.file, date: f.date, tool: f.tool, title: f.title, why: '关键词「' + f.via + '」' };
    })).sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    if (runs.length) {
      html += '<h3>相关对话 ' + runs.length +
        ' <em class="muted">（' + acts.length + ' 条显式链接 · ' + kwFacts.length + ' 条关键词匹配）</em></h3>' +
        '<div class="drawer-runs">' + runs.slice(0, 8).map(function (f) {
          return '<button class="run" data-fact="' + esc(f.file) + '">' +
            '<span class="run-date">' + esc(f.date) + '</span>' +
            '<span class="run-tool">' + esc(f.tool) + '</span>' +
            '<span class="run-title">' + esc(f.title) + '</span>' +
            '<span class="run-why">' + esc(f.why) + '</span></button>';
        }).join('') + '</div>';
    }

    html += '<div class="drawer-actions">' +
      '<button class="action-btn" data-copy-project>复制续接指令</button>' +
      (canWrite ? '<button class="action-btn" data-terminal-project>在终端继续</button>' : '') +
      '<button class="text-btn" data-open-obsidian>在 Obsidian 打开</button>' +
      '</div>';

    $('drawerBody').innerHTML = html;
    $('projectDrawer').hidden = false;
    document.body.classList.add('drawer-open');

    var copy = $('drawerBody').querySelector('[data-copy-project]');
    if (copy) copy.addEventListener('click', function () {
      copyText(projectPrompt(p), function (ok) {
        copy.textContent = ok ? '已复制，粘到任意 Agent ✓' : '复制失败，请手动选中';
        setTimeout(function () { copy.textContent = '复制续接指令'; }, 2200);
      });
    });
    var term = $('drawerBody').querySelector('[data-terminal-project]');
    if (term) term.addEventListener('click', function () {
      term.textContent = '正在打开终端…';
      fetch('/api/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: projectPrompt(p), file: p.path || '' })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          term.textContent = res.ok ? '终端已打开 ✓' : ('失败：' + (res.error || '未知错误'));
          setTimeout(function () { term.textContent = '在终端继续'; }, 2600);
        })
        .catch(function () {
          term.textContent = '本地服务不可用';
          setTimeout(function () { term.textContent = '在终端继续'; }, 2600);
        });
    });
    var obs = $('drawerBody').querySelector('[data-open-obsidian]');
    if (obs) obs.addEventListener('click', function () {
      var file = (p.path || '').replace(/\.md$/i, '');
      window.open('obsidian://open?vault=MyVault&file=' + encodeURIComponent(file), '_blank');
    });
    Array.prototype.forEach.call($('drawerBody').querySelectorAll('[data-fact]'), function (el) {
      el.addEventListener('click', function () {
        closeDrawer();
        setView('facts');
        var row = findFactRow(el.dataset.fact);
        if (row) {
          row.classList.add('open');
          var body = row.querySelector('.detail-body');
          if (body && !body.dataset.filled) fillDetail(body);
          row.scrollIntoView({ block: 'center' });
          row.focus({ preventScroll: true });
        }
      });
    });
  }

  function projectCard(p) {
    var status = p.status || '未标注';
    var blocked = p.blocked && p.blocked !== '无' ? p.blocked : '';
    var acts = projectActivity(p);
    var last = acts[0];
    return '<article class="proj" data-status="' + esc(status) + '" data-project="' + esc(p.stem) +
      '" tabindex="0" role="button" aria-label="打开项目：' + esc(p.title) + '">' +
      '<header><span class="proj-folder"><i class="dot"></i>' + esc(p.folder || '未分类') + '</span>' +
      '<span class="chip chip-status">' + esc(status) + '</span></header>' +
      '<h3>' + esc(p.title) + '</h3>' +
      (p.next ? '<p class="proj-line"><span class="k">下一步</span>' + esc(p.next) + '</p>' : '') +
      (blocked ? '<p class="proj-line warn"><span class="k">卡点</span>' + esc(blocked) + '</p>' : '') +
      '<footer><span>' + esc(p.updated || '未记录更新') + '</span>' +
      (p.priority ? '<span>' + esc(p.priority) + '优先级</span>' : '') +
      (last ? '<span>最近 ' + esc(last.tool) + ' · ' + esc((last.date || '').slice(5)) + '</span>' : '') +
      (acts.length > 1 ? '<span>' + acts.length + ' 条关联对话</span>' : '') +
      '</footer></article>';
  }

  function runRow(f) {
    return '<button class="run" data-run="' + esc(f.file) + '">' +
      '<span class="run-date">' + esc(f.date) + '</span>' +
      '<span class="run-tool">' + esc(f.tool) + '</span>' +
      '<span class="run-title">' + esc(f.title) + '</span>' +
      (f.status === '进行中' ? '<span class="live">进行中</span>' : '') +
      '</button>';
  }

  function claimRow(c) {
    return '<div class="claim">' +
      '<div class="claim-task">' + esc(c.task) + '</div>' +
      '<div class="claim-meta">' +
        '<span class="claim-who">' + esc(c.agent) + '</span>' +
        '<span class="claim-since">' + esc(c.since) + '</span>' +
        '<span class="chip-status">' + esc(c.status) + '</span>' +
      '</div>' +
      (c.note ? '<div class="claim-note">' + esc(c.note) + '</div>' : '') +
      '</div>';
  }

  function renderWork() {
    var projects = MEM.projects || [];
    var agents = MEM.agents || [];
    var pending = MEM.intents.filter(isPending);
    var confirm = MEM.intents.filter(isToConfirm);
    var closed = MEM.intents.filter(isClosed);
    var blocked = projects.filter(function (p) { return p.blocked && p.blocked !== '无'; });
    var active = projects.filter(function (p) { return p.status === '进行中'; });
    var runs = MEM.facts.filter(function (f) {
      return state.agent === 'all' || f.tool === state.agent;
    }).slice(0, 8);

    var claims = MEM.claims || [];
    var html = '<div class="work-stats">' +
      '<div class="stat"><b class="num">' + active.length + '</b><span>个项目在推进</span></div>' +
      '<div class="stat' + (blocked.length ? ' warn' : '') + '"><b class="num">' + blocked.length + '</b><span>个卡着等你</span></div>' +
      '<div class="stat"><b class="num">' + pending.length + '</b><span>项待办未完成</span></div>' +
      '<div class="stat"><b class="num">' + agents.length + '</b><span>个 Agent 有记录</span></div>' +
      '</div>';

    html += '<section class="work-block"><div class="section-heading"><span class="section-number">01</span><h2>项目</h2>' +
      '<span class="count">' + projects.length + ' 个</span></div>' +
      (projects.length ? '<div class="proj-grid">' + projects.map(projectCard).join('') + '</div>'
        : '<div class="empty"><strong>还没有项目笔记</strong>在 04-项目 下新建，并把 type 设为「项目」。</div>') +
      '</section>';

    html += '<section class="work-block"><div class="section-heading"><span class="section-number">02</span><h2>任务</h2>' +
      '<button class="text-btn" data-go="intents">全部待办</button></div>' +
      '<div class="board">' +
        '<div class="board-col"><div class="board-head">待处理<span class="count">' + pending.length + '</span></div>' +
          (pending.length ? '<div class="intents">' + pending.slice(0, 6).map(intentRow).join('') + '</div>'
            : '<div class="empty"><strong>待办已清空</strong></div>') +
          (pending.length > 6 ? '<button class="text-btn board-more" data-go="intents">还有 ' + (pending.length - 6) + ' 项 →</button>' : '') +
        '</div>' +
        '<div class="board-col"><div class="board-head">待确认结案<span class="count">' + confirm.length + '</span></div>' +
          (confirm.length ? '<div class="intents">' + confirm.slice(0, 4).map(intentRow).join('') + '</div>'
            : '<div class="empty"><strong>没有待确认</strong></div>') +
        '</div>' +
        '<div class="board-col"><div class="board-head">最近结案<span class="count">' + closed.length + '</span></div>' +
          (closed.length ? '<div class="intents">' + closed.slice(0, 4).map(intentRow).join('') + '</div>'
            : '<div class="empty"><strong>还没有结案</strong></div>') +
        '</div>' +
      '</div></section>';

    html += '<section class="work-block"><div class="section-heading"><span class="section-number">03</span><h2>谁在做什么</h2>' +
      '<span class="count">' + claims.length + ' 条认领</span></div>' +
      (claims.length ? '<div class="claims">' + claims.map(claimRow).join('') + '</div>'
        : '<div class="empty"><strong>还没有认领</strong>开工前在 08-AI记忆/_agent/claims.md 写一行，其他 Agent 就不会撞车。</div>') +
      '</section>';

    html += '<section class="work-block"><div class="section-heading"><span class="section-number">04</span><h2>Agent 运行</h2>' +
      '<button class="text-btn" data-go="facts">全部对话</button></div>' +
      '<div class="agent-strip">' +
        '<button class="agent' + (state.agent === 'all' ? ' on' : '') + '" data-agent="all">' +
          '<b>全部</b><span>' + MEM.facts.length + ' 次会话</span></button>' +
        agents.map(function (a) {
          return '<button class="agent' + (state.agent === a.name ? ' on' : '') + '" data-agent="' + esc(a.name) + '">' +
            '<b>' + esc(a.name) + '</b>' +
            '<span>' + a.sessions + ' 次 · 最近 ' + esc(a.last || '—') + '</span>' +
            (a.active ? '<i class="live">' + a.active + ' 进行中</i>' : '') + '</button>';
        }).join('') +
      '</div>' +
      '<div class="runs">' + (runs.length ? runs.map(runRow).join('')
        : '<div class="empty"><strong>这个 Agent 还没有存档</strong></div>') + '</div></section>';

    $('view-work').innerHTML = html;
    bindIntentActions($('view-work'));
    Array.prototype.forEach.call($('view-work').querySelectorAll('[data-go]'), function (el) {
      el.addEventListener('click', function () { setView(el.dataset.go); });
    });
    Array.prototype.forEach.call($('view-work').querySelectorAll('[data-project]'), function (el) {
      el.addEventListener('click', function () { openProject(el.dataset.project); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProject(el.dataset.project); }
      });
    });
    Array.prototype.forEach.call($('view-work').querySelectorAll('[data-agent]'), function (el) {
      el.addEventListener('click', function () {
        state.agent = el.dataset.agent;
        renderWork();
      });
    });
    Array.prototype.forEach.call($('view-work').querySelectorAll('[data-run]'), function (el) {
      el.addEventListener('click', function () {
        setView('facts');
        var row = findFactRow(el.dataset.run);
        if (row) {
          row.classList.add('open');
          var body = row.querySelector('.detail-body');
          if (body && !body.dataset.filled) fillDetail(body);
          row.scrollIntoView({ block: 'center' });
          row.focus({ preventScroll: true });
        }
      });
    });
  }

  // ---------- 事实正文（按需取） ----------
  // 正文合计约 5 MB，占了索引的 89%。generate.py 已按月拆到 facts/YYYY-MM.bin，
  // 展开某条时才下载并解密它所在的那一期；同一期只取一次，缓存在内存里。
  var CHUNK_CACHE = {};    // 'YYYY-MM' -> { 文件名: 正文 }
  var CHUNK_PENDING = {};  // 'YYYY-MM' -> Promise，同一期并发展开不会拉两遍

  function factByFile(file) {
    for (var i = 0; i < MEM.facts.length; i++) {
      if (MEM.facts[i].file === file) return MEM.facts[i];
    }
    return null;
  }

  function loadChunk(month) {
    if (CHUNK_CACHE[month]) return Promise.resolve(CHUNK_CACHE[month]);
    if (CHUNK_PENDING[month]) return CHUNK_PENDING[month];
    var p = PortalCrypto.decryptChunk(month).then(function (map) {
      delete CHUNK_PENDING[month];
      CHUNK_CACHE[month] = map || {};
      return CHUNK_CACHE[month];
    }, function (e) {
      delete CHUNK_PENDING[month];
      throw e;
    });
    CHUNK_PENDING[month] = p;
    return p;
  }

  // 先写占位再取：正文几十 KB，等它回来才撑开会让列表往下跳一大截
  function fillDetail(body) {
    body.dataset.filled = '1';
    var f = factByFile(body.dataset.file);
    if (!f || !f.chunk) { body.textContent = ''; return; }
    body.textContent = '正在读取这段对话…';
    loadChunk(f.chunk).then(function (map) {
      body.textContent = map[body.dataset.file] || '（这一期分片里没有这条正文）';
    }, function (e) {
      console.error(e);
      body.textContent = e && e.message === 'FETCH_FAILED'
        ? '正文没取到：facts/' + f.chunk + '.bin 不在线上，重新生成门户后再试'
        : '正文解密失败，刷新页面重新输入密码';
    });
  }

  // ---------- 事实 ----------
  // 只有事实可以删：有些对话不值得留。删除走本地服务移进 _已作废/，线上降级为复制指令。
  var pickMode = false;      // 合并选择模式
  var picked = [];           // 选中的文件名

  // P6-C 运行记录。默认收起：一份长会话可能有 20 批、上百步，
  // 全展开会把「最近对话」列表撑成日志墙。展开后按批次分组，失败步标红。
  function runsBlock(f) {
    var runs = f.runs || [];
    if (!runs.length) return '';
    var total = runs.reduce(function (n, r) { return n + r.count; }, 0);
    var fails = runs.reduce(function (n, r) { return n + (r.fail || 0); }, 0);
    var steps = runs.reduce(function (n, r) { return n + r.steps.length; }, 0);
    var cut = total - steps;
    var head = '<summary><b>运行记录</b>' +
      '<span class="runs-meta">' + runs.length + ' 批 · ' + total + ' 步' +
      (fails ? ' · <i class="runs-fail">失败 ' + fails + '</i>' : '') +
      (cut ? ' · 另有 ' + cut + ' 步未入门户' : '') + '</span></summary>';
    var body = runs.map(function (r) {
      var rows = r.steps.map(function (s) {
        return '<li class="' + (s.ok ? 'ok' : 'bad') + '">' +
          '<span class="step-mark">' + (s.ok ? '✓' : '✗') + '</span>' +
          '<span class="step-tool">' + esc(s.tool) + '</span>' +
          '<span class="step-brief">' + esc(s.brief || '（无摘要）') + '</span>' +
          (s.stored ? '<span class="step-out">有输出</span>' : '') +
          '</li>';
      }).join('');
      return '<div class="run-batch">' +
        '<div class="run-head">' + esc(r.summary || '工具批') +
        '<span>' + r.count + ' 步' + (r.fail ? ' · 失败 ' + r.fail : '') + '</span></div>' +
        '<ul class="run-steps">' + rows + '</ul>' +
        (r.truncated ? '<div class="run-cut">本批另有 ' + r.truncated + ' 步未入门户</div>' : '') +
        '</div>';
    }).join('');
    return '<details class="runs-panel">' + head + '<div class="runs-body">' + body + '</div></details>';
  }

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
          runsBlock(f) +
          // 正文按需渲染：32 条存档合计 38 万字符，一次性塞进 DOM 会让首屏卡住。
          // 用文件名做键：列表可能被工具筛选过，下标对不上 MEM.facts。
          '<div class="detail-body" data-file="' + esc(f.file) + '"></div>' +
          '<div class="detail-actions">' +
            '<button class="action-btn sm" data-continue="' + esc(f.file) + '">复制续接指令</button>' +
            '<button class="text-btn" data-terminal="' + esc(f.file) + '">在终端继续</button>' +
          '</div>' +
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
          if (body && !body.dataset.filled) fillDetail(body);
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

    // 从这条事实继续：复制指令 / 本地直接开终端
    Array.prototype.forEach.call(root.querySelectorAll('[data-continue]'), function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var f = MEM.facts.filter(function (x) { return x.file === el.dataset.continue; })[0];
        if (!f) return;
        copyText(factPrompt(f), function (ok) {
          el.textContent = ok ? '已复制 ✓' : '复制失败';
          setTimeout(function () { el.textContent = '复制续接指令'; }, 1800);
        });
      });
    });

    Array.prototype.forEach.call(root.querySelectorAll('[data-terminal]'), function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var f = MEM.facts.filter(function (x) { return x.file === el.dataset.terminal; })[0];
        if (!f) return;
        if (!isLocalServer()) {
          copyText(factPrompt(f), function () {
            el.textContent = '线上开不了终端，指令已复制';
            setTimeout(function () { el.textContent = '在终端继续'; }, 2400);
          });
          return;
        }
        el.textContent = '正在打开终端…';
        fetch('/api/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: factPrompt(f), file: f.file })
        }).then(function (r) { return r.json(); })
          .then(function (res) {
            el.textContent = res.ok ? '终端已打开 ✓' : ('失败：' + (res.error || '未知错误'));
            setTimeout(function () { el.textContent = '在终端继续'; }, 2600);
          })
          .catch(function () {
            el.textContent = '本地服务不可用';
            setTimeout(function () { el.textContent = '在终端继续'; }, 2600);
          });
      });
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
      if (state.panel === 'overview') renderOverview();
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
      if (state.panel === 'overview') renderOverview();
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
      if (state.panel === 'overview') renderOverview();
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

  // 状态（pending / started / blocked / closed）与优先级正交，来自行尾标记
  function taskState(i) {
    var o = override[i.task];
    if (o && o.state) return o.state;
    return i.state || (i.closed ? 'closed' : (i.done ? 'started' : 'pending'));
  }
  function isStarted(i) { return taskState(i) === 'started'; }
  function isBlocked(i) { return taskState(i) === 'blocked'; }

  function stateTag(i) {
    var st = taskState(i);
    if (st === 'blocked') {
      return '<span class="state-tag blocked" title="阻塞中">阻塞' +
        (i.blocked_kind ? ' · ' + esc(i.blocked_kind) : '') + '</span>';
    }
    if (st === 'started' && !isClosed(i)) {
      return '<span class="state-tag started" title="已认领">' +
        (i.state_date ? esc(i.state_date.slice(5)) : '在做') + '</span>';
    }
    return '';
  }

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
    } else if (canWrite || cloudReady()) {
      // Stage B：认领 / 阻塞直接写回；线上只读时降级为复制指令（沿用同一套按钮）
      var btns = [];
      if (isBlocked(t)) {
        btns.push('<button class="state-btn" data-task="' + esc(t.task) + '" data-action="unblock">解除阻塞</button>');
      } else {
        if (isStarted(t)) {
          btns.push('<button class="state-btn" data-task="' + esc(t.task) + '" data-action="unclaim">撤回认领</button>');
        } else {
          btns.push('<button class="state-btn" data-task="' + esc(t.task) + '" data-action="claim">认领</button>');
        }
        btns.push('<button class="state-btn" data-task="' + esc(t.task) + '" data-action="block" data-kind="等外部">阻塞</button>');
      }
      action = btns.join('');
    }

    return '<div class="' + cls + '" data-task-row="' + esc(t.task) + '" tabindex="-1">' +
      box +
      '<div class="intent-text">' + esc(t.task) + ' ' + stateTag(t) + '</div>' +
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
          var kind = el.dataset.kind || '';
          if (canWrite) {
            if (STATUS_ACTIONS.indexOf(action) >= 0) writeEdit(task, action, kind, el);
            else writeStatus(task, action, el);
          } else if (cloudReady()) {
            if (STATUS_ACTIONS.indexOf(action) >= 0) writeEditCloud(task, action, kind, el);
            else writeStatusCloud(task, action, el);
          } else {
            copyInstruction(task, action, el);
          }
        });
      }
    );
  }

  // ---------- Stage B：认领 / 阻塞写回 ----------
  var STATUS_ACTIONS = ['claim', 'unclaim', 'block', 'unblock'];
  var editSha = '';   // 乐观锁：GET /api/status 给的待办文件指纹

  function editOverride(task, action, kind) {
    var o = override[task] || (override[task] = {});
    if (action === 'claim') o.state = 'started';
    else if (action === 'unclaim') o.state = 'pending';
    else if (action === 'block') { o.state = 'blocked'; o.blocked_kind = kind || '等外部'; }
    else if (action === 'unblock') o.state = 'started';
  }

  function writeEdit(task, action, kind, el) {
    if (el.disabled) return;
    el.disabled = true;
    fetch('/api/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: task, action: action, kind: kind, sha: editSha })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) {
        if (res.stale) { editSha = res.sha || ''; toast('待办刚被改过，已刷新，请再点一次', true); }
        else toast(res.error || '写入失败', true);
        throw new Error(res.error || '写入失败');
      }
      if (res.sha) editSha = res.sha;
      editOverride(task, action, kind);
      renderIntents();
      renderWork();
      renderRail();
      renderHead();
      if (state.panel === 'overview') renderOverview();
    }).catch(function (err) {
      el.disabled = false;
      if (err && err.message) toast(err.message, true);
    });
  }

  function writeEditCloud(task, action, kind, el) {
    if (el.disabled) return;
    el.disabled = true;
    cloudPost('/edit', { task: task, action: action, kind: kind, sha: editSha }).then(function (res) {
      if (!res.ok) throw new Error(res.error || '写入失败');
      if (res.sha) editSha = res.sha;
      editOverride(task, action, kind);
      renderIntents();
      renderWork();
      renderRail();
      renderHead();
      if (state.panel === 'overview') renderOverview();
    }).catch(function (err) {
      el.disabled = false;
      toast('云端写入失败：' + err.message, true);
    });
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
      if (state.panel === 'overview') renderOverview();
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
      if (state.panel === 'overview') renderOverview();
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
          if (j.sha) editSha = j.sha;   // 首次拿到待办指纹，后续写回带它做乐观锁

          // 事实视图的删除 / 合并按钮只在可写时出现，探测完要重绘一次
          if (state.panel === 'intents') renderIntents();
          else if (state.panel === 'facts') renderFacts();
          else if (state.panel === 'overview') renderOverview();
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

  function renderKnowledge() {
    var ds = MEM.sections.distilled || { rows: [], count: 0 };
    var sk = MEM.sections.skills || { rows: [], count: 0 };
    var tl = MEM.sections.tools || { rows: [], count: 0 };

    var kn = MEM.knowledge || [];
    var html = '<div class="sec-label"><h2>可复用结论</h2>' +
      '<span class="count">' + (kn.length || ds.count || 0) + ' 条</span></div>';
    html += '<p class="sec-note">一条知识一个文件，正文要答四件事：是什么、有什么用、可以借鉴什么、为什么是这样。点开看细节。</p>';
    if (kn.length) {
      html += '<div class="kn-grid">';
      kn.forEach(function (k) {
        var chips = '';
        if (k.category) chips += '<span class="kn-chip">' + esc(k.category) + '</span>';
        if (k.domain) chips += '<span class="kn-chip kn-chip-dim">' + esc(k.domain) + '</span>';
        var more = '';
        if (k.use) more += '<details class="kn-more"><summary>有什么用</summary><p>' + esc(k.use) + '</p></details>';
        if (k.learn) more += '<details class="kn-more"><summary>可以借鉴什么</summary><p>' + esc(k.learn) + '</p></details>';
        if (k.why) more += '<details class="kn-more"><summary>为什么是这样</summary><p>' + esc(k.why) + '</p></details>';
        html += '<article class="kn-card">' +
          '<div class="kn-head">' + chips + '<time>' + esc(k.created || '') + '</time></div>' +
          '<h3>' + esc(k.title) + '</h3>' +
          '<p class="kn-what">' + esc(k.what || k.summary || '') + '</p>' +
          more +
          '</article>';
      });
      html += '</div>';
    } else {
      html += tableSection(ds, '还没有蒸馏知识');
    }

    html += '<div class="sec-label" style="margin-top:38px"><h2>技能</h2>' +
      '<span class="count">' + (sk.count || 0) + ' 个</span></div>';
    html += '<p class="sec-note">Agent 可复用的流程。一个技能一个目录，里面是 SKILL.md。</p>';
    html += tableSection(sk, '还没有登记技能');

    html += '<div class="sec-label" style="margin-top:38px"><h2>工具</h2>' +
      '<span class="count">' + (tl.count || 0) + ' 个</span></div>';
    html += '<p class="sec-note">拿来就能跑的东西：命令行、脚本、外部服务、API。</p>';
    html += tableSection(tl, '还没有登记工具');

    $('view-knowledge').innerHTML = html;
  }


  // ---------- 要求：用户每次提的话，按时间排 ----------
  var reqState = { q: '', kind: 'all', hidden: null, hiddenErr: '' };

  // 删除的语义：**只记隐藏清单，对话存档一个字都不动**。
  // 所以这里不需要确认弹窗——错了点「已隐藏」再恢复就行，原文一直在存档里。
  function reqPost(path, keys) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: keys })
    }).then(function (r) { return r.json(); });
  }

  function hideRequests(keys, el) {
    if (el) { el.disabled = true; el.textContent = '…'; }
    reqPost('/api/requests/delete', keys).then(function (res) {
      if (!res.ok) throw new Error(res.error || '删除失败');
      var gone = {};
      keys.forEach(function (k) { gone[k] = true; });
      MEM.requests = (MEM.requests || []).filter(function (r) { return !gone[r.key]; });
      reqState.hidden = null;          // 下次进「已隐藏」时重新拉
      renderRequests();
      renderRail();
      toast('已隐藏 ' + keys.length + ' 条（存档未改动，可在「已隐藏」里恢复）');
    }).catch(function (err) {
      if (el) { el.disabled = false; el.textContent = '删除'; }
      toast('删除失败：' + err.message, true);
    });
  }

  function restoreRequests(keys, el) {
    if (el) { el.disabled = true; el.textContent = '…'; }
    reqPost('/api/requests/restore', keys).then(function (res) {
      if (!res.ok) throw new Error(res.error || '恢复失败');
      var back = {};
      keys.forEach(function (k) { back[k] = true; });
      reqState.hidden = (reqState.hidden || []).filter(function (r) { return !back[r.key]; });
      // 内存里删过的那条已经没了，插不回来——重拉一份完整列表，比在前端拼字段可靠
      return fetch('/api/requests/list').then(function (r) { return r.json(); })
        .then(function (list) {
          if (list.ok) MEM.requests = list.items;
          renderRequests();
          toast('已恢复 ' + keys.length + ' 条');
        });
    }).catch(function (err) {
      if (el) { el.disabled = false; el.textContent = '恢复'; }
      toast('恢复失败：' + err.message, true);
    });
  }

  function loadHidden(done) {
    fetch('/api/requests/hidden').then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) throw new Error(res.error || '读取失败');
      reqState.hidden = res.items || [];
      reqState.hiddenErr = '';
      done();
    }).catch(function (err) {
      reqState.hidden = [];
      reqState.hiddenErr = err.message;
      done();
    });
  }

  function renderRequests() {
    var all = MEM.requests || [];
    var local = isLocalServer();
    if (reqState.kind === 'hidden' && reqState.hidden === null && local) {
      $('view-requests').innerHTML = '<p class="sec-note">读取隐藏清单…</p>';
      loadHidden(renderRequests);
      return;
    }
    if (!all.length && reqState.kind !== 'hidden') {
      $('view-requests').innerHTML =
        '<p class="sec-note">还没有从对话存档里抽到要求。运行 <code>python -I 08-AI记忆/tools/extract_requests.py</code> 看一下。</p>';
      return;
    }

    var q = reqState.q.trim().toLowerCase();
    var rows = all.filter(function (r) {
      if (reqState.kind !== 'all' && reqState.kind !== 'hidden' && r.kind !== reqState.kind) return false;
      if (!q) return true;
      return (r.text + ' ' + r.file + ' ' + r.date).toLowerCase().indexOf(q) !== -1;
    });
    if (reqState.kind === 'hidden') {
      // 已隐藏列表来自清单文件，不受正文筛选影响；搜索只筛当前展示的这一栏
      rows = (reqState.hidden || []).filter(function (r) {
        if (!q) return true;
        return (r.text + ' ' + r.file + ' ' + r.date).toLowerCase().indexOf(q) !== -1;
      });
    }

    // 按天分组，天内的顺序由抽取脚本保证（真实时间优先）
    var byDate = {};
    var order = [];
    rows.forEach(function (r) {
      var d = r.date || '未标日期';
      if (!byDate[d]) { byDate[d] = []; order.push(d); }
      byDate[d].push(r);
    });
    order.sort().reverse();

    var nReq = rows.filter(function (r) { return r.kind === 'request'; }).length;
    var isHiddenView = reqState.kind === 'hidden';
    var html = '<div class="sec-label"><h2>' + (isHiddenView ? '已隐藏的要求' : '我提过的要求') + '</h2>' +
      '<span class="count">' + rows.length + ' 条' +
        (isHiddenView ? '' : '（要求 ' + nReq + ' / 回执 ' + (rows.length - nReq) + '）') +
      '</span></div>' +
      '<p class="sec-note">' + (isHiddenView
        ? '这些只是从列表里藏起来了，<b>对话存档一个字都没动</b>，原文随时能翻。点「恢复」就回到列表。'
        : '从对话存档里按时间抽出来的。标「回执」的是「继续」「要」「执行」这类应答，' +
          '留着是为了看出节奏；后台通知、压缩摘要、系统注入的时间戳已经剔除。') +
      '</p>' +
      '<div class="req-bar">' +
        '<input id="reqSearch" type="search" placeholder="搜要求内容、存档名、日期…" value="' +
          esc(reqState.q) + '" aria-label="搜索要求">' +
        '<div class="req-kinds" role="group" aria-label="按类型筛选">' +
          ['all', 'request', 'ack', 'hidden'].map(function (k) {
            var label = { all: '全部', request: '只看要求', ack: '只看回执', hidden: '已隐藏' }[k];
            return '<button class="chip" data-kind="' + k + '" aria-pressed="' +
              (reqState.kind === k) + '">' + label + '</button>';
          }).join('') +
        '</div>' +
        (local && !isHiddenView
          ? '<button class="chip req-hide-all" id="reqHidePicked">删除选中的</button>'
          : '') +
      '</div>';

    if (!rows.length) {
      html += '<p class="sec-note">' +
        (isHiddenView ? (reqState.hiddenErr ? '读取隐藏清单失败：' + esc(reqState.hiddenErr)
                                            : '隐藏清单是空的。')
                      : '没有匹配项。') + '</p>';
    }

    order.forEach(function (d) {
      var list = byDate[d];
      html += '<div class="req-day"><div class="req-day-head">' +
        '<b>' + esc(d) + '</b><span class="count">' + list.length + ' 条</span></div>';
      list.forEach(function (r) {
        var i = all.indexOf(r);
        var btn = local
          ? (isHiddenView
              ? '<button class="req-del" data-key="' + esc(r.key || '') + '" data-act="restore">恢复</button>'
              : '<button class="req-del" data-key="' + esc(r.key || '') + '" data-act="hide" ' +
                'aria-label="从列表隐藏这条">删除</button>')
          : '';
        html += '<div class="req-row" data-idx="' + i + '" data-key="' + esc(r.key || '') + '">' +
          '<span class="req-time num">' + esc(r.time || '--:--') + '</span>' +
          '<span class="req-kind ' + (r.kind === 'ack' ? 'is-ack' : '') + '">' +
            (r.kind === 'ack' ? '回执' : '要求') + '</span>' +
          '<span class="req-text">' + esc(r.text) + '</span>' +
          '<span class="req-src">' + esc(r.file) + '</span>' +
          btn +
          '</div>';
      });
      html += '</div>';
    });

    if (local && !isHiddenView) {
      html += '<p class="sec-note req-tip">删除＝只从列表藏起来，存档不动，可在「已隐藏」里恢复。' +
        '线上版没有删除入口——它读的是静态快照。</p>';
    }

    $('view-requests').innerHTML = html;

    var input = $('reqSearch');
    if (input) {
      input.addEventListener('input', function () {
        reqState.q = this.value;
        renderRequests();
        var again = $('reqSearch');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      });
    }
    Array.prototype.forEach.call(
      $('view-requests').querySelectorAll('.req-del'),
      function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var key = btn.dataset.key;
          if (!key) return;
          if (btn.dataset.act === 'restore') restoreRequests([key], btn);
          else hideRequests([key], btn);
        });
      }
    );
    // 多选：点行身选中，不点行就不会误删；单条删除走右边的按钮
    Array.prototype.forEach.call(
      $('view-requests').querySelectorAll('.req-row'),
      function (row) {
        row.addEventListener('click', function () {
          if (!local || isHiddenView) return;
          row.classList.toggle('picked');
        });
      }
    );
    var bulk = $('reqHidePicked');
    if (bulk) {
      bulk.addEventListener('click', function () {
        var keys = Array.prototype.map.call(
          $('view-requests').querySelectorAll('.req-row.picked'),
          function (row) { return row.dataset.key; }
        ).filter(Boolean);
        if (!keys.length) return toast('先点一下要删的行', true);
        bulk.textContent = '…';
        hideRequests(keys, bulk);
      });
    }
    Array.prototype.forEach.call(
      $('view-requests').querySelectorAll('.req-kinds .chip'),
      function (btn) {
        btn.addEventListener('click', function () {
          reqState.kind = btn.dataset.kind;
          if (btn.dataset.kind === 'hidden' && reqState.hidden === null) reqState.hidden = null;
          renderRequests();
        });
      }
    );
  }


  // ---------- 磁盘 ----------
  // 门户只展示 purrge 的扫描结果，**没有任何删除入口**。
  // 清理必须去 purrge 自己的审查页勾选确认——这里是「看板」，不是「操作台」。
  var diskState = { data: null, loading: false, err: '', polling: 0 };

  function diskPost(path) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (r) { return r.json(); });
  }

  function loadDisk(done) {
    diskState.loading = true;
    fetch('/api/disk').then(function (r) { return r.json(); }).then(function (res) {
      diskState.data = res;
      diskState.loading = false;
      diskState.err = res.ok === false ? (res.error || '读取失败') : '';
      if (done) done();
    }).catch(function (err) {
      diskState.loading = false;
      diskState.err = err.message;
      if (done) done();
    });
  }

  function diskStartScan(btn) {
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = '已开始…';
    diskPost('/api/disk/scan').then(function (res) {
      if (!res.ok) throw new Error(res.error || '启动失败');
      toast(res.message || '已开始扫描');
      // 扫描 1～2 分钟：轮询到新 run 出现为止，最多盯 4 分钟
      var before = (diskState.data && diskState.data.run || {}).dir || '';
      var tries = 0;
      clearInterval(diskState.polling);
      diskState.polling = setInterval(function () {
        tries += 1;
        loadDisk(function () {
          var now = (diskState.data && diskState.data.run || {}).dir || '';
          if ((now && now !== before) || tries > 48) {
            clearInterval(diskState.polling);
            btn.disabled = false;
            btn.textContent = label;
            renderDisk();
            if (now && now !== before) toast('扫描完成，结果已更新');
          }
        });
      }, 5000);
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = label;
      toast('启动扫描失败：' + err.message, true);
    });
  }

  function diskOpenReview(btn) {
    btn.disabled = true;
    diskPost('/api/disk/review').then(function (res) {
      if (!res.ok) throw new Error(res.error || '打开失败');
      toast(res.message || '已打开审查页');
    }).catch(function (err) {
      toast('打开审查页失败：' + err.message, true);
    }).then(function () { btn.disabled = false; });
  }

  // ---------- 使用（每次会话用了什么） ----------
  function usageNum(n) {
    return String(n == null ? 0 : n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ---------- 协作：谁派的谁，各自走到哪 ----------
  // 数据来自 08-AI记忆/tools/agent_chains.py 的快照。门户是静态站，
  // 所以这里只能显示「截至某时」的状态，实时视图在本地 6869。
  function agDur(s) {
    s = Math.max(0, s || 0);
    if (s < 60) return Math.round(s) + ' 秒';
    if (s < 3600) return Math.round(s / 60) + ' 分';
    if (s < 86400) return (s / 3600).toFixed(1) + ' 小时';
    return (s / 86400).toFixed(1) + ' 天';
  }

  function agClock(t) {
    if (!t) return '—';
    var d = new Date(t * 1000);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function agClip(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // DSH 的标题就是任务原文，十个子代理都叫「你是阅读分析员…」，当名字没法用。
  // 名字统一用「工具 + 短 id」，「做什么」交给下一行的任务摘要。
  function agName(a) {
    return (a.runtime === 'DSH' ? 'DSH ' : 'CC ') + (a.short || '');
  }

  // 快照的「正在跑」要相对生成时刻判断；用浏览时的时间会把所有条都判成空闲。
  var agRef = 0;

  function agState(a) {
    if (a.ended) return '已结束';
    var age = a.lastTs && agRef ? agRef - a.lastTs : 0;
    if (age < 45) return '快照时在跑';
    return '空闲 ' + agDur(age);
  }

  // 活跃时长：把 segments 的区间加起来，不拿「首尾相减」当执行时间，
  // 否则跨几天的会话会把睡觉的时间也算进去。
  function agActive(a) {
    var s = 0;
    (a.segments || []).forEach(function (seg) { s += Math.max(0, seg[1] - seg[0]); });
    return s;
  }

  // 一个 agent 的四个阶段：派发 → 执行 → 反馈 → 检查。
  // 时间都来自会话日志；「检查」是父代理在子代理回报之后又有动作，属于推断。
  function agPhases(a) {
    var isRoot = !a.parent;
    var state = agState(a);
    var exec = (a.steps || 0) === 0 ? 'wait' : (state === '快照时在跑' ? 'live' : 'done');
    return [
      { k: '派发', t: a.createdAt || 0, s: a.createdAt ? 'done' : 'wait' },
      { k: '执行', t: a.lastTs || 0, s: exec,
        d: exec === 'wait' ? '' : (exec === 'live' ? '进行中 ' : '') + agDur(agActive(a)) },
      { k: '反馈', t: isRoot ? (a.lastTs || 0) : (a.reportTs || 0),
        s: (isRoot ? !!a.lastText : !!a.reportTs) ? 'done' : 'wait' },
      { k: '检查', t: isRoot ? 0 : (a.checkedTs || 0),
        s: (!isRoot && a.checkedTs) ? 'done' : 'wait' }
    ];
  }

  function agBot(a, isRoot) {
    var state = agState(a);
    var task = a.task || '';
    var ps = agPhases(a);
    var flow = ps.map(function (p, i) {
      var next = ps[i + 1];
      // 连线颜色看「下一站到没到」，不是看当前站：反馈完了不等于检查过了
      var cls = p.s + (next && p.s === 'done' && next.s === 'done' ? ' link' : '');
      return '<li class="' + cls + '"><span class="ag-ph">' + p.k + '</span>' +
        '<span class="ag-pt">' + (p.d || (p.t ? agClock(p.t) : '—')) + '</span></li>';
    }).join('');
    var more = '';
    if (task || a.lastText) {
      more = '<details class="ag-more"><summary>任务原文与输出</summary>' +
        (task ? '<div class="ag-k">派了什么活</div><p class="ag-v">' + esc(task) + '</p>' : '') +
        (a.lastText ? '<div class="ag-k">最后一段输出</div><p class="ag-v">' + esc(a.lastText) + '</p>' : '') +
        '</details>';
    }
    return '<article class="ag-bot' + (isRoot ? ' root' : '') + '">' +
      '<div class="ag-bot-head"><span class="ag-dot' + (state === '快照时在跑' ? ' on' : '') + '"></span>' +
      '<b>' + esc(agName(a)) + '</b>' +
      '<span class="ag-role">' + (isRoot ? '父代理' : '子代理') + '</span>' +
      '<span class="ag-bot-meta">' + (a.steps || 0) + ' 步' +
        (a.lastTool ? ' · ' + esc(a.lastTool) : '') + ' · ' + state + '</span></div>' +
      '<p class="ag-bot-task">' + (task ? esc(agClip(task, 100)) :
        '<span class="ag-none">日志里没有可辨识的任务原文</span>') + '</p>' +
      '<ol class="ag-flow" aria-label="调度状态">' + flow + '</ol>' + more + '</article>';
  }

  // 父代理在上，子代理缩进挂在下面——连线方向就是「谁派了谁」。
  function agTree(members) {
    var root = members.filter(function (a) { return !a.parent; })[0] || members[0];
    var kids = members.filter(function (a) { return a !== root; });
    return '<div class="ag-tree">' + agBot(root, true) +
      (kids.length ? '<div class="ag-branch">' + kids.map(function (a) {
        return agBot(a, false);
      }).join('') + '</div>' : '') + '</div>';
  }

  function renderAgents() {
    var box = $('view-agents');
    if (!box) return;
    var ac = MEM.agentChains || {};
    var chains = ac.chains || [];
    var agents = ac.agents || {};
    if (!chains.length) {
      box.innerHTML = '<div class="sec-label"><h2>多 agent 协作</h2></div>' +
        '<p class="sec-note">还没有协作数据。在本机跑一次 ' +
        '<code>python 08-AI记忆/tools/agent_chains.py write</code> 再生成门户。</p>';
      return;
    }

    var multi = chains.filter(function (c) { return c.size > 1; });
    var single = chains.filter(function (c) { return c.size <= 1; });
    agRef = (ac.generatedAt || 0) / 1000;
    var running = chains.filter(function (c) { return c.running; }).length;
    var maxPeak = chains.reduce(function (m, c) { return Math.max(m, c.peak || 0); }, 0);
    var stamp = ac.generatedAt ? new Date(ac.generatedAt) : null;

    var html = '<div class="sec-label"><h2>调度台</h2>' +
      '<span class="count">' + multi.length + ' 条协作链</span></div>' +
      '<p class="sec-note">从 DSH 与 Claude Code 的会话日志里读出来的真实时间。' +
      '每张卡片是一个 agent：<strong>上面是父代理，缩进在下面的是它派出去的</strong>；' +
      '四个点依次是<strong>派发 → 执行 → 反馈 → 检查</strong>，时间取自会话记录。' +
      '「检查」表示父代理在子代理回报之后又有动作，是推断不是铁证。' +
      '跨工具的接力靠 <code>08-AI记忆/_agent/chains.jsonl</code> 登记。' +
      (stamp ? ' <b>数据截至 ' + agClock(stamp.getTime() / 1000) + '</b>（最后一条会话活动），之后的新会话要等下次生成。' : '') +
      '</p>' +
      '<div class="ag-stats">' +
      '<div class="ag-stat"><b class="num">' + ac.total + '</b><span>个会话</span></div>' +
      '<div class="ag-stat"><b class="num">' + running + '</b><span>快照时在跑</span></div>' +
      '<div class="ag-stat"><b class="num">' + multi.length + '</b><span>多会话链</span></div>' +
      '<div class="ag-stat"><b class="num">' + maxPeak + '</b><span>最大同时执行</span></div>' +
      '</div>';

    html += multi.slice(0, 12).map(function (c) {
      var root = agents[c.id] || {};
      var members = c.members.map(function (id) { return agents[id]; })
        .filter(function (a) { return a; });
      return '<section class="ag-card">' +
        '<div class="ag-head"><h3>' + esc(root.title || c.id) + '</h3>' +
        '<span class="ag-meta">' + c.size + ' 个会话 · ' + esc((c.runtimes || []).join(' + ')) +
        ' · 并发峰值 ' + (c.peak || 1) + ' · ' + agDur(c.lastTs - c.startTs) +
        ' · 最后活动 ' + agClock(c.lastTs) + '</span></div>' +
        agTree(members) + '</section>';
    }).join('');

    if (single.length) {
      html += '<details class="ag-single"><summary>另有 ' + single.length +
        ' 个单会话（没有派出子代理，也没有登记接力）</summary>' +
        '<div class="ag-single-list">' +
        single.slice(0, 40).map(function (c) {
          var a = agents[c.id] || {};
          return '<span>' + esc(agClip(a.title || c.id, 18)) +
            (a.task ? ' — ' + esc(agClip(a.task, 24)) : '') + ' · ' +
            agClock(c.lastTs) + '</span>';
        }).join('') + '</div></details>';
    }

    box.innerHTML = html;
  }

  function renderUsage() {
    var box = $('view-usage');
    if (!box) return;

    var u = MEM.usage || {};
    var cov = u.coverage || {};
    var rows = u.sessions || [];
    if (!rows.length) {
      box.innerHTML = '<div class="sec-label"><h2>使用</h2></div>' +
        '<p class="sec-note">还没有使用数据。运行 <code>python -I 08-AI记忆/tools/usage_index.py</code> 重建后再生成门户。</p>';
      return;
    }

    var tools = u.tools || [];
    var skills = u.skills || [];
    var maxTool = tools.length ? tools[0].count : 0;

    // 覆盖范围先说清楚：只有 Claude Code 的存档写工具明细，
    // 不说这句话，读者会以为其余会话一次工具都没调过。
    var html = '<div class="sec-label"><h2>每次会话用了什么</h2>' +
      '<span class="count">' + rows.length + ' 次会话</span></div>' +
      '<p class="sec-note">从对话存档的「🔧 工具执行」条目里抽出来的。' +
      '<b>这不是「总共只干了这么多活」</b>，是「有据可查的干了这么多活」——' +
      '只有 Claude Code 归档时写工具明细，另外 ' + (cov.sessions - cov.detailed) +
      ' 份存档只有正文，只出现在下面的会话表里。</p>';

    html += '<div class="usage-stats">' +
      '<div class="usage-stat"><span class="usage-n">' + cov.detailed + ' / ' + cov.sessions + '</span>' +
        '<span class="usage-k">带明细会话</span>' +
        '<span class="usage-h">其余只有正文，没有工具记录</span></div>' +
      '<div class="usage-stat"><span class="usage-n">' + usageNum(cov.calls) + '</span>' +
        '<span class="usage-k">成功调用</span>' +
        '<span class="usage-h">存档里带 ✓ 的条目</span></div>' +
      '<div class="usage-stat"><span class="usage-n">' + usageNum(cov.fails) + '</span>' +
        '<span class="usage-k">失败</span>' +
        '<span class="usage-h">失败率 ' + cov.rate + '%</span></div>' +
      '</div>';

    if (tools.length) {
      html += '<div class="sec-label"><h3>工具分布</h3></div>' +
        '<div class="usage-bars">' +
        tools.map(function (t) {
          var pct = maxTool ? Math.round(t.count / maxTool * 100) : 0;
          return '<div class="usage-bar-row">' +
            '<span class="usage-bar-k"><code>' + esc(t.name) + '</code></span>' +
            '<span class="usage-track"><span class="usage-fill" style="width:' + pct + '%"></span></span>' +
            '<span class="usage-bar-v num">' + usageNum(t.count) + '</span>' +
            '</div>';
        }).join('') + '</div>' +
        '<p class="sec-note">Bash 次数高不等于干得多：查目录、读状态、跑测试都算一次。' +
        '先定位再读，别用 Bash 满仓库 <code>cat</code>。</p>';
    }

    if (skills.length) {
      html += '<div class="sec-label"><h3>技能使用</h3>' +
        '<span class="count">' + skills.length + ' 个</span></div>' +
        '<div class="usage-skills">' +
        skills.map(function (s) {
          return '<span class="usage-skill"><code>' + esc(s.name) + '</code>' +
            '<span class="num">×' + s.count + '</span>' +
            (s.last ? '<span class="usage-skill-when">' + esc(s.last) + '</span>' : '') +
            '</span>';
        }).join('') + '</div>' +
        '<p class="sec-note">把这张表和技能库索引对一遍：<b>登记了却从没出现在这里的技能</b>，' +
        '下次接同类任务先想到它，或者在索引里标一句「为什么一直用不上」。</p>';
    }

    // 会话表：有明细的排前面，按时间倒序
    html += '<div class="sec-label"><h3>逐次会话</h3>' +
      '<span class="count">按时间倒序</span></div>' +
      '<div class="usage-sessions">' +
      rows.map(function (r) {
        var sk = (r.skills || []).length
          ? (r.skills || []).map(function (s) { return '<code>' + esc(s) + '</code>'; }).join(' ')
          : '<span class="usage-none">—</span>';
        var stat = r.detailed
          ? '<span class="num">' + usageNum(r.calls) + '</span> 次' +
            (r.fails ? ' · <span class="usage-fail">' + r.fails + ' 失败</span>' : '')
          : '<span class="usage-none">无工具明细</span>';
        return '<div class="usage-row' + (r.detailed ? '' : ' is-bare') + '">' +
          '<span class="usage-when">' + esc(r.date) + ' ' + esc(r.clock) + '</span>' +
          '<span class="usage-topic">' + esc(r.topic || r.file) + '</span>' +
          '<span class="usage-tool">' + esc(r.tool || '—') + '</span>' +
          '<span class="usage-stat-cell">' + stat + '</span>' +
          '<span class="usage-skills-cell">' + sk + '</span>' +
          '</div>';
      }).join('') +
      '</div>' +
      '<p class="sec-note">完整版（含改过哪些文件、读得最多的文件、反复试错的会话）见 ' +
      '<code>08-AI记忆/使用索引.md</code>。这里只做浏览，不做判断——' +
      '「这次为什么绕」要人写。</p>';

    box.innerHTML = html;
  }

  function renderDisk() {
    var box = $('view-disk');
    if (!box) return;

    // 线上静态站（GitHub Pages）没有本地服务，也就读不到本机磁盘
    if (!isLocalServer()) {
      box.innerHTML = '<div class="sec-label"><h2>磁盘</h2></div>' +
        '<p class="sec-note">磁盘板块只在<strong>本地</strong>可用——它要读这台机器的剩余空间和清理工具的运行记录。' +
        '线上版读不到，就不显示数字，免得看的是别人机器的旧快照。</p>';
      return;
    }

    if (!diskState.data && !diskState.loading && !diskState.err) {
      box.innerHTML = '<p class="sec-note">读取磁盘状态…</p>';
      loadDisk(renderDisk);
      return;
    }

    var d = diskState.data || {};
    var run = d.run;
    var html = '<div class="sec-label"><h2>磁盘</h2>' +
      '<span class="count">' + (d.installed ? 'purrge 已接入' : '未接入') + '</span></div>' +
      '<p class="sec-note">数据来自 purrge 最近一次扫描。<strong>这个板块不删任何东西</strong>——' +
      '清理要由你在 purrge 的审查页面里逐项勾选确认。</p>';

    if (!d.installed) {
      html += '<div class="disk-empty">还没检测到 purrge（磁盘清理助手）。' +
        '装好以后这里的数字会自动出现。<br>' +
        '<span class="disk-hint">动手前它会先保护记忆库：MyVault 已经在 protect 名单里。</span></div>';
      box.innerHTML = html;
      return;
    }

    // 1. 空间条
    var vols = d.volumes || [];
    if (vols.length) {
      html += '<div class="disk-vols">';
      vols.forEach(function (v) {
        var used = v.total - v.free;
        var pct = v.total ? Math.round(used / v.total * 100) : 0;
        var low = d.thresholdGB && v.free < d.thresholdGB * 1024 * 1024 * 1024;
        html += '<div class="disk-vol' + (low ? ' is-low' : '') + '">' +
          '<div class="disk-vol-head"><b>' + esc(v.mount) + '</b>' +
            '<span class="num">剩 ' + esc(v.freeHuman) + ' / 共 ' + esc(v.totalHuman) + '</span></div>' +
          '<div class="disk-bar" role="img" aria-label="' + esc(v.mount) + ' 已用 ' + pct + '%">' +
            '<i style="width:' + pct + '%"></i></div>' +
          (low ? '<span class="disk-warn">低于阈值 ' + esc(String(d.thresholdGB)) + ' GB</span>' : '') +
          '</div>';
      });
      html += '</div>';
    }

    // 2. 最近一次扫描
    if (!run) {
      html += '<div class="disk-empty">' + esc(d.error || '还没扫描过。') +
        '点下面的按钮扫描一次。</div>';
    } else {
      html += '<div class="sec-label sec-sub"><h3>最近一次扫描</h3>' +
        '<span class="count">' + esc(run.scannedAt || '') + ' · ' +
        esc(run.engine || '规则判断') + '</span></div>';
      if (run.summary) {
        html += '<p class="disk-summary">' + esc(run.summary) + '</p>';
      }
      var tiers = [
        ['primary', '可清理', '较安全，清掉基本无痛'],
        ['optional', '需确认', '得自己看一眼再决定'],
        ['keep', '建议留', '别动']
      ];
      html += '<div class="disk-tiers">';
      tiers.forEach(function (t) {
        var k = t[0];
        var n = (run.counts || {})[k] || 0;
        var sz = (run.sizeHuman || {})[k] || '0 B';
        html += '<div class="disk-tier is-' + k + '">' +
          '<span class="disk-tier-n num">' + n + '</span>' +
          '<span class="disk-tier-size num">' + esc(sz) + '</span>' +
          '<span class="disk-tier-label">' + t[1] + '</span>' +
          '<span class="disk-tier-hint">' + t[2] + '</span>' +
          '</div>';
      });
      html += '</div>';
      html += '<p class="sec-note disk-hint">共 ' + run.total + ' 项候选。' +
        '数字与 <code>~/.purrge/runs/' + esc(run.dir) + '/review.json</code> 一致。</p>';
    }

    // 3. 两个按钮，仅本地
    html += '<div class="disk-actions">' +
      '<button class="primary-btn" id="diskScan">立即扫描</button>' +
      '<button class="ghost-btn" id="diskReview"' + (run ? '' : ' disabled') + '>打开审查页</button>' +
      '<span class="disk-hint">审查页由 purrge 自己打开，勾选后才清理；门户这边没有任何删除按钮。</span>' +
      '</div>';

    box.innerHTML = html;
    var s = $('diskScan');
    var r = $('diskReview');
    if (s) s.addEventListener('click', function () { diskStartScan(s); });
    if (r && !r.disabled) r.addEventListener('click', function () { diskOpenReview(r); });
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
          kind: k === 'skills' ? '技能' : '工具', view: 'knowledge',
          text: vals[0], sub: vals.slice(1).join(' · '),
          target: { type: 'view', view: 'knowledge' }
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
    (MEM.requests || []).forEach(function (r, i) {
      rows.push({
        kind: r.kind === 'request' ? '要求' : '回执', view: 'requests',
        text: r.text, sub: r.date + ' ' + r.time + ' · ' + r.file,
        target: { type: 'request', idx: i }
      });
    });
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
    } else if (hit.target.type === 'request') {
      setView('requests');
      var reqRow = document.querySelector('#view-requests .req-row[data-idx="' + hit.target.idx + '"]');
      if (reqRow) {
        reqRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
        reqRow.classList.add('located');
        setTimeout(function () { reqRow.classList.remove('located'); }, 1600);
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
      // 数字键 1-6 跳入口（不在输入框里时）。入口从 10 个收到 6 个，键位跟着收
      if (!mod && /^[1-6]$/.test(e.key) &&
          !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
        setView(VIEWS[parseInt(e.key, 10) - 1].id);
      }
    });
  }

  // 刷新后停回原来那一屏。#view= 里存的是面板 id（facts / beliefs…），
  // 合并入口之前存下的老链接也认，解析不了就回概览。
  function initialView() {
    var m = /#view=([a-z]+)/.exec(location.hash || '');
    return m ? m[1] : 'overview';
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
      setView(initialView());
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
    MEM.projects = MEM.projects || [];
    MEM.agents = MEM.agents || [];
    MEM.claims = MEM.claims || [];
    MEM.sections = MEM.sections || {};
    MEM.relations = MEM.relations || { nodes: [], links: [] };
    MEM.requests = MEM.requests || [];
  }

  function renderAll() {
    renderRail();
    renderToolFilter();
    renderOverview();
    renderWork();
    renderFacts();
    renderBeliefs();
    renderIntents();
    renderKnowledge();
    if (globalThis.PortalGraph) PortalGraph.init(MEM);
  }

  function init() {
    initTheme();
    initRail();

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

    // 项目抽屉：点遮罩或按 Esc 关闭
    var drawer = $('projectDrawer');
    if (drawer) {
      Array.prototype.forEach.call(drawer.querySelectorAll('[data-drawer-close]'), function (el) {
        el.addEventListener('click', closeDrawer);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
      });
    }

    var query = location.search || '';
    var shot = query.match(/[?&]shot=([a-z]*)/);
    var shotTheme = query.match(/[?&]theme=(dark|light)/);
    if (shotTheme) applyTheme(shotTheme[1]);
    if (shot) {
      shotMode(shot[1] || 'overview');
      if (/openpalette/.test(query)) setTimeout(openPalette, 600);
    }

    // 不再支持 #pw= 自动解锁：密码会留在地址栏与浏览器历史里。
    // 需要自动解锁时用密码管理器，或在本地 serve_portal.py 上手输一次。
    if (/pw=/.test(location.hash || '')) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }
  }

  // 设计验收专用：?shot=<view> 直接载入 data.json 明文渲染，跳过解密
  function shotMode(viewId) {
    // 先抓查询串：setView 里的 replaceState 会重写 URL
    var q = location.search || '';
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

        // 截图验收用：?openfact=<file> / ?openproject=<stem> 渲染完直接打开
        var of = q.match(/[?&]openfact=([^&]+)/);
        if (of) {
          var row = findFactRow(decodeURIComponent(of[1]));
          if (row) row.click();
        }
        var op = q.match(/[?&]openproject=([^&]+)/);
        if (op) openProject(decodeURIComponent(op[1]));

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
