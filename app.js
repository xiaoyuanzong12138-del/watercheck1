/* ============================================================
   app.js · 入口：hash 路由 + 页面渲染
   ------------------------------------------------------------
   路由：#/home  #/project/:id  #/edit/:id  #/result/:id  #/report/:id
   首页：产品名 + 新建体检 + 示例工程 + 我的工程 + 底部三句话。
   工程页：顶栏（返回 / 重命名 / 专业模式开关）+ 开发中占位。
   编辑页（#/edit/:id）：分区切换（用水量 / 节点 / 管段 / 校核参数），
   本轮实现「用水量」，其余三个分区为「即将支持」占位。
   ------------------------------------------------------------
   全局约定：唯一暴露 window.WC，公共接口挂 WC.app（boot）。
   ============================================================ */
(function (WC) {
  'use strict';

  var store = WC.store;
  var samples = WC.samples;
  var networkMap = WC.ui.networkMap;

  var root = null;            // #app 容器，boot 时赋值
  var proMode = { on: false }; // 专业模式（本轮占位，仅切换开关状态）

  /* ==================== 小工具 ==================== */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function byUpdatedDesc(a, b) {
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  }

  function setTitle(text) {
    document.title = text ? text + ' · 水压体检' : '水压体检 · 给水管网水力体检';
  }

  /* ==================== 路由 ==================== */

  function parseHash() {
    var raw = (location.hash || '#/home').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(function (x) { return x !== ''; });
    return {
      page: parts[0] || 'home',
      id: parts[1] ? decodeURIComponent(parts[1]) : null
    };
  }

  function navigate(hash) {
    if (location.hash === hash) render(); // 同路由也强制刷新
    else location.hash = hash;
  }

  var PAGE_META = {
    project: {
      title: '工程概览',
      planned: '这里将汇总节点/管段统计与用水量估算，作为进入「录入管网」「计算结果」的枢纽。',
      docTitle: '工程概览'
    },
    edit: {
      title: '录入管网',
      planned: '这里将录入节点（水源/接点/楼栋：标高、层数、人数）与管段（长度、管径、海曾-威廉系数）。',
      docTitle: '录入管网'
    },
    result: {
      title: '计算结果',
      planned: '这里将用白话展示：每栋楼能供到几层、哪段管偏细、要不要加水泵，并给出建议。',
      docTitle: '计算结果'
    },
    report: {
      title: '计算书',
      planned: '这里将生成专业模式的完整平差表（平差：反复修正管段流量直到压力平衡），支持导出。',
      docTitle: '计算书'
    }
  };

  function render() {
    var r = parseHash();
    root.innerHTML = '';

    if (r.page === 'edit') {
      renderEditPage(r.id);
    } else if (r.page === 'result') {
      renderResultPage(r.id);
    } else if (r.page === 'report') {
      renderReportPage(r.id);
    } else if (PAGE_META[r.page] && r.page !== 'project') {
      renderProjectPage(r.id, r.page);
    } else if (r.page === 'project') {
      renderProjectPage(r.id, 'project');
    } else {
      renderHome();
    }
    if (document.querySelector('.report-doc') || r.page === 'report') {
      // 计算书打印页不重复放页脚（正文自带页码）
    } else {
      root.appendChild(buildFootnotes());
    }
  }

  /* ==================== 顶栏 ==================== */

  /**
   * 顶栏：左侧返回首页，中间工程名（可点击重命名），右侧专业模式开关。
   * @param {{name:string, onRename:Function|null}} opts
   */
  function buildTopbar(opts) {
    var bar = document.createElement('header');
    bar.className = 'topbar';
    bar.innerHTML =
      '<a class="topbar-back" href="' + esc(opts.backHash || '#/home') + '" title="返回">' +
      esc(opts.backLabel || '← 首页') + '</a>' +
      '<button class="topbar-title" type="button"></button>' +
      '<label class="topbar-side switch" title="专业模式：查看完整平差数据（管段/节点/环闭合差/收敛曲线）与计算书">' +
      '<input type="checkbox">' +
      '<span class="switch-track"><span class="switch-knob"></span></span>' +
      '<span class="switch-label">专业模式</span>' +
      '</label>';

    var titleBtn = bar.querySelector('.topbar-title');
    var toggle = bar.querySelector('input[type="checkbox"]');

    toggle.checked = proMode.on;
    toggle.addEventListener('change', function () {
      proMode.on = toggle.checked;
      // 工程页传了 onProToggle：开关后重渲染以显示/隐藏「查看平差结果」「打印计算书」入口
      if (typeof opts.onProToggle === 'function') opts.onProToggle(toggle.checked);
    });

    if (opts.onRename) {
      titleBtn.innerHTML = esc(opts.name) + ' <span class="topbar-title-hint">✎ 改名</span>';
      titleBtn.title = '点击重命名工程';
      titleBtn.addEventListener('click', function () {
        if (titleBtn.querySelector('input')) return; // 已在编辑中
        opts.onRename(titleBtn);
      });
    } else {
      titleBtn.textContent = opts.name;
      titleBtn.classList.add('is-static');
    }
    return bar;
  }

  /** 内联重命名：把目标元素临时变成输入框；Enter 保存、Esc 取消、失焦保存。 */
  function inlineRename(el, current, onFinish) {
    if (!el || el.dataset.renaming === '1') return;
    el.dataset.renaming = '1';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-rename';
    input.value = current;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    try { input.select(); } catch (e) { /* 老浏览器忽略 */ }

    var done = false;
    /** 结束编辑：save=false 还原；save=true 且名字有效则回调新名，否则回调 null。 */
    function finish(save) {
      if (done) return;
      done = true;
      var v = input.value.trim();
      onFinish(save && v && v !== current ? v : null);
    }
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
  }

  /** 点顶栏工程名 → 内联改名（不再弹 prompt）。 */
  function renameProjectFlow(id) {
    return function (el) {
      var p = store.get(id);
      if (!p) { navigate('#/home'); return; }
      inlineRename(el, p.name, function (v) {
        if (v) { p.name = v; store.save(p); }
        render(); // 取消/保存都重绘还原界面
      });
    };
  }

  /* ==================== 首页 ==================== */

  function renderHome() {
    setTitle('');
    var page = document.createElement('div');
    page.className = 'home';
    page.appendChild(buildHero());
    page.appendChild(buildScrolly());
    page.appendChild(buildFixes());
    page.appendChild(buildChecker());
    page.appendChild(buildShowcase());
    var guide = buildGuide();
    if (guide) page.appendChild(guide);
    page.appendChild(buildSamples());
    page.appendChild(buildMyProjects());
    page.appendChild(buildStory());
    root.appendChild(buildHomeBar());
    root.appendChild(page);
  }

  /* —— 首页示例结论：真调 WC.solver 算，算不出来就降级，绝不编数字 —— */
  var sampleCalcCache = {};
  var pendingAutoCheck = null; // 点「看这份完整报告」后，进工程页自动体检一次

  function sampleTarget(s) {
    return { id: s.id, name: s.title, water: s.water, nodes: s.nodes, pipes: s.pipes, settings: s.settings };
  }
  function sampleResult(s) {
    if (sampleCalcCache[s.id]) return sampleCalcCache[s.id];
    var out;
    try {
      var t = sampleTarget(s);
      out = { ok: true, target: t, result: WC.solver.solve(t) };
    } catch (e) {
      console.warn('首页示例计算失败（' + s.title + '）：' + (e && e.message ? e.message : e));
      out = { ok: false };
    }
    sampleCalcCache[s.id] = out;
    return out;
  }

  /** 示例卡那一行结论（如「水压只够到 2 层」）。 */
  function sampleSummary(s) {
    var c = sampleResult(s);
    if (!c.ok) return '点开查看';
    var rows = verdictScope(c.target, c.result).rows;
    if (allPass(c.target, c.result)) {
      if (rows.length) {
        var maxF = Math.max.apply(null, rows.map(function (x) { return x.floors; }));
        return maxF + ' 层全达标';
      }
      return Math.round(c.result.totalDemand) + ' L/s 全达标';
    }
    var w = worstPoint(c.target, c.result);
    if (!w) return '点开查看';
    return w.served === 0 ? (w.floors + ' 层只能供到 0 层') : ('水压只够到 ' + w.served + ' 层');
  }

  /** 从当前入口压力往上找最小达标压力（0.5 m 步长，上限 80 m）。 */
  function pressurizeSearch(target) {
    var src = mainSource(target);
    if (!src) return null;
    var start = Math.round((src.head || 0) * 2) / 2;
    for (var h = start; h <= 80 + 1e-9; h += 0.5) {
      var H = h;
      try {
        var p = cloneProject(target);
        p.nodes.forEach(function (n) { if (n.fixed) n.head = H; });
        var rr = WC.solver.solve(p);
        if (allPass(target, rr)) {
          var w = worstPoint(target, rr);
          return { H: H, pressure: w.pressure };
        }
      } catch (e) { return null; }
    }
    return null;
  }

  /** 首页「样例体检卡」：用幸福里示例实时算出红/绿两行。 */
  function buildShowcase() {
    var s = samples.byId('sample-liuceng-muzhi');
    var card = document.createElement('section');
    card.className = 'card showcase-card';
    if (!s) return card;

    var head = '<div class="showcase-head"><h3>幸福里小区 · 6 层住宅 · 1998 年建</h3>' +
      '<span class="tag tag-water">样例</span></div>';
    var c = sampleResult(s);
    var body = '';
    if (c.ok) {
      var rows = verdictScope(c.target, c.result).rows;
      var w = worstPoint(c.target, c.result);
      var served = w ? w.served : 0;
      body += '<p class="showcase-bad"><span class="showcase-mark" aria-hidden="true">✕</span>现在只供到 ' + served + ' 层 —— 第 ' + (served + 1) + ' 层以上，高峰期没水</p>';
      var plan = pressurizeSearch(c.target);
      if (w && plan) {
        var maxF = rows.length ? Math.max.apply(null, rows.map(function (x) { return x.floors; })) : 6;
        body += '<p class="showcase-good"><span class="showcase-mark" aria-hidden="true">✓</span>加装增压泵、加压到 ' + plan.H.toFixed(1) + ' m 后，' +
          maxF + ' 层全部达标（最不利处 ' + plan.pressure.toFixed(1) + ' m）</p>';
      } else if (w) {
        body += '<p class="showcase-good"><span class="showcase-mark" aria-hidden="true">✓</span>点开看看这份报告</p>';
      }
    } else {
      body += '<p class="showcase-bad"><span class="showcase-mark" aria-hidden="true">✕</span>点开看看这份报告</p>';
    }

    card.innerHTML = head + body +
      '<div class="showcase-foot"><span class="u-muted u-small">数据来自内置示例，实时计算</span></div>';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary showcase-btn';
    btn.textContent = '看这份完整报告 →';
    btn.addEventListener('click', function () {
      pendingAutoCheck = s.id;
      navigate('#/project/' + encodeURIComponent(s.id));
    });
    card.insertBefore(btn, card.querySelector('.showcase-foot'));
    return card;
  }

  /* —— 首次访问引导条（关掉后记住，不再出现） —— */
  var GUIDE_KEY = 'wc.guide.v1';
  function buildGuide() {
    var dismissed = false;
    try { dismissed = localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { /* 隐私模式忽略 */ }
    if (dismissed) return null;
    var bar = document.createElement('div');
    bar.className = 'guide-bar';
    bar.innerHTML = '<span class="guide-text">第一次来？先打开示例「6 层老小区」看看。</span>';
    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn btn-primary btn-sm';
    go.textContent = '打开示例';
    go.addEventListener('click', function () {
      navigate('#/project/' + encodeURIComponent('sample-liuceng-muzhi'));
    });
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'guide-close';
    close.setAttribute('aria-label', '关闭引导');
    close.textContent = '×';
    close.addEventListener('click', function () {
      try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { /* 存不进就算了 */ }
      bar.remove();
    });
    bar.appendChild(go);
    bar.appendChild(close);
    return bar;
  }

  function buildHero() {
    var hero = document.createElement('header');
    hero.className = 'hero hero-q';
    hero.innerHTML =
      '<h1 class="hero-q-title">为什么高楼层的自来水，<br>总是很小？</h1>' +
      '<p class="hero-q-sub">因为水压只够把它推到某一层。<br>' +
      '问题是：推到第几层？还能不能往上？<br>' +
      '这个工具，30 秒给你答案。</p>' +
      '<div class="scroll-hint" aria-hidden="true"><span class="scroll-line"></span><span class="scroll-arrow">↓</span></div>';
    return hero;
  }

  /** 首页顶栏：产品名降级为左上角小字。 */
  function buildHomeBar() {
    var bar = document.createElement('header');
    bar.className = 'topbar home-bar';
    bar.innerHTML = '<span class="home-brand">水压体检</span>';
    return bar;
  }

  /** 30 秒自查：三步问答 → 结论卡（不录管网）。数字取自 settings.serviceHead 默认表。 */
  function buildChecker() {
    var sec = document.createElement('section');
    sec.className = 'checker';

    /* 服务水头表：与 store.create() 的默认 settings.serviceHead 一致（1→10 … 6→28 m） */
    var SH = serviceHeadTable({ settings: {} });
    var need = function (n) { return n <= 6 ? (SH[n] || 28) : 10 + 4 * (n - 1); };

    var head = document.createElement('div');
    head.className = 'checker-head';
    head.innerHTML = '<h2 class="checker-title">没有管网数据？30 秒自查</h2>' +
      '<p class="checker-sub">回答三个问题，先判断你这栋楼大概是什么情况</p>';
    sec.appendChild(head);

    var state = { floors: null, supply: null, status: null };

    var steps = [
      {
        key: 'floors', q: '1. 这栋楼几层？', opts: [
          { v: '1-6', t: '1–6 层' }, { v: '7-11', t: '7–11 层' },
          { v: '12-18', t: '12–18 层' }, { v: '19+', t: '19 层以上' }
        ]
      },
      {
        key: 'supply', q: '2. 水是怎么上楼的？', opts: [
          { v: 'direct', t: '市政直供（没有水箱、没有泵）' },
          { v: 'tank', t: '有楼顶水箱或二次供水' },
          { v: 'unknown', t: '不知道' }
        ]
      },
      {
        key: 'status', q: '3. 高层现在什么情况？', opts: [
          { v: 'low', t: '水很小、高峰期没水' },
          { v: 'normal', t: '一直正常' },
          { v: 'unknown', t: '不确定' }
        ]
      }
    ];

    var groups = [];
    steps.forEach(function (st) {
      var row = document.createElement('div');
      row.className = 'chk-step';
      var q = document.createElement('p');
      q.className = 'chk-q';
      q.textContent = st.q;
      var opts = document.createElement('div');
      opts.className = 'chk-opts';
      st.opts.forEach(function (o) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chk-opt';
        b.textContent = o.t;
        b.setAttribute('data-v', o.v);
        b.addEventListener('click', function () {
          state[st.key] = o.v;
          Array.prototype.forEach.call(opts.children, function (x) {
            var on = x === b;
            x.classList.toggle('is-on', on);
            x.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          maybeShow();
        });
        opts.appendChild(b);
      });
      row.appendChild(q);
      row.appendChild(opts);
      sec.appendChild(row);
      groups.push(opts);
    });

    var result = document.createElement('div');
    result.className = 'chk-result';
    result.hidden = true;
    sec.appendChild(result);

    var shownKey = '';

    function decide() {
      var f = state.floors, s = state.supply, t = state.status;
      var unknown = s === 'unknown' || t === 'unknown';

      /* 规则优先级：19 层以上（任意）> 市政直供 1–6 层水小 > 市政直供 7 层以上
         > 二次供水且水小 > 一直正常；任一「不知道/不确定」再加一句提示 */
      if (f === '19+') {
        return {
          title: '19 层以上必须分区供水，需要逐区核算',
          basis: '19 层按每层 4 m 估算要 ' + need(19) + ' m 以上，一套泵供不到顶',
          steps: ['确认分区方案', '每区单独做管网体检'],
          unknown: unknown
        };
      }
      if (s === 'direct' && f === '1-6' && t === 'low') {
        return {
          title: '大概率是入口压力不足',
          basis: '6 层要 ' + SH[6] + ' m 服务水头，市政一般只给到 18–24 m',
          steps: ['让物业测最不利点压力', '加装增压泵（示例中加压到 32.5 m 后 6 层全达标）'],
          unknown: unknown
        };
      }
      if (s === 'direct' && f && f !== '1-6') {
        return {
          title: '7 层以上市政直供基本不够，需要二次供水',
          basis: '7 层要 ' + need(7) + ' m、18 层要 ' + need(18) + ' m 服务水头，市政直供一般到不了',
          steps: ['查是否已有水箱 / 泵房', '按分区供水核算（示例里 18 层需要 ' + need(18) + ' m）'],
          unknown: unknown
        };
      }
      if (s === 'tank' && t === 'low') {
        return {
          title: '问题更可能在加压设备或管网老化',
          basis: '有二次供水还水小，说明楼内加压或管道有问题；正常管网 C 值应在 100 以上',
          steps: ['查泵是否正常运行', '测末端压力', '管网 C 值可能已低于 100'],
          unknown: unknown
        };
      }
      if (t === 'normal') {
        return {
          title: '目前没有明显问题',
          basis: '自由水压够 6 层（≥' + SH[6] + ' m）时一般不会出现水小',
          steps: ['可以做一次完整体检留个基线'],
          unknown: unknown
        };
      }
      return {
        title: '信息还不够，先确认供水方式和水压',
        basis: '6 层要 ' + SH[6] + ' m 服务水头，先确认这两项再判断',
        steps: ['问物业有没有水箱 / 泵房', '让物业测一次最不利点压力'],
        unknown: true
      };
    }

    function floorLabel() {
      var map = { '1-6': '1–6 层', '7-11': '7–11 层', '12-18': '12–18 层', '19+': '19 层以上' };
      return map[state.floors] || '层数未知';
    }
    function supplyLabel() {
      var map = { direct: '市政直供', tank: '二次供水', unknown: '供水方式未知' };
      return map[state.supply] || '供水方式未知';
    }

    function maybeShow() {
      if (!state.floors || !state.supply || !state.status) return;
      var d = decide();
      var key = d.title + '|' + d.unknown;
      if (key === shownKey) return;
      shownKey = key;

      var html = '<p class="chk-verdict">' + esc(d.title) + '</p>' +
        '<p class="chk-basis">依据：' + esc(d.basis) + '</p>';
      if (d.unknown) html += '<p class="chk-hint">建议先让物业确认这一项，结果会更准。</p>';
      html += '<ol class="chk-next">' + d.steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>';

      var acts = document.createElement('div');
      acts.className = 'chk-acts';
      var mk = document.createElement('button');
      mk.type = 'button';
      mk.className = 'btn btn-primary';
      mk.textContent = '按这个结论建一份体检 →';
      mk.addEventListener('click', function () {
        var p = store.create('小区体检 · ' + floorLabel() + ' · ' + supplyLabel());
        p.note = '自查结论：' + d.title + '；层数：' + floorLabel() + '；供水方式：' + supplyLabel();
        store.save(p);
        location.hash = '#/edit/' + p.id;
      });
      var demo = document.createElement('a');
      demo.className = 'btn';
      demo.href = '#/project/sample-liuceng-muzhi';
      demo.textContent = '先看一份完整示例 →';
      acts.appendChild(mk);
      acts.appendChild(demo);

      result.innerHTML = html;
      result.appendChild(acts);
      result.hidden = false;
      if (result.classList.contains('is-on')) {
        result.classList.remove('is-on');
      }
      requestAnimationFrame(function () { result.classList.add('is-on'); });
    }

    return sec;
  }

  /** 水压不够，怎么办：三张方案卡（全部数字来自实时试算）。 */
  function buildFixes() {
    var sec = document.createElement('section');
    sec.className = 'fixes';

    var s = samples.byId('sample-liuceng-muzhi');
    var c = s ? sampleResult(s) : null;
    if (!c || !c.ok) {
      console.warn('三方案卡跳过：示例求解失败');
      sec.classList.add('is-off');
      return sec;
    }
    var target = c.target, result = c.result;
    var plans;
    try { plans = buildPlans(target, result); } catch (e) { plans = []; }
    var worst = worstPoint(target, result);
    var floors = (worst && worst.floors) || 6;

    var pumpPlan = null, pipePlan = null;
    plans.forEach(function (p) {
      if (!pumpPlan && p.name === '二次加压') pumpPlan = p;
      if (!pipePlan && p.name.indexOf('扩径') >= 0) pipePlan = p;
    });
    if (!pumpPlan) {
      console.warn('三方案卡跳过：缺少增压试算结果');
      sec.classList.add('is-off');
      return sec;
    }

    var head = document.createElement('div');
    head.className = 'fixes-head';
    head.innerHTML = '<h2 class="fixes-title">水压不够，怎么办？</h2>' +
      '<p class="fixes-sub">三种办法，点一下看它管不管用</p>';
    sec.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'fixes-grid';

    var cards = [];

    function makeCard(idx, title, kind, plan, resultText) {
      var card = document.createElement('article');
      card.className = 'fix-card';
      card.style.transitionDelay = (idx * 0.12).toFixed(2) + 's';

      var figHost = document.createElement('div');
      figHost.className = 'fix-fig';
      var fig = buildFloorDiagram(target, result, { bare: true });
      if (fig) { figHost.appendChild(fig); fig.fdApi.final(); }

      var h3 = document.createElement('h3');
      h3.className = 'fix-name';
      h3.textContent = title;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn fix-try';
      btn.textContent = '试试看';

      var row = document.createElement('p');
      row.className = 'fix-result';
      row.hidden = true;

      btn.addEventListener('click', function () {
        if (btn.disabled || !fig) return;
        btn.disabled = true;
        fig.fdApi.plan(kind, plan, function () {
          btn.disabled = false;
          row.textContent = resultText();
          row.hidden = false;
        });
      });

      card.appendChild(figHost);
      card.appendChild(h3);
      card.appendChild(btn);
      card.appendChild(row);
      grid.appendChild(card);
      cards.push(card);
    }

    /* 卡 1 · 增压泵：水涨到顶层、全绿、标签更新 */
    makeCard(0, '加一台增压泵', 'pump', pumpPlan, function () {
      var w = worstPoint(target, pumpPlan.sim);
      return '最不利点 ' + w.pressure.toFixed(1) + ' m，' + floors + ' 层全达标';
    });

    /* 卡 2 · 换主管：如实给出真实涨幅（可能几乎没有） */
    if (pipePlan) {
      makeCard(1, '把主管换成更大的管', 'pipe', pipePlan, function () {
        var w0 = worstPoint(target, result), w1 = worstPoint(target, pipePlan.sim);
        var delta = w1.pressure - w0.pressure;
        if (delta >= 0.05) {
          return '最不利点只升了 ' + delta.toFixed(1) + ' m —— 说明瓶颈不在管径，在入口压力';
        }
        return '水压几乎没变 —— 说明瓶颈不在管径，在入口压力';
      });
    }

    /* 卡 3 · 顶部两层单独加压 */
    makeCard(2, (floors - 1) + '–' + floors + ' 层单独二次加压', 'local', pumpPlan, function () {
      return (floors - 1) + '–' + floors + ' 层独立供水，1–' + (floors - 2) + ' 层维持原状';
    });

    sec.appendChild(grid);

    var cta = document.createElement('div');
    cta.className = 'fixes-cta';
    var tryBtn = document.createElement('button');
    tryBtn.type = 'button';
    tryBtn.className = 'btn btn-primary';
    tryBtn.textContent = '用我家小区试一下 →';
    tryBtn.addEventListener('click', function () {
      var p = store.create('我的体检 ' + (store.loadAll().length + 1));
      location.hash = '#/edit/' + p.id;
    });
    var docBtn = document.createElement('a');
    docBtn.className = 'btn';
    docBtn.href = '#/report/sample-liuceng-muzhi';
    docBtn.textContent = '看看完整的计算过程 →';
    cta.appendChild(tryBtn);
    cta.appendChild(docBtn);
    sec.appendChild(cta);

    if (typeof IntersectionObserver === 'function') {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            cards.forEach(function (cd) { cd.classList.add('is-in'); });
            io.disconnect();
          }
        });
      }, { threshold: 0.2 });
      io.observe(sec);
    } else {
      cards.forEach(function (cd) { cd.classList.add('is-in'); });
    }
    return sec;
  }

  /** 首页「滚动驱动」舞台：楼体弹起 + 水随滚动爬升 + 旁白/解释框。 */
  function buildScrolly() {
    var sec = document.createElement('section');
    sec.className = 'scrolly';

    var s = samples.byId('sample-liuceng-muzhi');
    var c = s ? sampleResult(s) : null;
    if (!c || !c.ok) {
      console.warn('滚动舞台跳过：示例求解失败');
      sec.classList.add('is-off');
      return sec;
    }
    var target = c.target, result = c.result;
    var worst = worstPoint(target, result);
    if (!worst || !worst.floors) { sec.classList.add('is-off'); return sec; }

    var fig = buildFloorDiagram(target, result, { scrub: true });
    if (!fig || !fig.fdApi || !fig.fdApi.scrub) {
      console.warn('滚动舞台跳过：楼层图不可用');
      sec.classList.add('is-off');
      return sec;
    }

    var floors = worst.floors;
    var served = fig.fdApi.served;
    var src = mainSource(target);
    var entry = src ? ((src.head || 0) - (src.elev || 0)) : 0;
    var sh = serviceHeadTable(target);
    var need = floors <= 6 ? (sh[Math.max(floors, 1)] || sh[6]) : 10 + 4 * (floors - 1);
    var friction = Math.max(0, entry - (worst.pressure + worst.elev));
    var gap = Math.max(0, (need + friction) - entry);

    var stage = document.createElement('div');
    stage.className = 'scrolly-stage';
    var canvas = document.createElement('div');
    canvas.className = 'scrolly-canvas';
    var copy = document.createElement('div');
    copy.className = 'scrolly-copy';

    canvas.appendChild(fig);
    var tie = document.createElement('div');
    tie.className = 'scrolly-tie';
    canvas.appendChild(tie);

    var narr = document.createElement('div');
    narr.className = 'scrolly-narr';
    narr.innerHTML =
      '<p class="scrolly-line">水从楼下的进水管进来</p>' +
      '<p class="scrolly-line">每上一层楼，就要多 4 米水头</p>' +
      '<p class="scrolly-line">' + served + ' 层刚好够</p>' +
      '<p class="scrolly-line">再往上，推不动了</p>';
    var lines = Array.prototype.slice.call(narr.children);

    var exp = document.createElement('div');
    exp.className = 'scrolly-explain';
    exp.innerHTML =
      '<h3>为什么停在这？</h3>' +
      '<p>这栋楼的市政入口水头约 ' + entry.toFixed(1) + ' 米。</p>' +
      '<p>每往上多一层，就要多约 4 米。</p>' +
      '<p>' + floors + ' 层要 ' + need + ' 米，现在只有 ' + entry.toFixed(1) + ' 米 —— 差 ' + gap.toFixed(1) + ' 米。</p>' +
      '<p>再往上的水，只能靠二次加压。</p>' +
      '<p class="scrolly-src">依据最小服务水头估算；数据为内置示例</p>';

    copy.appendChild(narr);
    copy.appendChild(exp);
    stage.appendChild(canvas);
    stage.appendChild(copy);
    sec.appendChild(stage);

    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var lastP = -1, pending = false, curIdx = -1, expOn = false, logged = false;
    var gaps = [], lastTick = 0;

    function placeTie() {
      var svg = canvas.querySelector('.floor-svg');
      if (!svg) return;
      var r = svg.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      var y = fig.fdApi.waterY();
      var x0 = r.left - cr.left + (140 / 320) * r.width;
      tie.style.left = Math.round(x0) + 'px';
      tie.style.width = Math.max(0, Math.round(cr.width - x0)) + 'px';
      tie.style.top = Math.round(r.top - cr.top + (y / 400) * r.height) + 'px';
    }

    function apply(p) {
      fig.fdApi.scrub(p);
      var idx = p < 0.28 ? 0 : p < 0.62 ? 1 : p < 0.78 ? 2 : 3;
      if (idx !== curIdx) {
        curIdx = idx;
        lines.forEach(function (ln, i) { ln.classList.toggle('is-on', i === idx); });
      }
      var on = p >= 0.80;
      if (on !== expOn) {
        expOn = on;
        exp.classList.toggle('is-on', on);
        tie.classList.toggle('is-on', on);
      }
      if (on) placeTie();
    }

    function computeP() {
      var rect = sec.getBoundingClientRect();
      var total = sec.offsetHeight - window.innerHeight;
      if (total <= 0) return 0;
      return Math.min(1, Math.max(0, -rect.top / total));
    }

    function tick() {
      pending = false;
      if (!sec.isConnected) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        return;
      }
      var p = computeP();
      if (Math.abs(p - lastP) < 0.002) return;
      lastP = p;
      apply(p);

      var t = (window.performance && performance.now) ? performance.now() : Date.now();
      if (lastTick && t - lastTick < 100) gaps.push(t - lastTick); // 只取连续滚动的帧间隔，忽略停顿
      lastTick = t;
      if (!logged && gaps.length >= 30) {
        var sum = 0;
        for (var gi = 0; gi < gaps.length; gi++) sum += gaps[gi];
        console.log('[scrolly] 滚动重绘帧率 ' + (1000 / (sum / gaps.length)).toFixed(1) + ' fps');
        logged = true;
      }
    }

    function onScroll() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(tick);
    }

    if (reduce) {
      apply(1); // 减少动效：直接终态 + 解释框
      return sec;
    }

    apply(computeP());
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && sec.isConnected) onScroll();
    });
    return sec;
  }


  function buildStory() {
    var sec = document.createElement('section');
    sec.className = 'story';

    var quote = '「这栋楼，供不到顶」';
    try {
      var c = sampleResult(samples.byId('sample-liuceng-muzhi'));
      if (c.ok) {
        var w = worstPoint(c.target, c.result);
        if (w) quote = '「这栋 ' + w.floors + ' 层的楼，只能供到 ' + w.served + ' 层」';
      }
    } catch (e) {
      console.warn('故事卡取示例结果失败：' + (e && e.message ? e.message : e));
    }

    sec.innerHTML =
      '<div class="story-inner">' +
      '<div class="story-body">' +
      '<p>我是给排水科学与工程专业的学生。<br>' +
      '大三做课程设计，我把一张环状管网平差表算了两天 ——<br>' +
      '两三个环、一百多行，改一个管径就要从头再来。</p>' +
      '<p>那时候我发现：这东西算得出来，可它回答不了任何人的问题。<br>' +
      '物业说不清是管子细还是压力不够，住户只知道水小。</p>' +
      '<p>所以我把那套算法搬进了浏览器：<br>' +
      '不用装软件、不用登录，输入小区管网，它先说一句人话 ——<br>' +
      esc(quote) + '，再说为什么。</p>' +
      '</div>' +
      '<p class="story-sign">赵佳杰 · 给排水科学与工程<br>安徽工程大学 2023 级</p>' +
      '</div>';

    if (typeof IntersectionObserver === 'function') {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { sec.classList.add('is-in'); io.disconnect(); }
        });
      }, { threshold: 0.15 });
      io.observe(sec);
    } else {
      sec.classList.add('is-in');
    }
    return sec;
  }

  function buildSamples() {
    var sec = document.createElement('section');
    sec.className = 'section';
    sec.innerHTML =
      '<div class="section-head">' +
      '<h2 class="section-title">示例工程</h2>' +
      '<p class="u-muted u-small">先看典型场景怎么算</p>' +
      '</div>';

    var grid = document.createElement('div');
    grid.className = 'sample-grid';
    samples.list.forEach(function (s) {
      var card = document.createElement('article');
      card.className = 'card sample-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'link');
      card.setAttribute('aria-label', '打开示例：' + s.title);
      card.innerHTML =
        '<span class="tag tag-water">示例</span>' +
        '<h3>' + esc(s.title) + '</h3>' +
        '<p>' + esc(s.intro) + '</p>' +
        '<p class="sample-verdict">' + esc(sampleSummary(s)) + '</p>';
      var go = function () { navigate('#/project/' + encodeURIComponent(s.id)); };
      card.addEventListener('click', go);
      card.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
      });
      grid.appendChild(card);
    });

    sec.appendChild(grid);
    return sec;
  }

  function buildMyProjects() {
    var sec = document.createElement('section');
    sec.className = 'section';

    var head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = '<h2 class="section-title">我的工程</h2>';

    var importBtn = document.createElement('button');
    importBtn.className = 'btn btn-ghost btn-sm';
    importBtn.textContent = '导入 JSON';
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.hidden = true;

    importBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var p = store.importJSON(String(reader.result));
          render();
          flashItem(p.id);
        } catch (err) {
          alert('导入失败：' + (err && err.message ? err.message : '未知错误'));
        }
        fileInput.value = ''; // 允许连续导入同名文件
      };
      reader.onerror = function () { alert('读取文件失败，请重试'); };
      reader.readAsText(f, 'utf-8');
    });

    head.appendChild(importBtn);
    head.appendChild(fileInput);

    var newBtn = document.createElement('button');
    newBtn.className = 'btn btn-primary btn-sm js-new-project';
    newBtn.textContent = '＋ 新建体检';
    newBtn.addEventListener('click', function () {
      var p = store.create('我的体检 ' + (store.loadAll().length + 1));
      render();
      flashItem(p.id);
    });
    head.insertBefore(newBtn, importBtn);
    sec.appendChild(head);

    var wrap = document.createElement('div');
    wrap.className = 'project-list';
    var list = store.loadAll().slice().sort(byUpdatedDesc);

    if (!list.length) {
      wrap.innerHTML =
        '<div class="card empty">' +
        '<h3>还没有工程</h3>' +
        '<p>点上面的「＋ 新建体检」，开始录入你小区的管网；</p>' +
        '<p>也可以先打开「示例工程」，看看典型场景长什么样。</p>' +
        '</div>';
    } else {
      list.forEach(function (p) { wrap.appendChild(buildProjectItem(p)); });
    }
    sec.appendChild(wrap);
    return sec;
  }

  function buildProjectItem(p) {
    var item = document.createElement('article');
    item.className = 'card project-item';
    item.setAttribute('data-id', p.id);

    var nodes = Array.isArray(p.nodes) ? p.nodes.length : 0;
    var pipes = Array.isArray(p.pipes) ? p.pipes.length : 0;
    item.innerHTML =
      '<div class="project-info">' +
      '<h3 class="project-name">' + esc(p.name) + '</h3>' +
      '<p class="project-meta">更新于 ' + fmtDate(p.updatedAt) + ' · 节点 ' + nodes + ' · 管段 ' + pipes + '</p>' +
      '</div>' +
      '<div class="project-actions"></div>';

    var acts = item.querySelector('.project-actions');

    function act(label, handler, cls) {
      var b = document.createElement('button');
      b.className = 'act' + (cls ? ' ' + cls : '');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', handler);
      acts.appendChild(b);
    }

    act('打开', function () { navigate('#/project/' + encodeURIComponent(p.id)); });
    act('重命名', function () {
      var h3 = item.querySelector('.project-name');
      inlineRename(h3, p.name, function (v) {
        if (v) { p.name = v; store.save(p); }
        render(); // 取消/保存都重绘还原界面
      });
    });
    act('复制', function () {
      var c = store.duplicate(p.id);
      if (c) { render(); flashItem(c.id); }
    });
    act('导出 JSON', function () {
      var fresh = store.get(p.id);
      if (fresh) store.downloadJSON(fresh);
    });
    act('删除', function () {
      if (confirm('确定删除「' + p.name + '」吗？删除后无法恢复（可先「导出 JSON」备份）。')) {
        store.remove(p.id);
        render();
      }
    }, 'act-danger');

    return item;
  }

  function buildFootnotes() {
    var f = document.createElement('footer');
    f.className = 'footnotes app-footer no-print';
    f.innerHTML =
      '<p class="foot-line"><strong>水压体检 v0.9</strong> · 更新于 2026-11-22 · 数据仅存本机 · ' +
      '<a href="https://xiaoyuanzong12138-del.github.io/watercheck1/" target="_blank" rel="noopener">在线体验</a></p>' +
      '<p><strong>做了什么：</strong>录入小区的楼栋和管道，工具算出每栋楼的水压够不够、最多能供到第几层，并给出加压或换管的建议。</p>' +
      '<p><strong>用什么方法：</strong>先按用水人数估算各楼栋流量，再用环状管网平差（反复修正管段流量、直到各环路压力闭合的算法）算出各楼栋水压。</p>' +
      '<p><strong>数据安全：</strong>不联网、不登录，所有数据只存在你的浏览器里（本地存储，不上传到任何服务器）。</p>';
    return f;
  }

  /** 新建/导入后高亮滚动到对应条目。 */
  function flashItem(id) {
    var item = root.querySelector('.project-item[data-id="' + id + '"]');
    if (item) {
      item.classList.add('flash');
      try { item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* 老浏览器忽略 */ }
    }
  }

  /* ==================== 工程页 · 开始体检 ==================== */

  var resultCache = {}; // id → { result, ts }（内存缓存：重进工程页直接显示）

  /** 白话解释小圆点（点开显示，最多用 6 处，别满屏都是）。 */
  function infoDot(text) {
    return '<button type="button" class="info-dot" aria-label="这是什么意思" data-tip="' + esc(text) + '">ⓘ</button>';
  }

  function metricCard(label, value, tip) {
    return '<div class="metric-card"><div class="metric-label">' + esc(label) +
      (tip ? infoDot(tip) : '') + '</div>' +
      '<div class="metric-value">' + esc(value) + '</div></div>';
  }

  function fmtExp(v) {
    if (v === 0) return '0';
    if (Math.abs(v) >= 0.001) return String(Number(v.toFixed(4)));
    return v.toExponential(2);
  }

  /* ==================== 体检报告：口径 · 结论 · 诊断 ==================== */

  var DN_TIERS = [50, 80, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000];

  function cloneProject(p) { return JSON.parse(JSON.stringify(p)); }

  function serviceHeadTable(target) {
    return (target.settings && target.settings.serviceHead) ||
      { 1: 10, 2: 12, 3: 16, 4: 20, 5: 24, 6: 28 };
  }

  /** 层数的展示口径：超过 6 层只说「≥6 层」。 */
  function servedText(n) { return n >= 6 ? '≥6 层' : n + ' 层'; }

  /** 楼栋行：可服务层数查表定状态（与管网图三色完全一致）。 */
  function reportRows(target, result) {
    var srcById = {};
    (target.nodes || []).forEach(function (n) { srcById[n.id] = n; });
    var rows = [];
    (result.nodes || []).forEach(function (rn) {
      var src = srcById[rn.id];
      if (!src || src.kind !== 'building') return;
      var b = src.building || {};
      var floors = b.floors || 0;
      var served = WC.ui.networkMap.servedFloors(rn.pressure, target.settings);
      var status = served >= floors ? 'ok' : (floors - served === 1 ? 'warn' : 'bad');
      rows.push({
        id: rn.id, floors: floors, served: served, pressure: rn.pressure,
        elev: src.elev, status: status, demand: src.demand || 0,
        people: b.people || 0, households: b.households || 0
      });
    });
    return rows;
  }

  /**
   * 结论统计口径：楼栋节点 ≤ 6 且填了人数 → 按「栋楼」；
   * 否则（例如 3 栋 × 5 个楼层测点、没填人数）按「用水点」（只数有需水量的点）。
   */
  function verdictScope(target, result) {
    var rows = reportRows(target, result);
    if (!rows.length) return { rows: [], unit: '处', isBuilding: false };
    var hasPeople = rows.some(function (r) { return r.people > 0; });
    if (rows.length <= 6 && hasPeople) return { rows: rows, unit: '栋楼', isBuilding: true };
    var active = rows.filter(function (r) { return r.demand > 0; });
    return { rows: active.length ? active : rows, unit: '个用水点', isBuilding: false };
  }

  /** 全部达标：有楼栋按「可服务层数 ≥ 实际层数」，无楼栋按「自由水压 ≥ 6 层服务水头」。 */
  function allPass(target, result) {
    var sh = serviceHeadTable(target);
    var rows = reportRows(target, result);
    if (rows.length) return rows.every(function (r) { return r.status === 'ok'; });
    return (result.nodes || []).every(function (rn) {
      return rn.fixed || rn.pressure >= sh[6];
    });
  }

  /** 最不利点：楼栋按水压最低；无楼栋取水压最低的非水源点。 */
  function worstPoint(target, result) {
    var rows = reportRows(target, result);
    if (rows.length) {
      var w = rows[0];
      rows.forEach(function (r) { if (r.pressure < w.pressure) w = r; });
      return w;
    }
    var w2 = null;
    (result.nodes || []).forEach(function (rn) {
      if (rn.fixed) return;
      if (!w2 || rn.pressure < w2.pressure) w2 = rn;
    });
    return w2;
  }

  /** 大字结论（两种模板）。 */
  function buildVerdict(target, result) {
    var sh = serviceHeadTable(target);
    var scope = verdictScope(target, result);
    var rows = scope.rows;
    var worst = rows.length ? rows.reduce(function (a, b) { return b.pressure < a.pressure ? b : a; }) : worstPoint(target, result);
    var pass = rows.length ? rows.every(function (r) { return r.status === 'ok'; }) : allPass(target, result);
    if (rows.length) {
      if (pass) {
        var need = sh[Math.min(worst.floors, 6)] || sh[6];
        return { tone: 'ok', big: rows.length + ' ' + scope.unit + '全部达标，最不利的 ' + worst.id + ' 仍有 ' + (worst.pressure - need).toFixed(1) + ' m 余量' };
      }
      var bad = rows.filter(function (r) { return r.status !== 'ok'; });
      var head = bad.length === rows.length
        ? rows.length + ' ' + scope.unit + '全部不达标'
        : rows.length + ' ' + scope.unit + '中有 ' + bad.length + ' ' + scope.unit + '不达标';
      return { tone: 'bad', big: head + '，最差的是 ' + worst.id + '：' + worst.floors + ' 层只能供到 ' + worst.served + ' 层' };
    }
    if (pass) {
      return { tone: 'ok', big: '管网各点全部达标，最不利的 ' + worst.id + ' 仍有 ' + (worst.pressure - sh[6]).toFixed(1) + ' m 余量' };
    }
    var badN = (result.nodes || []).filter(function (rn) { return !rn.fixed && rn.pressure < sh[6]; }).length;
    return { tone: 'bad', big: '管网中有 ' + badN + ' 个点水压不够 6 层用水，最差的是 ' + worst.id };
  }

  /** 诊断（按重要性排序，最多 3 条，每条都带数字依据）。 */
  function buildDiagnoses(target, result) {
    var sh = serviceHeadTable(target);
    var out = [];

    /* —— ① 入口压力不足：缺口主要不是管子磨出来的 —— */
    var srcNode = null;
    (target.nodes || []).forEach(function (n) {
      if (n.kind === 'source' && (srcNode === null || (n.head || 0) > (srcNode.head || 0))) srcNode = n;
    });
    var worst = worstPoint(target, result);
    if (srcNode && worst) {
      // 服务水头按最不利点的实际层数算：≤6 层查表（1 层 10、2 层 12、6 层 28），
      // 超过 6 层按每层 +4 m 外推（18 层 → 78 m）
      var floors = worst.floors || 6;
      var need = floors <= 6 ? (sh[Math.max(floors, 1)] || sh[6]) : 10 + 4 * (floors - 1);
      var entry = (srcNode.head || 0) - (srcNode.elev || 0);    // 入口水压
      var friction = entry - (worst.pressure + worst.elev);     // 到最不利点的全程水头损失
      var gap = (need + friction) - entry;                      // 缺口 = 服务水头 + 损失 − 入口压力
      if (gap > 0 && friction < gap) {
        out.push({
          title: '入口压力不足',
          text: '入口 ' + entry.toFixed(1) + ' m，全程水头损失只有 ' + Math.max(friction, 0).toFixed(1) +
            ' m，而 ' + floors + ' 层需要 ' + need + ' m，缺了 ' + gap.toFixed(1) +
            ' m —— 问题在压力，不在管子。'
        });
      }
    }

    /* —— ② 管径偏小：|v| > vMax 的管段，点名最多 3 条 —— */
    var vMax = (target.settings && target.settings.vMax) || 1.4;
    var hot = (result.pipes || []).filter(function (p) { return Math.abs(p.v) > vMax; })
      .sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); }).slice(0, 3);
    if (hot.length) {
      var names = hot.map(function (p) {
        return p.id + '（流速 ' + Math.abs(p.v).toFixed(2) + ' m/s，建议扩到 DN' + suggestDN(p.qLs, p.D) + '）';
      }).join('、');
      out.push({ title: '管径偏小', text: names + '：这几段流速偏高，水头损失大。' });
    }

    /* —— ③ 管材老化：C < 100 —— */
    var old = (result.pipes || []).filter(function (p) { return p.C < 100; });
    if (old.length) {
      out.push({ title: '管材老化', text: '有 ' + old.length + ' 条管段 C 值 <100（内壁结垢严重，阻力偏大）。' });
    }

    /* —— ④ 环网未成环：枝状无备用通路 —— */
    if ((result.cycles || []).length === 0 && (target.nodes || []).length > 3) {
      out.push({ title: '环网未成环', text: '这是枝状管网，没有备用通路，一处检修整片停水。' });
    }

    return out.slice(0, 3);
  }

  /** 建议管径：按目标流速 1.0 m/s 反算，取 50 mm 整数档里刚够的一档（必须比现管径大）。 */
  function suggestDN(qLs, curD) {
    var Q = Math.abs(qLs) / 1000; // m³/s
    var need = Math.sqrt(4 * Q / Math.PI) * 1000; // mm
    for (var i = 0; i < DN_TIERS.length; i++) {
      if (DN_TIERS[i] >= need && DN_TIERS[i] > curD) return DN_TIERS[i];
    }
    return DN_TIERS[DN_TIERS.length - 1];
  }

  /* ==================== 体检报告：改造方案（试算不写 store） ==================== */

  /** 临时副本上改数据重算：返回 { result, view }，view 是改过数据的展示用副本。 */
  function simulate(target, mutate) {
    var p = cloneProject(target);
    mutate(p);
    return { result: WC.solver.solve(p), view: p };
  }

  /** 方案的预期结果：最低水压 + 达标数 + 绿/橙标注。 */
  function planOutcome(target, after) {
    var sh = serviceHeadTable(target);
    var scope = verdictScope(target, after);
    var rows = scope.rows;
    var total, ok, minP;
    if (rows.length) {
      total = rows.length;
      ok = rows.filter(function (r) { return r.status === 'ok'; }).length;
      minP = Math.min.apply(null, rows.map(function (r) { return r.pressure; }));
    } else {
      var pts = (after.nodes || []).filter(function (rn) { return !rn.fixed; });
      total = pts.length;
      ok = pts.filter(function (rn) { return rn.pressure >= sh[6]; }).length;
      minP = pts.length ? Math.min.apply(null, pts.map(function (rn) { return rn.pressure; })) : 0;
    }
    var unit = rows.length ? scope.unit : '个点';
    return {
      minPressure: minP, ok: ok, total: total, unit: unit,
      okBadge: ok === total,
      badgeText: ok === total ? '应用后达标' : '应用后仍差 ' + (total - ok) + ' ' + unit
    };
  }

  function mainSource(target) {
    var s = null;
    (target.nodes || []).forEach(function (n) {
      if (n.kind === 'source' && (s === null || (n.head || 0) > (s.head || 0))) s = n;
    });
    return s;
  }

  /** 改造方案 2–3 条（全部达标时返回 []）。 */
  function buildPlans(target, result) {
    if (allPass(target, result)) return [];
    var plans = [];
    var rows = reportRows(target, result);
    var worst = worstPoint(target, result);

    /* —— 方案 A · 二次加压：0.5 m 步长搜最小达标压力（上限 80 m） —— */
    var srcNode = mainSource(target);
    if (srcNode) {
      var curHead = srcNode.head || 0;
      var found = null, foundH = 0, sim = null;
      for (var h = Math.round(curHead * 2) / 2; h <= 80 + 1e-9; h += 0.5) {
        var step = h;
        try {
          sim = simulate(target, function (p) {
            p.nodes.forEach(function (n) { if (n.fixed) n.head = step; });
          });
        } catch (e) { sim = null; break; }
        if (allPass(target, sim.result)) { found = sim; foundH = step; break; }
      }
      if (found) {
        var wA = worstPoint(target, found.result);
        var servedA = rows.length ? servedText(WC.ui.networkMap.servedFloors(wA.pressure, target.settings)) : servedText(6);
        plans.push({
          letter: 'A', name: '二次加压',
          desc: '加压到 ' + foundH.toFixed(1) + ' m → 最不利点达标（' + wA.pressure.toFixed(1) + ' m / ' + servedA + '）',
          sim: found.result, view: found.view
        });
      } else {
        var cap = null;
        try {
          cap = simulate(target, function (p) { p.nodes.forEach(function (n) { if (n.fixed) n.head = 80; }); });
        } catch (e) { cap = null; }
        if (cap) plans.push({
          letter: 'A', name: '二次加压',
          desc: '单靠加压到 80 m 仍不够，需加中间水箱',
          sim: cap.result, view: cap.view
        });
      }
    }

    /* —— 方案 B · 主管扩径：流速最高且 |v|>vMax 的管段 —— */
    var vMax = (target.settings && target.settings.vMax) || 1.4;
    var viol = (result.pipes || []).filter(function (p) { return Math.abs(p.v) > vMax; })
      .sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
    var planB = null;
    if (viol.length) {
      var pB = viol[0], sugB = suggestDN(pB.qLs, pB.D);
      planB = tryPipePlan(target, worst, pB.id, sugB, pB.D);
      if (planB) { planB.name = '主管扩径'; plans.push(planB); }
    }

    /* —— 方案 C · 局部扩径：水头损失最大的管段（方案 B 已覆盖同一条则省略） —— */
    if ((result.pipes || []).length) {
      var pC = result.pipes.slice().sort(function (a, b) { return Math.abs(b.h) - Math.abs(a.h); })[0];
      if (!(planB && planB.pipeId === pC.id)) {
        var sugC = suggestDN(pC.qLs, pC.D);
        var planC = tryPipePlan(target, worst, pC.id, sugC, pC.D);
        if (planC) plans.push(planC);
      }
    }

    /* 编号：按最终顺序 A / B / C */
    plans.forEach(function (pl, i) {
      pl.letter = ['A', 'B', 'C'][i] || String.fromCharCode(66 + i);
      pl.outcome = planOutcome(target, pl.sim);
    });
    return plans;
  }

  /** 单管扩径方案：{pid} DN{cur} → DN{sug} → 最不利点 ±Δ m。 */
  function tryPipePlan(target, worst, pipeId, sugD, curD) {
    if (sugD <= curD) return null;
    try {
      var sim = simulate(target, function (p) {
        p.pipes.forEach(function (pp) { if (pp.id === pipeId) pp.D = sugD; });
      });
      var w2 = worstPoint(target, sim.result);
      var delta = w2.pressure - worst.pressure;
      return {
        name: '局部扩径',
        pipeId: pipeId,
        desc: pipeId + ' DN' + curD + ' → DN' + sugD + ' → 最不利点 ' +
          (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' m',
        sim: sim.result, view: sim.view
      };
    } catch (e) { return null; }
  }

  /** 工程页「开始体检」面板：校验 → 求解 → 指标卡 + 管网图 + 节点详情卡。 */
  function buildCalcSection(target, persist) {
    var panel = document.createElement('section');
    panel.className = 'card calc-panel';

    var actions = document.createElement('div');
    actions.className = 'calc-actions';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = '开始体检';
    var hint = document.createElement('span');
    hint.className = 'u-muted u-small';
    hint.textContent = '先校验数据，再算各楼栋水压';
    actions.appendChild(btn);
    actions.appendChild(hint);
    panel.appendChild(actions);

    var issuesBox = document.createElement('div');
    issuesBox.className = 'calc-issues';
    issuesBox.style.display = 'none';
    panel.appendChild(issuesBox);

    var errorBox = document.createElement('div');
    errorBox.className = 'calc-error';
    errorBox.style.display = 'none';
    panel.appendChild(errorBox);

    var resultBox = document.createElement('div');
    resultBox.style.display = 'none';
    panel.appendChild(resultBox);

    /** 有问题 → 展示问题列表并返回 true（同时禁用计算）。 */
    function renderIssues() {
      var issues = collectIssues(target);
      if (!issues.length) return false;
      var RULE_CHAR = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
      var html = '<h3>发现 ' + issues.length + ' 个数据问题，修复后才能开始体检</h3>';
      issues.forEach(function (iss) {
        html += '<p class="calc-issue-line"><b>' + (RULE_CHAR[iss.rule - 1] || '·') + '</b> ' + esc(iss.text) + '</p>';
      });
      issuesBox.innerHTML = html;
      issuesBox.style.display = '';
      return true;
    }

    /* —— 体检报告渲染：原始结果 / 试算预览（预览不写 store，重进页面自然回到原始结果） —— */
    var original = null;   // 原始体检结果
    var plans = [];        // 原始结果对应的改造方案（每条自带试算结果）
    var shownPlan = null;  // 正在预览的方案（null = 原始结果）

    function renderAll(r) {
      resultBox.style.display = '';
      resultBox.innerHTML = '';

      var scope = verdictScope(target, r);
      var rows = scope.rows;
      var verdict = buildVerdict(target, r);
      var diags = buildDiagnoses(target, r);
      var view = shownPlan ? shownPlan.view : target; // 预览时图上显示改过的数据（如 DN150、新水头）

      /* 顶部预览横幅 */
      if (shownPlan) {
        var banner = document.createElement('div');
        banner.className = 'preview-banner';
        banner.innerHTML = '<span class="preview-text">正在预览方案 ' + shownPlan.letter + '「' + esc(shownPlan.name) + '」（未保存）</span>';
        var backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'btn btn-ghost';
        backBtn.textContent = '恢复原状';
        backBtn.addEventListener('click', function () {
          shownPlan = null;
          renderAll(original);
        });
        banner.appendChild(backBtn);
        resultBox.appendChild(banner);
      }

      /* ① 体检结论卡（管网图上方）：大字结论 + 诊断 + 改造方案 */
      var card = document.createElement('div');
      card.className = 'verdict-card verdict-' + verdict.tone;
      var html = '<div class="verdict-head"><div class="verdict-big">' + esc(verdict.big) + '</div>' +
        infoDot('达标 = 能供到的层数 ≥ 实际层数。层数按服务水头表查：1 层 10 m、2 层 12 m、3 层 16 m、4 层 20 m、5 层 24 m、6 层 28 m。') +
        '</div>';
      if (diags.length) {
        html += '<ul class="verdict-diags">' + diags.map(function (d) {
          return '<li><b>' + esc(d.title) + '</b><span>' + esc(d.text) + '</span></li>';
        }).join('') + '</ul>';
      }
      if (plans.length) {
        html += '<div class="verdict-plans">' + plans.map(function (pl) {
          return '<div class="plan-row" data-letter="' + pl.letter + '">' +
            '<div class="plan-main">' +
            '<span class="plan-tag">方案 ' + pl.letter + ' · ' + esc(pl.name) + '</span>' +
            '<span class="plan-desc">' + esc(pl.desc) + '</span></div>' +
            '<div class="plan-side">' +
            '<span class="plan-meta">试算后最低水压 ' + pl.outcome.minPressure.toFixed(1) + ' m · ' +
            pl.outcome.ok + '/' + pl.outcome.total + ' ' + pl.outcome.unit + '达标</span>' +
            '<span class="pill ' + (pl.outcome.okBadge ? 'pill-ok' : 'pill-warn') + '">' + esc(pl.outcome.badgeText) + '</span>' +
            '<button type="button" class="btn btn-ghost plan-try">试算</button>' +
            '</div></div>';
        }).join('') + '</div>';
      } else if (verdict.tone === 'ok') {
        html += '<p class="u-muted u-small">全部达标：保持现状即可，无需改造。</p>';
      }
      html += '<p class="verdict-note">基于恒定流平差计算，改造方案仅供参考，实施请由有资质单位复核。</p>';
      card.innerHTML = html;

      /* 结论卡 + 右侧楼层剖面图（没有楼栋节点的工程不画） */
      var verdictRow = document.createElement('div');
      verdictRow.className = 'verdict-row';
      verdictRow.appendChild(card);
      var floorFig = buildFloorDiagram(target, r);
      if (floorFig) verdictRow.appendChild(floorFig);
      resultBox.appendChild(verdictRow);

      if (floorFig && floorFig.fdApi) {
        var F = floorFig.fdApi.floors;
        var pumpPlan = null, pipePlan = null;
        plans.forEach(function (p) {
          if (!pumpPlan && p.name.indexOf('加压') >= 0) pumpPlan = p;
          if (!pipePlan && p.name.indexOf('扩径') >= 0) pipePlan = p;
        });
        var acts = document.createElement('div');
        acts.className = 'fd-actions';
        var actBtns = [];
        var runPlan = function (kind, plan) {
          actBtns.forEach(function (b) { b.disabled = true; });
          floorFig.fdApi.plan(kind, plan, function () {
            actBtns.forEach(function (b) { b.disabled = false; });
          });
        };
        var mkBtn = function (label, kind, plan) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'fd-act';
          b.textContent = label;
          b.addEventListener('click', function () { runPlan(kind, plan); });
          acts.appendChild(b);
          actBtns.push(b);
        };
        if (pumpPlan) mkBtn('加一台增压泵', 'pump', pumpPlan);
        if (pipePlan) mkBtn('把主管换成更大的管', 'pipe', pipePlan);
        if (pumpPlan && F >= 4) mkBtn((F - 1) + '–' + F + ' 层单独二次加压', 'local', pumpPlan);
        if (actBtns.length) card.appendChild(acts);
        setTimeout(function () { floorFig.fdApi.play(); }, 30);
      }

      Array.prototype.forEach.call(card.querySelectorAll('.plan-try'), function (b) {
        b.addEventListener('click', function () {
          var rowEl = b.closest('.plan-row');
          var letter = rowEl ? rowEl.getAttribute('data-letter') : '';
          var pl = plans.filter(function (x) { return x.letter === letter; })[0];
          if (!pl) return;
          shownPlan = pl;
          renderAll(pl.sim);
        });
      });

      /* ② 管网图 + 点位详情 */
      var layout = document.createElement('div');
      layout.className = 'map-layout';
      var mapHost = document.createElement('div');
      layout.appendChild(mapHost);
      var detail = document.createElement('div');
      detail.className = 'map-detail';
      detail.innerHTML = '<h4>点位详情</h4><p class="u-muted u-small">点管网图里的楼栋或管线点，这里显示它的水压情况；点下面的表格行也行。</p>';
      layout.appendChild(detail);
      resultBox.appendChild(layout);

      /* ③ 楼栋表 / 节点水压表（结论卡下方，行与管网图互高亮） */
      var tableWrap = document.createElement('div');
      tableWrap.className = 'report-table-wrap';
      var tableHtml;
      if (rows.length) {
        tableHtml = '<h4>' + (scope.isBuilding ? '楼栋水压表' : '用水点水压表') + '</h4><table class="report-table"><thead><tr>' +
          '<th>' + (scope.isBuilding ? '楼栋' : '用水点') + '</th><th>层数</th>' +
          '<th>当前能供到' + infoDot('拿这栋楼的自由水压去查服务水头表，能到第几层就写第几层；比如 13.9 m 只够 2 层。') + '</th>' +
          '<th>自由水压' + infoDot('自由水压 = 水头 − 地面标高；6 层需要 28 m 才够。') + '</th><th>状态</th></tr></thead><tbody>';
        rows.forEach(function (row) {
          var pill = row.status === 'ok' ? ['pill-ok', '达标'] :
            (row.status === 'warn' ? ['pill-warn', '差1层'] : ['pill-bad', '差2层以上']);
          tableHtml += '<tr data-id="' + esc(row.id) + '"><td>' + esc(row.id) + '</td>' +
            '<td>' + row.floors + ' 层</td>' +
            '<td class="cell-served">' + servedText(row.served) + '</td>' +
            '<td>' + row.pressure.toFixed(2) + ' m</td>' +
            '<td><span class="pill ' + pill[0] + '">' + pill[1] + '</span></td></tr>';
        });
        tableHtml += '</tbody></table>';
      } else {
        tableHtml = '<h4>节点水压表</h4><table class="report-table"><thead><tr>' +
          '<th>节点</th><th>地面标高</th><th>自由水压</th><th>相当于可供 N 层</th></tr></thead><tbody>';
        (r.nodes || []).forEach(function (rn) {
          if (rn.fixed) return;
          var served = WC.ui.networkMap.servedFloors(rn.pressure, target.settings);
          var pill = served >= 6 ? 'pill-ok' : (served >= 1 ? 'pill-warn' : 'pill-bad');
          tableHtml += '<tr data-id="' + esc(rn.id) + '"><td>' + esc(rn.id) + '</td>' +
            '<td>' + (rn.elev || 0) + ' m</td>' +
            '<td>' + rn.pressure.toFixed(2) + ' m</td>' +
            '<td class="cell-served"><span class="pill ' + pill + '">' + servedText(served) + '</span></td></tr>';
        });
        tableHtml += '</tbody></table>';
      }
      tableWrap.innerHTML = tableHtml;
      resultBox.appendChild(tableWrap);

      /* ④ 技术指标（次一级信息） */
      var metrics = document.createElement('div');
      metrics.className = 'calc-metrics';
      metrics.innerHTML =
        metricCard('迭代次数', r.iterations + ' 次') +
        metricCard('最大环闭合差', fmtExp(r.maxLoopResidual) + ' m', '每轮修正后各环剩下的压力差；越接近 0，说明流量分得越准。') +
        metricCard('最大连续性残差', fmtExp(r.maxContinuity) + ' L/s', '每个节点进出水量的差；接近 0 说明没有凭空多水或少水。') +
        metricCard('总需水量', r.totalDemand.toFixed(2) + ' L/s', '所有楼栋和用水点的流量加起来，也就是水源要供的量。');
      resultBox.appendChild(metrics);

      /* 点位详情 + 表↔图互高亮 */
      function showDetail(nid) {
        var rn = null, src = null;
        r.nodes.forEach(function (x) { if (x.id === nid) rn = x; });
        (view.nodes || []).forEach(function (x) { if (x.id === nid) src = x; });
        if (!rn || !src) return;
        var kindLabel = src.kind === 'building' ? '楼栋' : (src.kind === 'source' ? '市政入口' : '连接点');
        var html2 = '<h4>' + esc(nid) + ' · ' + kindLabel + '</h4>';
        html2 += '<p><span class="k">地面标高</span> ' + src.elev + ' m</p>';
        if (src.kind === 'source') {
          html2 += '<p><span class="k">定压水头</span> ' + src.head + ' m</p>';
        } else {
          html2 += '<p><span class="k">自由水压</span> ' + rn.pressure.toFixed(2) + ' m</p>';
        }
        if (src.demand > 0) html2 += '<p><span class="k">需水量</span> ' + src.demand + ' L/s</p>';
        if (src.kind === 'building') {
          var floors = (src.building && src.building.floors) || 0;
          var served = WC.ui.networkMap.servedFloors(rn.pressure, target.settings);
          html2 += '<p><span class="k">能上几层</span> <b>' + served + '</b> / ' + floors + ' 层</p>';
        }
        detail.innerHTML = html2;
      }
      function highlightPoint(nid) {
        var tableEl = tableWrap.querySelector('.report-table');
        Array.prototype.forEach.call(tableEl.querySelectorAll('tr.is-hl'), function (tr) { tr.classList.remove('is-hl'); });
        Array.prototype.forEach.call(mapHost.querySelectorAll('.nw-node.is-hl'), function (g) { g.classList.remove('is-hl'); });
        var tr = tableEl.querySelector('tr[data-id="' + nid + '"]');
        if (tr) tr.classList.add('is-hl');
        var g = mapHost.querySelector('.nw-node[data-id="' + nid + '"]');
        if (g) g.classList.add('is-hl');
      }
      function selectPoint(nid) { showDetail(nid); highlightPoint(nid); }

      WC.ui.networkMap.onSelectNode = selectPoint;
      Array.prototype.forEach.call(tableWrap.querySelectorAll('tr[data-id]'), function (tr) {
        tr.addEventListener('click', function () { selectPoint(tr.getAttribute('data-id')); });
      });
      WC.ui.networkMap.render(mapHost, view, r);
    }

    /** 计算失败：红条写清原因，并给一个「回到数据」的出口。 */
    function showCalcError(msg) {
      errorBox.innerHTML = '<span class="calc-error-msg">' + esc('计算失败：' + msg) + '</span>';
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn btn-ghost btn-sm';
      back.textContent = '回到数据';
      back.addEventListener('click', function () {
        var isSample = !!samples.byId(target.id);
        navigate(isSample ? '#/project/' : '#/edit/' + encodeURIComponent(target.id));
      });
      errorBox.appendChild(back);
      errorBox.style.display = '';
    }

    /** 正式体检：算原始结果 + 生成改造方案，渲染报告（试算只在副本上做，永不写 store）。 */
    function showOriginal(r) {
      original = r;
      shownPlan = null;
      try { plans = buildPlans(target, r); } catch (e) { plans = []; }
      renderAll(r);
    }

    function runCalc() {
      // 已经算过且数据没变：直接复用，连点不会重复求解
      if (original) {
        issuesBox.style.display = 'none';
        errorBox.style.display = 'none';
        showOriginal(original);
        return;
      }
      try {
        var r = WC.solver.solve(target);
        WC.calcRunCount = (WC.calcRunCount || 0) + 1;
        resultCache[target.id] = { result: r, ts: Date.now() };
        if (persist) {
          target.calcAt = Date.now();
          try { store.save(target); } catch (e2) { /* 存储失败已有横幅提示 */ }
        }
        issuesBox.style.display = 'none';
        errorBox.style.display = 'none';
        showOriginal(r);
      } catch (e) {
        showCalcError(e && e.message ? e.message : '未知错误');
      }
    }

    btn.addEventListener('click', function () {
      if (renderIssues()) {
        btn.disabled = true; // 有问题：禁用计算
        btn.classList.add('is-disabled');
        hint.textContent = '去「录入管网」修复上面的问题，回来重新体检';
        return;
      }
      runCalc();
    });

    var cached = resultCache[target.id];
    if (cached) showOriginal(cached.result);

    // 从首页样例卡进来：自动体检一次，并滚到结论卡
    if (pendingAutoCheck === target.id) {
      pendingAutoCheck = null;
      setTimeout(function () {
        if (!original) runCalc();
        var vc = document.querySelector('.verdict-card');
        if (vc) vc.scrollIntoView({ block: 'center' });
      }, 60);
    }

    return panel;
  }

  function renderProjectPage(id, kind) {
    var meta = PAGE_META[kind];
    var project = id ? store.get(id) : null;
    var sample = project ? null : (id ? samples.byId(id) : null);

    var page = document.createElement('div');
    page.className = 'page';

    if (project) {
      setTitle(project.name + ' · ' + meta.docTitle);
      page.appendChild(buildTopbar({
        name: project.name, onRename: renameProjectFlow(project.id),
        onProToggle: function () { render(); } // 开关专业模式 → 显示/隐藏两个入口
      }));

      var shell = document.createElement('section');
      shell.className = 'card placeholder-hero';
      var nodes = Array.isArray(project.nodes) ? project.nodes.length : 0;
      var pipes = Array.isArray(project.pipes) ? project.pipes.length : 0;
      shell.innerHTML =
        '<span class="tag">工程概览</span>' +
        '<h2>' + esc(meta.title) + '</h2>' +
        '<p class="u-muted">' + esc(meta.planned) + '</p>' +
        '<p class="project-meta">当前：节点 ' + nodes + ' 个 · 管段 ' + pipes + ' 条 · 更新于 ' + fmtDate(project.updatedAt) + '</p>';
      page.appendChild(shell);

      if (kind === 'project') {
        var acts = document.createElement('div');
        acts.className = 'overview-actions';
        acts.innerHTML = '<a class="btn btn-ghost" href="#/edit/' + encodeURIComponent(project.id) + '">录入管网 →</a>';
        page.appendChild(acts);
        if (proMode.on) {
          var proActs = document.createElement('div');
          proActs.className = 'overview-actions pro-entry';
          proActs.innerHTML =
            '<a class="btn btn-ghost" href="#/result/' + encodeURIComponent(project.id) + '">查看平差结果 →</a>' +
            '<a class="btn btn-ghost" href="#/report/' + encodeURIComponent(project.id) + '">打印计算书 →</a>';
          page.appendChild(proActs);
        }
        page.appendChild(buildCalcSection(project, true)); // 开始体检（校验 → 平差 → 图）
      }
    } else if (sample) {
      setTitle(sample.title + ' · 示例');
      page.appendChild(buildTopbar({
        name: sample.title, onRename: null,
        onProToggle: function () { render(); } // 示例也能进专业模式（只读）
      }));
      var s = document.createElement('section');
      s.className = 'card placeholder-hero';
      s.innerHTML =
        '<span class="tag tag-water">示例 · 只读</span>' +
        '<h2>' + esc(sample.title) + '</h2>' +
        '<p class="u-muted">' + esc(sample.intro) + '</p>' +
        '<p class="u-muted">示例是只读模板：点下方按钮复制一份属于你的工程，随便改、随便算，原示例不受影响。</p>';
      page.appendChild(s);

      var copyActs = document.createElement('div');
      copyActs.className = 'overview-actions';
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-primary';
      copyBtn.textContent = '复制为我的工程';
      copyBtn.addEventListener('click', function () {
        // 示例永不被修改：在 store 里生成可编辑副本，然后跳到副本的编辑页
        var copy = store.create(sample.title + '（我的副本）');
        ['water', 'nodes', 'pipes', 'settings'].forEach(function (k) {
          if (sample[k] !== undefined) copy[k] = JSON.parse(JSON.stringify(sample[k]));
        });
        store.save(copy);
        navigate('#/edit/' + encodeURIComponent(copy.id));
      });
      copyActs.appendChild(copyBtn);
      page.appendChild(copyActs);
      if (proMode.on) {
        var proActs2 = document.createElement('div');
        proActs2.className = 'overview-actions pro-entry';
        proActs2.innerHTML =
          '<a class="btn btn-ghost" href="#/result/' + encodeURIComponent(sample.id) + '">查看平差结果 →</a>' +
          '<a class="btn btn-ghost" href="#/report/' + encodeURIComponent(sample.id) + '">打印计算书 →</a>';
        page.appendChild(proActs2);
      }

      // 示例只读体检：直接对示例数据计算（不落 store，原示例永不被修改）
      var sTarget = {
        id: sample.id, name: sample.title,
        water: sample.water, nodes: sample.nodes,
        pipes: sample.pipes, settings: sample.settings
      };
      page.appendChild(buildCalcSection(sTarget, false));
    } else {
      setTitle('工程不存在');
      page.appendChild(buildTopbar({ name: '水压体检', onRename: null }));
      var nf = document.createElement('section');
      nf.className = 'card placeholder-hero';
      nf.innerHTML =
        '<h2>没有找到这个工程</h2>' +
        '<p class="u-muted">它可能已被删除。可回首页「新建体检」或「导入 JSON」恢复备份。</p>' +
        '<div class="notfound-actions"><a class="btn btn-primary" href="#/home">← 回首页</a></div>';
      page.appendChild(nf);
    }

    root.appendChild(page);
  }

  /* ==================== 专业模式：计算结果页（#/result/:id）与计算书（#/report/:id） ==================== */

  /** 结果页/计算书共用：取工程或示例为计算对象（示例只读，不写 store）。 */
  function resolveTarget(id) {
    if (!id) return null;
    var project = store.get(id);
    if (project) return { target: project, name: project.name };
    var sample = samples.byId(id);
    if (!sample) return null;
    return {
      target: {
        id: sample.id, name: sample.title,
        water: sample.water, nodes: sample.nodes,
        pipes: sample.pipes, settings: sample.settings
      },
      name: sample.title
    };
  }

  /** 有缓存用缓存，否则现算（只进内存缓存，不写 store）。 */
  function getSolvedResult(target) {
    var cached = resultCache[target.id];
    if (cached) return cached.result;
    var r = WC.solver.solve(target);
    resultCache[target.id] = { result: r, ts: Date.now() };
    return r;
  }

  /** 科学计数：3 位有效数字（如 1.23e-17）。 */
  function fmtSci(v) {
    if (v === 0) return '0';
    return v.toExponential(2);
  }

  /* —— CSV 导出：UTF-8 BOM + 逗号分隔，Excel 打开中文不乱码 —— */
  function csvCell(v) {
    v = String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function downloadCSV(filename, rows) {
    var csv = '\uFEFF' + rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /** 管段流速状态：经济 / 偏慢 / 偏快。 */
  function pipeState(v, vMin, vMax) {
    var a = Math.abs(v);
    if (a > vMax) return '偏快';
    if (a < vMin) return '偏慢';
    return '经济';
  }

  /** 通用表格壳：标题 + 表头 + 表体（结果页与计算书共用，跨页时 thead 自动重复）。 */
  function tableShell(title, headerCells, bodyHtml, cls) {
    return '<div class="report-table-wrap' + (cls ? ' ' + cls : '') + '">' +
      (title ? '<h4>' + esc(title) + '</h4>' : '') +
      '<table class="report-table"><thead><tr>' +
      headerCells.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + bodyHtml + '</tbody></table></div>';
  }

  /** 管段结果行（HTML）：流量为负标「反向」，|v|>vMax 整行标橙。 */
  function pipeResultRows(target, r, withGeom) {
    var st = target.settings || {};
    var vMin = st.vMin || 0.6, vMax = st.vMax || 1.4;
    var b = '';
    (r.pipes || []).forEach(function (p) {
      var state = pipeState(p.v, vMin, vMax);
      var pillCls = state === '经济' ? 'pill-ok' : (state === '偏快' ? 'pill-warn' : 'pill-slow');
      var over = Math.abs(p.v) > vMax ? ' class="row-over"' : '';
      b += '<tr' + over + '><td>' + esc(p.id) + '</td><td>' + esc(p.from) + '</td><td>' + esc(p.to) + '</td>';
      if (withGeom) b += '<td class="cell-num">' + p.L + '</td><td class="cell-num">' + p.D + '</td><td class="cell-num">' + p.C + '</td>';
      b += '<td class="cell-num">' + p.qLs.toFixed(3) + (p.q < 0 ? ' <span class="rev-tag">反向</span>' : '') + '</td>' +
        '<td class="cell-num">' + Math.abs(p.v).toFixed(3) + '</td>' +
        '<td class="cell-num">' + p.h.toFixed(4) + '</td>' +
        '<td class="cell-num">' + p.i1000.toFixed(3) + '</td>' +
        '<td><span class="pill ' + pillCls + '">' + state + '</span></td></tr>';
    });
    return b;
  }

  /** 节点结果行（HTML）。 */
  function nodeResultRows(target, r) {
    var b = '';
    (r.nodes || []).forEach(function (rn) {
      var served = rn.fixed ? '—' : servedText(WC.ui.networkMap.servedFloors(rn.pressure, target.settings));
      b += '<tr><td>' + esc(rn.id) + '</td><td class="cell-num">' + rn.demand.toFixed(2) + '</td>' +
        '<td class="cell-num">' + rn.elev + '</td>' +
        '<td class="cell-num">' + rn.head.toFixed(3) + '</td>' +
        '<td class="cell-num">' + rn.pressure.toFixed(2) + '</td>' +
        '<td>' + served + '</td></tr>';
    });
    return b;
  }

  /** 收敛曲线 SVG：x = 迭代次数，y = max|ΔQ| 对数轴，收敛点标注「第 N 次收敛」。 */
  function convergenceSvg(history) {
    if (!history || !history.length) {
      return '<div class="conv-empty u-muted">枝状管网没有环，流量一遍就能定下来，无需迭代。</div>';
    }
    var W = 640, H = 240, pl = 62, pr = 24, pt = 26, pb = 42;
    var logs = history.map(function (h) { return Math.log10(Math.max(h.maxDQ, 1e-18)); });
    var maxIter = history[history.length - 1].iter;
    var lo = Math.floor(Math.min.apply(null, logs));
    var hi = Math.ceil(Math.max.apply(null, logs));
    if (hi <= lo) hi = lo + 1;
    function X(it) { return pl + (maxIter === 1 ? 0.5 : (it - 1) / (maxIter - 1)) * (W - pl - pr); }
    function Y(l) { return pt + (hi - l) / (hi - lo) * (H - pt - pb); }
    var s = '';
    for (var d = hi; d >= lo; d--) {
      var gy = Y(d).toFixed(1);
      s += '<line x1="' + pl + '" y1="' + gy + '" x2="' + (W - pr) + '" y2="' + gy + '" class="conv-grid"/>';
      s += '<text x="' + (pl - 8) + '" y="' + (Y(d) + 3.5).toFixed(1) + '" text-anchor="end" class="conv-tick">1e' + d + '</text>';
    }
    for (var it2 = 1; it2 <= maxIter; it2++) {
      s += '<text x="' + X(it2).toFixed(1) + '" y="' + (H - pb + 16) + '" text-anchor="middle" class="conv-tick">' + it2 + '</text>';
    }
    s += '<text x="' + ((pl + W - pr) / 2).toFixed(0) + '" y="' + (H - 6) + '" text-anchor="middle" class="conv-axis">迭代次数</text>';
    s += '<text x="14" y="' + (pt - 8) + '" class="conv-axis">max|ΔQ| m³/s（对数轴）</text>';
    var pts = history.map(function (h, i) { return X(h.iter).toFixed(1) + ',' + Y(logs[i]).toFixed(1); });
    s += '<polyline points="' + pts.join(' ') + '" class="conv-line"/>';
    history.forEach(function (h, i) {
      s += '<circle cx="' + X(h.iter).toFixed(1) + '" cy="' + Y(logs[i]).toFixed(1) + '" r="3.5" class="conv-dot' +
        (i === history.length - 1 ? ' conv-dot-end' : '') + '"/>';
    });
    var last = history[history.length - 1];
    var lx = Math.max(pl, Math.min(X(last.iter), W - pr - 100));
    s += '<text x="' + lx.toFixed(1) + '" y="' + (Y(logs[logs.length - 1]) - 10).toFixed(1) + '" class="conv-mark">第 ' + last.iter + ' 次收敛</text>';
    return '<svg class="conv-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="收敛曲线">' + s + '</svg>';
  }

  /** #/result/:id 计算结果页（专业模式完整平差数据）。 */
  function renderResultPage(id) {
    var res = resolveTarget(id);
    var page = document.createElement('div');
    page.className = 'page';
    if (!res) {
      setTitle('计算结果');
      page.appendChild(buildTopbar({ name: '水压体检', onRename: null }));
      page.appendChild(notFoundSection());
      root.appendChild(page);
      return;
    }
    var target = res.target;
    var encId = encodeURIComponent(target.id);
    setTitle(res.name + ' · 平差结果');
    page.appendChild(buildTopbar({
      name: res.name, onRename: null,
      backHash: '#/project/' + encId, backLabel: '← 返回工程'
    }));

    var r;
    try { r = getSolvedResult(target); }
    catch (e) {
      var eb = document.createElement('section');
      eb.className = 'card calc-error';
      eb.innerHTML = '<span class="calc-error-msg">' + esc('计算失败：' + (e && e.message ? e.message : '未知错误')) + '</span>';
      var ebBack = document.createElement('button');
      ebBack.type = 'button';
      ebBack.className = 'btn btn-ghost btn-sm';
      ebBack.textContent = '回到数据';
      ebBack.addEventListener('click', function () {
        navigate(samples.byId(target.id) ? '#/project/' : '#/edit/' + encodeURIComponent(target.id));
      });
      eb.appendChild(ebBack);
      page.appendChild(eb);
      root.appendChild(page);
      return;
    }

    /* —— 1. 指标卡（含进水流量校核） —— */
    var supplied = 0;
    (r.continuity || []).forEach(function (c) { if (typeof c.supplied === 'number') supplied += c.supplied; });
    var balance = Math.abs(supplied - r.totalDemand);
    var metrics = document.createElement('div');
    metrics.className = 'calc-metrics';
    metrics.innerHTML =
      metricCard('迭代次数', r.iterations + ' 次') +
      metricCard('最大环闭合差', fmtSci(r.maxLoopResidual) + ' m') +
      metricCard('最大节点连续性残差', fmtSci(r.maxContinuity) + ' L/s') +
      metricCard('总需水量', r.totalDemand.toFixed(2) + ' L/s') +
      metricCard('进水流量校核', balance < 0.001 ? '守恒 ✓' : '差 ' + balance.toFixed(3) + ' L/s');
    page.appendChild(metrics);

    /* —— 2. 管段结果表 —— */
    page.insertAdjacentHTML('beforeend',
      tableShell('管段平差结果',
        ['管段', '起点', '终点', '管长 m', '管径 mm', 'C', '流量 L/s', '流速 m/s', '水头损失 m', '1000i', '状态'],
        pipeResultRows(target, r, true)));

    /* —— 3. 节点结果表 —— */
    page.insertAdjacentHTML('beforeend',
      tableShell('节点水头结果',
        ['节点', '需水量 L/s', '地面标高 m', '水头 m', '自由水压 m', '相当于可供 N 层'],
        nodeResultRows(target, r)));

    /* —— 4. 环闭合差明细 —— */
    var cyBody = '';
    if (!(r.cycles || []).length) {
      cyBody = '<tr><td colspan="3" class="u-muted">枝状管网：0 个环，无闭合差需要校核。</td></tr>';
    } else {
      (r.cycles || []).forEach(function (c, i) {
        cyBody += '<tr><td>' + (i + 1) + '</td><td>' + esc(c.pipes.join(' → ')) + '</td>' +
          '<td class="cell-num">' + fmtSci(c.residual) + '</td></tr>';
      });
    }
    page.insertAdjacentHTML('beforeend',
      tableShell('环闭合差明细', ['环号', '组成管段（按环序）', '闭合差 m'], cyBody));

    /* —— 5. 收敛曲线 —— */
    var conv = document.createElement('section');
    conv.className = 'card conv-card';
    conv.innerHTML = '<h4>收敛曲线（每轮修正流量的最大变化量逐轮下降）</h4>' + convergenceSvg(r.history);
    page.appendChild(conv);

    /* —— 6. 导出按钮 —— */
    var exp = document.createElement('div');
    exp.className = 'result-exports';
    var btnPipes = document.createElement('button');
    btnPipes.type = 'button';
    btnPipes.className = 'btn btn-ghost';
    btnPipes.textContent = '导出管段 CSV';
    var btnNodes = document.createElement('button');
    btnNodes.type = 'button';
    btnNodes.className = 'btn btn-ghost';
    btnNodes.textContent = '导出节点 CSV';
    var btnCycles = document.createElement('button');
    btnCycles.type = 'button';
    btnCycles.className = 'btn btn-ghost';
    btnCycles.textContent = '导出环 CSV';
    exp.appendChild(btnPipes);
    exp.appendChild(btnNodes);
    exp.appendChild(btnCycles);
    page.appendChild(exp);

    var st = target.settings || {};
    var vMin = st.vMin || 0.6, vMax = st.vMax || 1.4;
    btnPipes.addEventListener('click', function () {
      var rows = [['管段', '起点', '终点', '管长(m)', '管径(mm)', 'C', '流量(L/s)', '流速(m/s)', '水头损失(m)', '1000i', '状态']];
      (r.pipes || []).forEach(function (p) {
        var state = pipeState(p.v, vMin, vMax);
        rows.push([p.id, p.from, p.to, p.L, p.D, p.C,
          p.qLs.toFixed(3) + (p.q < 0 ? '（反向）' : ''),
          Math.abs(p.v).toFixed(3), p.h.toFixed(4), p.i1000.toFixed(3), state]);
      });
      downloadCSV(res.name + '-管段.csv', rows);
    });
    btnNodes.addEventListener('click', function () {
      var rows = [['节点', '需水量(L/s)', '地面标高(m)', '水头(m)', '自由水压(m)', '相当于可供层数']];
      (r.nodes || []).forEach(function (rn) {
        rows.push([rn.id, rn.demand.toFixed(2), rn.elev,
          rn.head.toFixed(3), rn.pressure.toFixed(2),
          rn.fixed ? '' : Math.min(WC.ui.networkMap.servedFloors(rn.pressure, target.settings), 6)]);
      });
      downloadCSV(res.name + '-节点.csv', rows);
    });
    btnCycles.addEventListener('click', function () {
      var rows = [['环号', '组成管段', '闭合差(m)']];
      (r.cycles || []).forEach(function (c, i) {
        rows.push([i + 1, c.pipes.join(' → '), c.residual.toExponential(2)]);
      });
      downloadCSV(res.name + '-环.csv', rows);
    });

    /* —— 7. 页脚说明 —— */
    var foot = document.createElement('p');
    foot.className = 'u-muted u-small pro-foot';
    foot.textContent = '计算方法：沿程水头损失按海澄-威廉公式 h = 10.67·L·Q^1.852 / (C^1.852·D^4.87)，流量分配用哈代-克罗斯环校正逐环修正直至闭合。本页数据来自恒定流平差计算。';
    page.appendChild(foot);

    root.appendChild(page);
  }

  /** 「没有找到这个工程」卡片（结果页/计算书共用）。 */
  function notFoundSection() {
    var nf = document.createElement('section');
    nf.className = 'card placeholder-hero';
    nf.innerHTML =
      '<h2>没有找到这个工程</h2>' +
      '<p class="u-muted">它可能已被删除。可回首页「新建体检」或「导入 JSON」恢复备份。</p>' +
      '<div class="notfound-actions"><a class="btn btn-primary" href="#/home">← 回首页</a></div>';
    return nf;
  }

  /** #/report/:id 计算书（A4 打印页）。 */
  function renderReportPage(id) {
    var res = resolveTarget(id);
    var page = document.createElement('div');
    page.className = 'page report-page';
    if (!res) {
      setTitle('计算书');
      page.appendChild(buildTopbar({ name: '水压体检', onRename: null }));
      page.appendChild(notFoundSection());
      root.appendChild(page);
      return;
    }
    var target = res.target;
    var encId = encodeURIComponent(target.id);
    setTitle(res.name + ' · 计算书');
    page.appendChild(buildTopbar({
      name: res.name, onRename: null,
      backHash: '#/project/' + encId, backLabel: '← 返回工程'
    }));

    var r;
    try { r = getSolvedResult(target); }
    catch (e) {
      var eb = document.createElement('section');
      eb.className = 'card calc-error';
      eb.innerHTML = '<span class="calc-error-msg">' + esc('计算失败：' + (e && e.message ? e.message : '未知错误')) + '</span>';
      var ebBack = document.createElement('button');
      ebBack.type = 'button';
      ebBack.className = 'btn btn-ghost btn-sm';
      ebBack.textContent = '回到数据';
      ebBack.addEventListener('click', function () {
        navigate(samples.byId(target.id) ? '#/project/' : '#/edit/' + encodeURIComponent(target.id));
      });
      eb.appendChild(ebBack);
      page.appendChild(eb);
      root.appendChild(page);
      return;
    }

    /* —— 打印按钮（打印时隐藏） —— */
    var printBar = document.createElement('div');
    printBar.className = 'no-print print-bar';
    var printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'btn btn-primary';
    printBtn.textContent = '打印 / 另存为 PDF';
    printBtn.addEventListener('click', function () { window.print(); });
    printBar.appendChild(printBtn);
    page.appendChild(printBar);

    /* —— 动态页脚（第 X 页 / 共 Y 页 + 工具版本 + 生成时间） —— */
    var now = new Date();
    var dateStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    Array.prototype.forEach.call(document.querySelectorAll('style.wc-dyn-page'), function (s) { s.remove(); });
    var dynStyle = document.createElement('style');
    dynStyle.className = 'wc-dyn-page';
    dynStyle.textContent =
      '@page { @bottom-center { content: "水压体检 v1 · 生成于 ' + dateStr +
      ' · 第 " counter(page) " 页 / 共 " counter(pages) " 页"; font-size: 9pt; color: #555; } }';
    document.head.appendChild(dynStyle);

    var st = target.settings || {};
    var vMin = st.vMin || 0.6, vMax = st.vMax || 1.4;
    var sh = serviceHeadTable(target);
    var w = target.water || {};

    /* —— 一、工程概况（人数/定额可能是 NaN 或空，先兜底再算） —— */
    var popN = Number(w.population), quotaN = Number(w.quota), khN = Number(w.kh);
    if (!isFinite(popN)) popN = 0;
    if (!isFinite(quotaN)) quotaN = 0;
    if (!isFinite(khN)) khN = 0;
    var qd = (popN * quotaN) / 1000;
    var qh = qd * khN / 24;
    var html = '<article class="report-doc">' +
      '<h1>供水管网水力计算书</h1>' +
      '<p class="rp-sub">工程名称：' + esc(res.name) + ' · 计算日期：' + dateStr + '</p>' +
      '<section class="rp-sec"><h2>一、工程概况</h2>' +
      '<p>用水人口 ' + popN + ' 人；综合生活用水定额 q = ' + quotaN +
      ' L/(人·d)；时变化系数 Kh = ' + khN + '。</p>' +
      '<p>最高日用水量 Qd = q×N/1000 = ' + qd.toFixed(2) + ' m³/d；最高时用水量 Qh = Qd×Kh/24 = ' +
      qh.toFixed(2) + ' m³/h；折算流量 Qh/3.6 = ' + (qh / 3.6).toFixed(2) + ' L/s；' +
      '平差总需水量 ' + r.totalDemand.toFixed(2) + ' L/s。</p></section>';

    /* —— 二、设计参数与公式 —— */
    html += '<section class="rp-sec"><h2>二、设计参数与公式</h2>' +
      '<p>沿程水头损失采用海澄-威廉公式：h = 10.67·L·Q<sup>1.852</sup> / (C<sup>1.852</sup>·D<sup>4.87</sup>)，' +
      '其中 h 为沿程水头损失（m），L 为管长（m），Q 为流量（m³/s），C 为海澄-威廉系数，D 为管径（m）。</p>' +
      '<p>环校正（哈代-克罗斯法）：ΔQ = −Σh / (1.852·Σ|h/Q|)，每环按上式独立修正流量，逐轮迭代至 |ΔQ| < 10<sup>−7</sup>。</p>' +
      '<p>流速经济区间 ' + vMin + '～' + vMax + ' m/s。服务水头表（最小服务水头）：' +
      '1 层 ' + sh[1] + ' m、2 层 ' + sh[2] + ' m、3 层 ' + sh[3] + ' m、4 层 ' + sh[4] +
      ' m、5 层 ' + sh[5] + ' m、6 层 ' + sh[6] + ' m。</p></section>';

    /* —— 三、节点表 —— */
    var nb3 = '';
    (target.nodes || []).forEach(function (n) {
      var kind = n.kind === 'source' ? '水源（定压 ' + n.head + ' m）' : (n.kind === 'building' ? '楼栋' : '接点');
      nb3 += '<tr><td>' + esc(n.id) + '</td><td>' + kind + '</td><td>' + n.demand + '</td><td>' + n.elev + '</td></tr>';
    });
    html += '<section class="rp-sec"><h2>三、节点表</h2>' +
      tableShell('', ['节点', '类型', '需水量 L/s', '地面标高 m'], nb3) + '</section>';

    /* —— 四、管段表 —— */
    var pb4 = '';
    (target.pipes || []).forEach(function (p) {
      pb4 += '<tr><td>' + esc(p.id) + '</td><td>' + esc(p.from) + '</td><td>' + esc(p.to) + '</td>' +
        '<td>' + p.L + '</td><td>' + p.D + '</td><td>' + p.C + '</td></tr>';
    });
    html += '<section class="rp-sec"><h2>四、管段表</h2>' +
      tableShell('', ['管段', '起点', '终点', '管长 m', '管径 mm', 'C'], pb4) + '</section>';

    /* —— 五、平差结果表 —— */
    html += '<section class="rp-sec"><h2>五、平差结果表</h2>' +
      tableShell('', ['管段', '起点', '终点', '流量 L/s', '流速 m/s', '水头损失 m', '1000i', '状态'],
        pipeResultRows(target, r, false)) + '</section>';

    /* —— 六、节点水头与自由水压表 —— */
    html += '<section class="rp-sec"><h2>六、节点水头与自由水压表</h2>' +
      tableShell('', ['节点', '需水量 L/s', '地面标高 m', '水头 m', '自由水压 m', '相当于可供 N 层'],
        nodeResultRows(target, r)) + '</section>';

    /* —— 七、校核结论 —— */
    var vOver = (r.pipes || []).filter(function (p) { return Math.abs(p.v) > vMax; });
    var flowLine = vOver.length
      ? '<span class="pill pill-bad">不满足</span> ' + vOver.map(function (p) {
          return esc(p.id) + '（' + Math.abs(p.v).toFixed(2) + ' m/s）';
        }).join('、') + ' 流速超过 ' + vMax + ' m/s'
      : '<span class="pill pill-ok">满足</span> 全部管段流速不超过 ' + vMax + ' m/s';
    var scopeB = verdictScope(target, r);
    var rowsB = scopeB.rows;
    var worst = worstPoint(target, r);
    var pressLine;
    if (rowsB.length) {
      pressLine = allPass(target, r)
        ? '<span class="pill pill-ok">满足</span> 全部 ' + rowsB.length + ' ' + scopeB.unit + '可服务层数达到实际层数，最不利点 ' + esc(worst.id) + ' 自由水压 ' + worst.pressure.toFixed(2) + ' m'
        : '<span class="pill pill-bad">不满足</span> 最不利点 ' + esc(worst.id) + ' 自由水压 ' + worst.pressure.toFixed(2) + ' m，按服务水头表只够 ' + servedText(worst.served) + '（差 ' + (rowsB.filter(function (x) { return x.status !== 'ok'; }).length) + ' ' + scopeB.unit + '）';
    } else {
      pressLine = allPass(target, r)
        ? '<span class="pill pill-ok">满足</span> 各点自由水压均不低于 6 层服务水头 ' + sh[6] + ' m'
        : '<span class="pill pill-bad">不满足</span> 有点自由水压低于 ' + sh[6] + ' m';
    }
    var convLine = (r.cycles || []).length === 0
      ? '<span class="pill pill-ok">满足</span> 枝状管网（0 环），流量一遍即定，无需闭合差校核'
      : (r.maxLoopResidual <= 1e-6
        ? '<span class="pill pill-ok">满足</span> 最大环闭合差 ' + fmtSci(r.maxLoopResidual) + ' m，' + r.iterations + ' 轮收敛'
        : '<span class="pill pill-bad">不满足</span> 最大环闭合差 ' + fmtSci(r.maxLoopResidual) + ' m');
    html += '<section class="rp-sec"><h2>七、校核结论</h2>' +
      '<p class="rp-check">流速校核：' + flowLine + '</p>' +
      '<p class="rp-check">水压校核：' + pressLine + '</p>' +
      '<p class="rp-check">闭合差校核：' + convLine + '</p></section>';

    /* —— 八、计算假定 —— */
    html += '<section class="rp-sec"><h2>八、计算假定</h2><ol class="rp-assume">' +
      '<li>按恒定流计算，即各节点用水量不随时间变化；</li>' +
      '<li>沿程水头损失按海澄-威廉公式计算，局部水头损失不单独计算，已折算并入沿程损失；</li>' +
      '<li>单一水源定压供水，水源水头恒定不变。</li>' +
      '</ol></section>';

    html += '</article>';
    var doc = document.createElement('div');
    doc.innerHTML = html;
    page.appendChild(doc.firstChild);
    root.appendChild(page);
  }

  /* ==================== 体检页：楼层剖面图（静态 SVG，不带动画） ==================== */

  /** 楼层剖面图：等轴测结构 + 水爬升动画。所有数值来自求解结果。
   *  opts.scrub = true 时改为「滚动驱动」：不自动播放，由外部调用 fdApi.scrub(p) 控制水位。 */
  function buildFloorDiagram(target, result, opts) {
    var scrub = !!(opts && opts.scrub);
    var bare = !!(opts && opts.bare); // 只要画布：不放「重播/恢复原状」与说明行
    var scope;
    try {
      scope = verdictScope(target, result);
    } catch (e) {
      console.warn('楼层剖面图计算失败：' + (e && e.message ? e.message : e));
      return null;
    }
    if (!scope.rows.length) return null; // 没有楼栋节点（如城镇管网）：不显示

    var worst = scope.rows.reduce(function (a, b) { return b.pressure < a.pressure ? b : a; });
    var floors = worst.floors || 0;
    if (!floors) return null;
    var served0 = Math.max(0, Math.min(WC.ui.networkMap.servedFloors(worst.pressure, target.settings), floors));

    var topY = 70, bottomY = 340, bandH = (bottomY - topY) / floors;
    var waterY0 = bottomY - served0 * bandH;
    var PX = 134, PW = 12;
    var uid = 'fdclip' + Math.floor(Math.random() * 100000);
    var s = '';

    /* 地面投影（向右下延伸，楼落地） */
    s += '<ellipse cx="178" cy="351" rx="122" ry="12" fill="#E5EBF3"/>';
    /* 楼体：侧面暗 */
    s += '<polygon points="220,70 254,48 254,318 220,340" fill="#CBD9E8"/>';
    /* 屋顶板（8px 厚，比正面更亮）+ 板下阴影线 */
    s += '<polygon points="60,62 94,40 254,40 220,62" fill="#F6FAFF"/>';
    s += '<polygon points="60,62 220,62 220,70 60,70" fill="#EAF1FA"/>';
    s += '<polygon points="220,62 254,40 254,48 220,70" fill="#DCE7F3"/>';
    s += '<line x1="60" y1="70" x2="220" y2="70" stroke="#B9C9DB" stroke-width="2"/>';
    /* 正面（剖切面，更亮） */
    s += '<polygon points="60,70 220,70 220,340 60,340" fill="#EDF3FA"/>';
    /* 剖切口的左右侧墙线 */
    s += '<line x1="60" y1="70" x2="60" y2="340" stroke="#9FB4CB" stroke-width="2"/>';
    s += '<line x1="220" y1="70" x2="220" y2="340" stroke="#9FB4CB" stroke-width="2"/>';

    for (var k = 1; k <= floors; k++) {
      var y1 = bottomY - k * bandH;
      s += '<rect class="fd-ok" data-k="' + k + '" x="62" y="' + (y1 + 0.5).toFixed(1) + '" width="156" height="' +
        Math.max(1, bandH - 1).toFixed(1) + '" fill="#0E9F6E" fill-opacity="0.13" opacity="0"/>';
      s += '<rect class="fd-dry" data-k="' + k + '" x="60" y="' + y1.toFixed(1) + '" width="160" height="' +
        bandH.toFixed(1) + '" fill="#94A3B8" fill-opacity="0.45" stroke="#94A3B8" stroke-dasharray="4 3" stroke-width="1" opacity="0"/>';
      if (k < floors) {
        s += '<line class="fd-fl" data-k="' + k + '" x1="60" y1="' + y1.toFixed(1) + '" x2="220" y2="' + y1.toFixed(1) +
          '" stroke="#F5F9FD" stroke-width="1"/>';
      }
    }

    var fs = floors <= 8 ? 10 : 9;
    for (var k2 = 1; k2 <= floors; k2++) {
      var show = floors <= 8 || k2 === 1 || k2 === floors || k2 % 3 === 0;
      if (!show) continue;
      var ty = bottomY - k2 * bandH + bandH / 2 + 3.2;
      s += '<text x="54" y="' + ty.toFixed(1) + '" text-anchor="end" font-size="' + fs +
        '" fill="#94A3B8">' + k2 + 'F</text>';
    }

    /* 立管（空管虚线）+ 进水管（先隐藏，动画淡入） */
    s += '<rect x="134" y="70" width="12" height="270" rx="6" fill="none" stroke="#94A3B8" stroke-dasharray="4 3" stroke-width="1.6"/>';
    s += '<path class="fd-inlet" d="M 300 366 H 140 V ' + bottomY + '" fill="none" stroke="#2E8FD0" stroke-width="12" ' +
      'stroke-linecap="round" stroke-linejoin="round" opacity="0"/>';

    /* 水柱（裁剪在管内）+ 高光 + 气泡 + 波浪 */
    s += '<defs><clipPath id="' + uid + '"><rect x="134" y="70" width="12" height="270" rx="6"/></clipPath></defs>';
    s += '<g clip-path="url(#' + uid + ')">';
    s += '<rect class="fd-water" x="134" y="340" width="12" height="0" fill="#2E8FD0"/>';
    s += '<line class="fd-shine" x1="137.5" y1="340" x2="137.5" y2="340" stroke="#67B8E8" stroke-width="2"/>';
    for (var b = 0; b < 5; b++) {
      s += '<circle class="fd-bubble" r="1.5" cx="' + (136.5 + b * 1.9).toFixed(1) + '" cy="340" fill="#fff" opacity="0"/>';
    }
    s += '</g>';
    s += '<path class="fd-wave" d="" fill="none" stroke="#9AD2F2" stroke-width="1.6" opacity="0"/>';

    /* 水位线 + 标签 + 右上提示（后段淡入） */
    s += '<line class="fd-line" x1="126" y1="340" x2="154" y2="340" stroke="#0E9F6E" stroke-width="2" stroke-linecap="round" opacity="0"/>';
    s += '<g class="fd-chip" opacity="0"><rect class="fd-chip-bg" x="152" y="318" width="90" height="16" rx="3" fill="#E7F6EF" stroke="#BCE5D2"/>' +
      '<text class="fd-chip-text" x="159" y="329.5" font-size="10" font-weight="700" fill="#0E9F6E"></text></g>';
    s += '<text class="fd-note" x="316" y="38" text-anchor="end" font-size="10" font-weight="600" fill="#DC2626" opacity="0"></text>';

    var wrap = document.createElement('div');
    wrap.className = 'floor-card' + (scrub ? ' is-scrub' : '') + (bare ? ' is-bare' : '');
    wrap.innerHTML =
      '<svg class="floor-svg" viewBox="0 0 320 400" role="img" aria-label="楼层水压剖面图：' + esc(worst.id) +
      ' 共 ' + floors + ' 层，能供到 ' + served0 + ' 层">' + s + '</svg>' +
      (scrub || bare ? '' : '<div class="fd-bar"><button type="button" class="fd-btn fd-replay">重播</button>' +
        '<button type="button" class="fd-btn fd-restore" hidden>恢复原状</button></div>' +
        '<p class="fd-caption"></p>');

    var svg = wrap.querySelector('svg');
    function q(sel) { return svg.querySelector(sel); }
    function qa(sel) { return Array.prototype.slice.call(svg.querySelectorAll(sel)); }
    var elWater = q('.fd-water'), elShine = q('.fd-shine'), elWave = q('.fd-wave'), elLine = q('.fd-line');
    var elChip = q('.fd-chip'), elChipBg = q('.fd-chip-bg'), elChipText = q('.fd-chip-text');
    var elNote = q('.fd-note'), elInlet = q('.fd-inlet');
    var dryEls = qa('.fd-dry'), okEls = qa('.fd-ok'), flEls = qa('.fd-fl'), bubbles = qa('.fd-bubble');
    var elCaption = wrap.querySelector('.fd-caption');
    var btnRestore = wrap.querySelector('.fd-restore');

    var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var raf = null, curRunning = false, curStart = 0, curElapsed = null, curPlayer = null, pendingStart = false;
    var flash = {}, lastY = bottomY, reveal = 0;

    function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
    function stopAnim() { curRunning = false; if (raf) cancelAnimationFrame(raf); raf = null; }

    function setWater(y, t) {
      var h = Math.max(0, bottomY - y);
      elWater.setAttribute('y', y.toFixed(1));
      elWater.setAttribute('height', h.toFixed(1));
      elShine.setAttribute('y1', y.toFixed(1));
      elShine.style.display = h > 2 ? '' : 'none';
      elLine.setAttribute('y1', y.toFixed(1));
      elLine.setAttribute('y2', y.toFixed(1));
      if (h > 4) {
        var d = 'M ' + PX + ' ' + (y + 1).toFixed(1);
        for (var i = 0; i <= 12; i++) {
          var xx = PX + (i / 12) * PW;
          var yy = y + 1 + 2.6 * Math.sin(t * 5.2 + (i / 12) * Math.PI * 6);
          d += ' L ' + xx.toFixed(1) + ' ' + yy.toFixed(1);
        }
        elWave.setAttribute('d', d);
        elWave.style.opacity = 1;
      } else {
        elWave.style.opacity = 0;
      }
      var flowK = Math.max(0.5, Math.min(1.8, (result.totalDemand || 4) / 4));
      bubbles.forEach(function (bb, bi) {
        if (h < 10) { bb.setAttribute('opacity', 0); return; }
        var frac = (t * (0.35 + 0.25 * flowK) + bi * 0.21) % 1;
        bb.setAttribute('cy', (bottomY - frac * h).toFixed(1));
        bb.setAttribute('opacity', 0.55);
      });
    }

    function setFloors(servedNow, revealP, greenSet) {
      dryEls.forEach(function (r) {
        var kk = +r.getAttribute('data-k');
        r.setAttribute('opacity', kk > servedNow ? (0.45 * revealP).toFixed(2) : 0);
      });
      okEls.forEach(function (r) {
        var kk = +r.getAttribute('data-k');
        var on = greenSet ? greenSet.indexOf(kk) >= 0 : kk <= servedNow;
        r.setAttribute('opacity', on ? 1 : 0);
      });
    }

    function setChip(text, op) {
      elChipText.textContent = text;
      elChipBg.setAttribute('width', Math.round(14 + text.length * 6.2));
      elChip.setAttribute('opacity', op);
    }
    function placeChip(y) {
      var ly = Math.max(topY + 2, y - 22);
      elChipBg.setAttribute('y', ly.toFixed(1));
      elChipText.setAttribute('y', (ly + 11.5).toFixed(1));
    }
    function setNote(text, op) { elNote.textContent = text; elNote.setAttribute('opacity', op); }
    function setCaption(text) { if (elCaption) elCaption.textContent = text; }
    function resetFlash() {
      flEls.forEach(function (ln) { ln.setAttribute('stroke', '#F5F9FD'); ln.setAttribute('stroke-width', 1); });
    }

    /* —— 初始动画：0.3s 进水管 → 1.5s 匀速上升 → 冲高回落 → 干楼层淡入 —— */
    function playInitial(elapsed) {
      resetFlash();
      flash = {}; lastY = bottomY; reveal = 0;
      elInlet.setAttribute('opacity', 0);
      elLine.setAttribute('opacity', 0);
      elChip.setAttribute('opacity', 0);
      setWater(bottomY, 0);
      setFloors(0, 0, null);
      setChip(served0 + ' 层 · ' + worst.pressure.toFixed(1) + ' m', 0);
      placeChip(waterY0);
      if (served0 < floors) setNote((served0 + 1) + ' 层以上：高峰期没水', 0); else setNote('', 0);
      setCaption(served0 === 0
        ? '现状：水刚进管口就停住（0/' + floors + ' 层）'
        : '现状：水只供到 ' + served0 + ' 层（共 ' + floors + ' 层）');
      btnRestore.hidden = true;
      curStart = now() - (elapsed || 0) * 1000;

      function loop() {
        if (!curRunning) return;
        if (document.hidden) { raf = null; return; }
        var t = (now() - curStart) / 1000;
        if (t >= 2.6) { finishInitial(); return; }
        elInlet.setAttribute('opacity', Math.min(1, t / 0.3).toFixed(2));
        var y;
        if (t < 0.3) y = bottomY;
        else if (t < 1.8) y = bottomY + (waterY0 - bottomY) * ((t - 0.3) / 1.5);
        else if (t < 1.95) y = waterY0 - (served0 > 0 ? 0.3 * bandH : 0) * ((t - 1.8) / 0.15);
        else if (t < 2.1) y = (waterY0 - (served0 > 0 ? 0.3 * bandH : 0)) + (served0 > 0 ? 0.3 * bandH : 0) * ((t - 1.95) / 0.15);
        else y = waterY0;

        for (var kk = 1; kk <= floors; kk++) {
          var lineY = bottomY - kk * bandH;
          if (lastY > lineY + 0.01 && y <= lineY + 0.01) flash[kk] = t;
        }
        lastY = y;
        flEls.forEach(function (ln) {
          var ft = flash[+ln.getAttribute('data-k')];
          var on = ft !== undefined && t - ft < 0.15;
          ln.setAttribute('stroke', on ? '#38A3E0' : '#F5F9FD');
          ln.setAttribute('stroke-width', on ? 2.6 : 1);
        });

        setWater(y, t);
        var wet = Math.min(floors, Math.floor((bottomY - y) / bandH + 1e-6));
        if (t >= 2.1) {
          reveal = Math.min(1, (t - 2.1) / 0.5);
          setFloors(served0, reveal, null);
          elLine.setAttribute('opacity', reveal);
          elChip.setAttribute('opacity', reveal);
          elNote.setAttribute('opacity', served0 < floors ? reveal : 0);
          placeChip(y);
        } else {
          setFloors(wet, 0, null);
        }
        raf = requestAnimationFrame(loop);
      }
      function finishInitial() {
        curRunning = false; curElapsed = null;
        reveal = 1;
        elInlet.setAttribute('opacity', 1);
        setWater(waterY0, 0);
        setFloors(served0, 1, null);
        elLine.setAttribute('opacity', 1);
        elChip.setAttribute('opacity', 1);
        elNote.setAttribute('opacity', served0 < floors ? 1 : 0);
        placeChip(waterY0);
        resetFlash();
      }
      curRunning = true;
      loop();
    }

    /* —— 方案联动：水柱按真实试算结果涨到对应层数（0.8s ease-out） —— */
    function playPlan(kind, plan, onDone, elapsed) {
      stopAnim();
      var targetServed, targetPressure, chipText, greenSet = null;
      if (!plan && kind !== 'local') { if (onDone) onDone(); return; }
      if (kind === 'local') {
        targetServed = floors;
        greenSet = [floors - 1, floors];
        targetPressure = floors <= 6 ? (serviceHeadTable(target)[floors] || 28) : 10 + 4 * (floors - 1);
        chipText = (floors - 1) + '–' + floors + ' 层 · ' + targetPressure + ' m';
      } else {
        var w = worstPoint(target, plan.sim);
        targetServed = Math.max(served0, Math.min(floors, WC.ui.networkMap.servedFloors(w.pressure, target.settings)));
        targetPressure = w.pressure;
        chipText = targetServed + ' 层 · ' + targetPressure.toFixed(1) + ' m';
      }
      var yFrom = waterY0, yTo = bottomY - targetServed * bandH;
      elInlet.setAttribute('opacity', 1);
      setChip(chipText, 1);
      setNote(targetServed < floors ? (targetServed + 1) + ' 层以上：高峰期没水' : '', targetServed < floors ? 1 : 0);
      elLine.setAttribute('opacity', 1);
      if (btnRestore) btnRestore.hidden = false;
      setCaption(kind === 'local'
        ? '局部加压：' + (floors - 1) + '–' + floors + ' 层补上供水'
        : (kind === 'pump' ? '增压后：' : '换管后：') + targetServed + '/' + floors + ' 层达标' +
          (targetServed >= floors ? '（最不利处 ' + targetPressure.toFixed(1) + ' m）' : '（最不利处 ' + targetPressure.toFixed(1) + ' m，仍不够）'));
      curStart = now() - (elapsed || 0) * 1000 - (reduced ? 2000 : 0);
      var D = 800;

      function step() {
        if (!curRunning) return;
        if (document.hidden) { raf = null; return; }
        var p = Math.min(1, (now() - curStart) / D);
        var e = 1 - Math.pow(1 - p, 3);
        var y = yFrom + (yTo - yFrom) * e;
        setWater(y, (now() - curStart) / 1000);
        placeChip(y);
        var wet = Math.min(floors, Math.floor((bottomY - y) / bandH + 1e-6));
        setFloors(wet, 1, greenSet);
        if (p < 1) { raf = requestAnimationFrame(step); return; }
        curRunning = false; curElapsed = null;
        setWater(yTo, 0);
        setFloors(targetServed, 1, greenSet);
        placeChip(yTo);
        if (onDone) onDone();
      }
      curRunning = true;
      step();
    }

    function begin(player) {
      curPlayer = player;
      curElapsed = null;
      if (document.hidden) { pendingStart = true; return; }
      pendingStart = false;
      player(0);
    }

    function onVis() {
      if (!wrap.isConnected) { document.removeEventListener('visibilitychange', onVis); return; }
      if (reduced) return;
      if (document.hidden) {
        if (curRunning) { curElapsed = (now() - curStart) / 1000; stopAnim(); }
        return;
      }
      if (pendingStart) { pendingStart = false; if (curPlayer) curPlayer(0); return; }
      if (curElapsed !== null && curPlayer) {
        var el2 = curElapsed; curElapsed = null; curRunning = true; curPlayer(el2);
      }
    }
    document.addEventListener('visibilitychange', onVis);

    if (!scrub && !bare) {
      wrap.querySelector('.fd-replay').addEventListener('click', function () { begin(playInitial); });
      btnRestore.addEventListener('click', function () { begin(playInitial); });
    }

    /* 兜底：减少动效 → 直接显示最终状态 */
    function showFinal() {
      stopAnim();
      elInlet.setAttribute('opacity', 1);
      setWater(waterY0, 0);
      setFloors(served0, 1, null);
      elLine.setAttribute('opacity', 1);
      elChip.setAttribute('opacity', 1);
      setNote(served0 < floors ? (served0 + 1) + ' 层以上：高峰期没水' : '', served0 < floors ? 1 : 0);
      setChip(served0 + ' 层 · ' + worst.pressure.toFixed(1) + ' m', 1);
      placeChip(waterY0);
      setCaption(served0 === 0
        ? '现状：水刚进管口就停住（0/' + floors + ' 层）'
        : '现状：水只供到 ' + served0 + ' 层（共 ' + floors + ' 层）');
    }

    /* —— 滚动驱动（scrub）：外部按页面滚动进度 p 直接摆放水位 —— */
    var curScrubY = bottomY;
    function scrubTo(p) {
      var e = Math.min(1, Math.max(0, p / 0.10));
      svg.style.opacity = e.toFixed(3);
      svg.style.transform = 'translateY(' + (60 * (1 - e)).toFixed(1) + 'px) scale(' + (0.92 + 0.08 * e).toFixed(3) + ')';

      var y;
      if (p <= 0.10) y = bottomY;
      else if (p < 0.66) y = bottomY + (waterY0 - bottomY) * ((p - 0.10) / 0.56);
      else if (p < 0.74) y = waterY0 - 0.3 * bandH * ((p - 0.66) / 0.08);
      else if (p < 0.80) y = (waterY0 - 0.3 * bandH) + 0.25 * bandH * ((p - 0.74) / 0.06);
      else y = waterY0 - 0.05 * bandH;
      curScrubY = y;

      elInlet.setAttribute('opacity', 1);
      setWater(y, now() / 1000);
      var wet = Math.min(floors, Math.floor((bottomY - y) / bandH + 1e-6));
      var rv = Math.min(1, Math.max(0, (p - 0.74) / 0.06));
      setFloors(wet, rv, null);
      var last = p >= 0.80 ? 1 : 0;
      elLine.setAttribute('opacity', last);
      elChip.setAttribute('opacity', last);
      setNote('', 0);
      setChip(served0 + ' 层 · ' + worst.pressure.toFixed(1) + ' m', last);
      placeChip(y);
      resetFlash();
    }

    wrap.fdApi = {
      floors: floors,
      served: served0,
      scrub: scrubTo,
      waterY: function () { return curScrubY; },
      play: function () { begin(playInitial); },
      plan: function (kind, plan, onDone) { if (reduced) { playPlan(kind, plan, onDone); onDone && onDone(); } else { begin(function (e) { playPlan(kind, plan, onDone, e); }); } },
      final: showFinal
    };

    if (scrub) { scrubTo(0); return wrap; }
    if (reduced) showFinal();
    return wrap;
  }

  /* ==================== 编辑页（#/edit/:id） ==================== */
  var editTab = 'water'; // 编辑页当前分区，默认「用水量」

  var EDIT_TABS = [
    { key: 'water', label: '用水量' },
    { key: 'nodes', label: '节点' },
    { key: 'pipes', label: '管段' },
    { key: 'settings', label: '校核参数' }
  ];

  function hhmm(d) {
    d = d || new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 数字保留 1–2 位小数：192.00→"192.0"、14.40→"14.4"、12.34→"12.34" */
  function fmtNum(x) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    return x.toFixed(2).replace(/0$/, '');
  }

  /** 工具条状态：数据改动未计算 → 黄色「未计算」；计算过 → 绿色「已计算 HH:MM」。 */
  function setCalcChip(el, project) {
    if (!el) return;
    if (project && project.calcAt) {
      el.textContent = '已计算 ' + hhmm(new Date(project.calcAt));
      el.className = 'save-status is-done';
    } else {
      el.textContent = '未计算';
      el.className = 'save-status is-todo';
    }
  }

  /** localStorage 写入失败时页面顶部出现可关闭的黄色横幅；恢复后自动消失。 */
  function ensureStorageBanner() {
    var b = document.getElementById('wc-storage-banner');
    var ok = store.persistOk();
    if (!ok) {
      if (b) return;
      b = document.createElement('div');
      b.id = 'wc-storage-banner';
      b.className = 'storage-banner';
      var txt = document.createElement('span');
      txt.textContent = '浏览器本地存储不可用，本次修改不会被保存';
      var close = document.createElement('button');
      close.type = 'button';
      close.textContent = '✕';
      close.title = '关闭';
      close.addEventListener('click', function () { b.remove(); });
      b.appendChild(txt);
      b.appendChild(close);
      document.body.appendChild(b);
    } else if (b) {
      b.remove(); // 存储恢复后横幅自动消失
    }
  }

  function renderEditPage(id) {
    var project = id ? store.get(id) : null;
    var page = document.createElement('div');
    page.className = 'page';

    if (!project) {
      setTitle('工程不存在');
      page.appendChild(buildTopbar({ name: '水压体检', onRename: null }));
      var nf = document.createElement('section');
      nf.className = 'card placeholder-hero';
      nf.innerHTML =
        '<h2>没有找到这个工程</h2>' +
        '<p class="u-muted">它可能已被删除。可回首页「新建体检」或「导入 JSON」恢复备份。</p>' +
        '<div class="notfound-actions"><a class="btn btn-primary" href="#/home">← 回首页</a></div>';
      page.appendChild(nf);
      root.appendChild(page);
      return;
    }

    setTitle(project.name + ' · 录入管网');
    page.appendChild(buildTopbar({
      name: project.name,
      onRename: renameProjectFlow(project.id),
      backHash: '#/project/' + encodeURIComponent(project.id),
      backLabel: '← 概览'
    }));

    // 分区切换
    var tabs = document.createElement('nav');
    tabs.className = 'edit-tabs';
    tabs.setAttribute('aria-label', '录入分区');
    EDIT_TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'edit-tab' + (t.key === editTab ? ' is-active' : '');
      b.textContent = t.label;
      b.addEventListener('click', function () {
        if (editTab === t.key) return;
        editTab = t.key;
        render();
      });
      tabs.appendChild(b);
    });
    page.appendChild(tabs);

    /* 校验状态条（Tab 下方常驻；有问题时可展开问题列表） */
    var vwrap = document.createElement('div');
    vwrap.className = 'v-bar';
    var vbtn = document.createElement('button');
    vbtn.type = 'button';
    vbtn.className = 'v-status';
    var vlist = document.createElement('div');
    vlist.className = 'v-list';
    vlist.style.display = 'none';
    vwrap.appendChild(vbtn);
    vwrap.appendChild(vlist);
    page.appendChild(vwrap);
    vBar.btn = vbtn; vBar.listEl = vlist; vBar.open = false; vBar.issues = [];
    vbtn.addEventListener('click', function () {
      if (!vBar.issues.length) return; // 绿色状态不可展开
      vBar.open = !vBar.open;
      var caret = vbtn.querySelector('.v-caret');
      if (vBar.open) {
        renderVList();
        vlist.style.display = '';
        if (caret) caret.textContent = '收起 ▴';
      } else {
        vlist.style.display = 'none';
        if (caret) caret.textContent = '展开 ▾';
      }
    });

    var content = document.createElement('div');
    content.className = 'edit-content';
    if (editTab === 'water') {
      content.appendChild(buildWaterSection(project));
    } else if (editTab === 'nodes') {
      content.appendChild(buildNodesSection(project));
    } else if (editTab === 'pipes') {
      content.appendChild(buildPipesSection(project));
    } else if (editTab === 'settings') {
      content.appendChild(buildSettingsSection(project));
    } else {
      var cur = null;
      for (var i = 0; i < EDIT_TABS.length; i++) {
        if (EDIT_TABS[i].key === editTab) cur = EDIT_TABS[i];
      }
      content.appendChild(buildComingSoon(cur ? cur.label : ''));
    }
    page.appendChild(content);
    refreshVBar(project); // 初始校验状态
    root.appendChild(page);
  }

  function buildComingSoon(title) {
    var s = document.createElement('section');
    s.className = 'card placeholder-hero';
    s.innerHTML =
      '<span class="tag">即将支持</span>' +
      '<h2>' + esc(title) + '</h2>' +
      '<p class="u-muted">这个分区正在开发中，请先完成「用水量」。</p>';
    return s;
  }

  /* ---------- 编辑页 · 用水量分区 ---------- */

  /** 单个数字输入：标签 + 单位 + 输入框 + 行内错误位。值为 0 时显示为空。 */
  function numField(label, unit, value) {
    var el = document.createElement('div');
    el.className = 'field';
    el.innerHTML =
      '<span class="field-label">' + esc(label) +
      '<span class="field-unit">' + esc(unit) + '</span></span>' +
      '<input type="number" step="any" inputmode="decimal">' +
      '<p class="field-err" role="alert"></p>';
    var input = el.querySelector('input');
    input.value = value ? String(value) : '';
    return { el: el, input: input, err: el.querySelector('.field-err') };
  }

  /** 读输入框：空 = 0（不算错）；非数字 / 负数等由调用方判定。 */
  function fieldNum(f) {
    var t = f.input.value.trim();
    if (t === '') return { v: 0, nan: false, empty: true };
    var v = Number(t);
    return { v: v, nan: isNaN(v), empty: false };
  }

  function buildWaterSection(project) {
    var w = project.water || (project.water = { population: 0, quota: 0, kh: 0, mode: 'calc' });

    var sec = document.createElement('section');
    sec.className = 'card edit-section';
    sec.innerHTML =
      '<div class="edit-head">' +
        '<h2>用水量</h2>' +
        '<span class="save-status" role="status"></span>' +
      '</div>' +
      '<p class="u-muted u-small edit-sub">先算出整个小区总共用多少水，再按人口分到各楼栋。最高日（一年里用水最多的那天）Qd = q×N/1000；最高时（最高日里用水最多的那小时）Qh = Qd×Kh/24。</p>';

    var statusEl = sec.querySelector('.save-status');
    setCalcChip(statusEl, project); // 初始状态：未计算（黄）／已计算 HH:MM（绿）

    var grid = document.createElement('div');
    grid.className = 'form-grid';
    var fPop = numField('人口 N', '人', w.population);
    var fQuota = numField('综合生活用水定额 q', 'L/(人·d)，每人每天多少升', w.quota);
    var fKh = numField('时变化系数 Kh', '最高时用水量是平均时的几倍', w.kh);
    grid.appendChild(fPop.el);
    grid.appendChild(fQuota.el);
    grid.appendChild(fKh.el);
    sec.appendChild(grid);

    var results = document.createElement('div');
    results.className = 'water-results';
    results.innerHTML =
      '<div class="result-item"><div><span class="result-num" data-r="qd">—</span><span class="result-unit">m³/d</span></div>' +
      '<div class="result-desc">最高日 Qd：整个小区一天最多用多少水</div></div>' +
      '<div class="result-item"><div><span class="result-num" data-r="qh">—</span><span class="result-unit">m³/h</span></div>' +
      '<div class="result-desc">最高时 Qh：最高日里最忙的那一小时用多少水</div></div>' +
      '<div class="result-item"><div><span class="result-num" data-r="qls">—</span><span class="result-unit">L/s</span></div>' +
      '<div class="result-desc">折算流量 Qh/3.6：换成每秒多少升，之后分给各楼栋</div></div>';
    sec.appendChild(results);

    var actions = document.createElement('div');
    actions.className = 'water-actions';
    var distBtn = document.createElement('button');
    distBtn.type = 'button';
    distBtn.className = 'btn btn-primary';
    distBtn.textContent = '按人口分配到楼栋节点';
    var distNote = document.createElement('span');
    distNote.className = 'dist-note u-muted';
    actions.appendChild(distBtn);
    actions.appendChild(distNote);
    sec.appendChild(actions);

    var eQd = results.querySelector('[data-r="qd"]');
    var eQh = results.querySelector('[data-r="qh"]');
    var eQls = results.querySelector('[data-r="qls"]');

    function markSaved() { setCalcChip(statusEl, project); refreshVBar(project); ensureStorageBanner(); }

    /** 读三个输入并做行内校验，返回 {valid, N, q, kh}。 */
    function readInputs() {
      var p = fieldNum(fPop);
      var q = fieldNum(fQuota);
      var k = fieldNum(fKh);

      fPop.err.textContent = p.nan ? '请输入数字' : (p.v < 0 ? '人口不能为负数' : '');
      fQuota.err.textContent = q.nan ? '请输入数字' : (q.v < 0 ? '用水定额不能为负数' : '');
      fKh.err.textContent = k.nan ? '请输入数字' : ((!k.empty && k.v <= 0) ? 'Kh 必须大于 0，否则算不出用水量' : '');

      fPop.input.classList.toggle('is-invalid', !!fPop.err.textContent);
      fQuota.input.classList.toggle('is-invalid', !!fQuota.err.textContent);
      fKh.input.classList.toggle('is-invalid', !!fKh.err.textContent);

      var valid = !fPop.err.textContent && !fQuota.err.textContent && !fKh.err.textContent;
      return { valid: valid, N: p.nan ? 0 : p.v, q: q.nan ? 0 : q.v, kh: k.nan ? 0 : k.v };
    }

    /** 实时重算并刷新显示，返回 {valid, qls}。 */
    function update() {
      var st = readInputs();
      if (!st.valid) {
        eQd.textContent = eQh.textContent = eQls.textContent = '—';
        return { valid: false, qls: 0 };
      }
      var qd = st.q * st.N / 1000; // m³/d
      var qh = qd * st.kh / 24;    // m³/h
      var qls = qh / 3.6;          // L/s
      eQd.textContent = fmtNum(qd);
      eQh.textContent = fmtNum(qh);
      eQls.textContent = fmtNum(qls);
      return { valid: true, qls: qls };
    }

    /** 失焦/回车提交：合法值写回 project.water 并立即保存。 */
    function commit() {
      var st = readInputs();
      if (st.valid) {
        w.population = st.N;
        w.quota = st.q;
        w.kh = st.kh;
      }
      store.save(project);
      markSaved();
    }

    [fPop, fQuota, fKh].forEach(function (f) {
      f.input.addEventListener('input', function () { update(); });
      f.input.addEventListener('change', function () { commit(); });
    });

    distBtn.addEventListener('click', function () {
      var st = update();
      if (!st.valid) {
        distNote.textContent = '请先修正上面的非法输入，再分配';
        distNote.className = 'dist-note is-err';
        return;
      }
      if (!(st.qls > 0)) {
        distNote.textContent = '当前用水量为 0，请先填写人口、定额和 Kh';
        distNote.className = 'dist-note is-warn';
        return;
      }
      var nodes = project.nodes || (project.nodes = []);
      var total = 0;
      nodes.forEach(function (n) {
        if (n && n.kind === 'building' && n.building && Number(n.building.people) > 0) {
          total += Number(n.building.people);
        }
      });
      if (!total) {
        distNote.textContent = '还没有带人数的楼栋节点，请先录入楼栋（「节点」分区即将支持）';
        distNote.className = 'dist-note is-warn';
        return;
      }
      var count = 0;
      nodes.forEach(function (n) {
        if (!n) return;
        if (n.kind === 'building' && n.building && Number(n.building.people) > 0) {
          n.demand = Math.round(st.qls * Number(n.building.people) / total * 100) / 100;
          count++;
        } else {
          n.demand = 0; // 水源与普通节点置 0
        }
      });
      store.save(project);
      markSaved();
      var sum = 0;
      nodes.forEach(function (n) {
        if (n && n.kind === 'building' && n.building && Number(n.building.people) > 0) sum += n.demand;
      });
      var diff = Math.abs(sum - st.qls);
      distNote.textContent = '已分配：' + count + ' 栋楼 / 共 ' + total + ' 人，' +
        fmtNum(st.qls) + ' L/s 按人数比例写入各楼栋' +
        (diff > 0.01 ? '（四舍五入误差 ' + diff.toFixed(2) + ' L/s）' : '');
      distNote.className = 'dist-note is-ok';
    });

    update(); // 首次渲染
    return sec;
  }

  /* ---------- 编辑页 · 节点分区 ---------- */

  var KIND_LABELS = [
    { v: 'source', t: '水源' },
    { v: 'junction', t: '节点' },
    { v: 'building', t: '楼栋' }
  ];

  /** 全局浮动提示（短暂显示后自动消失） */
  var toastTimer = null;
  function showToast(msg) {
    var t = document.querySelector('.wc-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'wc-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('is-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 2400);
  }

  /** 表格数字显示：0 显示为空（更干净），其余原样 */
  function cellNum(v) {
    return (typeof v === 'number' && isFinite(v) && v !== 0) ? String(v) : '';
  }

  function buildNodesSection(project) {
    var sec = document.createElement('section');
    sec.className = 'card edit-section';
    sec.innerHTML =
      '<div class="edit-head"><h2>节点</h2><span class="save-status" role="status"></span></div>' +
      '<p class="u-muted u-small edit-sub">一行一个节点：水源＝自来水进小区的地方；节点＝管道转角/分支；楼栋＝要算水压的房子。标高＝该处地面高度（米）。改编号会自动同步引用它的管段。</p>';
    var statusEl = sec.querySelector('.save-status');
    setCalcChip(statusEl, project); // 初始状态：未计算（黄）／已计算 HH:MM（绿）

    var nodes = project.nodes;
    if (!Array.isArray(nodes)) nodes = project.nodes = [];
    var pipes = project.pipes;
    if (!Array.isArray(pipes)) pipes = project.pipes = [];

    function markSaved() { setCalcChip(statusEl, project); refreshVBar(project); ensureStorageBanner(); }
    function saveNow() { store.save(project); markSaved(); }

    /* —— 工具行（表格上方） —— */
    var tools = document.createElement('div');
    tools.className = 'grid-tools';
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-ghost btn-sm';
    addBtn.textContent = '＋ 添加节点';
    var csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'btn btn-ghost btn-sm';
    csvBtn.textContent = '粘贴 CSV';
    tools.appendChild(addBtn);
    tools.appendChild(csvBtn);
    sec.appendChild(tools);

    /* —— 表格（窄屏横向滚动 + 表头吸顶）与空状态 —— */
    var emptyMsg = document.createElement('p');
    emptyMsg.className = 'grid-empty';
    emptyMsg.textContent = '还没有节点，点上面 + 添加节点，或粘贴 CSV';

    var wrap = document.createElement('div');
    wrap.className = 'grid-wrap';
    wrap.innerHTML =
      '<table class="grid-table"><thead><tr>' +
      '<th>类型</th><th>编号</th><th class="num">需水量 L/s</th><th class="num">地面标高 m</th>' +
      '<th>是否定压</th><th class="num">定压水头 m</th>' +
      '<th class="num">层数</th><th class="num">户数</th><th class="num">人数</th>' +
      '<th></th>' +
      '</tr></thead><tbody></tbody></table>';
    var tbody = wrap.querySelector('tbody');
    sec.appendChild(wrap);
    sec.appendChild(emptyMsg);

    /* —— 表底「+ 添加节点」 —— */
    var bottomTools = document.createElement('div');
    bottomTools.className = 'grid-tools grid-tools-bottom';
    var addBtn2 = document.createElement('button');
    addBtn2.type = 'button';
    addBtn2.className = 'btn btn-ghost btn-sm';
    addBtn2.textContent = '＋ 添加节点';
    addBtn2.addEventListener('click', function () { addBtn.click(); });
    bottomTools.appendChild(addBtn2);
    sec.appendChild(bottomTools);

    /** Enter：下移一行同列；无可聚焦格则失焦保存。 */
    function moveDown(input) {
      var r = Number(input.dataset.r) + 1;
      var next = tbody.querySelector('[data-r="' + r + '"][data-c="' + input.dataset.c + '"]');
      if (next && !next.disabled) next.focus();
      else input.blur();
    }

    /** Esc 还原当前格、Enter 下移一行（失焦即保存，Tab 走浏览器默认顺序）。 */
    function attachKeys(input) {
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          input.value = input.dataset.orig || '';
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          moveDown(input);
        }
      });
    }

    function parseCellNum(text, label) {
      if (text === '') return 0;
      var v = Number(text);
      if (isNaN(v)) { showToast(label + '「' + text + '」不是数字，已还原'); return null; }
      return v;
    }

    /** 数字格：失焦提交（空=0），失败还原。 */
    function wireNum(input, r, c, get, set, label) {
      input.dataset.r = r; input.dataset.c = c;
      input.value = cellNum(get());
      input.dataset.orig = input.value;
      attachKeys(input);
      input.addEventListener('blur', function () {
        if (input.value === input.dataset.orig) return;
        var v = parseCellNum(input.value.trim(), label);
        if (v === null) { input.value = input.dataset.orig; return; }
        set(v);
        input.dataset.orig = input.value;
        saveNow();
      });
    }

    function buildRow(n, r) {
      var tr = document.createElement('tr');

      /* 类型 */
      var tdK = document.createElement('td');
      var sel = document.createElement('select');
      KIND_LABELS.forEach(function (k) {
        var o = document.createElement('option');
        o.value = k.v;
        o.textContent = k.t;
        sel.appendChild(o);
      });
      sel.value = n.kind || 'junction';
      sel.dataset.r = r; sel.dataset.c = 0;
      tdK.appendChild(sel);
      tr.appendChild(tdK);

      /* 编号（改名同步管段引用） */
      var idInput = document.createElement('input');
      idInput.type = 'text';
      idInput.dataset.r = r; idInput.dataset.c = 1;
      idInput.value = n.id;
      idInput.dataset.orig = n.id;
      attachKeys(idInput);
      idInput.addEventListener('blur', function () {
        if (idInput.value === idInput.dataset.orig) return;
        var raw = idInput.value.trim();
        if (!raw) { idInput.value = n.id; idInput.dataset.orig = n.id; showToast('编号不能为空，已还原'); return; }
        var dup = false;
        nodes.forEach(function (m) { if (m !== n && m.id === raw) dup = true; });
        if (dup) { idInput.value = n.id; idInput.dataset.orig = n.id; showToast('编号「' + raw + '」已存在，已还原'); return; }
        var old = n.id;
        var cnt = 0;
        pipes.forEach(function (p) {
          var hit = false;
          if (p.from === old) { p.from = raw; hit = true; }
          if (p.to === old) { p.to = raw; hit = true; }
          if (hit) cnt++;
        });
        n.id = raw;
        idInput.dataset.orig = raw;
        saveNow();
        if (cnt) showToast('已同步 ' + cnt + ' 条管段');
      });
      var tdId = document.createElement('td');
      tdId.appendChild(idInput);
      tr.appendChild(tdId);

      /* 需水量 */
      var tdD = document.createElement('td');
      tdD.className = 'num';
      var dInput = document.createElement('input');
      dInput.type = 'number';
      dInput.step = 'any';
      tdD.appendChild(dInput);
      tr.appendChild(tdD);
      wireNum(dInput, r, 2,
        function () { return n.demand || 0; },
        function (v) { n.demand = v; },
        '需水量');

      /* 地面标高 */
      var tdE = document.createElement('td');
      tdE.className = 'num';
      var eInput = document.createElement('input');
      eInput.type = 'number';
      eInput.step = 'any';
      tdE.appendChild(eInput);
      tr.appendChild(tdE);
      wireNum(eInput, r, 3,
        function () { return n.elev || 0; },
        function (v) { n.elev = v; },
        '地面标高');

      /* 是否定压（开关；打开时水头默认 28） */
      var tdF = document.createElement('td');
      var lab = document.createElement('label');
      lab.className = 'switch';
      var fixedCb = document.createElement('input');
      fixedCb.type = 'checkbox';
      fixedCb.dataset.r = r; fixedCb.dataset.c = 4;
      fixedCb.checked = !!n.fixed;
      lab.innerHTML = '<span class="switch-track"><span class="switch-knob"></span></span>';
      lab.insertBefore(fixedCb, lab.firstChild);
      tdF.appendChild(lab);
      tr.appendChild(tdF);

      /* 定压水头 */
      var tdH = document.createElement('td');
      tdH.className = 'num';
      var hInput = document.createElement('input');
      hInput.type = 'number';
      hInput.step = 'any';
      tdH.appendChild(hInput);
      tr.appendChild(tdH);
      wireNum(hInput, r, 5,
        function () { return n.head || 0; },
        function (v) { n.head = v; },
        '定压水头');

      /* 楼栋三列（层数 / 户数 / 人数） */
      var bCells = [];
      var B_COLS = [
        { key: 'floors', label: '层数', c: 6 },
        { key: 'households', label: '户数', c: 7 },
        { key: 'people', label: '人数', c: 8 }
      ];
      var bCellRefs = {};
      B_COLS.forEach(function (col) {
        var td = document.createElement('td');
        td.className = 'num';
        var inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '1';
        td.appendChild(inp);
        tr.appendChild(td);
        wireNum(inp, r, col.c,
          function () { return (n.building && n.building[col.key]) || 0; },
          function (v) {
            if (!n.building) n.building = { floors: 0, households: 0, people: 0 };
            n.building[col.key] = v;
          },
          col.label);
        bCells.push({ key: col.key, input: inp });
        bCellRefs[col.key] = inp;
      });

      function syncBuildingCells() {
        var b = n.building || {};
        bCells.forEach(function (cell) {
          cell.input.disabled = (n.kind !== 'building');
          cell.input.value = cellNum(Number(b[cell.key]) || 0);
          cell.input.dataset.orig = cell.input.value;
        });
      }

      fixedCb.addEventListener('change', function () {
        n.fixed = fixedCb.checked;
        if (n.fixed && !n.head) n.head = 28; // 打开定压默认 28 m，可改
        hInput.value = cellNum(n.head);
        hInput.dataset.orig = hInput.value;
        saveNow();
      });

      sel.addEventListener('change', function () {
        n.kind = sel.value;
        if (n.kind === 'building' && !n.building) {
          n.building = { floors: 6, households: 24, people: 96 };
        }
        syncBuildingCells();
        saveNow();
      });

      syncBuildingCells();

      /* 行尾删除 */
      var tdX = document.createElement('td');
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'row-del';
      del.title = '删除该节点';
      del.textContent = '✕';
      del.addEventListener('click', function () {
        var refIds = [];
        pipes.forEach(function (q) {
          if (q && (q.from === n.id || q.to === n.id) && refIds.indexOf(q.id) < 0) refIds.push(q.id);
        });
        if (refIds.length) {
          if (!confirm('有 ' + refIds.length + ' 条管段（' + refIds.join('、') + '）引用了节点 ' + n.id +
            '，删除后这些管段会失效。确定删除？')) return;
        }
        var i = nodes.indexOf(n);
        if (i >= 0) nodes.splice(i, 1);
        saveNow();
        rebuild();
      });
      tdX.appendChild(del);
      tr.appendChild(tdX);

      return tr;
    }

    function rebuild() {
      tbody.innerHTML = '';
      nodes.forEach(function (n, r) { tbody.appendChild(buildRow(n, r)); });
      var empty = nodes.length === 0;
      wrap.style.display = empty ? 'none' : '';
      emptyMsg.style.display = empty ? '' : 'none';
      bottomTools.style.display = empty ? 'none' : '';
    }

    /** 自动生成不冲突的编号：N1、N2… */
    function nextNodeId() {
      var i = 1;
      while (true) {
        var cand = 'N' + i;
        var used = false;
        nodes.forEach(function (m) { if (m.id === cand) used = true; });
        if (!used) return cand;
        i++;
      }
    }

    function addNode() {
      nodes.push({ id: nextNodeId(), kind: 'junction', demand: 0, elev: 0, fixed: false, head: 0 });
      saveNow();
      rebuild();
      var last = tbody.querySelector('tr:last-child input[data-c="1"]');
      if (last) last.focus();
    }
    addBtn.addEventListener('click', addNode);
    csvBtn.addEventListener('click', openCsvModal);

    /* —— CSV 弹层 —— */

    function openCsvModal() {
      var mask = document.createElement('div');
      mask.className = 'modal-mask';
      var modal = document.createElement('div');
      modal.className = 'modal card';
      modal.innerHTML =
        '<h3>粘贴节点 CSV</h3>' +
        '<p class="u-muted u-small">一行一个节点。列顺序：类型、编号、需水量、地面标高、是否定压、定压水头、层数、户数、人数。分隔符支持英文逗号、中文逗号（，）、Tab；第一行可以是表头（自动跳过）；缺的列按默认值补：需水量 0、标高 0、不定压、楼栋 6 层 24 户 96 人。类型填：水源 / 节点 / 楼栋。</p>' +
        '<textarea spellcheck="false" placeholder="类型,编号,需水量,地面标高,是否定压,定压水头,层数,户数,人数"></textarea>' +
        '<div class="modal-result" role="status"></div>' +
        '<div class="modal-actions"></div>';
      mask.appendChild(modal);
      document.body.appendChild(mask);

      var ta = modal.querySelector('textarea');
      var result = modal.querySelector('.modal-result');
      var actions = modal.querySelector('.modal-actions');

      function close() { mask.remove(); }

      function renderActions(mode) {
        actions.innerHTML = '';
        if (mode === 'input') {
          var cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'btn btn-ghost';
          cancel.textContent = '取消';
          cancel.addEventListener('click', close);
          var ok = document.createElement('button');
          ok.type = 'button';
          ok.className = 'btn btn-primary';
          ok.textContent = '确认导入';
          ok.addEventListener('click', function () { doImport(ta.value); });
          actions.appendChild(cancel);
          actions.appendChild(ok);
        } else {
          var done = document.createElement('button');
          done.type = 'button';
          done.className = 'btn btn-primary';
          done.textContent = '关闭';
          done.addEventListener('click', close);
          actions.appendChild(done);
        }
      }

      mask.addEventListener('click', function (ev) { if (ev.target === mask) close(); });
      modal.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && ev.target.tagName !== 'TEXTAREA') { ev.preventDefault(); close(); }
      });

      renderActions('input');
      setTimeout(function () { ta.focus(); }, 0);

      function doImport(text) {
        var res = parseNodesCsv(text);
        res.rows.forEach(function (row) { nodes.push(row); });
        var html = '<p class="ok">成功导入 ' + res.rows.length + ' 行' +
          (res.errors.length ? '；失败 ' + res.errors.length + ' 行：' : '。') + '</p>';
        res.errors.forEach(function (e2) { html += '<p class="bad">' + esc(e2) + '</p>'; });
        result.innerHTML = html;
        if (res.rows.length) { saveNow(); rebuild(); }
        ta.value = '';
        renderActions('done');
      }
    }

    /** 解析 CSV：好的行返回、坏的行报「第 N 行：原因」，不整批吞掉。 */
    function parseNodesCsv(text) {
      var rows = [], errors = [];
      var seen = {};
      nodes.forEach(function (m) { seen[m.id] = true; });
      var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
      var first = true;
      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i];
        if (!raw.trim()) continue;
        var line = raw.replace(/，/g, ',');
        var cells = line.split(line.indexOf('\t') >= 0 ? '\t' : ',');
        for (var ci = 0; ci < cells.length; ci++) cells[ci] = cells[ci].trim();
        if (first) {
          first = false;
          if ((cells[0] && cells[0].indexOf('类型') >= 0) || (cells[1] && cells[1].indexOf('编号') >= 0)) continue;
        }
        var errs = [];
        var k = (cells[0] || '').toLowerCase();
        var kind = 'junction';
        if (k === '' || k === '节点' || k === 'junction' || k === 'j') kind = 'junction';
        else if (k === '水源' || k === 'source' || k === 's') kind = 'source';
        else if (k === '楼栋' || k === 'building' || k === 'b') kind = 'building';
        else errs.push('类型「' + cells[0] + '」无法识别');

        var id = cells[1] || '';
        if (!id) errs.push('缺少编号');
        else if (seen[id]) errs.push('编号「' + id + '」已存在');

        function numAt(ix, def, label) {
          var t = cells[ix] == null ? '' : cells[ix];
          if (t === '') return def;
          var v = Number(t);
          if (isNaN(v)) { errs.push(label + '「' + t + '」不是数字'); return def; }
          return v;
        }
        var demand = numAt(2, 0, '需水量');
        var elev = numAt(3, 0, '地面标高');
        var fTxt = (cells[4] || '').toLowerCase();
        var fixed = (fTxt === '是' || fTxt === 'y' || fTxt === 'true' || fTxt === '1');
        var head = numAt(5, fixed ? 28 : 0, '定压水头');
        var floors = numAt(6, 6, '层数');
        var households = numAt(7, 24, '户数');
        var people = numAt(8, 96, '人数');

        if (errs.length) { errors.push('第 ' + (i + 1) + ' 行：' + errs.join('；')); continue; }
        seen[id] = true;
        rows.push({
          id: id, kind: kind, demand: demand, elev: elev, fixed: fixed, head: head,
          building: { floors: floors, households: households, people: people }
        });
      }
      return { rows: rows, errors: errors };
    }

    rebuild();
    return sec;
  }

  /* ---------- 编辑页 · 管段分区 ---------- */

  function buildPipesSection(project) {
    var sec = document.createElement('section');
    sec.className = 'card edit-section';
    sec.innerHTML =
      '<div class="edit-head"><h2>管段</h2><span class="save-status" role="status"></span></div>' +
      '<p class="u-muted u-small edit-sub">一行一段管子。C 值＝海曾-威廉系数，表示管子内壁光滑程度：越新越光滑、数值越大（90 旧铸铁 → 150 塑料管），可从下拉提示里选常用值，也可手填。</p>';
    var statusEl = sec.querySelector('.save-status');
    setCalcChip(statusEl, project); // 初始状态：未计算（黄）／已计算 HH:MM（绿）

    var nodes = project.nodes;
    if (!Array.isArray(nodes)) nodes = project.nodes = [];
    var pipes = project.pipes;
    if (!Array.isArray(pipes)) pipes = project.pipes = [];

    function markSaved() { setCalcChip(statusEl, project); refreshVBar(project); ensureStorageBanner(); }
    /** 管段分区：每次提交都刷新小结，保证「实时」。 */
    function saveNow() { store.save(project); markSaved(); updateSummary(); }

    /* C 值常用值提示（datalist，允许手填其他值） */
    var dl = document.getElementById('wc-c-values');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'wc-c-values';
      [['90', '旧铸铁管'], ['100', '旧钢管'], ['130', '新铸铁/钢管'], ['140', '新钢管'], ['150', '塑料管']].forEach(function (h) {
        var o = document.createElement('option');
        o.value = h[0];
        o.label = h[1];
        dl.appendChild(o);
      });
      document.body.appendChild(dl);
    }

    /* —— 工具行（表格上方） —— */
    var tools = document.createElement('div');
    tools.className = 'grid-tools';
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-ghost btn-sm';
    addBtn.textContent = '＋ 添加管段';
    var csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'btn btn-ghost btn-sm';
    csvBtn.textContent = '粘贴 CSV';
    tools.appendChild(addBtn);
    tools.appendChild(csvBtn);
    sec.appendChild(tools);

    /* —— 空状态 + 表格 —— */
    var emptyMsg = document.createElement('p');
    emptyMsg.className = 'grid-empty';
    emptyMsg.textContent = '还没有管段，点上面 + 添加管段，或粘贴 CSV';

    var wrap = document.createElement('div');
    wrap.className = 'grid-wrap';
    wrap.innerHTML =
      '<table class="grid-table"><thead><tr>' +
      '<th>编号</th><th>起点</th><th>终点</th><th class="num">管长 m</th>' +
      '<th class="num">管径 mm</th><th class="num">C 值</th><th></th>' +
      '</tr></thead><tbody></tbody></table>';
    var tbody = wrap.querySelector('tbody');
    sec.appendChild(wrap);
    sec.appendChild(emptyMsg);

    /* —— 表下方实时小结 —— */
    var sumEl = document.createElement('p');
    sumEl.className = 'pipe-summary u-muted u-small';
    sec.appendChild(sumEl);

    /* —— 表底「+ 添加管段」 —— */
    var bottomTools = document.createElement('div');
    bottomTools.className = 'grid-tools grid-tools-bottom';
    var addBtn2 = document.createElement('button');
    addBtn2.type = 'button';
    addBtn2.className = 'btn btn-ghost btn-sm';
    addBtn2.textContent = '＋ 添加管段';
    addBtn2.addEventListener('click', function () { addBtn.click(); });
    bottomTools.appendChild(addBtn2);
    sec.appendChild(bottomTools);

    function moveDown(input) {
      var r = Number(input.dataset.r) + 1;
      var next = tbody.querySelector('[data-r="' + r + '"][data-c="' + input.dataset.c + '"]');
      if (next && !next.disabled) next.focus();
      else input.blur();
    }

    function attachKeys(input) {
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          input.value = input.dataset.orig || '';
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          moveDown(input);
        }
      });
    }

    function parseCellNum(text, label) {
      if (text === '') return 0;
      var v = Number(text);
      if (isNaN(v)) { showToast(label + '「' + text + '」不是数字，已还原'); return null; }
      return v;
    }

    function wireNum(input, r, c, get, set, label) {
      input.dataset.r = r; input.dataset.c = c;
      input.value = cellNum(get());
      input.dataset.orig = input.value;
      attachKeys(input);
      input.addEventListener('blur', function () {
        if (input.value === input.dataset.orig) return;
        var v = parseCellNum(input.value.trim(), label);
        if (v === null) { input.value = input.dataset.orig; return; }
        set(v);
        input.dataset.orig = input.value;
        saveNow();
      });
    }

    /** 起点终点下拉：选项来自节点编号 */
    function buildNodeSelect(val) {
      var sel = document.createElement('select');
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '（选择节点）';
      sel.appendChild(blank);
      nodes.forEach(function (n) {
        var o = document.createElement('option');
        o.value = n.id;
        o.textContent = n.id;
        sel.appendChild(o);
      });
      sel.value = val || '';
      return sel;
    }

    function buildRow(p, r) {
      var tr = document.createElement('tr');

      /* 编号 */
      var tdId = document.createElement('td');
      var idInput = document.createElement('input');
      idInput.type = 'text';
      idInput.dataset.r = r; idInput.dataset.c = 0;
      idInput.value = p.id;
      idInput.dataset.orig = p.id;
      attachKeys(idInput);
      idInput.addEventListener('blur', function () {
        if (idInput.value === idInput.dataset.orig) return;
        var raw = idInput.value.trim();
        if (!raw) { idInput.value = p.id; idInput.dataset.orig = p.id; showToast('编号不能为空，已还原'); return; }
        var dup = false;
        pipes.forEach(function (m) { if (m !== p && m.id === raw) dup = true; });
        if (dup) { idInput.value = p.id; idInput.dataset.orig = p.id; showToast('编号「' + raw + '」已存在，已还原'); return; }
        p.id = raw;
        idInput.dataset.orig = raw;
        saveNow();
      });
      tdId.appendChild(idInput);
      tr.appendChild(tdId);

      /* 起点 */
      var tdF = document.createElement('td');
      var fromSel = buildNodeSelect(p.from);
      fromSel.dataset.r = r; fromSel.dataset.c = 1;
      tdF.appendChild(fromSel);
      tr.appendChild(tdF);

      /* 终点（附行内错误提示） */
      var tdT = document.createElement('td');
      tdT.className = 'cell-to';
      var toSel = buildNodeSelect(p.to);
      toSel.dataset.r = r; toSel.dataset.c = 2;
      tdT.appendChild(toSel);
      var errSpan = document.createElement('span');
      errSpan.className = 'cell-err';
      errSpan.textContent = '起点和终点不能是同一个节点';
      tdT.appendChild(errSpan);
      tr.appendChild(tdT);

      /** 起点终点撞车：行内标红 + 不写入数据（显示还原为旧值） */
      function setErr(on) {
        fromSel.classList.toggle('is-invalid', on);
        toSel.classList.toggle('is-invalid', on);
        errSpan.style.display = on ? 'block' : 'none';
      }

      fromSel.addEventListener('change', function () {
        if (fromSel.value && fromSel.value === p.to) {
          fromSel.value = p.from || '';
          setErr(true);
          return;
        }
        setErr(false);
        p.from = fromSel.value;
        saveNow();
      });
      toSel.addEventListener('change', function () {
        if (toSel.value && toSel.value === p.from) {
          toSel.value = p.to || '';
          setErr(true);
          return;
        }
        setErr(false);
        p.to = toSel.value;
        saveNow();
      });

      /* 管长 / 管径 / C 值 */
      var tdL = document.createElement('td');
      tdL.className = 'num';
      var lInput = document.createElement('input');
      lInput.type = 'number';
      lInput.step = 'any';
      tdL.appendChild(lInput);
      tr.appendChild(tdL);
      wireNum(lInput, r, 3, function () { return p.L || 0; }, function (v) { p.L = v; }, '管长');

      var tdD = document.createElement('td');
      tdD.className = 'num';
      var dInput = document.createElement('input');
      dInput.type = 'number';
      dInput.step = 'any';
      tdD.appendChild(dInput);
      tr.appendChild(tdD);
      wireNum(dInput, r, 4, function () { return p.D || 0; }, function (v) { p.D = v; }, '管径');

      var tdC = document.createElement('td');
      tdC.className = 'num';
      var cInput = document.createElement('input');
      cInput.type = 'number';
      cInput.step = 'any';
      cInput.setAttribute('list', 'wc-c-values');
      tdC.appendChild(cInput);
      tr.appendChild(tdC);
      wireNum(cInput, r, 5, function () { return p.C || 0; }, function (v) { p.C = v; }, 'C 值');

      /* 行尾删除 */
      var tdX = document.createElement('td');
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'row-del';
      del.title = '删除该管段';
      del.textContent = '✕';
      del.addEventListener('click', function () {
        var i = pipes.indexOf(p);
        if (i >= 0) pipes.splice(i, 1);
        saveNow();
        rebuild();
      });
      tdX.appendChild(del);
      tr.appendChild(tdX);

      return tr;
    }

    /** 表下方小结：条数 / 总长 / 管径分布（实时） */
    function updateSummary() {
      if (!pipes.length) { sumEl.style.display = 'none'; return; }
      sumEl.style.display = '';
      var total = 0;
      var dist = {};
      pipes.forEach(function (p) {
        if (typeof p.L === 'number' && p.L > 0) total += p.L;
        if (typeof p.D === 'number' && p.D > 0) dist[p.D] = (dist[p.D] || 0) + 1;
      });
      var keys = Object.keys(dist).map(Number).sort(function (a, b) { return b - a; });
      var parts = keys.map(function (k) { return 'DN' + k + '×' + dist[k]; });
      sumEl.textContent = '管段 ' + pipes.length + ' 条 · 总长 ' + (total / 1000).toFixed(2) +
        ' km · 管径分布 ' + (parts.length ? parts.join(' / ') : '—');
    }

    function rebuild() {
      tbody.innerHTML = '';
      pipes.forEach(function (p, r) { tbody.appendChild(buildRow(p, r)); });
      var empty = pipes.length === 0;
      wrap.style.display = empty ? 'none' : '';
      emptyMsg.style.display = empty ? '' : 'none';
      bottomTools.style.display = empty ? 'none' : '';
      updateSummary();
    }

    function nextPipeId() {
      var i = 1;
      while (true) {
        var cand = 'P' + i;
        var used = false;
        pipes.forEach(function (m) { if (m.id === cand) used = true; });
        if (!used) return cand;
        i++;
      }
    }

    function addPipe() {
      pipes.push({ id: nextPipeId(), from: '', to: '', L: 100, D: 100, C: 100 });
      saveNow();
      rebuild();
      var last = tbody.querySelector('tr:last-child input[data-c="0"]');
      if (last) last.focus();
    }
    addBtn.addEventListener('click', addPipe);
    csvBtn.addEventListener('click', openCsvModal);

    /* —— CSV 弹层（列顺序：编号,起点,终点,管长,管径,C） —— */

    function openCsvModal() {
      var mask = document.createElement('div');
      mask.className = 'modal-mask';
      var modal = document.createElement('div');
      modal.className = 'modal card';
      modal.innerHTML =
        '<h3>粘贴管段 CSV</h3>' +
        '<p class="u-muted u-small">一行一段管子。列顺序：编号、起点、终点、管长、管径、C。分隔符支持英文逗号、中文逗号（，）、Tab；第一行可以是表头（自动跳过）；缺的列按默认值补：管长 100 m、管径 100 mm、C 100。起点/终点必须填已有节点编号。</p>' +
        '<textarea spellcheck="false" placeholder="编号,起点,终点,管长,管径,C"></textarea>' +
        '<div class="modal-result" role="status"></div>' +
        '<div class="modal-actions"></div>';
      mask.appendChild(modal);
      document.body.appendChild(mask);

      var ta = modal.querySelector('textarea');
      var result = modal.querySelector('.modal-result');
      var actions = modal.querySelector('.modal-actions');

      function close() { mask.remove(); }

      function renderActions(mode) {
        actions.innerHTML = '';
        if (mode === 'input') {
          var cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'btn btn-ghost';
          cancel.textContent = '取消';
          cancel.addEventListener('click', close);
          var ok = document.createElement('button');
          ok.type = 'button';
          ok.className = 'btn btn-primary';
          ok.textContent = '确认导入';
          ok.addEventListener('click', function () { doImport(ta.value); });
          actions.appendChild(cancel);
          actions.appendChild(ok);
        } else {
          var done = document.createElement('button');
          done.type = 'button';
          done.className = 'btn btn-primary';
          done.textContent = '关闭';
          done.addEventListener('click', close);
          actions.appendChild(done);
        }
      }

      mask.addEventListener('click', function (ev) { if (ev.target === mask) close(); });
      modal.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && ev.target.tagName !== 'TEXTAREA') { ev.preventDefault(); close(); }
      });

      renderActions('input');
      setTimeout(function () { ta.focus(); }, 0);

      function doImport(text) {
        var res = parsePipesCsv(text);
        res.rows.forEach(function (row) { pipes.push(row); });
        var html = '<p class="ok">成功导入 ' + res.rows.length + ' 行' +
          (res.errors.length ? '；失败 ' + res.errors.length + ' 行：' : '。') + '</p>';
        res.errors.forEach(function (e2) { html += '<p class="bad">' + esc(e2) + '</p>'; });
        result.innerHTML = html;
        if (res.rows.length) { saveNow(); rebuild(); }
        ta.value = '';
        renderActions('done');
      }
    }

    function parsePipesCsv(text) {
      var rows = [], errors = [];
      var seenIds = {};
      pipes.forEach(function (m) { seenIds[m.id] = true; });
      var nodeIds = {};
      nodes.forEach(function (n) { nodeIds[n.id] = true; });
      var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
      var first = true;
      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i];
        if (!raw.trim()) continue;
        var line = raw.replace(/，/g, ',');
        var cells = line.split(line.indexOf('\t') >= 0 ? '\t' : ',');
        for (var ci = 0; ci < cells.length; ci++) cells[ci] = cells[ci].trim();
        if (first) {
          first = false;
          if ((cells[0] && cells[0].indexOf('编号') >= 0) || (cells[1] && cells[1].indexOf('起点') >= 0)) continue;
        }
        var errs = [];
        var id = cells[0] || '';
        if (!id) errs.push('缺少编号');
        else if (seenIds[id]) errs.push('编号「' + id + '」已存在');

        var from = cells[1] || '';
        var to = cells[2] || '';
        if (!from) errs.push('缺少起点');
        else if (!nodeIds[from]) errs.push('起点「' + from + '」不存在');
        if (!to) errs.push('缺少终点');
        else if (!nodeIds[to]) errs.push('终点「' + to + '」不存在');
        if (from && to && from === to) errs.push('起点和终点不能是同一个节点');

        function numAt(ix, def, label) {
          var t = cells[ix] == null ? '' : cells[ix];
          if (t === '') return def;
          var v = Number(t);
          if (isNaN(v)) { errs.push(label + '「' + t + '」不是数字'); return def; }
          if (v <= 0) { errs.push(label + '「' + t + '」必须为正数'); return def; }
          return v;
        }
        var L = numAt(3, 100, '管长');
        var D = numAt(4, 100, '管径');
        var C = numAt(5, 100, 'C 值');

        if (errs.length) { errors.push('第 ' + (i + 1) + ' 行：' + errs.join('；')); continue; }
        seenIds[id] = true;
        rows.push({ id: id, from: from, to: to, L: L, D: D, C: C });
      }
      return { rows: rows, errors: errors };
    }

    rebuild();
    return sec;
  }

  /* ---------- 编辑页 · 校核参数分区 ---------- */

  function buildSettingsSection(project) {
    var sec = document.createElement('section');
    sec.className = 'card edit-section';
    sec.innerHTML =
      '<div class="edit-head"><h2>校核参数</h2><span class="save-status" role="status"></span></div>' +
      '<p class="u-muted u-small edit-sub">这些数字决定「体检」怎么判断：流速太低说明管子选粗了、造价浪费；流速太高则水头损失大、容易噪音。服务水头是让该层住户正常出水所需的最低压力（米水柱，1 m 水柱约 10 kPa）。</p>';
    var statusEl = sec.querySelector('.save-status');
    setCalcChip(statusEl, project); // 初始状态：未计算（黄）／已计算 HH:MM（绿）

    var st = project.settings;
    if (!st || typeof st !== 'object') st = project.settings = {};
    if (typeof st.vMin !== 'number') st.vMin = 0.6;
    if (typeof st.vMax !== 'number') st.vMax = 1.4;
    if (!st.serviceHead || typeof st.serviceHead !== 'object') {
      st.serviceHead = { 1: 10, 2: 12, 3: 16, 4: 20, 5: 24, 6: 28 };
    }

    function markSaved() { setCalcChip(statusEl, project); refreshVBar(project); ensureStorageBanner(); }
    function saveNow() { store.save(project); markSaved(); }

    /* —— 经济流速 —— */
    var vTitle = document.createElement('h3');
    vTitle.className = 'edit-block';
    vTitle.textContent = '经济流速';
    sec.appendChild(vTitle);

    var velGrid = document.createElement('div');
    velGrid.className = 'form-grid';
    var fMin = numField('经济流速下限 vMin', 'm/s：低于它说明管径选大了、造价浪费', st.vMin);
    var fMax = numField('经济流速上限 vMax', 'm/s：高于它水头损失大、容易噪音', st.vMax);
    velGrid.appendChild(fMin.el);
    velGrid.appendChild(fMax.el);
    sec.appendChild(velGrid);

    function checkVel() {
      fMin.err.textContent = '';
      fMax.err.textContent = '';
      fMin.input.classList.remove('is-invalid');
      fMax.input.classList.remove('is-invalid');
      var a = fMin.input.value.trim();
      var b = fMax.input.value.trim();
      if (a === '' || b === '') return true; // 空着先不判
      var va = Number(a), vb = Number(b);
      if (isNaN(va)) { fMin.err.textContent = '请输入数字'; fMin.input.classList.add('is-invalid'); return false; }
      if (isNaN(vb)) { fMax.err.textContent = '请输入数字'; fMax.input.classList.add('is-invalid'); return false; }
      if (va >= vb) {
        fMin.err.textContent = 'vMin 应小于 vMax（当前 ' + va + ' ≥ ' + vb + '），否则没法判断流速是否经济';
        fMin.input.classList.add('is-invalid');
        return false;
      }
      return true;
    }

    /** 不合法不写入；合法则两格一起提交（避免半新半旧） */
    function commitVel() {
      if (!checkVel()) return;
      var a = fMin.input.value.trim();
      var b = fMax.input.value.trim();
      if (a !== '') st.vMin = Number(a);
      if (b !== '') st.vMax = Number(b);
      saveNow();
    }
    [fMin, fMax].forEach(function (f) {
      f.input.addEventListener('input', function () { checkVel(); });
      f.input.addEventListener('change', function () { commitVel(); });
    });

    /* —— 服务水头表（1–6 层） —— */
    var hTitle = document.createElement('h3');
    hTitle.className = 'edit-block';
    hTitle.textContent = '服务水头（1–6 层）';
    sec.appendChild(hTitle);

    var headGrid = document.createElement('div');
    headGrid.className = 'form-grid';
    var FLOORS = [1, 2, 3, 4, 5, 6];
    var headFields = {};
    FLOORS.forEach(function (fl) {
      var v = Number(st.serviceHead[fl]);
      var f = numField('第 ' + fl + ' 层服务水头', 'm：让 ' + fl + ' 层住户正常出水的最低压力', isNaN(v) ? 0 : v);
      headFields[fl] = f;
      headGrid.appendChild(f.el);
    });
    sec.appendChild(headGrid);

    /** 服务水头应随层数递增，否则该格行内报错 */
    function checkHeads() {
      var prev = null;
      var ok = true;
      FLOORS.forEach(function (fl) {
        var f = headFields[fl];
        f.err.textContent = '';
        f.input.classList.remove('is-invalid');
        var t = f.input.value.trim();
        if (t === '') return;
        var v = Number(t);
        if (isNaN(v)) {
          f.err.textContent = '请输入数字';
          f.input.classList.add('is-invalid');
          ok = false;
          return;
        }
        if (prev !== null && v <= prev) {
          f.err.textContent = '应大于上一层的 ' + prev + ' m（楼层越高需要压力越大）';
          f.input.classList.add('is-invalid');
          ok = false;
        }
        prev = v;
      });
      return ok;
    }

    function commitHeads() {
      if (!checkHeads()) return;
      FLOORS.forEach(function (fl) {
        var t = headFields[fl].input.value.trim();
        if (t !== '') st.serviceHead[fl] = Number(t);
      });
      saveNow();
    }
    FLOORS.forEach(function (fl) {
      headFields[fl].input.addEventListener('input', function () { checkHeads(); });
      headFields[fl].input.addEventListener('change', function () { commitHeads(); });
    });

    return sec;
  }

  /* ---------- 编辑页 · 校验（状态条 + 问题列表 + 定位） ---------- */

  var vBar = { btn: null, listEl: null, open: false, issues: [] };

  /**
   * 收集问题（纯数据计算，每次数据变更后实时重算）。
   * 每条：{ rule: 1..7, tab: 'nodes'|'pipes', id: 定位用编号或 null, text: 描述 }
   */
  function collectIssues(p) {
    var issues = [];
    if (!p) return issues;
    var nodes = Array.isArray(p.nodes) ? p.nodes : [];
    var pipes = Array.isArray(p.pipes) ? p.pipes : [];

    /* ① 节点编号：空 / 重复（同一编号只报一条） */
    var nodeId = {}, nodeDup = {}, nodeEmpty = 0;
    nodes.forEach(function (n) {
      if (!n || !n.id || !String(n.id).trim()) { nodeEmpty++; return; }
      var k = String(n.id).trim();
      if (nodeId[k]) nodeDup[k] = (nodeDup[k] || 1) + 1;
      else nodeId[k] = true;
    });
    if (nodeEmpty) issues.push({ rule: 1, tab: 'nodes', id: null, text: '有 ' + nodeEmpty + ' 个节点编号为空' });
    Object.keys(nodeDup).forEach(function (k) {
      issues.push({ rule: 1, tab: 'nodes', id: k, text: '节点编号「' + k + '」重复（出现 ' + nodeDup[k] + ' 次）' });
    });

    /* ② 管段编号：空 / 重复 */
    var pipeId = {}, pipeDup = {}, pipeEmpty = 0;
    pipes.forEach(function (q) {
      if (!q || !q.id || !String(q.id).trim()) { pipeEmpty++; return; }
      var k = String(q.id).trim();
      if (pipeId[k]) pipeDup[k] = (pipeDup[k] || 1) + 1;
      else pipeId[k] = true;
    });
    if (pipeEmpty) issues.push({ rule: 2, tab: 'pipes', id: null, text: '有 ' + pipeEmpty + ' 条管段编号为空' });
    Object.keys(pipeDup).forEach(function (k) {
      issues.push({ rule: 2, tab: 'pipes', id: k, text: '管段编号「' + k + '」重复（出现 ' + pipeDup[k] + ' 次）' });
    });

    /* ③ 管段起点/终点不存在，或起点=终点 */
    pipes.forEach(function (q) {
      if (!q) return;
      var label = q.id ? '「' + q.id + '」' : '（无编号）';
      if (!q.from) issues.push({ rule: 3, tab: 'pipes', id: q.id || null, text: '管段' + label + '还没有选起点' });
      else if (!nodeId[q.from]) issues.push({ rule: 3, tab: 'pipes', id: q.id || null, text: '管段' + label + '的起点「' + q.from + '」不存在' });
      if (!q.to) issues.push({ rule: 3, tab: 'pipes', id: q.id || null, text: '管段' + label + '还没有选终点' });
      else if (!nodeId[q.to]) issues.push({ rule: 3, tab: 'pipes', id: q.id || null, text: '管段' + label + '的终点「' + q.to + '」不存在' });
      if (q.from && q.from === q.to) issues.push({ rule: 3, tab: 'pipes', id: q.id || null, text: '管段' + label + '起点和终点都是「' + q.from + '」' });
    });

    /* ④ 数值范围：需水量为负；管长过小或为负、管径/C ≤ 0 */
    nodes.forEach(function (n) {
      if (!n || !n.id) return;
      if (typeof n.demand === 'number' && n.demand < 0) {
        issues.push({ rule: 4, tab: 'nodes', id: n.id, text: '节点「' + n.id + '」需水量为负（' + n.demand + ' L/s）' });
      }
    });
    pipes.forEach(function (q) {
      if (!q || !q.id) return;
      if (typeof q.L === 'number' && q.L <= 0) issues.push({ rule: 4, tab: 'pipes', id: q.id, text: '管段「' + q.id + '」管长 ' + q.L + ' m 无效（必须大于 0）' });
      if (typeof q.D === 'number' && q.D <= 0) issues.push({ rule: 4, tab: 'pipes', id: q.id, text: '管段「' + q.id + '」管径 ' + q.D + ' mm 无效（必须大于 0）' });
      if (typeof q.C === 'number' && q.C <= 0) issues.push({ rule: 4, tab: 'pipes', id: q.id, text: '管段「' + q.id + '」C 值 ' + q.C + ' 无效（必须大于 0）' });
    });

    /* ⑤ 定压节点数量必须恰好 1（0 个或多个都提示） */
    var fixedList = [];
    nodes.forEach(function (n) { if (n && n.fixed) fixedList.push(n); });
    if (nodes.length > 0 && fixedList.length === 0) {
      issues.push({ rule: 5, tab: 'nodes', id: null, text: '还没有定压节点：当前版本只支持一个定压水源，请把水源节点的「是否定压」开关打开' });
    } else if (fixedList.length > 1) {
      var names = [];
      fixedList.forEach(function (n) { if (n.id) names.push(n.id); });
      issues.push({ rule: 5, tab: 'nodes', id: names[0] || null, text: '有 ' + fixedList.length + ' 个定压节点（' + names.join('、') + '）：当前版本只支持一个定压水源，请把多余的定压节点改为普通节点' });
    }

    /* ⑥ 孤立节点（没有任何管段相连，且节点数 > 1） */
    if (nodes.length > 1) {
      var degree = {};
      pipes.forEach(function (q) {
        if (!q) return;
        if (q.from) degree[q.from] = (degree[q.from] || 0) + 1;
        if (q.to) degree[q.to] = (degree[q.to] || 0) + 1;
      });
      nodes.forEach(function (n) {
        if (n && n.id && !degree[n.id]) {
          issues.push({ rule: 6, tab: 'nodes', id: n.id, text: '节点「' + n.id + '」是孤立的（没有任何管段相连）' });
        }
      });
    }

    /* ⑦ 连通性：从定压节点做 BFS，点名列出到不了的节点 */
    if (fixedList.length === 1 && fixedList[0].id) {
      var adj = {};
      pipes.forEach(function (q) {
        if (!q || !q.from || !q.to || q.from === q.to) return;
        if (!nodeId[q.from] || !nodeId[q.to]) return; // 引用悬空的边不参与连通性
        (adj[q.from] = adj[q.from] || []).push(q.to);
        (adj[q.to] = adj[q.to] || []).push(q.from);
      });
      var visited = {};
      var queue = [fixedList[0].id];
      visited[fixedList[0].id] = true;
      while (queue.length) {
        var cur = queue.shift();
        (adj[cur] || []).forEach(function (nb) {
          if (!visited[nb]) { visited[nb] = true; queue.push(nb); }
        });
      }
      var lost = [];
      nodes.forEach(function (n) {
        if (n && n.id && nodeId[n.id] && !visited[n.id]) lost.push(n.id);
      });
      if (lost.length) {
        issues.push({ rule: 7, tab: 'nodes', id: lost[0], text: '节点 ' + lost.join('、') + ' 无法到达水源，管网不连通' });
      }
    }

    /* 同一个问题只报一条（按规则+描述去重） */
    var uniq = [], seenKey = {};
    issues.forEach(function (iss) {
      var k = iss.rule + '|' + iss.text;
      if (seenKey[k]) return;
      seenKey[k] = true;
      uniq.push(iss);
    });

    return uniq;
  }

  /** 渲染问题列表（可收起，不占满屏幕） */
  function renderVList() {
    var list = vBar.listEl;
    if (!list) return;
    list.innerHTML = '';
    var RULE_CHAR = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
    vBar.issues.forEach(function (iss) {
      var item = document.createElement('div');
      item.className = 'v-item';
      var rule = document.createElement('span');
      rule.className = 'v-rule';
      rule.textContent = RULE_CHAR[iss.rule - 1] || '·';
      var txt = document.createElement('span');
      txt.className = 'v-text';
      txt.textContent = iss.text;
      item.appendChild(rule);
      item.appendChild(txt);
      if (iss.id) {
        var loc = document.createElement('button');
        loc.type = 'button';
        loc.className = 'v-locate';
        loc.textContent = '定位';
        loc.addEventListener('click', function () { locateIssue(iss); });
        item.appendChild(loc);
      }
      list.appendChild(item);
    });
  }

  /** 状态条：无问题绿色、有问题红色；每次数据变更实时重算。 */
  function refreshVBar(project) {
    if (!vBar.btn || !project) return;
    var issues = collectIssues(project);
    vBar.issues = issues;
    var ok = issues.length === 0;
    vBar.btn.className = 'v-status ' + (ok ? 'is-ok' : 'is-bad');
    vBar.btn.innerHTML = ok
      ? '<span class="v-dot"></span><span>数据检查通过，可以进行计算</span>'
      : '<span class="v-dot"></span><span>发现 ' + issues.length + ' 个问题</span><span class="v-caret">展开 ▾</span>';
    if (ok) { vBar.open = false; }
    if (vBar.open) {
      renderVList();
      vBar.listEl.style.display = '';
      var caret = vBar.btn.querySelector('.v-caret');
      if (caret) caret.textContent = '收起 ▴';
    } else {
      vBar.listEl.style.display = 'none';
    }
  }

  /** 点「定位」：跳到对应分区、滚动到那一行并闪烁高亮 1.5 秒。 */
  function locateIssue(iss) {
    editTab = iss.tab;
    render();
    setTimeout(function () {
      var tbody = document.querySelector('.grid-table tbody');
      if (!tbody) return;
      var trs = tbody.querySelectorAll('tr');
      var idCol = iss.tab === 'nodes' ? '1' : '0';
      var row = null;
      for (var i = 0; i < trs.length; i++) {
        var inp = trs[i].querySelector('input[data-c="' + idCol + '"]');
        if (inp && inp.value === iss.id) { row = trs[i]; break; }
      }
      if (!row) return;
      row.classList.add('row-flash');
      try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 老浏览器忽略 */ }
      setTimeout(function () { row.classList.remove('row-flash'); }, 1500);
    }, 80);
  }

  /* ==================== 启动 ==================== */

  function boot() {
    root = document.getElementById('app');
    if (!root) return;
    root.className = 'app-shell';
    window.addEventListener('hashchange', render);

    // 白话解释小圆点：点一下展开，点别处收起（事件委托，重渲染后依然有效）
    root.addEventListener('click', function (ev) {
      var dot = ev.target && ev.target.closest ? ev.target.closest('.info-dot') : null;
      var opened = root.querySelectorAll('.info-dot.is-open');
      Array.prototype.forEach.call(opened, function (d) { if (d !== dot) d.classList.remove('is-open'); });
      if (dot) {
        ev.preventDefault();
        dot.classList.toggle('is-open');
      }
    });

    render();
  }

  WC.app = { boot: boot };

  boot(); // script 位于 body 末尾，此时 DOM 已就绪
})(window.WC = window.WC || {});
