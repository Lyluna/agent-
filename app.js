/* ============================================================
   门户主逻辑
   六个分区各自是一个视图；顶部命令面板做跨分区搜索。
   ============================================================ */
(function () {
  'use strict';

  // ---------- 状态 ----------
  var MEM = { profile: {}, facts: [], beliefs: [], intents: [], sections: {} };
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
    { id: 'knowledge', label: '蒸馏知识', icon: 'drop' }
  ];

  var ICONS = {
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
      intents: MEM.intents.filter(function (i) { return !i.done; }).length,
      skills: (MEM.sections.skills ? MEM.sections.skills.count : 0) +
              (MEM.sections.tools ? MEM.sections.tools.count : 0),
      knowledge: MEM.sections.distilled ? MEM.sections.distilled.count : 0
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
    $('searchBtn').style.display = id === 'facts' ? 'none' : '';

    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // ---------- 页头：一句话说清这一屏在回答什么 ----------
  function renderHead() {
    var p = MEM.profile || {};
    var pending = MEM.intents.filter(function (i) { return !i.done; });
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
    var html = '';

    // 画像
    html += '<div class="sec-label"><h2>画像</h2><span class="count">跨 agent 共享</span></div>';
    html += '<p class="sec-note">你是谁、用什么工具、希望 AI 怎么配合你。</p>';
    html += '<div class="profile">';

    html += '<div class="profile-cell"><h3>基本信息</h3>' +
      '<div class="val">' + esc(p.name || '—') + '</div>' +
      '<div class="sub">' + esc(p.role || '') + '</div></div>';

    if (p.tools && p.tools.length) {
      html += '<div class="profile-cell"><h3>接入工具</h3><ul>' +
        p.tools.map(function (t) {
          return '<li>' + esc(t.name) + (t.usage ? ' — ' + esc(t.usage) : '') + '</li>';
        }).join('') + '</ul></div>';
    }

    if (p.preferences && p.preferences.length) {
      html += '<div class="profile-cell"><h3>沟通偏好</h3><ul>' +
        p.preferences.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
        '</ul></div>';
    }

    if (p.rules && p.rules.length) {
      html += '<div class="profile-cell"><h3>记忆规则</h3><ul>' +
        p.rules.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
        '</ul></div>';
    }

    html += '</div>';

    // 最近的对话
    var recent = MEM.facts.slice(0, 5);
    if (recent.length) {
      html += '<div class="sec-label" style="margin-top:34px"><h2>最近的对话</h2>' +
        '<span class="count">' + MEM.facts.length + ' 条</span></div>';
      html += '<p class="sec-note">每次对话归档为一条事实，点开可看完整记录。</p>';
      html += '<div class="facts">' + recent.map(factRow).join('') + '</div>';
    }

    // 高优先级待办
    var high = MEM.intents.filter(function (i) { return !i.done && i.priority === 'high'; }).slice(0, 5);
    if (high.length) {
      html += '<div class="sec-label" style="margin-top:34px"><h2>高优先级待办</h2>' +
        '<span class="count">' + high.length + ' 项</span></div>';
      html += '<p class="sec-note">下一步最该动的事。</p>';
      html += '<div class="intents">' + high.map(intentRow).join('') + '</div>';
    }

    $('view-overview').innerHTML = html;
    bindFacts($('view-overview'));
  }

  // ---------- 事实 ----------
  function factRow(f, i) {
    var live = f.status === '进行中';
    return '<div class="fact" tabindex="0" data-idx="' + i + '">' +
      '<div class="fact-date">' + esc(f.date) + '</div>' +
      '<div class="fact-main">' +
        '<div class="fact-title">' + esc(f.title) + '</div>' +
        '<div class="fact-sum">' + esc(f.summary) + '</div>' +
        '<div class="fact-detail">' +
          '<div class="detail-bar"><span>完整对话存档</span>' +
          '<span>' + esc(f.tool) + '</span></div>' +
          '<div class="detail-body">' + esc(f.detail) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="fact-side">' +
        (live ? '<span class="live">进行中</span>' : '') +
        '<span class="src">' + esc(f.tool) + '</span>' +
      '</div>' +
    '</div>';
  }

  function bindFacts(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.fact'), function (el) {
      function toggle() { el.classList.toggle('open'); }
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  function renderFacts() {
    var list = MEM.facts.filter(function (f) {
      return state.tool === 'all' || f.tool === state.tool;
    });

    var html = '<div class="sec-label"><h2>事实时间线</h2>' +
      '<span class="count">' + list.length + ' 条</span></div>';
    html += '<p class="sec-note">由自动归档实时写入。点击任一条展开完整对话。</p>';

    if (!list.length) {
      html += '<div class="empty"><strong>没有匹配的对话</strong>换个工具筛选试试。</div>';
    } else {
      html += '<div class="facts">' + list.map(factRow).join('') + '</div>';
    }

    $('view-facts').innerHTML = html;
    bindFacts($('view-facts'));
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
  // 本地服务可写时，点「确认无后续」直接写回 markdown；
  // 线上静态站降级为「复制结案指令」。
  var canWrite = false;      // 由 detectWritable() 探测
  var closedThisRun = {};    // 本次会话刚结案的，先乐观更新界面

  function intentRow(t) {
    var label = { high: '高', mid: '中', low: '低' }[t.priority] || t.priority || '';
    var closed = t.closed || closedThisRun[t.task];
    var cls = 'intent' + (t.done ? ' done' : '') + (closed ? ' closed' : '');

    var action = '';
    if (t.done && !closed) {
      action = canWrite
        ? '<button class="close-btn" data-task="' + esc(t.task) + '">确认无后续</button>'
        : '<button class="close-btn copy" data-task="' + esc(t.task) + '">复制结案指令</button>';
    } else if (closed) {
      action = '<span class="closed-tag">已结案' +
        (t.closed_at ? ' ' + esc(t.closed_at) : '') + '</span>';
    }

    return '<div class="' + cls + '">' +
      '<div class="intent-box"></div>' +
      '<div class="intent-text">' + esc(t.task) + action + '</div>' +
      '<div class="intent-prio ' + esc(t.priority || '') + '">' + esc(label) + '</div>' +
    '</div>';
  }

  function renderIntents() {
    var pending = MEM.intents.filter(function (i) { return !i.done; });
    var confirm = MEM.intents.filter(function (i) {
      return i.done && !i.closed && !closedThisRun[i.task];
    });
    var closed = MEM.intents.filter(function (i) {
      return i.closed || closedThisRun[i.task];
    });

    var html = '<div class="sec-label"><h2>意图待办</h2>' +
      '<span class="count">' + pending.length + ' 项未完成</span></div>';
    html += '<p class="sec-note">' +
      (confirm.length
        ? '已完成的 ' + confirm.length + ' 项等你确认有没有后续；确认后归档不再提醒。'
        : '完成的条目会先停在这里，等你确认有没有后续。') +
      '</p>';

    if (!pending.length && !confirm.length && !closed.length) {
      html += '<div class="empty"><strong>没有待办</strong>有新计划时会出现在这里。</div>';
    } else {
      if (pending.length) html += '<div class="intents">' + pending.map(intentRow).join('') + '</div>';

      if (confirm.length) {
        html += '<div class="sec-label" style="margin-top:30px"><h2>待确认结案</h2>' +
          '<span class="count">' + confirm.length + ' 项</span></div>';
        html += '<p class="sec-note">' +
          (canWrite
            ? '点「确认无后续」会直接改写待办与下一步.md 并重新加密数据。'
            : '线上是静态站，点「复制结案指令」后粘给任意 AI 执行。') +
          '</p>';
        html += '<div class="intents">' + confirm.map(intentRow).join('') + '</div>';
      }

      if (closed.length) {
        html += '<div class="sec-label" style="margin-top:30px"><h2>已结案</h2>' +
          '<span class="count">' + closed.length + ' 项</span></div>';
        html += '<div class="intents">' + closed.map(intentRow).join('') + '</div>';
      }
    }

    $('view-intents').innerHTML = html;
    bindCloseButtons($('view-intents'));
  }

  function bindCloseButtons(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.close-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var task = btn.dataset.task;
        if (canWrite) {
          btn.disabled = true;
          btn.textContent = '写入中…';
          fetch('/api/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: task })
          }).then(function (r) { return r.json(); }).then(function (res) {
            if (!res.ok) throw new Error(res.error || '写入失败');
            closedThisRun[task] = true;
            renderIntents();
            renderRail();
            renderHead();
            if (!res.regenerated) console.warn('数据未重新生成：', res.log);
          }).catch(function (err) {
            btn.disabled = false;
            btn.textContent = '确认无后续';
            alert('写入失败：' + err.message);
          });
        } else {
          copyCloseInstruction(task, btn);
        }
      });
    });
  }

  function copyCloseInstruction(task, btn) {
    var text = '把 08-AI记忆/待办与下一步.md 里这条待办标记为已结案' +
      '（行尾追加 〔已结案 ' + todayStr() + '〕）：\n- ' + task;
    var done = function () {
      var old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = old; }, 1600);
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
          if (state.view === 'intents') renderIntents();
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
        target: { type: 'view', view: 'intents' }
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
      // 等一帧让视图渲染完，再展开对应条目
      requestAnimationFrame(function () {
        var rows = document.querySelectorAll('#view-facts .fact');
        var row = rows[hit.target.idx];
        if (row) {
          row.classList.add('open');
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          row.focus();
        }
      });
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
      // 数字键 1-6 跳分区（不在输入框里时）
      if (!mod && /^[1-6]$/.test(e.key) &&
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
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
