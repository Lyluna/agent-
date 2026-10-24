/* 关系探索：轻量 SVG + 原生 DOM。没有图谱库、远程素材或持续渲染依赖。 */
(function (global) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); };
  var KINDS = {
    project: '项目', fact: '对话', belief: '认知', knowledge: '知识',
    skills: '技能', tools: '工具', note: '关联笔记'
  };
  var graph = { nodes: [], links: [] }, facts = [];
  var selectedKind = 'all', selectedId = '', motion = true;
  // 渐进展开：默认只画骨架（项目 + 知识），点谁展开谁的邻居。
  // 154 个节点画一张图，无论怎么排都是毛线团 —— 那正是「关系是乱的」的来源。
  var expanded = {};
  var ROOT_KINDS = { project: 1, knowledge: 1 };
  function connected(n) {
    return graph.links.filter(function (l) { return l.source === n.id || l.target === n.id; });
  }
  function neighborIds(id) {
    var ids = {};
    graph.links.forEach(function (l) {
      if (l.source === id) ids[l.target] = true;
      else if (l.target === id) ids[l.source] = true;
    });
    return ids;
  }
  function isRoot(n) { return ROOT_KINDS[n.kind]; }
  // 列表始终列全部节点（按类型筛选），只有地图用「焦点 + 邻居」，两者分工不同。
  function visible() {
    if (selectedKind === 'all') return graph.nodes.slice();
    return graph.nodes.filter(function (n) { return n.kind === selectedKind; });
  }
  function expand(id) {
    if (!expanded[id]) expanded[id] = true;
  }
  function counts() {
    var c = {};
    graph.nodes.forEach(function (n) { c[n.kind] = (c[n.kind] || 0) + 1; });
    return c;
  }
  function renderFilters() {
    var c = counts();
    $('graphFilters').innerHTML = ['all'].concat(Object.keys(KINDS)).filter(function (k) {
      return k === 'all' || c[k];
    }).map(function (k) {
      return '<button class="graph-filter" data-kind="' + k + '" aria-pressed="' +
        (selectedKind === k) + '"><i class="kind-' + k + '" aria-hidden="true"></i>' +
        (k === 'all' ? '全部关系' : KINDS[k]) +
        '<span>' + (k === 'all' ? graph.nodes.length : c[k]) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call($('graphFilters').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { selectedKind = b.dataset.kind; selectedId = ''; render(); });
    });
  }
  /* 自我网络（ego network）：中心一个焦点，外圈只放它的直接邻居。
     不把全库画成一张图 —— 154 个节点怎么排都是毛线团，那是「关系是乱的」的根源。 */
  function renderMap(nodes) {
    var w = 980, h = 680, cx = w / 2, cy = h / 2;
    var focus = graph.nodes.filter(function (n) { return n.id === selectedId; })[0];

    // 没有选中时，把「根节点」按度数排成一圈，让人先挑一个入口。
    if (!focus) {
      var roots = nodes.filter(function (n) { return isRoot(n); });
      var list = (roots.length ? roots : nodes).slice().sort(function (a, b) {
        return connected(b).length - connected(a).length;
      }).slice(0, 12);
      // 两圈交替排布，避免节点少时全挤在一圈、底部标签互相压住
      var spot = {};
      var dots = list.map(function (n, i) {
        var half = Math.ceil(list.length / 2);
        var ring = i % 2;
        var idx = Math.floor(i / 2);
        var count = ring === 0 ? half : list.length - half;
        var a = (idx / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2 + (ring ? Math.PI / Math.max(1, count) : 0);
        var rx = ring ? 300 : 190, ry = ring ? 210 : 132;
        var x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
        spot[n.id] = { x: x, y: y };
        return nodeMarkup(n, x, y, 18);
      }).join('');
      // 入口之间本来就有的显式双链要画出来，否则「项目之间毫无关系」是假象。
      var inList = {}, seenPair = {};
      list.forEach(function (n) { inList[n.id] = true; });
      var inner = [], pairs = 0;
      graph.links.forEach(function (l) {
        if (!inList[l.source] || !inList[l.target] || l.source === l.target) return;
        var key = [l.source, l.target].sort().join('\u0000');
        if (seenPair[key]) return;
        seenPair[key] = true; pairs++;
        var a = spot[l.source], b = spot[l.target];
        inner.push('<line class="graph-edge" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y +
          '"><title>' + esc(l.kind) + '</title></line>');
      });
      $('graphCanvas').innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="group" aria-label="选择关系入口">' +
        '<g class="graph-edges">' + inner.join('') + '</g>' +
        '<text class="graph-hint" x="' + cx + '" y="' + (cy - 30) + '" text-anchor="middle">选一个项目或知识条目，看它的真实关联</text>' +
        '<g class="graph-nodes">' + dots + '</g></svg>';
      bindNodes();
      $('graphLimit').textContent = '从 ' + list.length + ' 个项目/知识入口开始 · 其中 ' + pairs +
        ' 组之间有显式双链 · 全库 ' + graph.nodes.length + ' 个节点、' + graph.links.length +
        ' 条真实关联，点开一个再看它的邻居';
      return;
    }

    var around = connected(focus).map(function (l) {
      var other = graph.nodes.filter(function (x) { return x.id === (l.source === focus.id ? l.target : l.source); })[0];
      return other ? { n: other, kind: l.kind } : null;
    }).filter(Boolean);
    // 同一条边可能双向，按节点去重
    var seenOther = {};
    around = around.filter(function (x) { if (seenOther[x.n.id]) return false; seenOther[x.n.id] = 1; return true; });

    var R = Math.min(300, 150 + around.length * 14);
    var pos = {};
    pos[focus.id] = { x: cx, y: cy };
    var perRing = 14;
    around.forEach(function (x, i) {
      var ring = Math.floor(i / perRing);
      var inRing = Math.min(perRing, around.length - ring * perRing);
      var a = (i % perRing) / inRing * Math.PI * 2 - Math.PI / 2;
      var rr = R + ring * 105;
      pos[x.n.id] = { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * (rr * 0.74) };
    });
    var lines = around.map(function (x) {
      var p = pos[x.n.id];
      return '<line class="graph-edge" x1="' + cx + '" y1="' + cy + '" x2="' + p.x + '" y2="' + p.y +
        '"><title>' + esc(x.kind) + '</title></line>';
    }).join('');
    var dots = nodeMarkup(focus, cx, cy, 0, 'focus') +
      around.map(function (x) { return nodeMarkup(x.n, pos[x.n.id].x, pos[x.n.id].y, x.n.label.length > 18 ? 17 : 0); }).join('');
    $('graphCanvas').innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="group" aria-label="' +
      esc(focus.label) + ' 的真实关联">' +
      '<g class="graph-edges">' + lines + '</g><g class="graph-nodes">' + dots + '</g></svg>';
    bindNodes();
    $('graphLimit').textContent = around.length
      ? '「' + focus.label + '」的直接关联 ' + around.length + ' 条 · 点外圈任意一个继续往下走'
      : '「' + focus.label + '」暂无显式关联，不自动推断';
  }
  function nodeMarkup(n, x, y, cut, extra) {
    var short = cut && n.label.length > cut ? n.label.slice(0, cut - 1) + '…' : n.label;
    return '<g class="graph-node kind-' + n.kind + (selectedId === n.id ? ' selected' : '') + (extra ? ' ' + extra : '') +
      '" data-id="' + esc(n.id) + '" transform="translate(' + x + ' ' + y + ')" tabindex="0" role="button" aria-label="查看' +
      esc(KINDS[n.kind] + '：' + n.label) + '"><circle r="9" class="graph-node-ring"/><circle r="4" class="graph-node-dot"/>' +
      '<text y="25" text-anchor="middle">' + esc(short) + '</text><title>' + esc(n.label) + '</title></g>';
  }
  function bindNodes() {
    Array.prototype.forEach.call($('graphCanvas').querySelectorAll('.graph-node'), function (el) {
      function choose() {
        selectedId = el.dataset.id;
        expand(selectedId);
        render();
      }
      el.addEventListener('click', choose);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    });
  }
  function markSelected() {
    Array.prototype.forEach.call($('graphCanvas').querySelectorAll('.graph-node'), function (el) {
      el.classList.toggle('selected', el.dataset.id === selectedId);
    });
  }
  function rowHtml(n) {
    return '<button class="graph-list-row' + (selectedId === n.id ? ' selected' : '') + '" data-id="' + esc(n.id) + '">' +
      '<span class="graph-kind kind-' + n.kind + '">' + KINDS[n.kind] + '</span><span>' + esc(n.label) + '</span>' +
      '<span class="graph-degree">' + connected(n).length + ' 条关联</span></button>';
  }
  function renderList(nodes) {
    if (!nodes.length) {
      $('graphList').innerHTML = '<div class="empty"><strong>还没有可展示的关系</strong>笔记中的 [[双链]] 和明确的项目关联会出现在这里。</div>';
      return;
    }
    // 筛选时把「本类型」和「只是关联到本类型」的邻居分开列，避免看起来所有东西都是同一类。
    var primary = [], others = [];
    nodes.forEach(function (n) { (selectedKind === 'all' || n.kind === selectedKind ? primary : others).push(n); });
    var html = primary.map(rowHtml).join('');
    if (others.length) {
      html += '<div class="graph-list-split">以上 ' + primary.length + ' 个是' + KINDS[selectedKind] +
        '，以下 ' + others.length + ' 个只是与它们直接相连</div>' + others.map(rowHtml).join('');
    }
    $('graphList').innerHTML = html;
    Array.prototype.forEach.call($('graphList').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { selectedId = b.dataset.id; renderDetail(); markSelected(); renderList(visible()); });
    });
  }
  function renderDetail() {
    var n = graph.nodes.filter(function (x) { return x.id === selectedId; })[0];
    if (!n) {
      $('graphDetail').innerHTML = '<span class="eyebrow">关系说明</span><h3>从一条内容，回到它的来处</h3>' +
        '<p>这里读取显式双链与明确关联。点击节点，可以查看详情和直接相连的内容。</p>' +
        '<div class="graph-legend"><span><i class="kind-fact"></i>对话</span><span><i class="kind-knowledge"></i>知识</span>' +
        '<span><i class="kind-belief"></i>认知</span><span><i class="kind-note"></i>笔记</span></div>';
      return;
    }
    var links = connected(n);
    var action = '';
    if (n.kind === 'fact') action = '<button class="primary-btn graph-open" data-view="facts">在事实时间线中打开 ↗</button>';
    else if (n.kind === 'belief') action = '<button class="primary-btn graph-open" data-view="beliefs">前往认知列表 ↗</button>';
    else if (n.kind === 'knowledge') action = '<button class="primary-btn graph-open" data-view="knowledge">前往知识列表 ↗</button>';
    else if (n.kind === 'skills' || n.kind === 'tools') action = '<button class="primary-btn graph-open" data-view="tools">前往技能与工具 ↗</button>';
    else if (n.source) action = '<p class="graph-note">来源：' + esc(n.source) + '<br>可在 Obsidian 中打开并编辑这篇笔记。</p>';
    $('graphDetail').innerHTML = '<span class="eyebrow">' + KINDS[n.kind] + '</span><h3>' + esc(n.label) + '</h3>' +
      '<p>' + esc(n.detail || '这条内容暂时没有更多说明。') + '</p>' + action +
      '<div class="graph-detail-meta">' + (n.source ? esc(n.source) : '来自 Markdown') + (n.date ? ' · ' + esc(n.date) : '') + ' · ' + links.length + ' 条真实关联</div>' +
      (links.length ? '<div class="graph-neighbors">' + links.slice(0, 8).map(function (l) {
        var other = graph.nodes.filter(function (x) { return x.id === (l.source === n.id ? l.target : l.source); })[0];
        return other ? '<button data-id="' + esc(other.id) + '">' + esc(other.label) + '<span>' + esc(l.kind) + '</span></button>' : '';
      }).join('') + '</div>' : '<p class="graph-note">暂无显式关联，不自动推断。</p>');
    Array.prototype.forEach.call($('graphDetail').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.view) {
          var nav = document.querySelector('.rail-item[data-view="' + b.dataset.view + '"]');
          if (nav) nav.click();
          if (n.kind === 'fact') {
            var index = -1;
            for (var i = 0; i < facts.length; i++) { if (facts[i].title === n.label) { index = i; break; } }
            var row = document.querySelector('#view-facts .fact[data-idx="' + index + '"]');
            if (row) { row.classList.add('open'); row.scrollIntoView({ block: 'center' }); row.focus(); }
          }
          return;
        }
        selectedId = b.dataset.id;
        expand(selectedId);
        render();
      });
    });
  }
  function render() {
    var nodes = visible();
    renderFilters(); renderMap(nodes); renderList(nodes); renderDetail();
    $('graphCanvas').hidden = !motion || global.innerWidth < 761;
    $('graphList').hidden = motion && global.innerWidth >= 761;
    $('motionBtn').setAttribute('aria-pressed', String(!motion));
    $('motionBtn').textContent = motion ? '静态模式' : '图形模式';
  }
  function init(mem) {
    graph = global.PortalGraphData.build(mem);
    facts = mem.facts || [];
    motion = !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) && global.innerWidth >= 761;
    $('motionBtn').addEventListener('click', function () { motion = !motion; render(); });
    global.addEventListener('resize', function () { if (global.innerWidth < 761) motion = false; render(); });
    render();
  }
  global.PortalGraph = { init: init, refresh: render };
})(window);
