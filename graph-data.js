/* 真实 Markdown 关系的浏览器端读取层。
   只读取门户已经解密的数据：显式 wikilink、存档关联和索引记录。
   不做关键词相似度推断，不创建看似智能但没有依据的连线。 */
(function (global) {
  'use strict';

  function text(v) { return String(v == null ? '' : v); }
  var PLACEHOLDER = /^(\.{2,}|…|Note Name|双链|wikilink|image\.(png|jpe?g|gif|webp)|document\.pdf|旧名|路径|base|\.\.\.)$/i;
  function clean(v) {
    var s = text(v).replace(/^\[\[|\]\]$/g, '').replace(/\\?\|.*$/, '').replace(/#.*$/, '').trim();
    if (PLACEHOLDER.test(s)) return '';
    if (/\.base$/i.test(s) || s.indexOf('{{') >= 0 || s.indexOf('`') >= 0) return '';
    return s;
  }
  // 代码块/行内代码里的 [[双链]] 是示例，不是真实关系
  function stripCode(v) { return text(v).replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, ''); }
  function base(v) { return text(v).split('/').pop().replace(/\.md$/i, '').trim(); }
  function id(kind, key) { return kind + ':' + text(key).toLowerCase(); }

  function build(mem) {
    var nodes = [], links = [], byName = {}, byId = {};
    function add(kind, label, detail, source) {
      label = text(label).trim();
      if (!label) return null;
      var nodeId = id(kind, label);
      if (byId[nodeId]) {
        var existing = byId[nodeId];
        if (detail && !existing.detail) existing.detail = detail;
        if (source && !existing.source) existing.source = source;
        return existing;
      }
      var n = { id: nodeId, kind: kind, label: label,
                detail: detail || '', source: source || '' };
      nodes.push(n); byId[n.id] = n;
      var key = base(label).toLowerCase();
      if (!byName[key] || kind === 'project') byName[key] = n;
      return n;
    }
    function resolve(label, fallbackKind) {
      label = clean(label);
      var key = base(label).toLowerCase();
      return byName[key] || add(fallbackKind || 'note', label, '', '显式双链');
    }
    function link(a, b, kind) {
      if (!a || !b || a.id === b.id) return;
      var key = [a.id, b.id, kind].sort().join('|');
      if (links.some(function (l) { return l.key === key; })) return;
      links.push({ key: key, source: a.id, target: b.id, kind: kind });
    }

    ((mem.relations || {}).nodes || []).forEach(function (n) {
      add(n.kind, n.title, '', n.source);
    });

    (mem.facts || []).forEach(function (f) {
      var n = add('fact', f.title, f.summary, '08-AI记忆/对话存档/' + f.file);
      if (!n) return;
      n.file = f.file; n.tool = f.tool; n.date = f.date;
      n.links = (stripCode(f.detail).match(/\[\[[^\]]+\]\]/g) || []).map(clean).filter(Boolean);
    });
    (mem.beliefs || []).forEach(function (b) {
      add('belief', b.title || b.statement, b.detail, b.updated);
    });
    var sections = mem.sections || {};
    ['skills', 'tools'].forEach(function (kind) {
      var sec = sections[kind] || {};
      (sec.rows || []).forEach(function (r) {
        var first = Object.keys(r)[0];
        if (first) add(kind, r[first], Object.keys(r).map(function (k) { return r[k]; }).join(' · '));
      });
    });
    ((sections.distilled || {}).rows || []).forEach(function (r) {
      var keys = Object.keys(r);
      add('knowledge', r['主题'] || r[keys[1]] || r[keys[0]], r['一句话结论'] || '');
      Object.keys(r).forEach(function (k) {
        if (/文件|路径/.test(k)) {
          var label = clean(r[k]);
          if (label) {
            var knowledgeNode = byId[id('knowledge', r['主题'] || r[keys[1]] || r[keys[0]])];
            byName[base(label).toLowerCase()] = knowledgeNode;
            if (knowledgeNode && !knowledgeNode.source) knowledgeNode.source = label;
          }
        }
      });
    });

    // 服务端从项目/知识笔记读出的链接优先：可以定位到原文件。
    ((mem.relations || {}).links || []).forEach(function (l) {
      var a = byId[id(l.sourceKind, l.sourceTitle)];
      var b = byId[id(l.targetKind, l.targetTitle)] || resolve(l.targetTitle, l.targetKind);
      link(a, b, l.kind);
    });

    // 存档中未被项目和知识链接覆盖的显式双链。
    (mem.facts || []).forEach(function (f) {
      var fact = byId[id('fact', f.title)];
      if (!fact) return;
      fact.links.forEach(function (raw) {
        var target = resolve(raw, 'note');
        link(fact, target, '显式双链');
      });
    });

    // 目录索引的显式链接补充为知识条目和技能工具的关系。
    Object.keys(byId).forEach(function (key) {
      var n = byId[key];
      if (n.kind === 'fact') return;
      (stripCode(n.detail).match(/\[\[[^\]]+\]\]/g) || []).forEach(function (raw) {
        link(n, resolve(raw, 'note'), '显式双链');
      });
    });

    return { nodes: nodes, links: links };
  }

  global.PortalGraphData = { build: build };
})(window);
