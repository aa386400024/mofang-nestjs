# AF-503 · 优化 auto-practice 调试面板纵向密度与 BDI 长滚动（交付记录）

- 任务：AF-503
- 日期：2026-11-25
- 分支：task/AF-503-auto-practice-bdi
- 基线：a64abcc948965cea5913eb57b7dca46f7c89d787
- 范围：admin-dashboard 前端 + 交付文档；后端契约与 engine-core 未改

## 1. 本次结论

auto-practice 调试面板的图表已经统一使用 ECharts（`echarts/core` + `vue-echarts` 的 `VChart`），没有新增图表库，也没有用原生 SVG 画业务图表。BDI 雷达、历史趋势、效价趋势都是 ECharts；效价双极位置条和阻抗进度条属于读数条，不是图表。

BDI 面板此前把雷达、数值标签、效价、阻抗、移情、核心信念、Δ、两条趋势图全部纵向堆叠，单项高度超过右栏可用高度。本次改为“默认本轮 + 独立走势子视图”，把默认视图压缩到雷达、关键数值、效价摘要即可读完，细节按需展开，趋势单独切换查看。

## 2. 改动文件

- `admin-dashboard/src/components/BdiStatePanel.vue`
- `admin-dashboard/src/components/DebugTracePanel.vue`
- `admin-dashboard/src/views/AutoPractice.vue`
- 本交付记录与 AF-503 任务记录

## 3. 关键实现

### 3.1 BDI 默认视图不再长滚动

- 顶部增加固定的 `本轮 / 走势` 子视图切换，面板头 sticky，滚动时轮次与切换入口不消失。
- 本轮视图改为两栏自适应网格：左侧雷达 160px，右侧紧凑数值区（信任 / 安全感 / 联结 / 唤醒 / 阻抗话量），替代原来的标签行 + 底部重复数值明细。
- 效价改为紧凑双极条，保留 -1~+1 语义，不再占一整块高度。
- 阻抗三维、移情三态、核心信念、本轮 Δ 默认收进“状态细节”折叠区；折叠时用摘要 chip 保留关键值（阻抗、移情、信念峰值、Δ 最大），不把信息藏死。
- 细节展开后使用 `repeat(auto-fit, minmax(180px, 1fr))` 自适应网格，宽栏时两列、窄栏时单列，避免固定宽度溢出。

### 3.2 趋势合并为一张 ECharts 双轴图

- 原“历史趋势 160px + 效价趋势 110px”合并为一张 250px ECharts 折线图。
- 左轴固定 0~1，承载 trust / safety / bond / arousal / 阻抗话量；右轴固定 -1~1，承载 valence。
- 效价使用右轴虚线系列，保留独立双极语义，不混进 0~1 轴。
- 选中轮 markLine 保留；点击趋势点继续触发 `select-turn`，交互不回退。

### 3.3 调试面板滚动与去重

- `DebugTracePanel` 的 `NTabs` 改为 `h-full min-h-0 flex flex-col`，所有 `NTabPane` 加 `min-h-0 overflow-auto`，tab 栏固定、内容区单独滚动。
- 删除 BDI tab 底部重复的“数值明细（0~1）”块；关键数值只在 BdiStatePanel 本轮紧凑区出现一次。
- AutoPractice 右侧面板与调试面板容器增加 `overflow-hidden`，把滚动约束在面板内部，不再撑高页面。
- 长 prompt、完整 JSON、deliberation trace 继续各自限高/折叠，不改变既有行为。

## 4. 验证结果

- `pnpm --dir admin-dashboard type-check`：exit 0。
- `pnpm --dir admin-dashboard build-only`：exit 0；4721 modules transformed；2.68s。
- `pnpm lint`：exit 0。
- `pnpm typecheck`：exit 0。
- `pnpm test`：exit 0；335 个测试文件通过 / 1 skipped；4955 个用例通过 / 4 skipped。
- `git diff --stat HEAD -- src/engine-core`：空输出。

## 5. 与任务单的偏差

- 无功能性偏差。
- 任务单只要求“优化 BDI 长滚动”，实现时同时收紧了 DebugTracePanel 的统一滚动容器并删除重复数值块；两者都属于同一可读性问题，未触碰后端与 engine-core。

## 6. 遗留

- `SessionDetail.vue` 仍使用旧的 `BdiTrajectoryChart.vue`，其所有序列共用 -1~1 轴；该页面不在 auto-practice 调试面板范围，本次未改。
- 成本看板缓存命中率聚合、gateDecision 后端接入仍属于后端能力，继续由既有 backlog / AF-481 队列承接，未在本任务处理。
