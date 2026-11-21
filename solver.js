/* ============================================================
   solver.js · 求解内核（环状管网平差）
   ------------------------------------------------------------
   算法（按规格实现，勿改）：
   1. 单位换算：demand/1000 → m³/s；D/1000 → m
   2. 阻力系数 R = 10.67·L / (C^1.852·D^4.87)；
      水头损失 h(Q) = R·Q·|Q|^0.852（海澄-威廉）
   3. 找唯一定压节点，BFS 建生成树；不可达节点 → 报错
   4. 基本环路：每条余枝（非树边）+ 树上两端到 LCA 的路径；
      环数 = 管段数 − 节点数 + 1
   5. 初分流量：树边 = 子树需水量（自叶向根累加），余枝 = 0
   6. 哈代-克罗斯迭代：ΔQ = −Σ(sign·h) / (1.852·Σ|h/Q|)；
      逐环算完立即回加（经典顺序法）；|h/Q| 在 Q=0 时取 0，
      分母为 0 跳过该环；max|ΔQ| < eps 或达 maxIter 停止
   7. 节点水头：从定压节点沿生成树推进 H_to = H_from − h
   纯函数：不改输入工程对象。
   ------------------------------------------------------------
   全局约定：唯一暴露 window.WC，公共接口挂 WC.solver。
   ============================================================ */
(function (WC) {
  'use strict';

  var HW_N = 1.852;           // 海澄-威廉指数
  var HW_A = 10.67;           // 海澄-威廉系数（h 单位 m、Q 单位 m³/s、D 单位 m）

  /** 一条管段在流量 q（m³/s，沿 from→to 为正）下的水头损失（m，带符号）。 */
  function hOf(R, q) {
    return R * q * Math.pow(Math.abs(q), 0.852);
  }

  /**
   * 求解入口。
   * @param {object} project  watercheck/v1 工程（只读，不会被修改）
   * @param {object} [opts]   { eps=1e-7, maxIter=300 }
   * @returns {object} 平差结果（见规格第 8 条）
   */
  function solve(project, opts) {
    opts = opts || {};
    var eps = opts.eps === undefined ? 1e-7 : opts.eps;      // m³/s
    var maxIter = opts.maxIter === undefined ? 300 : opts.maxIter;

    var srcNodes = (project && project.nodes) || [];
    var srcPipes = (project && project.pipes) || [];
    if (!srcNodes.length || !srcPipes.length) {
      throw new Error('请先录入节点和管段');
    }

    /* —— 内部副本（纯函数：不动输入）—— */
    var N = srcNodes.map(function (nn) {
      return {
        id: nn.id, kind: nn.kind || 'junction',
        demand: Number(nn.demand) || 0,   // L/s
        elev: Number(nn.elev) || 0,       // m
        fixed: !!nn.fixed,
        head: Number(nn.head) || 0        // m（定压节点用）
      };
    });
    var P = srcPipes.map(function (p) {
      return { id: p.id, from: p.from, to: p.to, L: Number(p.L), D: Number(p.D), C: Number(p.C) };
    });

    var idxOf = {};
    N.forEach(function (nn, i) { idxOf[nn.id] = i; });

    /* —— 边界与参数校验 —— */
    P.forEach(function (p) {
      if (p.from === p.to || idxOf[p.from] === undefined || idxOf[p.to] === undefined) {
        throw new Error('管段「' + p.id + '」必须连接两个不同的已有节点');
      }
      if (!(p.L > 0) || !(p.D > 0) || !(p.C > 0)) {
        throw new Error('管段「' + p.id + '」的管长、管径、C 值必须大于 0');
      }
    });

    var fixedIdx = -1;
    N.forEach(function (nn, i) {
      if (nn.fixed) {
        if (fixedIdx >= 0) {
          throw new Error('有多个定压节点（' + N[fixedIdx].id + '、' + nn.id +
            '）：当前版本只支持一个定压水源，请把多余的定压节点改为普通节点');
        }
        fixedIdx = i;
      }
    });
    if (fixedIdx < 0) {
      throw new Error('还没有定压节点：当前版本只支持一个定压水源，请把水源节点的「是否定压」开关打开');
    }

    /* —— 阻力系数（第 1、2 条：D 换 m，R = 10.67·L / (C^1.852·D^4.87)）—— */
    P.forEach(function (p) {
      var Dm = p.D / 1000;
      p.R = HW_A * p.L / (Math.pow(p.C, HW_N) * Math.pow(Dm, 4.87));
      p.q = 0; // 管段流量（m³/s，沿 from→to 为正）
    });

    var n = N.length, m = P.length, i;

    /* —— 邻接表 —— */
    var adj = [];
    for (i = 0; i < n; i++) adj.push([]);
    P.forEach(function (p, pi) {
      var a = idxOf[p.from], b = idxOf[p.to];
      adj[a].push({ to: b, pipe: pi });
      adj[b].push({ to: a, pipe: pi });
    });

    /* —— BFS 生成树（第 3 条）—— */
    var parent = [], parentPipe = [], depth = [], order = [], seen = [];
    for (i = 0; i < n; i++) { parent.push(-1); parentPipe.push(-1); depth.push(0); seen.push(false); }
    var queue = [fixedIdx];
    seen[fixedIdx] = true;
    while (queue.length) {
      var cur = queue.shift();
      order.push(cur);
      for (var k = 0; k < adj[cur].length; k++) {
        var nb = adj[cur][k];
        if (!seen[nb.to]) {
          seen[nb.to] = true;
          parent[nb.to] = cur;
          parentPipe[nb.to] = nb.pipe;
          depth[nb.to] = depth[cur] + 1;
          queue.push(nb.to);
        }
      }
    }
    var lost = [];
    for (i = 0; i < n; i++) if (!seen[i]) lost.push(N[i].id);
    if (lost.length) {
      throw new Error('管网不连通：节点 ' + lost.join('、') + ' 无法到达定压节点');
    }

    var inTree = [];
    for (i = 0; i < m; i++) inTree.push(false);
    for (i = 0; i < n; i++) if (parentPipe[i] >= 0) inTree[parentPipe[i]] = true;

    /* —— 初分流量（第 5 条）：树边 = 子树需水量，余枝 = 0 —— */
    var sub = [];
    for (i = 0; i < n; i++) sub.push(N[i].demand / 1000); // m³/s
    for (i = order.length - 1; i >= 1; i--) {
      var j = order[i];
      if (parent[j] >= 0) sub[parent[j]] += sub[j];
    }
    for (i = 0; i < n; i++) {
      var pi = parentPipe[i];
      if (pi < 0) continue; // 根
      var p = P[pi];
      // 流向：水源（根）→ 子树；管段 from→to 同向为正
      P[pi].q = (p.from === N[parent[i]].id) ? sub[i] : -sub[i];
    }

    /* —— 基本环路（第 4 条）：余枝 + 两端到 LCA 的树上路径 —— */
    function lca(a, b) {
      var mark = [];
      var x = a;
      while (x >= 0) { mark[x] = true; x = parent[x]; }
      var y = b;
      while (y >= 0) {
        if (mark[y]) return y;
        y = parent[y];
      }
      return -1;
    }

    var loops = [];
    P.forEach(function (p, pi) {
      if (inTree[pi]) return;
      var u = idxOf[p.from], v = idxOf[p.to];
      var w = lca(u, v);
      if (w < 0) return; // 理论上不会发生（BFS 已连通）

      var items = [{ pipe: pi, sign: (p.from === N[u].id) ? 1 : -1 }]; // 余枝：u→v
      // v 沿树上行到 LCA（遍历方向：child → parent）
      var x = v;
      while (x !== w) {
        var e = parentPipe[x];
        items.push({ pipe: e, sign: (P[e].from === N[x].id) ? 1 : -1 });
        x = parent[x];
      }
      // u 沿树上行到 LCA（收集后反转 → 遍历方向：parent → child）
      var down = [];
      var y = u;
      while (y !== w) {
        var e2 = parentPipe[y];
        down.push({ pipe: e2, sign: (P[e2].from === N[parent[y]].id) ? 1 : -1 });
        y = parent[y];
      }
      down.reverse();
      loops.push({ items: items.concat(down) });
    });

    /* —— 哈代-克罗斯迭代（第 6 条）；0 环（枝状管网）无需迭代 —— */
    var converged = loops.length === 0; // 枝状管网：初分流量即精确解
    var iterations = 0;
    var history = [];
    for (var it = 1; loops.length > 0 && it <= maxIter; it++) {
      var maxDQ = 0;
      for (var c = 0; c < loops.length; c++) {
        var items = loops[c].items;
        var sumH = 0, sumDeriv = 0;
        for (var t = 0; t < items.length; t++) {
          var q = P[items[t].pipe].q;
          var hh = hOf(P[items[t].pipe].R, q);
          sumH += items[t].sign * hh;
          sumDeriv += (q === 0) ? 0 : Math.abs(hh / q); // Q=0 时按 0 处理
        }
        if (sumDeriv === 0) continue; // 分母为 0：跳过该环
        var dQ = -sumH / (HW_N * sumDeriv);
        for (var t2 = 0; t2 < items.length; t2++) {
          P[items[t2].pipe].q += items[t2].sign * dQ;
        }
        if (Math.abs(dQ) > maxDQ) maxDQ = Math.abs(dQ);
      }
      iterations = it;
      history.push({ iter: it, maxDQ: maxDQ });
      if (maxDQ < eps) { converged = true; break; }
    }

    /* —— 节点水头（第 7 条）：沿生成树 H_to = H_from − h —— */
    var H = [];
    H[fixedIdx] = N[fixedIdx].head;
    for (i = 1; i < order.length; i++) {
      var node = order[i];
      var pa = parent[node];
      var pi2 = parentPipe[node];
      var pp = P[pi2];
      // 树方向 parent→child 的流量；管段反向则取负
      var qPTC = (pp.from === N[pa].id) ? pp.q : -pp.q;
      H[node] = H[pa] - hOf(pp.R, qPTC);
    }

    /* —— 输出组装（第 8 条）—— */
    var outPipes = P.map(function (p) {
      var h = hOf(p.R, p.q);
      var Dm = p.D / 1000;
      var area = Math.PI * Dm * Dm / 4;
      return {
        id: p.id, from: p.from, to: p.to, L: p.L, D: p.D, C: p.C,
        q: p.q,             // m³/s（沿 from→to 为正）
        qLs: p.q * 1000,    // L/s
        v: area > 0 ? p.q / area : 0, // m/s（带符号）
        h: h,               // m（沿 from→to 的水头损失，正=顺向损失）
        i1000: p.L > 0 ? Math.abs(h) / p.L * 1000 : 0 // ‰ 水力坡降
      };
    });

    var outNodes = N.map(function (nn, i2) {
      return {
        id: nn.id, demand: nn.demand, elev: nn.elev, fixed: nn.fixed,
        head: H[i2], pressure: H[i2] - nn.elev
      };
    });

    var cycles = loops.map(function (lp, ci) {
      var residual = 0;
      var ids = [];
      lp.items.forEach(function (it2) {
        residual += it2.sign * hOf(P[it2.pipe].R, P[it2.pipe].q);
        ids.push(P[it2.pipe].id);
      });
      return { index: ci, pipes: ids, residual: residual };
    });

    var totalDemand = 0;
    N.forEach(function (nn) { totalDemand += nn.demand; }); // L/s

    var continuity = [];
    var maxCont = 0;
    N.forEach(function (nn, i2) {
      var net = 0; // m³/s，正=净流入
      P.forEach(function (p) {
        if (p.from === nn.id) net -= p.q;
        if (p.to === nn.id) net += p.q;
      });
      if (nn.fixed) {
        continuity.push({ id: nn.id, supplied: -net * 1000 }); // L/s，水源供入管网
      } else {
        var res = net * 1000 - nn.demand; // L/s
        if (Math.abs(res) > maxCont) maxCont = Math.abs(res);
        continuity.push({ id: nn.id, residual: res });
      }
    });

    var maxLoopResidual = 0;
    cycles.forEach(function (cy) {
      if (Math.abs(cy.residual) > maxLoopResidual) maxLoopResidual = Math.abs(cy.residual);
    });

    return {
      pipes: outPipes,
      nodes: outNodes,
      cycles: cycles,
      continuity: continuity,
      iterations: iterations,
      converged: converged,
      maxLoopResidual: maxLoopResidual,
      maxContinuity: maxCont,
      totalDemand: totalDemand,
      history: history
    };
  }

  WC.solver = { solve: solve, VERSION: 'hardy-cross/1.0' };
})(window.WC = window.WC || {});
