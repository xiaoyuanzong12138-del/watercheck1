/* ============================================================
   ui/network-map.js · 管网图（SVG 渲染组件）
   ------------------------------------------------------------
   接口：WC.ui.networkMap.render(container, project, result)
     - 纯渲染，不改数据；可重复调用（先清空容器）
     - 返回渲染根元素（SVG 或空态 div）
     - result 可为 null（无结果时楼栋灰色、无箭头）
   点击节点 → WC.ui.networkMap.onSelectNode(id) 回调（页面注入）。
   布局确定性：BFS 分层 + 固定 30 轮松弛，同一工程每次布局一致。
   ============================================================ */
(function (WC) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var INK = '#0F1720', MUTED = '#5A6B7D', BRAND = '#0B63CE';
  var C_OK = '#0E9F6E', C_WARN = '#D97706', C_BAD = '#DC2626', C_NONE = '#98A6B5';

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
      }
    }
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtQ(v) {
    var a = Math.abs(v);
    if (a >= 100) return v.toFixed(1);
    if (a >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }

  /** 可服务层数：满足 serviceHead[f] ≤ 水压 的最高层数（服务水头表只到 6 层）。 */
  function servedFloors(pressure, settings) {
    var sh = (settings && settings.serviceHead) ||
      { 1: 10, 2: 12, 3: 16, 4: 20, 5: 24, 6: 28 };
    var served = 0;
    for (var f = 1; f <= 6; f++) {
      if (typeof sh[f] === 'number' && pressure >= sh[f]) served = f;
    }
    return served;
  }

  /**
   * @param {HTMLElement} container 宿主容器
   * @param {object} project watercheck/v1 工程
   * @param {object} [result] WC.solver.solve 结果（可空）
   */
  function render(container, project, result) {
    if (!container) return null;
    container.innerHTML = '';

    var nodes = (project && project.nodes) || [];
    var pipes = (project && project.pipes) || [];
    if (!nodes.length || !pipes.length) {
      var empty = document.createElement('div');
      empty.className = 'nw-empty';
      empty.textContent = '还没有管网数据';
      container.appendChild(empty);
      return empty;
    }

    /* —— 结果索引（无结果时空表） —— */
    var resNode = {}, resPipe = {};
    if (result) {
      (result.nodes || []).forEach(function (n) { resNode[n.id] = n; });
      (result.pipes || []).forEach(function (p) { resPipe[p.id] = p; });
    }

    var wrap = document.createElement('div');
    wrap.className = 'nw-container';

    var svg = svgEl('svg', {
      'class': 'nw-svg', viewBox: '0 0 1000 620',
      xmlns: SVG_NS, 'data-testid': 'nw-svg'
    });
    var rootG = svgEl('g'); // 缩放目标
    svg.appendChild(rootG);
    wrap.appendChild(svg);

    /* —— 缩放 / 导出按钮（右上角 HTML 覆盖层） —— */
    var btns = document.createElement('div');
    btns.className = 'nw-btns';
    var scale = 1;
    function applyScale() {
      scale = Math.max(0.6, Math.min(2.5, scale));
      rootG.setAttribute('transform',
        'translate(500,310) scale(' + scale + ') translate(-500,-310)');
    }
    var zIn = document.createElement('button');
    zIn.type = 'button'; zIn.textContent = '＋';
    zIn.title = '放大';
    zIn.addEventListener('click', function () { scale *= 1.25; applyScale(); });
    var zOut = document.createElement('button');
    zOut.type = 'button'; zOut.textContent = '－';
    zOut.title = '缩小';
    zOut.addEventListener('click', function () { scale /= 1.25; applyScale(); });
    var ex = document.createElement('button');
    ex.type = 'button'; ex.textContent = '导出 SVG';
    ex.title = '把管网图导出为 SVG 文件';
    ex.addEventListener('click', exportSvg);
    btns.appendChild(zOut);
    btns.appendChild(zIn);
    btns.appendChild(ex);
    wrap.appendChild(btns);

    /* —— tooltip（跟随鼠标） —— */
    var tip = document.createElement('div');
    tip.className = 'nw-tooltip';
    tip.style.display = 'none';
    wrap.appendChild(tip);
    function bindTip(el, getText) {
      el.addEventListener('mousemove', function (ev) {
        tip.textContent = getText();
        tip.style.display = '';
        var rect = wrap.getBoundingClientRect();
        var x = ev.clientX - rect.left + 14;
        var y = ev.clientY - rect.top + 16;
        if (x > rect.width - 250) x = Math.max(4, x - 270);
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
      });
      el.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
    }

    /* ============ 布局（确定性） ============ */
    var N = nodes.length;
    var idx = {};
    nodes.forEach(function (n, i) { idx[n.id] = i; });

    var adj = [];
    for (var ai = 0; ai < N; ai++) adj.push([]);
    pipes.forEach(function (p) {
      if (idx[p.from] === undefined || idx[p.to] === undefined || p.from === p.to) return;
      adj[idx[p.from]].push(idx[p.to]);
      adj[idx[p.to]].push(idx[p.from]);
    });

    var fixedI = -1;
    nodes.forEach(function (n, i) { if (n.fixed) fixedI = i; });
    if (fixedI < 0) fixedI = 0; // 兜底：无定压节点时以 0 号为根（仅布局用）

    // BFS：跳数 d 分层，层内保持访问顺序
    var depth = [], seen = [], order = [];
    for (ai = 0; ai < N; ai++) { depth.push(-1); seen.push(false); }
    var queue = [fixedI];
    seen[fixedI] = true; depth[fixedI] = 0;
    while (queue.length) {
      var cur = queue.shift();
      order.push(cur);
      for (var qk = 0; qk < adj[cur].length; qk++) {
        var nb = adj[cur][qk];
        if (!seen[nb]) {
          seen[nb] = true;
          depth[nb] = depth[cur] + 1;
          queue.push(nb);
        }
      }
    }
    var maxD = 0;
    for (ai = 0; ai < N; ai++) if (depth[ai] > maxD) maxD = depth[ai];
    // 不连通的游离节点：按输入顺序挂到当前最深层的下一层，保证全部可画
    for (ai = 0; ai < N; ai++) {
      if (depth[ai] < 0) { depth[ai] = maxD + 1; order.push(ai); }
    }
    for (ai = 0; ai < N; ai++) if (depth[ai] > maxD) maxD = depth[ai];

    // 分层（保持 BFS 顺序）
    var layers = [];
    for (var d = 0; d <= maxD; d++) layers.push([]);
    order.forEach(function (i) { layers[depth[i]].push(i); });

    var px = [], py = [], layerX = [];
    var spanX = maxD > 0 ? 820 / maxD : 0;
    layers.forEach(function (layer, di) {
      var n2 = layer.length;
      layer.forEach(function (ni, ii) {
        layerX[ni] = 90 + di * spanX;
        px[ni] = layerX[ni];
        py[ni] = 70 + (ii + 0.5) * (480 / n2);
      });
    });

    // 30 轮松弛：距离 < 58 沿连线各推开一半；层内 x 恒定
    for (var pass = 0; pass < 30; pass++) {
      for (var a = 0; a < N; a++) {
        for (var b = a + 1; b < N; b++) {
          var dx = px[a] - px[b], dy = py[a] - py[b];
          var d2 = dx * dx + dy * dy;
          if (d2 < 58 * 58) {
            var dist = Math.sqrt(d2) || 0.001;
            var push = (58 - dist) / 2;
            var ux = dx / dist, uy = dy / dist;
            px[a] += ux * push; py[a] += uy * push;
            px[b] -= ux * push; py[b] -= uy * push;
          }
        }
      }
      for (a = 0; a < N; a++) {
        px[a] = layerX[a];                       // 同层节点 x 相同
        py[a] = Math.max(30, Math.min(560, py[a])); // 画布内
      }
    }

    /* ============ 绘制：管段（先画线后画点，压住线头） ============ */
    var defs = svgEl('defs');
    var markerColors = { '#94A3B8': 'nw-arrow-gray', '#38A3E0': 'nw-arrow-blue', '#D97706': 'nw-arrow-amber' };
    for (var mc in markerColors) {
      var mk = svgEl('marker', {
        id: markerColors[mc], viewBox: '0 0 10 10', refX: 8.5, refY: 5,
        markerWidth: 5.5, markerHeight: 5.5, orient: 'auto-start-reverse'
      });
      var mpath = svgEl('path', { d: 'M0,0 L10,5 L0,10 z', fill: mc });
      mk.appendChild(mpath);
      defs.appendChild(mk);
    }
    rootG.appendChild(defs);

    var maxQ = 1;
    if (result) {
      (result.pipes || []).forEach(function (p) {
        if (Math.abs(p.qLs) > maxQ) maxQ = Math.abs(p.qLs);
      });
    }

    pipes.forEach(function (p) {
      if (idx[p.from] === undefined || idx[p.to] === undefined || p.from === p.to) return;
      var a = idx[p.from], b = idx[p.to];
      var rp = resPipe[p.id] || null;
      var q = rp ? rp.qLs : 0;
      var v = rp ? Math.abs(rp.v) : 0;
      var width = rp ? 1.6 + 3.4 * (Math.abs(q) / maxQ) : 1.6;
      var color = !rp ? '#94A3B8' : (v < 0.5 ? '#94A3B8' : (v <= 1.4 ? '#38A3E0' : '#D97706'));

      var line = svgEl('line', {
        x1: px[a].toFixed(1), y1: py[a].toFixed(1),
        x2: px[b].toFixed(1), y2: py[b].toFixed(1),
        stroke: color, 'stroke-width': width.toFixed(2),
        'stroke-linecap': 'round'
      });
      line.setAttribute('class', 'nw-pipe');
      line.setAttribute('data-id', p.id);
      if (rp) {
        var marker = markerColors[color];
        if (q > 0) line.setAttribute('marker-end', 'url(#' + marker + ')');
        else if (q < 0) line.setAttribute('marker-start', 'url(#' + marker + ')');
      }
      rootG.appendChild(line);

      // 中点小字：DN + 流量（无结果只标 DN）
      var mx = (px[a] + px[b]) / 2, my = (py[a] + py[b]) / 2;
      var label = svgEl('text', {
        x: mx.toFixed(1), y: (my - 8).toFixed(1),
        'text-anchor': 'middle', 'font-size': 10, fill: MUTED,
        'class': 'nw-pipe-label'
      });
      label.textContent = rp ? ('DN' + p.D + ' · ' + fmtQ(Math.abs(q)) + ' L/s') : ('DN' + p.D);
      rootG.appendChild(label);

      bindTip(line, function () {
        if (!rp) return p.id + '：' + p.from + '→' + p.to + ' · DN' + p.D + ' · L ' + p.L + ' m（未计算）';
        return p.id + '：' + p.from + '→' + p.to +
          ' · DN' + p.D + ' · L ' + p.L + ' m' +
          ' · Q ' + fmtQ(Math.abs(rp.qLs)) + ' L/s' +
          ' · v ' + Math.abs(rp.v).toFixed(2) + ' m/s' +
          ' · h ' + rp.h.toFixed(3) + ' m' +
          ' · 1000i ' + rp.i1000.toFixed(2) + '‰';
      });
    });

    /* ============ 绘制：节点 ============ */
    nodes.forEach(function (n, i) {
      var g = svgEl('g', { 'class': 'nw-node' });
      g.setAttribute('data-id', n.id);
      g.setAttribute('data-x', px[i].toFixed(2));
      g.setAttribute('data-y', py[i].toFixed(2));
      var rn = resNode[n.id] || null;

      if (n.kind === 'source') {
        g.appendChild(svgEl('circle', { cx: px[i], cy: py[i], r: 14, fill: 'none', stroke: BRAND, 'stroke-width': 2 }));
        g.appendChild(svgEl('circle', { cx: px[i], cy: py[i], r: 7, fill: BRAND }));
        var sLabel = svgEl('text', {
          x: px[i], y: py[i] + 30, 'text-anchor': 'middle',
          'font-size': 11, fill: INK, 'font-weight': 600
        });
        sLabel.textContent = '市政 ' + (n.head != null ? n.head : '') + ' m';
        g.appendChild(sLabel);
      } else if (n.kind === 'building') {
        var floors = (n.building && n.building.floors) || 0;
        var served = rn ? servedFloors(rn.pressure, project.settings) : -1;
        var fill = C_NONE;
        if (rn) {
          if (served >= floors) fill = C_OK;
          else if (floors - served === 1) fill = C_WARN;
          else fill = C_BAD;
        }
        g.appendChild(svgEl('rect', {
          x: px[i] - 13, y: py[i] - 16, width: 26, height: 32, rx: 3,
          fill: fill, stroke: 'rgba(16,24,40,.18)', 'stroke-width': 1
        }));
        g.appendChild(svgEl('path', {
          d: 'M' + (px[i] - 15) + ',' + (py[i] - 16) +
             ' L' + (px[i] + 15) + ',' + (py[i] - 16) +
             ' L' + (px[i]) + ',' + (py[i] - 26) + ' z',
          fill: fill, stroke: 'rgba(16,24,40,.18)', 'stroke-width': 1
        }));
        var bId = svgEl('text', {
          x: px[i] + 20, y: py[i] - 2, 'font-size': 10,
          fill: INK, 'font-weight': 600
        });
        bId.textContent = n.id;
        g.appendChild(bId);
        var bServed = svgEl('text', { x: px[i] + 20, y: py[i] + 10, 'font-size': 10, fill: MUTED });
        bServed.textContent = rn ? (served + '/' + floors + ' 层') : (floors ? floors + ' 层' : '');
        bServed.setAttribute('class', 'nw-served');
        g.appendChild(bServed);
      } else {
        g.appendChild(svgEl('circle', {
          cx: px[i], cy: py[i], r: 9, fill: '#FFFFFF',
          stroke: BRAND, 'stroke-width': 1.5
        }));
        var jId = svgEl('text', {
          x: px[i], y: py[i] + 3.5, 'text-anchor': 'middle',
          'font-size': 11, fill: INK
        });
        jId.textContent = n.id;
        g.appendChild(jId);
      }

      bindTip(g, function () {
        var base = n.id + ' · 标高 ' + n.elev + ' m';
        if (n.kind === 'source') return base + ' · 定压水头 ' + n.head + ' m';
        if (!rn) return base + '（未计算）';
        var t = base + ' · 水压 ' + rn.pressure.toFixed(2) + ' m';
        if (n.kind === 'building') {
          var sv = servedFloors(rn.pressure, project.settings);
          t += ' · 能上 ' + sv + ' 层';
        }
        return t;
      });

      g.addEventListener('click', function () {
        if (typeof WC.ui.networkMap.onSelectNode === 'function') {
          WC.ui.networkMap.onSelectNode(n.id);
        }
      });

      rootG.appendChild(g);
    });

    /* ============ 图例（图下方独立一行，不压住任何节点，也不随缩放变形） ============ */
    var legendBar = document.createElement('div');
    legendBar.className = 'nw-legend-bar';
    [[C_OK, '达标'], [C_WARN, '差1层'], [C_BAD, '差2层以上'], [C_NONE, '无数据']].forEach(function (item) {
      var chip = document.createElement('span');
      chip.className = 'nw-legend-item';
      chip.innerHTML = '<i style="background:' + item[0] + '"></i>' + item[1];
      legendBar.appendChild(chip);
    });

    container.appendChild(wrap);
    wrap.appendChild(legendBar);

    /* —— 导出 SVG —— */
    function exportSvg() {
      var clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', SVG_NS);
      clone.setAttribute('width', '1000');
      clone.setAttribute('height', '620');
      var text = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
      var blob = new Blob([text], { type: 'image/svg+xml' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '管网图.svg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    return wrap;
  }

  WC.ui = WC.ui || {};
  WC.ui.networkMap = {
    render: render,
    onSelectNode: null,
    servedFloors: servedFloors
  };
})(window.WC = window.WC || {});
