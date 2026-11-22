# L2 编排看板升级 · P1/P2/P3 只读视图回填 — 交付记录

- **状态**：✅ 快照层 + 前端视图落地（2026-11-15，本机闸门全绿；定向测试 22 passed）
- **基线 HEAD**：`eaf19c9`（与 `origin/integrate` 一致）
- **提交方式**：工作区改动待提交；按仓库 §2.4 纪律本单不自动 commit / push，草稿见 §六

---

## 一、本单做了什么（一句话）

工具链演进后，把新增能力回填到 `web/orchestration/` 只读看板：P1 前端补 backlog 状态 / frozen 标记 / 台账两维分布；P2 快照扩台账条目明细 + 交付包清单段；P3 Agent Card 与工具契约声明纳入快照与视图。

---

## 二、改动文件清单

### 2.1 快照层（`scripts/orchestration/`）

| 文件                               | 改动                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state-store.mjs`                  | PATHS 增 `agentCardsDir` / `toolsContractFile`；补 `readdirSync` 导入；新增 `listDeliveryPacks(limit)`、`loadAgentCards()`、`loadToolContracts()` 与 `safeReadJson` 容错；目录 / 文件缺失或单文件损坏返回空数组，不阻断快照 |
| `improvement-log.mjs`              | `summarizeLog` 返回增 `items[]` 只读投影（编号 / 状态 / 来源 / 类型 / 层级 / 关联任务 / 证据 / 影响 / 建议 / `historyCount` / 末次流转）；注释更新为“汇总 + 只读视图投影”                                                   |
| `scheduler.mjs`                    | `buildSnapshot` return 增 `deliveryPacks` / `agentCards` / `toolContracts` 三段；import 三个新辅助                                                                                                                          |
| `__tests__/orchestration.spec.mjs` | `summarizeLog` items 字段断言；`buildSnapshot` 三段数组结构容错断言                                                                                                                                                         |

### 2.2 前端（`web/orchestration/`）

| 文件         | 改动                                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html` | 台账 meta 文案更新为“网页只读投影”；新增 Agent Card / 工具契约 / 交付包三列 panel-grid                                                                                                                                                                                                                        |
| `app.js`     | 字典补 backlog、SOURCE / TYPE / LAYER / 台账状态标签；overview `order` 加入 backlog；任务详情补 frozen 冻结行；`renderImprovements` 重写（状态汇总 + byType / bySource 分布 + items 明细列表）；新增 `renderDeliveryPacks` / `renderAgentCards` / `renderToolContracts`；`renderEmpty` 清空新容器并接入初始化 |
| `styles.css` | `.cards` 改 auto-fit `minmax`；新增 `.tags` / `.tag` / `.imp-list` 标签与明细间距样式                                                                                                                                                                                                                         |

### 2.3 快照产物（CLI 双写刷新）

| 文件                                                        | 改动                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `docs/team/agent-orchestration/orchestration-snapshot.json` | 刷新：新增 `deliveryPacks` / `agentCards` / `toolContracts` 段；`improvements.items` 明细 |
| `web/orchestration/data.js`                                 | 前端数据同步刷新（与 snapshot 同批 CLI 生成）                                             |

### 2.4 上一轮遗留并入本单

| 文件                                 | 改动                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `scripts/orchestration/open-web.mjs` | 新增跨平台一键打开看板脚本（win32 / darwin / linux 调系统默认浏览器）      |
| `package.json`                       | scripts 增 `orchestration:web` → `node scripts/orchestration/open-web.mjs` |

### 2.5 零改动确认

- `src/engine-core/`、`src/migration/`、`src/**/*.ts` 业务代码、整个 `test/` 目录 —— **零 diff**（`git diff --name-only` 计数：engine-core 0 / migration 0 / 非编排 src 0）
- **未引入新第三方包**；**未升级任何依赖版本**
- 快照只增字段，既有字段不删（向后兼容）

### 2.6 显式排除的未跟踪产物（不纳入本单 stage）

- `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`（Judge Layer 备忘，并行线产物，零 src 改动）

---

## 三、差距与处置（P1 / P2 / P3）

### P1 纯前端（快照已有数据）

- backlog 状态无中文标签、概览缺卡片 → `STATUS_LABEL` 与 overview `order` 补 backlog
- frozen 字段未展示 → 任务详情补冻结标记行
- 台账 `byType` / `bySource` 分布快照已有、网页未渲染 → 补两条分布行

### P2 快照层配合

- 台账仅汇总计数、无条目明细 → `summarizeLog.items` 投影进快照
- 快照无交付包段 → `listDeliveryPacks` 清单（文件名 / 生成时间 / 四类计数，倒序最近 10 条，不复制包正文）

### P3 设计决策纳入视图

- Agent Card、工具契约声明件未建模进快照 → `loadAgentCards` / `loadToolContracts` 只读投影进快照与对应面板

---

## 四、闸门证据

| 命令                                                                          | 退出码 | 结果                                                                     |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `pnpm typecheck`（`tsc -b tsconfig.check.json`）                              | 0      | 0 error                                                                  |
| `pnpm lint`（`eslint --cache`）                                               | 0      | 0 warning / 0 error                                                      |
| `pnpm lint:fast`（`oxlint src test bin`）                                     | 0      | 0 warning / 0 error，1350 文件                                           |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 22 passed（原 21 + 新增 1）                                              |
| `node --check web/orchestration/app.js`                                       | 0      | 语法通过                                                                 |
| 编码探测                                                                      | —      | 改动文件均 `bom=False`、`cr=0`；snapshot.json 与 data.js JSON 双解析通过 |

- **未重跑全量**：改动不进入 `src/test` 运行时，沿用基线 **3381 例 / 201 文件（4 skipped）**。
- **快照实测**：cards=3、tools=6、items=3、packs=0（delivery-packs 目录为空，容错返回空数组正确）。

---

## 五、遗留与未决

- **P-DEBT-21 / IM-003**：prod **5 moderate** 传递依赖升级；受 P-DEBT-4 约束（版本变动须附全量绿跑 + 墙钟数字），本单不实施。
- **AF-005 ~ AF-008**：backlog 排期；自治模式是否开启。
- **V3 上线清理清单**：`src/sample`、`foobar`、样品 entity、passport demo 链路、`prompts` / `rimraf` / `@types/prompts` 孤儿依赖。
- **IM-002 终态 `done`**：当前 accepted，待本单归档提交后由编排者闸门流转。

---

## 六、提交草稿（按 §2.4 不自动执行）

合并单 commit 建议：

```
feat(orchestration): backfill dashboard views for task states, ledger items, delivery packs and agent/tool contracts

- P1: backlog status label/card, frozen marker, ledger by-type/by-source distribution
- P2: snapshot adds ledger item projections and delivery pack index
- P3: snapshot and view add agent cards and tool contracts from declaration files
- chore: orchestration:web script and cross-platform open-web launcher

Scope: scripts/orchestration, web/orchestration, declaration docs read-only; zero src/engine-core, src/migration, business code diff.
```

Stage 清单（排除 phase3 未跟踪文件）：

- `scripts/orchestration/state-store.mjs`、`improvement-log.mjs`、`scheduler.mjs`、`__tests__/orchestration.spec.mjs`、`open-web.mjs`
- `web/orchestration/index.html`、`app.js`、`styles.css`、`data.js`
- `docs/team/agent-orchestration/orchestration-snapshot.json`
- `package.json`
