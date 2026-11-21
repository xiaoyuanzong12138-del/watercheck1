/* ============================================================
   store.js · 工程数据层
   ------------------------------------------------------------
   所有数据只存 localStorage（键名 wc.projects.v1），不联网不上传。
   schema 固定 watercheck/v1；每次写操作都会刷新 updatedAt。
   公共接口：loadAll / get / save / create / remove / duplicate /
             exportJSON / downloadJSON / importJSON / validate
   ------------------------------------------------------------
   全局约定：唯一暴露 window.WC，公共接口挂 WC.store。
   ============================================================ */
(function (WC) {
  'use strict';

  var LS_KEY = 'wc.projects.v1';
  var SCHEMA = 'watercheck/v1';
  var NODE_KINDS = ['source', 'junction', 'building'];
  var lastPersistOk = true; // 最近一次写入 localStorage 是否成功（供界面提示）

  /* ---------- 内部工具 ---------- */

  function nowTs() { return new Date().toISOString(); }

  function genId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* 极少数环境不可用时走下方兜底 */ }
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function indexOf(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return i;
    }
    return -1;
  }

  function shallowCopy(o) {
    var c = {};
    for (var k in o) {
      if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k];
    }
    return c;
  }

  function sanitizeFileName(name) {
    return String(name == null ? '' : name).replace(/[\\\/:*?"<>|]/g, '_');
  }

  /* ---------- 读 / 写 ---------- */

  function loadAll() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return []; // 本地数据损坏时按空处理，不让页面崩掉
    }
  }

  /** 写入 localStorage；不可用或配额满时返回 false，不抛异常。 */
  function persist(list) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list));
      lastPersistOk = true;
      return true;
    } catch (e) {
      lastPersistOk = false;
      return false;
    }
  }

  /** 最近一次写入是否成功（页面据此显示「存储不可用」横幅）。 */
  function persistOk() { return lastPersistOk; }

  function get(id) {
    var list = loadAll();
    var i = indexOf(list, id);
    return i >= 0 ? list[i] : null;
  }

  /** 新建或更新工程（按 id 判断），写操作刷新 updatedAt。 */
  function save(project) {
    if (!project || typeof project !== 'object') throw new Error('save：无效的工程对象');
    var list = loadAll();
    var p = shallowCopy(project);
    p.schema = SCHEMA;
    p.updatedAt = nowTs();
    if (!p.createdAt) p.createdAt = p.updatedAt;
    // nodes/pipes 深拷贝后再存，避免与外部引用共享、被后续修改污染
    if (Array.isArray(p.nodes)) p.nodes = JSON.parse(JSON.stringify(p.nodes));
    if (Array.isArray(p.pipes)) p.pipes = JSON.parse(JSON.stringify(p.pipes));
    var i = indexOf(list, p.id);
    if (i >= 0) list[i] = p; else list.push(p);
    persist(list);
    return p;
  }

  /** 新建空白工程（含默认设置）。 */
  function create(name) {
    return save({
      schema: SCHEMA,
      id: genId(),
      name: name,
      water: { population: 0, quota: 0, kh: 0, mode: 'calc' },
      nodes: [],
      pipes: [],
      settings: {
        vMin: 0.6,
        vMax: 1.4,
        serviceHead: { 1: 10, 2: 12, 3: 16, 4: 20, 5: 24, 6: 28 }
      }
    });
  }

  function remove(id) {
    var list = loadAll();
    var next = [];
    var removed = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { removed = true; continue; }
      next.push(list[i]);
    }
    if (removed) persist(next);
    return removed;
  }

  function duplicate(id) {
    var src = get(id);
    if (!src) return null;
    var copy = JSON.parse(JSON.stringify(src)); // 深拷贝，双保险（结构里已无函数/日期）
    copy.id = genId();
    copy.name = src.name + ' 副本';
    delete copy.createdAt;
    delete copy.updatedAt;
    return save(copy);
  }

  /* ---------- 导出 / 导入 ---------- */

  function exportJSON(project) {
    return JSON.stringify(project, null, 2);
  }

  /** 把工程导出成 .json 文件下载（浏览器直接保存到本地）。 */
  function downloadJSON(project) {
    if (!project) return;
    var fileName = '水压体检-' + sanitizeFileName(project.name || project.id) + '.json';
    var blob = new Blob([exportJSON(project)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function importJSON(text) {
    var p;
    try {
      p = JSON.parse(text);
    } catch (e) {
      throw new Error('不是有效的 JSON 文件');
    }
    var errs = validate(p);
    if (errs.length) throw new Error('工程数据不合法：' + errs.join('；'));
    if (!p.id || indexOf(loadAll(), p.id) >= 0) p.id = genId(); // 防止覆盖已有工程
    return save(p);
  }

  /* ---------- 校验 ---------- */

  /**
   * 校验工程对象，返回错误信息数组（空数组 = 合法）。
   * 新建工程的空 nodes/pipes 属于合法状态。
   */
  function validate(p) {
    var errs = [];
    if (!p || typeof p !== 'object') return ['不是有效的工程对象'];

    if (p.schema !== SCHEMA) errs.push('schema 应为 ' + SCHEMA + '，实际是 ' + JSON.stringify(p.schema));
    if (typeof p.name !== 'string' || !p.name.trim()) errs.push('工程名(name)不能为空');
    if (!Array.isArray(p.nodes)) errs.push('nodes 必须是数组（节点列表）');
    if (!Array.isArray(p.pipes)) errs.push('pipes 必须是数组（管段列表）');

    if (Array.isArray(p.nodes)) {
      var nodeIds = {};
      for (var i = 0; i < p.nodes.length; i++) {
        var n = p.nodes[i];
        var nLabel = (n && n.id) ? '节点「' + n.id + '」' : '第 ' + (i + 1) + ' 个节点';
        if (!n || typeof n !== 'object') { errs.push(nLabel + '：不是有效对象'); continue; }
        if (!n.id) errs.push(nLabel + '：缺少 id');
        else if (nodeIds[n.id]) errs.push(nLabel + '：id 重复');
        else nodeIds[n.id] = true;
        if (NODE_KINDS.indexOf(n.kind) < 0) errs.push(nLabel + '：kind 必须是 source/junction/building 之一');
        if (typeof n.elev !== 'number') errs.push(nLabel + '：缺少地面标高 elev(米)');
        if (typeof n.demand !== 'number') errs.push(nLabel + '：缺少用水量 demand(升/秒)');
      }
      if (Array.isArray(p.pipes)) {
        for (var j = 0; j < p.pipes.length; j++) {
          var e = p.pipes[j];
          var eLabel = (e && e.id) ? '管段「' + e.id + '」' : '第 ' + (j + 1) + ' 条管段';
          if (!e || typeof e !== 'object') { errs.push(eLabel + '：不是有效对象'); continue; }
          if (!e.from || !nodeIds[e.from]) errs.push(eLabel + '：起点 ' + JSON.stringify(e.from) + ' 不存在');
          if (!e.to || !nodeIds[e.to]) errs.push(eLabel + '：终点 ' + JSON.stringify(e.to) + ' 不存在');
          if (!(typeof e.L === 'number' && e.L > 0)) errs.push(eLabel + '：管长 L(米) 必须是正数');
          if (!(typeof e.D === 'number' && e.D > 0)) errs.push(eLabel + '：管径 D(毫米) 必须是正数');
          if (typeof e.C !== 'number') errs.push(eLabel + '：缺少海曾-威廉系数 C（管子内壁光滑程度）');
        }
      }
    }
    return errs;
  }

  /* ---------- 暴露公共接口 ---------- */

  WC.store = {
    LS_KEY: LS_KEY,
    SCHEMA: SCHEMA,
    loadAll: loadAll,
    get: get,
    save: save,
    create: create,
    remove: remove,
    duplicate: duplicate,
    exportJSON: exportJSON,
    downloadJSON: downloadJSON,
    importJSON: importJSON,
    validate: validate,
    persistOk: persistOk
  };
})(window.WC = window.WC || {});
