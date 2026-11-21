/* ============================================================
   samples.js · 示例工程（只读模板）
   ------------------------------------------------------------
   4 个典型场景，自带完整 water/nodes/pipes/settings 数据。
   示例永不被修改：打开时只读，点「复制为我的工程」才在
   store 里生成可编辑副本。
   ------------------------------------------------------------
   全局约定：唯一暴露 window.WC，数据挂 WC.samples。
   ============================================================ */
(function (WC) {
  'use strict';

  function ND(id, kind, demand, elev, opts) {
    opts = opts || {};
    return {
      id: id, kind: kind, demand: demand, elev: elev,
      fixed: !!opts.fixed, head: opts.head || 0,
      building: opts.building || undefined
    };
  }
  function PP(id, from, to, L, D, C) {
    return { id: id, from: from, to: to, L: L, D: D, C: C };
  }
  function water(population, quota, kh) {
    return { population: population, quota: quota, kh: kh, mode: 'calc' };
  }
  function settings() {
    return { vMin: 0.6, vMax: 1.4, serviceHead: { 1: 10, 2: 12, 3: 16, 4: 20, 5: 24, 6: 28 } };
  }

  /* —— 示例 1：幸福里 · 6 层老小区，市政直供（1 个环） —— */
  var s1 = {
    id: 'sample-liuceng-muzhi',
    title: '6 层老小区 · 市政直供',
    intro: '最有代表性的场景：6 层楼直接接市政管网（城市供水主管），不加水泵，看看水压够供到几层。',
    water: water(1200, 160, 1.8),
    nodes: [
      ND('S', 'source', 0, 0, { fixed: true, head: 18 }),
      ND('J1', 'junction', 0, 0), ND('J2', 'junction', 0, 0), ND('J3', 'junction', 0, 0),
      ND('L1', 'building', 0.6667, 0, { building: { floors: 6, households: 48, people: 200 } }),
      ND('L2', 'building', 0.6667, 0, { building: { floors: 6, households: 48, people: 200 } }),
      ND('L3', 'building', 0.6667, 0, { building: { floors: 6, households: 48, people: 200 } }),
      ND('L4', 'building', 0.6667, 0, { building: { floors: 6, households: 48, people: 200 } }),
      ND('L5', 'building', 0.6667, 0, { building: { floors: 6, households: 48, people: 200 } }),
      ND('L6', 'building', 0.6667, 0, { building: { floors: 6, households: 48, people: 200 } })
    ],
    pipes: [
      PP('M1', 'S', 'J1', 60, 80, 90),
      PP('M2', 'J1', 'J2', 120, 80, 90),
      PP('M3', 'J2', 'J3', 110, 80, 90),
      PP('M4', 'J3', 'J1', 130, 80, 90),
      PP('B1', 'J1', 'L1', 20, 40, 90),
      PP('B2', 'J1', 'L2', 25, 40, 90),
      PP('B3', 'J2', 'L3', 30, 40, 90),
      PP('B4', 'J2', 'L4', 40, 32, 90),
      PP('B5', 'J3', 'L5', 30, 40, 90),
      PP('B6', 'J3', 'L6', 35, 32, 90)
    ],
    settings: settings()
  };

  /* —— 示例 2：高层小区 · 顶层断水（枝状立管） —— */
  var s2 = {
    id: 'sample-gaoceng-bengfang',
    title: '高层小区 · 顶层断水',
    intro: '18 层高层只靠市政压力会怎样？顶层水压 −26 m，根本出不来水。看体检怎么加压。',
    water: water(600, 160, 2.0),
    nodes: [
      ND('S', 'source', 0, 0, { fixed: true, head: 28 }),
      ND('J', 'junction', 0, 0)
    ],
    pipes: [
      PP('M0', 'S', 'J', 80, 100, 120)
    ],
    settings: settings()
  };
  // 三栋 A/B/C，每栋 5 个立管节点（6/9/12/15/18 层），隔层取水
  ['A', 'B', 'C'].forEach(function (b) {
    [[6, 18, 0.247], [9, 27, 0], [12, 36, 0.247], [15, 45, 0], [18, 54, 0.247]].forEach(function (pt) {
      s2.nodes.push(ND(b + pt[0], 'building', pt[2], pt[1], {
        building: { floors: 18, households: 60, people: 200 }
      }));
    });
    s2.pipes.push(PP('L' + b + '1', 'J', b + '6', 30, 65, 120));
    s2.pipes.push(PP('L' + b + '2', b + '6', b + '9', 9, 50, 120));
    s2.pipes.push(PP('L' + b + '3', b + '9', b + '12', 9, 50, 120));
    s2.pipes.push(PP('L' + b + '4', b + '12', b + '15', 9, 50, 120));
    s2.pipes.push(PP('L' + b + '5', b + '15', b + '18', 9, 50, 120));
  });

  /* —— 示例 3：城镇管网 · 环状平差演示（2 个环） —— */
  var s3 = {
    id: 'sample-huanzhuang-pingcha',
    title: '环状管网 · 平差演示',
    intro: '教科书级环状网：一个水源、两个大环、8 个出流点，看哈代-克罗斯平差（反复修正流量直到环闭合）怎么收敛。',
    water: water(100000, 335, 1.4),
    nodes: [
      ND('S', 'source', 0, 8, { fixed: true, head: 68 }),
      ND('1', 'junction', 120, 12), ND('2', 'junction', 150, 14),
      ND('3', 'junction', 130, 16), ND('4', 'junction', 110, 18),
      ND('5', 'junction', 100, 16), ND('6', 'junction', 80, 13),
      ND('7', 'junction', 50, 20), ND('8', 'junction', 50, 19)
    ],
    pipes: [
      PP('G1', 'S', '1', 800, 1000, 130),
      PP('R1', '1', '2', 600, 800, 130),
      PP('R2', '2', '3', 500, 600, 130),
      PP('R3', '3', '4', 600, 400, 130),
      PP('R4', '4', '5', 500, 350, 130),
      PP('R5', '5', '6', 600, 350, 130),
      PP('R6', '6', '1', 700, 500, 130),
      PP('C1', '2', '5', 500, 450, 130),
      PP('B1', '3', '7', 400, 300, 130),
      PP('B2', '4', '8', 400, 300, 130)
    ],
    settings: settings()
  };

  /* —— 示例 4：别墅区 · 枝状管网（0 环） —— */
  var s4 = {
    id: 'sample-bieshu-zhizhuang',
    title: '别墅区 · 枝状管网',
    intro: '一源多枝、没有环路：枝状管网不用平差，流量一遍就能定下来，适合验证「能供几层」。',
    water: water(36, 300, 2.5),
    nodes: [
      ND('S', 'source', 0, 0, { fixed: true, head: 30 }),
      ND('J1', 'junction', 0, 0), ND('J2', 'junction', 0, 1),
      ND('J3', 'junction', 0, 2), ND('J4', 'junction', 0, 2),
      ND('A1', 'building', 0.0521, 0.5, { building: { floors: 3, households: 2, people: 6 } }),
      ND('A2', 'building', 0.0521, 0.5, { building: { floors: 3, households: 2, people: 6 } }),
      ND('B1', 'building', 0.0521, 1, { building: { floors: 3, households: 2, people: 6 } }),
      ND('B2', 'building', 0.0521, 1, { building: { floors: 3, households: 2, people: 6 } }),
      ND('C1', 'building', 0.0521, 2, { building: { floors: 3, households: 2, people: 6 } }),
      ND('C2', 'building', 0.0521, 2, { building: { floors: 3, households: 2, people: 6 } })
    ],
    pipes: [
      PP('T1', 'S', 'J1', 300, 65, 130),
      PP('T2', 'J1', 'J2', 250, 50, 130),
      PP('T3', 'J2', 'J3', 250, 40, 130),
      PP('T4', 'J3', 'J4', 200, 40, 130),
      PP('H1', 'J1', 'A1', 120, 32, 130),
      PP('H2', 'J1', 'A2', 100, 32, 130),
      PP('H3', 'J2', 'B1', 120, 32, 130),
      PP('H4', 'J2', 'B2', 180, 25, 130),
      PP('H5', 'J3', 'C1', 200, 25, 130),
      PP('H6', 'J4', 'C2', 250, 25, 130)
    ],
    settings: settings()
  };

  WC.samples = {
    list: [s1, s2, s3, s4],
    byId: function (id) {
      for (var i = 0; i < this.list.length; i++) {
        if (this.list[i].id === id) return this.list[i];
      }
      return null;
    }
  };
})(window.WC = window.WC || {});
