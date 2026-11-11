# REVIEW-3 · WP-N 标注批次前后端契约类型对齐复核（只读审计；前端类型缺口才修）

> 状态：✅ 已交付（2026-11-11）→ [交付记录](review3-wpn-contract-alignment-2026-11-11.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/team/quality-annotation-batch-api-contract.md`（7 路由 + 1 CLI）；`admin-dashboard/src/api/types.ts`；`admin-dashboard/src/api/client.ts`；`docs/worklog/completed/phase2.5/wp-n-fe-annotation-batch-ui-implementation-2026-11-11.md`
> 任务性质：纯验证（契约对照审计；仅当发现前端类型缺口时，才在 `admin-dashboard/` 内做最小类型修复）
> 改动范围：默认纯后端只读核对；如授权修复，仅 `admin-dashboard/src/api/` 类型 / client（后端 `src/` 本单零改动）

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md`；2. `docs/README.md`；3. `docs/team/conventions.md`（§1.2 前端边界、§1.1 内核边界）
2. 阶段入口：`phase2.5-README.md`；事实源：契约 md 全文 + WP-N-FE 交付记录
3. 本任务单

---

## 1. 背景（先读，方向别错）

WP-N 交付时浏览器三路径已回归，但阶段 README 仍标「前后端契约类型对齐待复核」。本单把契约文档的请求 / 响应形状与前端 `types.ts` / `client.ts` 逐条对照，确认字段名、可空性、枚举取值、查询参数（含 `includeInvalid`）与契约一致；只在发现前端类型与契约脱节时做最小修复。

### 关键现状（已核对，别当新问题）

- 契约端点：`/admin/api/quality/batches`、`/annotations`、`/annotations/:ref`、`PUT /annotations/:ref`、`/reveal`、`/auto`、`/consistency`（契约 §1.1）；`:ref` 语义见 §1.2；legacy 分母口径见 §2.7；三种前端态见 §三；`includeInvalid=1` 见 §四。
- 前端类型集中在 `admin-dashboard/src/api/types.ts`，请求封装在 `admin-dashboard/src/api/client.ts`。
- **既有前端类型债基线**：前端工程存在改动前就有的 vue-tsc 错误（WP-N-FE 交付记录记 **51 条**，分散在其他视图 / 组件；涉文件数以现场 `pnpm type-check` 复跑为准）；WP-N-FE 改动文件 0 错误。本单新增改动必须 0 错误，既有债隔离记录、不在本单清理（conventions §5.3 口径）。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

1. **逐端点对照**：按契约 §2.1–§2.7 逐条核对 `types.ts` 对应 interface / type 与 `client.ts` 请求函数：
   - 字段名与层级一致；可选字段（`?`）与契约可空性一致；枚举联合类型与契约取值一致（如 `level: 'pass'|'warn'|'block'`、annotation `type: 'good'|'warn'|'error'`）；
   - 查询参数（批次口径、`includeInvalid`、批次 id 等）与契约 §四一致；
   - 响应包裹形状（列表 / 分页 / 单条 / 一致性报告）与契约一致。
2. **缺口处置分级**：
   - 类型缺字段 / 错可空 / 枚举漂移 → 最小修复 `admin-dashboard/src/api/types.ts`（必要时 `client.ts` 参数透传）；
   - 契约文档与后端实现不符 → 不改前端适配错误后端，只在交付记录登记契约待修订条目；
   - 视图组件消费了类型外字段 → 记录为后续前端条目，不在本单重构组件。
3. 输出对照表：端点 × 契约形状 × 前端类型 × 一致 / 缺口 / 处置。

**明确不在范围内（禁止顺手做）：**

- 不改后端 `src/` 任何控制器 / DTO / service；不新加后端端点。
- 不重构 Vue 组件、不改交互与样式；不碰 Flutter。
- 不清理既有前端 vue-tsc 债（只记录基线数字）；不跑后端 lint-staged 扫前端。
- 不碰 DB / migration / prompt / engine-core；`boundary.spec.ts` 不许改。
- 不自动 commit / push。

---

## 3. 目标架构 / 交付物

- **交付物 1：对照审计记录** —— 交付记录 §1 端点对照表（一致 / 缺口 / 处置）；§2 发现的前后端不一致清单与定性。
- **交付物 2：前端类型最小修复（仅当有缺口）** —— `admin-dashboard/src/api/types.ts`（+ 必要时 `client.ts`）；只补类型与参数透传，不动运行时业务逻辑。
- **交付物 3：前端闸门证据** —— 在 `admin-dashboard/` 目录跑其自带 `pnpm type-check`（vue-tsc --build）与 `pnpm build-only`；记录「本单新增改动 0 错误」与「既有债 N 条（改动前基线）」两组数字。

> **口径真相源**：字段 / 枚举 / 可空性唯一真相源 = 契约 md（后端 active spec）；前端类型是消费侧投影，不另抄判定口径。

---

## 4. 红线（违反即返工）

- 前端边界：只在任务单授权的 `admin-dashboard/src/api/` 内改类型；前端闸门在前端目录跑，不套用后端 eslint / tsc 规则。
- 既有债隔离：新增文件 / 新增改动 0 错误；既有债数字单独记录，不记为本单引入。
- 后端 `src/` 零改动；`git diff --stat HEAD -- src/engine-core` 为空。
- 不把后端判定阈值 / 口径复制进前端复算；不自动 commit/push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范：一律 pnpm，禁止裸 npx。

### 5.1 日常内循环

- 后端无改动：无需后端定向测试。
- 前端改动时：`admin-dashboard/` 内 `pnpm type-check`；视图层不跑后端 vitest。

### 5.2 收尾全量闸门

| 闸门        | 命令                                            | 要求                                                   |
| ----------- | ----------------------------------------------- | ------------------------------------------------------ |
| 后端类型    | `pnpm exec tsc -p tsconfig.build.json --noEmit` | 0 error（确认后端 src 未改）                           |
| 后端 Lint   | `pnpm lint`                                     | 0 error，记 warning 数                                 |
| 后端测试    | `pnpm test`                                     | 全绿，记用例总数（基线 2947：2942 passed + 4 skipped） |
| 前端类型    | `cd admin-dashboard && pnpm type-check`         | 本单新增改动 0 错误；既有债 N 条单独记录               |
| 前端构建    | `cd admin-dashboard && pnpm build-only`         | 通过                                                   |
| engine-core | `git diff --stat HEAD -- src/engine-core`       | 空                                                     |

---

## 6. 交付记录（路径固定）

`docs/worklog/completed/phase2.5/review3-wpn-contract-alignment-2026-11-11.md`

1. 一句话总结；2. 端点对照表；3. 缺口清单与处置（修了哪些类型 / 哪些登记后续）；4. 改动文件清单；5. 闸门表真实数字（后端三组 + 前端两组，既有债基线单列）；6. 回归风险；7. 遗留项（契约待修订条目、组件层后续条目）。

---

## 7. 【交付回写清单】做完逐项勾选

- [ ] 交付记录已写到 §6 路径
- [ ] 任务单移到 `completed/phase2.5/`，状态 `✅` 并链接记录
- [ ] 回写 wp-list / README 阶段表中「类型对齐待复核」条目
- [ ] 若修了前端类型：回写 WP-N-FE 交付记录或 backlog 指针
- [ ] `git diff --stat HEAD -- src/engine-core` 为空；后端 src 无改动
- [ ] 提交分组核对：后端文档组 / 前端 api 组分开 stage，不混提
- [ ] commit message 草稿（不自己 commit/push）

---

## 8. 回复输出约定

1. 「已写入交付记录」+ 路径；2. 闸门真实数字（后端 + 前端分开报）；3. §7 进度与遗留；4. 不贴 diff 全文。
