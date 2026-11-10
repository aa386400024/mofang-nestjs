# WP-J P1b · 自动对练危机指标落库 —— 实现交付记录

> 任务单：[`wp-j-p1b-crisis-metrics-persist-task-2026-11-10.md`](./wp-j-p1b-crisis-metrics-persist-task-2026-11-10.md)
> 日期：2026-11-10
> 基线 HEAD：`212611a`（分支 `integrate`）
> 状态：✅ 已交付（**后端 only**；前端不动 —— admin-dashboard 的 TS 类型由主 Agent 同步）
> 范围声明：**未碰** `src/engine-core/**`（红线）、`src/admin-debug/**`、`admin-dashboard/**`（前端）、`quality_annotation` 表、`ap_practice_batches` 表。

---

## 一、改了哪些文件

### 新增

| 文件 | 职责 |
|---|---|
| `src/migration/1714900000042-AddCrisisMetricsToPracticeSessions.ts` | 手写幂等 DDL：`ap_practice_sessions` 加 6 个危机练习窗指标列（`information_schema` 守卫 + 干净 down） |
| `test/auto-practice/crisis-metrics-persist.spec.ts` | 单测 6 例（成功路径 / 失败路径 / 二次升级 / WS payload / 列表 `include=crisis` / 详情） |

### 改动

| 文件 | 改了什么 |
|---|---|
| `src/auto-practice/entities/practice-session.entity.ts` | ① `crisis_ended` 列注释补"四种合法组合"对照表；② 追加 6 列（`crisis_practiced` / `crisis_first_turn` / `crisis_post_turns` / `crisis_peak_level` / `crisis_category` / `crisis_escalated`）；③ 文件头补本轮背景与"老行 ≠ 没练过"说明 |
| `src/auto-practice/practice-runner.service.ts` | ① `updateSessionResult` 入参类型加 6 个字段；② 调用处从 `metrics` 传入（布尔量转 0/1）；③ `endPayload` 补 4 个危机字段 |
| `src/auto-practice/auto-practice.events.ts` | `AutoPracticeSessionEndPayload` 补 4 个**可选**字段（`crisisFirstTurn` / `crisisPeakLevel` / `crisisCategory` / `crisisEscalated`） |
| `src/auto-practice/auto-practice.controller.ts` | ① 场次列表加 `?include=crisis`（默认剥掉 6 列）；② 单场详情注释说明"始终带 6 列"；③ 新增模块级 `toListItem` + `CRISIS_METRIC_KEYS` |
| `bin/ormconfig.ts` | ① import；② `migrations[]` 登记 0042（**真注册点**，漏登记会静默不建列） |
| `src/migration/index.ts` | 导出 `AddCrisisMetricsToPracticeSessions1714900000042`（与 ormconfig 严格 1:1） |

### 明确**没有**碰

- `src/engine-core/**`（BDI 决策内核，红线）—— 本单是纯落库层
- `admin-dashboard/**`（前端归主 Agent）
- `quality_annotation` 表与 `src/quality/**`（WP-J P2 的人工标注侧，另单）
- `ap_practice_batches` 表与 `practice-batch-health.service.ts`（批次聚合后续用 GROUP BY 算，不冗余落库 —— 任务单 §4.4）
- 6 个新列**不加索引**（低基数 tinyint，加了意义不大）
- **未回填历史数据**（任何回填都是替历史编数据）

---

## 二、6 个新列的口径

| DB 列 | 实体字段 | 类型 | 语义 | 老行的 0 / NULL 意味着 |
|---|---|---|---|---|
| `crisis_practiced` | `crisisPracticed` | TINYINT NOT NULL DEFAULT 0 | 是否进过**危机后置练习窗** | **"P1a 上线前跑的场次，没这个数据"** —— 不等于"没练过危机" |
| `crisis_first_turn` | `crisisFirstTurn` | INT NULL | 危机**首次披露**轮次（从 1 起） | 没披露过 / 没数据 |
| `crisis_post_turns` | `crisisPostTurns` | INT NOT NULL DEFAULT 0 | 危机窗内**实际完成**的练习轮数 | 没数据 |
| `crisis_peak_level` | `crisisPeakLevel` | INT NOT NULL DEFAULT 0 | 危机**强度峰值**档 0~3（规则自动判） | 没数据 |
| `crisis_category` | `crisisCategory` | VARCHAR(64) NULL | 危机类别（内核枚举值，**非自由文本**） | 没披露过 / 没数据 |
| `crisis_escalated` | `crisisEscalated` | TINYINT NOT NULL DEFAULT 0 | 是否发生"强度上升"型二次升级 | 没数据 |

落库的只有**数字 / 枚举**，**零台词**（隐私红线 AGENTS.md §5.4）。

---

## 三、关键设计决策（与任务单 / 仓库事实有出入的地方）

### B1 · 两个 tinyint 用 `number`（0/1），**不是** `boolean`

- **任务单怎么写的**（§2.1）：`crisisPracticed!: boolean` / `crisisEscalated!: boolean`。
- **仓库事实是什么**：mysql 驱动的 `tinyint` 读回来就是**数字**（仓库里 `ap_counselor_modes.enabled` 也是 `number`，前端 `AutoPractice.vue` 判的是 `crisisEnded === 1`）。
- **怎么改的**：实体类型用 `number`（0/1），落库时 `metrics.crisisPracticed ? 1 : 0`。
- **为什么**：写 `boolean` 会让**类型撒谎** —— TS 说 `true/false`，运行时与 JSON 里都是 `0/1`，前端按布尔用就静默出错（`0` 是 falsy，`1` 是 truthy，恰好能用，但类型骗人）。跟着仓库既有口径走，不发明第二套。

### B2 · 老数据不回填，且"0 ≠ 没练过"的语义写进列注释

- **怎么改的**：migration **不写任何 UPDATE**；5 个非空列由 DB DEFAULT 自动填 0，两个可空列留 NULL。
- **为什么**：历史场次是 P1a 之前跑的，引擎当时**根本没统计**这些指标 —— 任何回填都是替历史编数据。语义（"没数据" ≠ "当时没问题"）写进**实体列注释**和**迁移文件头**，因为看代码的人不一定读迁移。

### B3 · `crisis_ended` 与 `crisis_practiced` 是两个独立信号（四种组合都合法）

| 组合 | 含义 |
|---|---|
| `c_ended=0 c_practiced=0` | 没危机 |
| `c_ended=0 c_practiced=1` | 进了窗、正常收尾（**理想情况**） |
| `c_ended=1 c_practiced=1` | 进了窗，但强度二次升级仍终止（协议没救回来） |
| `c_ended=1 c_practiced=0` | **P1a 之前的老数据**：直接因危机掉线，从没进过窗 |

- **怎么改的**：`crisis_ended` 列**一字未动**（值与语义都不改）；两种信号的对照表写进该列注释。
- **为什么**：后人会写 `WHERE crisis_ended=1 AND crisis_practiced=0` 去查"掉了线的危机场"—— 那会**把老数据当新 bug**。对照表就地写在列上，查的人一眼看见。

### B4 · 与 `quality_annotation.crisis_peak_level` 语义相反，**只对照不 join**

- **两处同名列**：
  - `ap_practice_sessions.crisis_peak_level` = **规则自动判**的危机档（引擎结论）；
  - `quality_annotation.crisis_peak_level` = **人工标**的危机档（WP-J P2 校准用）。
- **怎么改的**：实体列注释里写清区别；两表**不做 join**。
- **为什么**：两张表都有这一列，join 上去就把"人工标"和"规则判"混成同一个真相 —— 而下游要的正是"人工 vs 自动"的**对照一致率**（任务单 §下游用途）。混在一起就测不出校准效果了。

### B5 · WS payload 用 boolean，库里用 0/1（两套载体、两套表示）

- **怎么改的**：`AutoPracticeSessionEndPayload.crisisPracticed` 保持 `boolean`（既有契约）；库里那两列是 0/1。
- **为什么**：WS 面向前端实时渲染，库里面向查询与统计。两处各自跟自己的载体一致，不强行统一 —— 统一要动既有 WS 契约（超出本单范围）。

### B6 · 场次列表默认**不带** 6 列，`?include=crisis` 才带；`crisis_ended` 一直在

- **怎么改的**：列表把 6 个危机列剥掉（`toListItem`）；单场详情**始终**带（返的是实体行，新列自动在内）。
- **为什么**：列表是分页扫的，指标列多了会膨胀；"显式要的东西才给"。但 `crisis_ended` **不能剥** —— 前端 `AutoPractice.vue` 用 `crisisEnded === 1` 判"这场因危机掉线"，剥了它前端就瞎了。

### B7 · migration 用 `information_schema` 守卫（MySQL 5.7 无 `ADD COLUMN IF NOT EXISTS`）

- **怎么改的**：照 0039 的既有范式（`existingColumns()` 查 `INFORMATION_SCHEMA.COLUMNS`，缺才 `ALTER TABLE ADD COLUMN`）；`AFTER crisis_ended` 锚点缺失时退回"追加到表尾"，免得 ALTER 因锚点缺失失败。
- **down()**：只 drop 这 6 列，**`crisis_ended` 不动**，不写 `DROP TABLE`。

### B8 · 任务单写的 `npx tsc --noEmit` **不是本仓可用的闸门**

- **仓库事实**：根 `tsconfig.json` 不含 vitest 全局类型、也不解析 `typings/global` 引用 → 全仓 **7514 个既有错误**（`bin/*.ts`、`src/**/*.spec.ts` 等），与本单无关。
- **本仓真正的类型闸门**：`npx tsc -p tsconfig.build.json --noEmit`（**0 error**）—— 测试文件不在构建配置里。
- **本单的自律**：即便如此，我仍把**本次新增的测试文件**在根 tsconfig 下修到 **0 错误**（顺手修了 `CounselorHistoryTurn` 导入源、`closeRequested` 必填字段、`update` 替身签名三处）。
- **顺带发现（未改，不属本单范围）**：`test/auto-practice/practice-runner.spec.ts` / `practice-runner-cost.spec.ts` 有同类既有错误 —— `CounselorReply.closeRequested` 变成必填后，老 spec 的 mock 没跟上。

### B9 · 失败路径写的是 `emptyMetrics()` 默认值，**不是 undefined**

- **怎么改的**：失败路径走 `metrics = emptyMetrics()`，落库写入 `0 / null / 0 / 0 / null / 0`。
- **为什么**：`undefined` 会被 TypeORM 当成"这列不写" → 列保持旧值。老行保持 0 反而是对的（"没测到"）。单测专门断言"一个都不能是 undefined"。

---

## 四、闸门（本次自跑，数字不空）

| # | 命令 | exit | error | warning | 用例数 | 结论 |
|---|---|---|---|---|---|---|
| 1 | `npx tsc -p tsconfig.build.json --noEmit` | **0** | **0** | —— | —— | ✅ 仓库标准类型闸门 |
| 2 | `npx tsc --noEmit`（任务单字面） | 2 | **7514（全仓既有）** | —— | —— | ⚠️ **该命令在本仓不可用**（见 B8）；**本次改动文件命中 0 条** |
| 3 | `npx eslint "src/auto-practice/**/*.ts" "src/migration/1714900000042*"`（+ 本单测试文件） | **0** | **0** | **0** | —— | ✅ |
| 4 | `npx vitest run test/auto-practice` | **0** | 0 | —— | **6 files / 70 tests** 全绿 | ✅ |
| 5 | `npx vitest run`（全量） | 1 | **0 新增** | —— | **4 failed \| 158 passed \| 5 skipped (167)**；Tests **4 failed \| 2663 passed \| 19 skipped (2686)** | ✅ 4 failed 全部是**基线既有** admin-debug 失败 |
| 6 | `git diff --stat HEAD -- src/engine-core` | —— | —— | —— | —— | ✅ **空**（红线未破） |
| 7 | migration 实跑（见下） | **0** | 0 | —— | —— | ✅ `SHOW COLUMNS ... LIKE 'crisis_%'` → **7 列** |

### 4 个基线失败（与本单无关，逐一核对过）

| # | 失败用例 | 根因 |
|---|---|---|
| 1 | `debug-session-persistence.spec.ts` → 超出 500 个 → 最旧的被自动删掉 | `MAX_DEBUG_SESSIONS` 已是 500，测试仍按 50 断言 |
| 2 | `wp26-admin-role-guard.spec.ts` → 全部端点的有效 guard 都含 AdminRoleGuard | `AdminDebugController` 路由清单里有**重复的 `characters`** |
| 3 | `wp30-admin-real-api.spec.ts` → 4 个新端点都是 GET + guard | 同上 |
| 4 | `wp31-cost-board.spec.ts` → 2 个新端点都是 GET + guard | 同上 |

本单**新增 1 个测试文件 / 6 个用例**，全量用例数从 2657 → 2663，**失败数不变（4）**。

### migration 实跑（本机 dev 库 MySQL 8.0.46 / `mofang_dev`）

用**外科式**脚本只跑本单这一条 migration（不连带执行其他待执行 migration），验证三件事：

```
BEFORE : crisis_ended
UP  1  : crisis_ended,crisis_practiced,crisis_first_turn,crisis_post_turns,crisis_peak_level,crisis_category,crisis_escalated
UP  2  : （同上 7 列，不报错）      ← 幂等：information_schema 守卫生效
DOWN   : crisis_ended              ← down 只删这 6 列，crisis_ended 未动
UP  3  : （7 列）| 列数 = 7
SHOW COLUMNS FROM ap_practice_sessions LIKE 'crisis_%'  → 7 列
migrations 表已登记 = AddCrisisMetricsToPracticeSessions1714900000042
```

⚠️ 本机 dev 库**已应用**本条 migration（6 列已在表里）。后续跑 `pnpm migration:run` 时它是 no-op（守卫生效），并被正式登记进 `migrations` 表。

---

## 五、手动验证步骤（大炮可复跑）

```bash
# ① 迁移（幂等；本机已应用过，重复跑不报错）
pnpm migration:run

# ② 确认 7 列
mysql -h $DB_HOST -u $DB_USER -p $DB_NAME -e \
  "SHOW COLUMNS FROM ap_practice_sessions LIKE 'crisis_%';"
```

```sql
-- ③ 跑完一场对练后查这 6 列（crisis_practiced=1 的就是危机场）
SELECT id, status, exit_reason,
       crisis_ended, crisis_practiced, crisis_first_turn,
       crisis_post_turns, crisis_peak_level, crisis_category, crisis_escalated
FROM ap_practice_sessions
ORDER BY created_at DESC
LIMIT 10;
```

```bash
# ④ admin 接口（列表默认不带 6 列；带 include=crisis 才有；详情始终有）
curl -s -u "$ADMIN_USER:$ADMIN_PASS" \
  "http://localhost:3000/admin/api/auto-practice/sessions?pageSize=5" | jq '.items[0] | keys'
curl -s -u "$ADMIN_USER:$ADMIN_PASS" \
  "http://localhost:3000/admin/api/auto-practice/sessions?include=crisis&pageSize=5" | jq '.items[0].crisisPracticed'
curl -s -u "$ADMIN_USER:$ADMIN_PASS" \
  "http://localhost:3000/admin/api/auto-practice/sessions/<id>" | jq '.crisisPeakLevel'
```

**预期**：④ 第一条命令的 keys 里**没有** `crisisPracticed` 等 6 个键；后两条能看到（值可能是 0/NULL —— 那是"这场没危机"，不是"没数据"）。

---

## 六、部署顺序

```bash
pnpm migration:run   # 加 6 列（幂等）
pnpm start           # 起服务（runner 结算开始往这 6 列写值）
```

**前端**：admin-dashboard 的 `PracticeSession` TS 类型需要主 Agent 加这 6 个字段（`crisisPracticed` / `crisisFirstTurn` / `crisisPostTurns` / `crisisPeakLevel` / `crisisCategory` / `crisisEscalated`，前两个布尔量是 **number 0/1**）。**后端不改前端**，本单没碰 `admin-dashboard/`。

---

## 七、Commit message 草稿（**不自动提交**，等大炮指令）

```bash
feat(wp-j-p1b): 自动对练危机指标落库 —— ap_practice_sessions 加 6 个危机练习窗指标列
```

---

_交付人：MCode（结对 AI）· 2026-11-10 · 基线 `212611a`_
