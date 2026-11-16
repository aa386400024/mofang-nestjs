# WP-J P2 · 专业级标注工具（admin-dashboard 内嵌）（给 MiniMax 的任务单）

> **状态：✅ 后端已交付（2026-11-10）** —— 后端部分（`quality_annotation` 表 + migration + 五个 admin 端点 + 锚点清单幂等导入 + 一致性纯函数）已交付并过闸门；**前端三栏标注页归主 Agent**（`admin-dashboard/` 本单未碰）。
> **交付记录**：[`completed/phase2.5/wp-j-p2-annotation-calibration-implementation-2026-11-10.md`](./wp-j-p2-annotation-calibration-implementation-2026-11-10.md)

- 日期：2026-11-10
- 上游依据：`docs/worklog/pending/phase2.5-wp-j-p2-visitor-quality-v1-2026-11-10.md`
- 基线 HEAD：`212611a`（分支 `integrate`）
- 上一版思路（终端 annotation-console）作废，改 admin-dashboard 内嵌页面。

## 0. 背景

P2 v1 量出：停滞/危机/探索阈值是工程种子值，需人工标注 30 场锚点来校准。标注工具要让大炮在浏览器里点选完成，专业标注工具体验。

## 1. 已核实的仓库事实（照着接，不要另造）

- 逐字稿是**文件存储**：`src/admin-debug/debug-session-store.ts`（node:fs 读写 JSON，`readFile/readdir/writeFile`）。标注工具**复用这个 store 的读路径**取消息，不要自己扫目录。
- anchor 清单：`data/quality/anchor-sample-30.csv`（30 行，表头 `debug_session_id,character_slug,attachment_style,turns,first_exploration_turn,dominant_label,crisis_peak_level`，后三列空）。
- 逐字稿 JSON 可能在 `data/debug-sessions/`（57）或 `data/archives/debug-sessions-baseline-20261109/`（500）——store 已处理路径解析。
- 自动指标脚本：`scripts/ops/quality/visitor-quality-audit.ts`。
- admin 鉴权：跟现有 admin 端点同模式（Basic Auth）。

## 2. 你做什么（全栈，三部分）

### 2.1 迁移 + 实体
- 新表 `quality_annotation`：`id, debug_session_id (唯一), character_slug, attachment_style, first_exploration_turn (int null), dominant_label (varchar null), crisis_peak_level (int 0-3, 默认 0), should_end_turn (int null), annotator, notes (text null), created_at, updated_at`。
- 一次性导入 anchor-sample-30.csv 的 30 行进表（脚本或 service 启动幂等导入）。

### 2.2 后端 admin 端点
- `GET /admin/quality/annotations?status=pending|done|all`：列表 + 进度（已标/总数）。
- `GET /admin/quality/annotations/:id`：单条详情 + 该场逐字稿（复用 debug-session-store 读路径；**只返双方台词数组，不返 traces/kernelState**）。
- `PUT /admin/quality/annotations/:id`：保存三列标注。
- `GET /admin/quality/annotations/:id/reveal`：保存后才调用——返回自动判定结果（自动探索轮次/自动主导标签/自动危机档位），供对照（**双盲：标之前不返回**）。
- `GET /admin/quality/consistency`：一致性报告（30 场标完后才有意义）——人工三列 vs `visitor-quality-audit.ts` 自动口径的混淆矩阵：标签一致率、危机档位一致率、探索轮次偏差 MAE。

### 2.3 前端标注页面（**你不做**，归主 Agent）
admin-dashboard 的三栏标注页面由主 Agent 后续实现。你只需要把 **API 契约**定稳并按上面 §2.2 的端点形状交付，不要碰 `admin-dashboard/` 目录。前端约定：
- 列表/详情/保存/reveal/一致性五个端点的请求响应 JSON 形状写进交付记录，主 Agent 照此对接。
- CORS / 鉴权头跟现有 admin 前端调用方式一致。

## 3. 红线

- **不动** `src/engine-core/**`、`practice-runner.service.ts`、`counselor-agent.service.ts`。
- 心理内容（台词）不进日志 / crash report。
- 标注本身由大炮点，你不预填标注列。
- 你自己跑闸门：`npx tsc -p tsconfig.build.json --noEmit`、`npx eslint`（改动文件）、`npx vitest run`（基线 4 failed admin-debug，不许新增失败），数字写进交付记录。

## 4. 交付物

- migration + entity + admin service/controller（**后端 only，不碰 admin-dashboard/**）
- anchor CSV 导入逻辑（幂等）
- 单测（一致性计算的纯函数）
- 交付记录写 `docs/worklog/completed/phase2.5/`，附五个端点的请求/响应 JSON 契约
