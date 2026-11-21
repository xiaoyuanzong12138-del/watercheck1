# 水压体检 WaterCheck

给水管网水力体检工具：录入小区管网 → 环状管网平差（Hardy-Cross）→ 算出每栋楼能供到第几层 → 给出加压/换管建议与前后对比。

- 纯静态网页，零构建、无后端、不联网；双击 `index.html` 即可本地使用
- 数据只存在浏览器 localStorage，不上传任何服务器
- 专业模式：完整平差结果表、环闭合差、收敛曲线，可导出计算书

## 本地打开

双击 `index.html`（Chrome / Edge / Safari 均可）。数值自检页：`tests.html`。

## 文件

| 文件 | 说明 |
|---|---|
| index.html | 入口，按顺序加载 5 个脚本 |
| styles.css | 设计系统与页面样式 |
| solver.js | 环状管网平差求解内核（纯函数） |
| samples.js | 4 个示例工程数据 |
| store.js | localStorage 数据层 |
| ui/network-map.js | 管网图 SVG 渲染 |
| app.js | 路由与全部页面 |
| tests.html | 浏览器内数值自检（数据层 + 求解内核） |
