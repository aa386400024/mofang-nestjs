# WP-J P1b · 自动对练危机指标落库

> **状态：✅ 已交付（2026-11-10）** —— 实体 6 列 + migration `1714900000042`（幂等 + down，已在本机 dev 库实跑验证 7 列）+ `updateSessionResult` 落库 + socket payload 补 4 字段 + admin 列表 `?include=crisis` / 详情带 6 列 + 单测 6 例（成功 / 失败路径均覆盖）。
> **交付记录**：[`completed/phase2.5/wp-j-p1b-crisis-metrics-persist-implementation-2026-11-10.md`](./wp-j-p1b-crisis-metrics-persist-implementation-2026-11-10.md)

> **日期**：2026-11-10
> **派发**：MiniMax Code（后端实现）
> **前端**：主 Agent 已完成标注台 UI，不需本轮改前端
> **上游任务**：WP-J P1a（危机后置练习窗，已交付 commit 212611a）
> **下游用途**：30 场人工标注完成后，人工 `quality_annotation.crisis_peak_level` 与本场自动落库的 `crisis_peak_level` 对照，算危机档一致率

---

## 0. 背景与问题（为什么要做这个）

P1a 已经把「危机后置练习窗」逻辑写完，`PracticeRunMetrics` 接口里已经有完整的 6 个危机字段：

```ts
// src/auto-practice/practice-runner.service.ts:141
export interface PracticeRunMetrics {
  readonly crisisPracticed: boolean;   // 是否经历过危机练习窗
  readonly crisisFirstTurn: number | null;  // 危机首次披露轮次
  readonly crisisPostTurns: number;    // 危机窗内实际完成练习轮数
  readonly crisisPeakLevel: number;    // 危机强度档 0~3
  readonly crisisCategory: string | null;  // 危机类别枚举
  readonly crisisEscalated: boolean;  // 是否发生二次升级
  // ... 其他字段
}
```

**但现在这些字段只在内存里**：
- `run()` return 了 metrics，但 `updateSessionResult()` 只把 `crisisEnded`（旧的 `crisis_ended` 列）写进库，新的 6 个危机字段没落库
- `ap_practice_sessions` 表只有一个 `crisis_ended`（tinyint，"是否因危机掉线"），没有练习窗指标列
- socket session_end 事件只推了 `crisisPracticed` / `crisisPostTurns`，其他 4 个字段前端也拿不到

**后果**：P1a 上线后跑了几十场自动对练，「危机窗后有没有真练到、练了几轮、峰值多高、有没有升级」这几个核心质量指标**全部丢了**。没法回答「危机应对协议到底有没有用」。

---

## 1. 目标

把 `PracticeRunMetrics` 里的 6 个危机字段完整落库到 `ap_practice_sessions`，并在 admin 查询接口和实时事件里带出来。

---

## 2. 具体改动

### 2.1 实体加列（`src/auto-practice/entities/practice-session.entity.ts`）

在现有 `crisis_ended` 列（第 111 行）之后追加：

```ts
@Column({ type: 'tinyint', default: 0, name: 'crisis_practiced' })
crisisPracticed!: boolean;

@Column({ type: 'int', nullable: true, name: 'crisis_first_turn' })
crisisFirstTurn!: number | null;

@Column({ type: 'int', default: 0, name: 'crisis_post_turns' })
crisisPostTurns!: number;

@Column({ type: 'int', default: 0, name: 'crisis_peak_level' })
crisisPeakLevel!: number;

@Column({ type: 'varchar', length: 64, nullable: true, name: 'crisis_category' })
crisisCategory!: string | null;

@Column({ type: 'tinyint', default: 0, name: 'crisis_escalated' })
crisisEscalated!: boolean;
```

### 2.2 新建 migration

- 路径：`src/migration/1714900000042-AddCrisisMetricsToPracticeSessions.ts`
- 时间戳必须 > 1714900000041（quality_annotation 那张表的 migration）
- 用 `queryRunner.addColumn('ap_practice_sessions', ...)` 逐列加，参考 `1714900000041-CreateQualityAnnotations.ts` 的写法
- 老行自动带默认值（0 / null），**不回填**（历史场次没有这些数据，填 0 就好，不要冒充"没练危机"）

### 2.3 `updateSessionResult` 落库这 6 个字段

文件：`src/auto-practice/practice-runner.service.ts`

**改动 A**：第 622 行 `updateSessionResult` 的 `fields` 类型加这 6 个字段（带 JSDoc）。

**改动 B**：第 336 行调用处，从 `metrics` 传入：

```ts
await this.updateSessionResult(practiceSessionId, {
  status, exitReason, turnCount, crisisEnded, errorMessage, degradedTurns,
  promptTokens, completionTokens, reasoningTokens, totalTokens,
  totalCostCny, costBasis,
  // P1b: 危机练习窗指标
  crisisPracticed: metrics.crisisPracticed,
  crisisFirstTurn: metrics.crisisFirstTurn,
  crisisPostTurns: metrics.crisisPostTurns,
  crisisPeakLevel: metrics.crisisPeakLevel,
  crisisCategory: metrics.crisisCategory,
  crisisEscalated: metrics.crisisEscalated,
});
```

### 2.4 socket session_end 事件补全

文件：`src/auto-practice/auto-practice.events.ts` 的 `AutoPracticeSessionEndPayload` 类型，以及 `practice-runner.service.ts` 第 352 行构造 `endPayload` 处。

把缺的 4 个字段补上（`crisisFirstTurn` / `crisisPeakLevel` / `crisisCategory` / `crisisEscalated`），保持与库字段同源。

### 2.5 admin 查询接口带出这 6 列

- 单场详情（auto-practice session detail）：返回里加这 6 个字段
- 场次列表：默认不返回（避免膨胀），但有 query 参数 `?include=crisis` 时带上
- 不做新端点，只在现有响应 DTO 加字段

### 2.6 顺带同步：`/auto` 端点已加

主 Agent 已经在 quality 模块加了 `GET /admin/api/quality/annotations/:id/auto`（跟 `/reveal` 并列，不做双盲门禁），你不需要再动它。只是知会一下，别下次改 quality 模块时不知道这条路由存在。

---

## 3. 硬约束（红线）

1. **不动 engine-core**（BDI 决策内核）——这是纯落库层改动
2. **不打心理内容日志**——只落数字 / 枚举，日志里不许出现对话原文
3. **不要跟 `quality_annotation` 表混淆**——那张表是**人工标注**（你我标的），这张表是**自动对练**（引擎跑的）。两个表都有 `crisis_peak_level` 字段，语义不同：
   - `quality_annotation.crisis_peak_level` = 人工判断的危机档（校准用）
   - `ap_practice_sessions.crisis_peak_level` = 规则自动判的危机档（对照用）
   - 代码注释里要写清楚这个区别，别让人把两套数据 join 起来
4. **migration 要可重复执行**——MySQL 5.7 不支持 `ADD COLUMN IF NOT EXISTS`，必须先 `information_schema.COLUMNS` 查列是否存在，存在则 skip。参考现有 migration 的写法
5. **老数据不回填**——历史行这 6 列就是默认值（0 / null），不要写脚本去回溯。**但要在注释里说明**：老行 `crisis_practiced=0` 不等于"没练过危机"，只等于"P1a 上线前跑的场次，没这个数据"
6. **单测**：补一个单测验证「跑一场 crisis_practiced=true 的场次，updateSessionResult 正确写入 6 个字段」

---

## 4. 边界与防坑（大厂级，务必处理）

### 4.1 时间戳撞号

现有 migration 里 `1714900000040` 已经撞过一次（`AddCharacterProfileVerbalVoice.ts` 和 `CreateAutoPracticeBatches.ts` 同名时间戳）。你用 `1714900000042` 是安全的，但**写完后 `ls src/migration/17149*` 确认没有其他文件也叫 042**。

### 4.2 `crisis_ended` 与 `crisis_practiced` 是两个独立信号

不要把 `crisis_practiced` 当成 `crisis_ended` 的替代。它们的语义：

| 字段 | 语义 |
|---|---|
| `crisis_ended`（旧列，保留） | 这场是否因危机**终止**（掉线） |
| `crisis_practiced`（新列） | 这场是否**进过**危机后置练习窗 |

P1a 上线后，两者组合有四种合法情况：
- `c_e=0 c_p=0`：没危机
- `c_e=0 c_p=1`：进了窗，正常收尾（理想情况）
- `c_e=1 c_p=1`：进了窗，但还是在危机里结束了（协议没救回来）
- `c_e=1 c_p=0`：P1a 之前的老数据，直接掉线没进窗

注释里要写清楚这四种组合，别让后来人写 `WHERE crisis_ended=1 AND crisis_practiced=0` 时把老数据当新 bug。

### 4.3 失败路径已兜底，但要验证

`run()` 的 catch 分支已经用 `emptyMetrics()` 兜底（第 300 行），所以 `metrics` 在所有路径上都存在。但单测要覆盖一条：**循环异常时 updateSessionResult 被调用，6 个新字段写的是 emptyMetrics 的默认值（false / null / 0 / 0 / null / false），不能是 undefined 或 throw**。

### 4.4 不要顺手加索引 / batch 聚合

- 6 个新列**本轮不加索引**。低基数 tinyint（0/1）加索引意义不大，后续看板真要按 crisis_practiced 过滤时再补
- `ap_practice_batches` 表**本轮不加** crisis 聚合列（crisis_practiced_count 之类）。batch 看板后续用 `GROUP BY` 算，不冗余落库

### 4.5 socket payload 向后兼容

新增字段加到 `AutoPracticeSessionEndPayload` 类型末尾。老前端不解析新字段也不会炸（JSON 多字段不影响），但 admin-dashboard 那边的 TS 类型主 Agent 会同步加，不用你管前端。

### 4.6 migration 必须有 down 方法

- `up()`：加 6 列
- `down()`：drop 这 6 列（`crisis_ended` 旧列不动）
- 不要写 `DROP TABLE` 这种破坏性回滚

---

## 5. 闸门（必须自己跑，数字写进交付记录）

- `npx tsc --noEmit`：exit code 0
- `npx eslint "src/auto-practice/**/*.ts" "src/migration/1714900000042*"`：0 error 0 warning（warning 可以有但要说明）
- `npx vitest run test/auto-practice` 或对应 spec 路径：全绿
- 起服务跑 migration，确认 `SHOW COLUMNS FROM ap_practice_sessions LIKE 'crisis_%'` 返回 7 列（含原 crisis_ended）

---

## 6. 交付物

1. 实体改动 + 新 migration 文件
2. `updateSessionResult` 与调用处改动
3. socket payload 类型补全
4. admin detail / list 接口返回这 6 列
5. 单测（成功路径 + 失败路径）
6. 交付记录写到 `docs/worklog/completed/phase2.5/wp-j-p1b-crisis-metrics-persist-implementation-2026-11-10.md`，含：
   - 改动文件清单（每行：文件路径 / 改了什么）
   - 闸门表格（命令 / exit code / error 数 / warning 数 / 测试用例数）
   - 手动验证步骤（跑完一场 crisis 场次，查库确认字段有值）

---

## 7. 不做什么

- 不改前端（admin-dashboard 标注台 UI 主 Agent 维护）
- 不回填历史数据
- 不加新 admin 端点
- 不动 `quality_annotation` 表
- 不改 socket 事件名
