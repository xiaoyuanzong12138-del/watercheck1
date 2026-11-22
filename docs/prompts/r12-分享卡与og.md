现在只做一件事：分享卡片图（浏览器里生成 PNG 下载）+ 微信转发用的 OG 元信息。不动其他页面与逻辑。

【一、分享卡片生成器】
入口：体检页结论卡右上角加一个小按钮「生成分享图」（375px 下放在结论下方、通栏）。
点击后**在浏览器里**用 Canvas 现场绘制一张 1200×1500 的 PNG，然后直接下载，文件名「水压体检-<工程名>.png」。不引第三方库、不跳转、不弹窗。

卡片内容（自上而下）：
1. 顶部：小字「水压体检 WaterCheck」+ 右上角一行灰色小字「2026-11-22」；
2. 主标题（64px 加粗）：工程名，例如「幸福里小区」；
3. 结论大字（88px 加粗，红色 #DC2626 或绿色 #0E9F6E）：例如「6 层只能供到 2 层」；
   下方一行 32px 灰字：例如「最不利点 L4 · 自由水压 13.9 m」；
4. 迷你剖面楼（居中，宽 260、高 320）：只画 6 个楼层矩形 + 一根立管；有水段蓝色、无水段虚线；供到的那一层画绿线；
5. 三行关键数字（各 32px，左标签右值）：
   入口压力 18.0 m ｜ 服务水头 28 m ｜ 缺口 14.1 m
   数字全部实时取当前求解结果；若某值为空则该行不画；
6. 底部：一行 28px「https://xiaoyuanzong12138-del.github.io/watercheck1/」，右侧小字「扫码或打开链接，30 秒算出你家能供到几层」。

绘制要求：
- canvas 尺寸 1200×1500，`devicePixelRatio` 缩放不做额外放大（导出固定 1200×1500）；
- 背景白色，四周 80px 留白，卡片内圆角不加阴影；
- 中文字体用 `system-ui, "PingFang SC", "Microsoft YaHei"`，先 `document.fonts.ready` 再绘制，避免字体未就绪；
- 红色/绿色与网页一致；无水楼层灰 #CBD5E1。

【二、OG / 微信转发卡片】
在 index.html 的 <head> 里加（不要删掉现有 meta）：
  <meta property="og:type" content="website">
  <meta property="og:title" content="水压体检 · 算清你家能供到几层">
  <meta property="og:description" content="给水管网水力体检：说清哪栋楼只能供到第几层、为什么，给出加压/换管方案的前后对比。">
  <meta property="og:url" content="https://xiaoyuanzong12138-del.github.io/watercheck1/">
  <meta property="og:image" content="https://xiaoyuanzong12138-del.github.io/watercheck1/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
说明：og.png 由我随后放进仓库根目录，你只要把标签写对、路径写对。

【硬要求】
1. 不引第三方库；不改求解；不动首页各段；
2. 375px 下按钮通栏、点一次能下载到 PNG；
3. 生成失败（如 Canvas 不可用）时提示「当前浏览器不支持生成图片」，不白屏；
4. 卡片上任何数字不许写死，全部来自当前结果。

【验收】
□ 点「生成分享图」能下载 1200×1500 的 PNG，文件名含工程名
□ 卡片上结论、三个数字与页面一致（2 层 / 18.0 / 28 / 14.1）
□ 迷你楼的供到层数与页面剖面图一致
□ 375px 下可正常生成并下载
□ view-source 或 DevTools 能看到 6 个 og/twitter meta 标签，og:image 路径正确
改完贴：生成的分享图 PNG + 桌面/375px 按钮截图 + 上述 5 条。