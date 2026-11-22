现在只做这一件事：实现求解内核 solver.js + 数值自检页 tests.html。不要动界面、不要画管网图，也不要先解释计划。

【solver.js 算法，严格按此实现，不要自行改算法】
入口：WC.solver.solve(project) → 结果对象；纯函数，不改输入。
输入约定：nodes:[{id,demand(L/s),elev(m),fixed,head}]，pipes:[{id,from,to,L(m),D(mm),C}]，opts:{eps=1e-7,maxIter=300}。

1. 单位换算：demand/1000 → m³/s；D/1000 → m。
2. 阻力系数 R = 10.67·L / (C^1.852·D^4.87)；水头损失 h(Q) = R·Q·|Q|^0.852（海澄-威廉，n=1.852）。
3. 找唯一定压节点；从它做 BFS 建生成树。有节点到不了 → throw new Error('管网不连通：节点 X1、X2 无法到达定压节点')。
4. 基本环路：每条非树边（余枝）+ 树上两端到最近公共祖先(LCA)的路径构成一个独立环；环数 = 管段数 − 节点数 + 1。每个环记下 [{pipeIndex, sign}] 序列，sign 为该管段在环内的方向（+1/−1）。
5. 初分流量：按生成树自叶向根累加子树需水量，树边流量 = 该子树需水量之和；余枝流量取 0。这样天然满足全部节点连续性。
6. 迭代（每轮遍历所有环）：对每个环算 Σ(sign·h) 与 Σ|h/Q|，ΔQ = −Σ(sign·h) / (1.852·Σ|h/Q|)，把 sign·ΔQ 累加回该环每条管段；记录本轮 max|ΔQ|；收敛条件 max|ΔQ| < eps 或迭代到 maxIter。注意 |h/Q| 在 Q=0 时按 0 处理并跳过该环。
7. 节点水头：从定压节点沿生成树推进 H_to = H_from − h；若管段方向与树方向相反则取负。
8. 输出：
   pipes: [{id,from,to,L,D,C,q,qLs,v,h,i1000}]   // i1000 = |h|/L×1000；v = q/(πD²/4)，D 用米
   nodes: [{id,demand,elev,fixed,head,pressure}]  // pressure = head − elev
   cycles: [{index,pipes:[id],residual}]          // residual = Σ(sign·h)，应在 1e-6 量级
   continuity: [{id,residual(L/s)}]                // 非定压节点；定压节点给 supplied(L/s)
   iterations、converged、maxLoopResidual(m)、maxContinuity(L/s)、totalDemand(L/s)、history:[{iter,maxDQ}]
9. 边界：环数为 0（枝状管网）要能正常算；单管段单节点要报明确错误；节点数或管段数为 0 报「请先录入节点和管段」。
10. 性能：50 节点 / 80 管段在 100ms 内出结果。

【tests.html 数值自检页】
扩展现有的 tests.html，加一段「求解内核」自检，跑三个算例并逐项对比期望值，PASS 绿 / FAIL 红，显示实际值与差值。必须全部 PASS：

算例A 教科书小网：5 节点 6 管段 2 环
  节点 A(fixed,100,elev0) 1(20,5) 2(25,6) 3(30,7) 4(15,8)
  管段 P1 A-1 L500 D400 C130 | P2 1-2 L600 D300 | P3 2-3 L600 D250 | P4 3-4 L500 D200 | P5 1-4 L800 D250 | P6 2-4 L700 D200
  期望：迭代 13；P1 = 90.00 L/s；节点1 自由水压 94.35 m；最大环闭合差 < 1e-5；连续性残差 < 1e-6

算例B 城镇管网：9 节点 10 管段 2 环
  S(fixed,68,elev8) 1(120,12) 2(150,14) 3(130,16) 4(110,18) 5(100,16) 6(80,13) 7(50,20) 8(50,19)
  G1 S-1 L800 D1000 | R1 1-2 L600 D800 | R2 2-3 L500 D600 | R3 3-4 L600 D400 | R4 4-5 L500 D350
  R5 5-6 L600 D350 | R6 6-1 L700 D500 | C1 2-5 L500 D450 | B1 3-7 L400 D300 | B2 4-8 L400 D300  （C 全部 130）
  期望：迭代 7；R1 = 533.2 L/s；节点8 自由水压 45.48 m

算例C 幸福里小区：10 节点 10 管段 1 环
  S(fixed,18,elev0) J1 J2 J3 (junction, 0) L1..L6 (building, demand 0.667, elev 0)
  M1 S-J1 L60 D80 | M2 J1-J2 L120 D80 | M3 J2-J3 L110 D80 | M4 J3-J1 L130 D80
  B1 J1-L1 L20 D40 | B2 J1-L2 L25 D40 | B3 J2-L3 L30 D40 | B4 J2-L4 L40 D32 | B5 J3-L5 L30 D40 | B6 J3-L6 L35 D32  （C 全部 90）
  期望：最低自由水压 13.88 m（在 L4），总需水 4.0 L/s

容差：流量 ±0.05 L/s，水压 ±0.05 m，迭代次数 ±0。

自测并贴出：三个算例每项的 实际值 / 期望值 / 差值，以及 tests.html 的通过计数（应全 PASS）。如果对不上，先自己按上面 10 条排查，把排查过程写出来，不要直接改期望值。