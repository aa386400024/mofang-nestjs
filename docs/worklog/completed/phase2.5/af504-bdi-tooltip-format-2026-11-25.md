# AF-504 · 修复 BDI ECharts tooltip 浮点长尾（交付记录）

- 任务：AF-504
- 日期：2026-11-25
- 分支：task/AF-504-bdi-tooltip-format
- 基线：6b39b3a3e93e7e2f542c25063db432345d9c46d7
- 范围：admin-dashboard 前端展示层 + 交付文档；后端契约与 engine-core 未改

## 1. 本次结论

BDI 雷达图和走势图的 hover tooltip 之前没有自定义 formatter，ECharts 直接把 IEEE 浮点原值渲染出来，出现 `0.6895000000000001` 这类长尾。本次在 `BdiStatePanel.vue` 给两个 tooltip 都接了自定义 formatter，展示精度统一为 2 位小数：0~1 指标直接两位小数，效价使用带符号两位小数，缺失值显示“—”。数据链路、trace JSON 导出精度（仍为 4 位）和图表交互均未改。

## 2. 改动文件

- `admin-dashboard/src/components/BdiStatePanel.vue`
- 本交付记录与 AF-504 任务记录

## 3. 关键实现

### 3.1 雷达 tooltip

- `radarOption.tooltip` 增加自定义 formatter，按雷达维度顺序读取 `params.value` 数组。
- 每一项显示“维度名 + 两位小数”，复用 `formatMetric(value, 2)`，不出现原始浮点长尾。
- tooltip 标题保留“第 N 轮”，深色背景、边框、字号沿用原样式。

### 3.2 走势 tooltip

- `trendOption.tooltip` 增加自定义 formatter，按轴触发返回的 series 列表逐项渲染。
- 0~1 维度（trust / safety / bond / arousal / 阻抗话量）走 `formatMetric(value, 2)`；效价（右轴）走 `formatSigned(value, 2)`，正数带 `+`。
- 缺失值 `null` 显示“—”，不补 0。
- 标题取当前 hover 轮次（`dataIndex` 对应的 `turnIndex`），保留系列颜色 marker，不丢图例对应关系。

### 3.3 边界控制

- 只改 tooltip 展示层，未改雷达/折线数据、轴范围、markLine、点击切轮逻辑。
- 未改 `trace-format.ts` 的 JSON 4 位精度，面板卡片仍为 2 位；tooltip 与卡片口径一致。
- 未引入新图表库，未新增日志。

## 4. 验证结果

- `pnpm --dir admin-dashboard type-check`：exit 0。
- `pnpm --dir admin-dashboard build-only`：exit 0；4721 modules transformed；2.53s。
- `pnpm lint`：exit 0。
- `pnpm typecheck`：exit 0。
- `pnpm test`：exit 0；335 个测试文件通过 / 1 skipped；4955 个用例通过 / 4 skipped；29.76s。
- `git diff --stat HEAD -- src/engine-core`：空输出。
- 未做浏览器 hover 截图验证；类型检查与生产构建通过，格式化函数已有单测覆盖基础行为。

## 5. 与任务单的偏差

- 无功能性偏差。
- 走势 tooltip 额外显示轮次标题和系列 marker，属于同一可读性目标内的增强，未扩大范围。

## 6. 遗留

- `SessionDetail.vue` 的旧 `BdiTrajectoryChart.vue` 未接入本次 tooltip 格式化；该页面不在 auto-practice 调试面板范围，继续由既有前端 backlog 承接。
- 其他看板（CostBoard / BatchTrend 等）如也有浮点 tooltip 长尾，需另开任务按同一口径处理，本次未顺手改。
