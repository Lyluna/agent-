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
  function connected(n) {
    return graph.links.filter(function (l) { return l.source === n.id || l.target === n.id; });
  }
  function visible() {
    if (selectedKind === 'all') return graph.nodes.slice();
    var primary = graph.nodes.filter(function (n) { return n.kind === selectedKind; });
    var allowed = {};
    primary.forEach(function (n) { allowed[n.id] = true; });
    var linked = graph.links.filter(function (l) { return allowed[l.source] || allowed[l.target]; });
    var ids = {};
    linked.forEach(function (l) { ids[l.source] = true; ids[l.target] = true; });
    return graph.nodes.filter(function (n) { return ids[n.id]; });
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
  function renderMap(nodes) {
    var w = 980, h = 680, cx = w / 2, cy = h / 2;
    var max = Math.min(nodes.length, 54);
    var mapNodes = nodes.slice().sort(function (a, b) {
      var primary = (b.kind === selectedKind) - (a.kind === selectedKind);
      return primary || connected(b).length - connected(a).length;
    });
    var visibleIds = {};
    mapNodes.slice(0, max).forEach(function (n) { visibleIds[n.id] = true; });
    var positioned = mapNodes.slice(0, max).map(function (n, i) {
      var ring = Math.floor(i / 18), angle = (i % 18) / Math.min(18, max - ring * 18) * Math.PI * 2 - Math.PI / 2;
      var rx = 145 + ring * 125, ry = 105 + ring * 110;
      return { n: n, x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
    var lines = graph.links.filter(function (l) { return visibleIds[l.source] && visibleIds[l.target]; }).map(function (l) {
      var a = positioned.filter(function (p) { return p.n.id === l.source; })[0];
      var b = positioned.filter(function (p) { return p.n.id === l.target; })[0];
      return '<line class="graph-edge" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"><title>' + esc(l.kind) + '</title></line>';
    }).join('');
    var dots = positioned.map(function (p) {
      var n = p.n, short = n.label.length > 17 ? n.label.slice(0, 16) + '…' : n.label;
      return '<g class="graph-node kind-' + n.kind + (selectedId === n.id ? ' selected' : '') +
        '" data-id="' + esc(n.id) + '" transform="translate(' + p.x + ' ' + p.y + ')" tabindex="0" role="button" aria-label="查看' +
        esc(KINDS[n.kind] + '：' + n.label) + '"><circle r="9" class="graph-node-ring"/><circle r="4" class="graph-node-dot"/>' +
        '<text y="25" text-anchor="middle">' + esc(short) + '</text><title>' + esc(n.label) + '</title></g>';
    }).join('');
    $('graphCanvas').innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="group" aria-label="Markdown 显式关系图">' +
      '<g class="graph-edges">' + lines + '</g><g class="graph-nodes">' + dots + '</g></svg>';
    Array.prototype.forEach.call($('graphCanvas').querySelectorAll('.graph-node'), function (el) {
      function choose() { selectedId = el.dataset.id; renderDetail(); markSelected(); }
      el.addEventListener('click', choose);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    });
    $('graphLimit').textContent = nodes.length > max ? '图形显示前 ' + max + ' 个节点，列表保留全部 ' + nodes.length + ' 个；请按类型筛选。' :
      '显示 ' + nodes.length + ' 个节点 · 只画真实关联，不做相似度推断';
  }
  function markSelected() {
    Array.prototype.forEach.call($('graphCanvas').querySelectorAll('.graph-node'), function (el) {
      el.classList.toggle('selected', el.dataset.id === selectedId);
    });
  }
  function renderList(nodes) {
    $('graphList').innerHTML = nodes.length ? nodes.map(function (n) {
      return '<button class="graph-list-row' + (selectedId === n.id ? ' selected' : '') + '" data-id="' + esc(n.id) + '">' +
        '<span class="graph-kind kind-' + n.kind + '">' + KINDS[n.kind] + '</span><span>' + esc(n.label) + '</span>' +
        '<span class="graph-degree">' + connected(n).length + ' 条关联</span></button>';
    }).join('') : '<div class="empty"><strong>还没有可展示的关系</strong>笔记中的 [[双链]] 和明确的项目关联会出现在这里。</div>';
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
        selectedId = b.dataset.id; renderDetail(); markSelected(); renderList(visible());
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
