现在只做这一件事：把 4 个示例工程填上真实数据 + 实现管网图 + 在工程页接上「开始体检」。不要做体检结论文案，也不要先解释计划。

【一、samples.js 填真实数据】给 4 个示例补上完整 project 字段（water/nodes/pipes/settings），id 和标题保持不变。

=== 示例1 sample-liuceng-muzhi「6 层老小区 · 市政直供」===
water: population 1200, quota 160, kh 1.8
nodes:
S  source   demand 0      elev 0  fixed true  head 18
J1 junction demand 0      elev 0
J2 junction demand 0      elev 0
J3 junction demand 0      elev 0
L1..L6 building demand 0.6667 elev 0 building{floors:6, households:48, people:200}
pipes（C 全部 90）:
M1 S-J1 L60 D80 | M2 J1-J2 L120 D80 | M3 J2-J3 L110 D80 | M4 J3-J1 L130 D80
B1 J1-L1 L20 D40 | B2 J1-L2 L25 D40 | B3 J2-L3 L30 D40 | B4 J2-L4 L40 D32 | B5 J3-L5 L30 D40 | B6 J3-L6 L35 D32

=== 示例2 sample-gaoceng-bengfang「高层小区 · 顶层断水」===
water: population 600, quota 160, kh 2.0
nodes: S source fixed head 28 elev 0; J junction elev 0;
三栋 A/B/C，每栋五个点：b6 elev 18 demand 0.247 / b9 elev 27 demand 0 / b12 elev 36 demand 0.247 / b15 elev 45 demand 0 / b18 elev 54 demand 0.247（b 取 A/B/C）
pipes（C 全部 120）: M0 S-J L80 D100; 每栋 L{b}1 J→b6 L30 D65, L{b}2 b6→b9 L9 D50, L{b}3 b9→b12 L9 D50, L{b}4 b12→b15 L9 D50, L{b}5 b15→b18 L9 D50

=== 示例3 sample-huanzhuang-pingcha「环状管网 · 平差演示」===
water: population 100000, quota 335, kh 1.4
nodes: S source fixed head 68 elev 8; 1(120,12) 2(150,14) 3(130,16) 4(110,18) 5(100,16) 6(80,13) 7(50,20) 8(50,19)
pipes（C 全部 130）: G1 S-1 L800 D1000 | R1 1-2 L600 D800 | R2 2-3 L500 D600 | R3 3-4 L600 D400 | R4 4-5 L500 D350
R5 5-6 L600 D350 | R6 6-1 L700 D500 | C1 2-5 L500 D450 | B1 3-7 L400 D300 | B2 4-8 L400 D300

=== 示例4 sample-bieshu-zhizhuang「别墅区 · 枝状管网」===
water: population 36, quota 300, kh 2.5
nodes: S source fixed head 30 elev 0; J1 elev 0; J2 elev 1; J3 elev 2; J4 elev 2;
A1 elev 0.5 · A2 elev 0.5 · B1 elev 1 · B2 elev 1 · C1 elev 2 · C2 elev 2，这 6 个 building 节点 demand 各 0.0521，building{floors:3, households:2, people:6}
pipes（C 全部 130）: T1 S-J1 L300 D65 | T2 J1-J2 L250 D50 | T3 J2-J3 L250 D40 | T4 J3-J4 L200 D40
H1 J1-A1 L120 D32 | H2 J1-A2 L100 D32 | H3 J2-B1 L120 D32 | H4 J2-B2 L180 D25 | H5 J3-C1 L200 D25 | H6 J4-C2 L250 D25

settings 全部用默认：vMin 0.6 / vMax 1.4 / 服务水头 10,12,16,20,24,28。

【二、ui/network-map.js 管网图渲染】
接口：WC.ui.networkMap.render(container, project, result) → 返回 SVG 元素；纯渲染，不改数据，可重复调用（先清空容器）。

布局（必须确定性，同一工程每次布局一致）：
1. 从定压节点 BFS 算每节点跳数 d；按 d 分层，层内保持 BFS 访问顺序。
2. 画布 viewBox 0 0 1000 620；第 d 层的 x = 90 + d × (820 / maxD)；层内第 i 个（共 n 个）的 y = 70 + (i + 0.5) × (480 / n)。
3. 做 30 次松弛：任意两节点距离小于 58 就沿连线方向各推开一半；松弛后仍保持同一层的节点 x 相同。

节点画法：
- 水源：双层圆（外 r14 描边 #0B63CE、内 r7 实心），下方标签「市政 18 m」
- 普通节点：圆 r9，白底、描边 #0B63CE、内部写编号（字号 11）
- 楼栋：矩形 26×32 圆角 3 + 顶部小三角屋顶；填充按状态：可服务层数 ≥ 实际层数 → #0E9F6E；差 1 层 → #D97706；差 ≥2 层 → #DC2626；无计算结果 → #98A6B5；楼栋旁两行小字：编号 / 「3/6 层」
管段画法：
- stroke-width = 1.6 + 3.4 × (|q| / maxQ)，颜色按流速：<0.5 #94A3B8；0.5–1.4 #38A3E0；>1.4 #D97706
- 中点上方 8px 小字：管径（如 DN80）+ 流量（如 1.3 L/s），字号 10，颜色 #5A6B7D
- 箭头用 marker，指向上游→下游（q > 0 从 from 指向 to，q < 0 反向）；无结果时不画箭头
交互与辅助：
- hover 节点/管段 → 跟随鼠标的 tooltip（节点：编号/标高/水压/能上几层；管段：编号/起点→终点/DN/L/Q/v/h/1000i）
- 点击节点 → 回调 onSelectNode(id)，页面右侧显示详情卡
- 右下角图例：四色块 + 文字（达标 / 差1层 / 差2层以上 / 无数据）
- 右上角两个按钮：放大/缩小（scale 0.6–2.5，只缩 SVG 内容不改布局）、导出 SVG
- 容器为空或数据为空时显示居中文案「还没有管网数据」

【三、工程页接上计算】#/project/:id：
1. 顶部「开始体检」按钮 → 校验（复用 collectIssues）→ 有问题就展示问题列表并禁用计算；无问题才调 WC.solver.solve(project)。
2. 算完在页面上显示：迭代次数、最大环闭合差、最大连续性残差、总需水量、以及管网图（带颜色）。
3. 计算失败（如不连通）要显示明确错误，不要白屏。
4. 结果先做最小呈现即可（一行指标卡 + 图），结论文案下一轮做。

自测（真实点击）：
□ 四个示例都能打开并算出结果，迭代次数分别为 3 / 1 / 7 / 0（幸福里、高层、城镇、别墅；别墅是枝状 0 环）
□ 幸福里最低水压 13.88 m，L4 楼栋显示红色「3/6 层」这种量级（按可服务层数公式算）
□ 高层示例 18F 节点水压为负，楼栋显示红色
□ 城镇示例迭代 7 次、R1 流量 533.2 L/s
□ 同一工程反复进出，节点位置不变（布局确定性）
□ hover 有 tooltip，点击节点有详情卡
□ 375px 下图能完整显示（可横向滚动或自适应缩放）
□ 导出 SVG 能下载且能被浏览器打开
改完贴代码要点 + 四个示例的截图 + 上面 8 条实测结果。