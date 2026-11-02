# WP3 · 会话轨迹控制引擎（三模式 + 线性多幕游标）后端交付记录

> 任务单: [`engine-core-wp3-trajectory-control-backend-2026-10-28.md`](./engine-core-wp3-trajectory-control-backend-2026-10-28.md)
> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP3
> 前置: [`engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`](./engine-core-wp0-boundary-skeleton-backend-2026-10-28.md)（边界骨架）、
>       [`engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md`](./engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md)（BDI 规则轨）、
>       [`engine-core-wp2-layered-memory-backend-2026-10-28.md`](./engine-core-wp2-layered-memory-backend-2026-10-28.md)（分层记忆 V1）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 状态: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest engine-core 5 套件 123 用例全绿、engine-adapters 13 用例全绿；WP0·WP1·WP2 既有用例零回归）

---

## 1. 闸门复跑结果（本轮自跑，Windows PowerShell）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx eslint "src/**/*.ts"` | **exit 0**，0 error |
| 2 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| 3 | `npx jest test/engine-core` | **5 套件 / 123 用例全绿**（WP0+WP1+WP2 既有 82 零回归 + WP3 新增 41） |
| 4 | `npx jest test/engine-adapters` | **1 套件 / 13 用例全绿**（WP2 B 层，本期未动） |

> 本轮未跑 `pnpm build`（全量构建）与既有业务测试 —— 本期零 entity / migration / module 改动，内核未被 `app.module.ts` 引用；全量构建建议合并前补跑。

---

## 2. 交付范围逐条对照（任务单 §1.1 / §9）

| 任务单条目 | 交付 | 落点 |
|---|---|---|
| §1.1-1 剧本类型模型（纯 TS，不落库） | ✅ | `domain/trajectory/script.ts`：`TrajectoryMode` / `TrajectoryScript` / `TrajectoryNode` / `TrajectoryTrigger` / `TrajectoryNodeTarget` / `SnapshotDelta` / `TrajectoryCompletion` / `TrajectoryTrace` |
| §1.1-2 原子条件判定纯函数 `evaluateTrigger` | ✅ | `cognition/trajectory/trigger-evaluate.ts`：四类原子（事件 / 关键词 / 轮次 / 快照谓词）AND 组合 |
| §1.1-3 线性游标推进纯函数 `planAct` | ✅ | `cognition/trajectory/act-cursor.ts`：单向推进、不跳幕、不回退 |
| §1.1-4 三模式合成纯函数 `applyTrajectory` | ✅ | `cognition/trajectory/trajectory-applier.ts`：强覆盖替换 / 加权混合 / 触发按强覆盖出手 |
| §1.1-5 状态偏移叠加（复用 WP1 clamp） | ✅ | 同上文件 `applyDelta`：复用 `clamp01 / clampValence / resolveEmotionLabel`，**未新造 clamp** |
| §1.1-6 完成 / 异常判定（不自动 close） | ✅ | `in-memory-engine-session.ts`：`abort` 优先于 `completion.when`；终态只写 `trajectoryTrace.outcome`，`closeSession` 未被调用 |
| §1.1-7 端口向后兼容追加 | ✅ | `OpenEngineSessionInput.trajectory?` / `EngineTurnOutput.trajectoryTrace?`，三方法签名与既有 DTO 未破坏 |
| §1.1-8 运行时挂载（内存实现） | ✅ | `InMemoryEngineSession` 持 `script / cursor / activatedOrders / visitedNodeIds / outcome`，全部**进程内存、不落库** |
| §1.1-9 单测覆盖 | ✅ | `test/engine-core/wp3-trajectory.spec.ts`（41 用例，覆盖任务单 §8 清单 1-14 + 可复现性验收） |
| §5.8 管线插入位置 | ✅ | `turn` 中 `planIntention` 之后、`save` 之前插入轨迹步（`in-memory-engine-session.ts` 第 2.5 步） |
| §7 无剧本零回归 | ✅ | 无剧本时 `applyTrajectoryStep` 原样返回，出参**无** `trajectoryTrace`；单测逐字比对 WP1 路径的意图与快照 |
| §9 验收清单 | ✅ | 全部勾选，详见任务单 §13 回写 |
| §1.3 不碰 `src/counselor/drills/` | ✅ | 本轮**零**文件改动（git status 可核） |

### 额外交付（任务单未点名，但属「治本」范畴）

| # | 额外项 | 理由 |
|---|---|---|
| A | **`orderedTrajectoryNodes`（幕序有效值唯一算法）** | 幕序缺省取数组下标，而"取下标"这件事必须只有一处实现。校验 / 选幕 / 运行时记账三处各写一遍 `node.order ?? index`, 就会出现"校验说 order 唯一"与"推进时找到的不是同一幕"分裂 |
| B | **`validateTrajectoryScript` 在开场即校验** | 一条非法剧本拖到第 5 轮才炸 = 这场对练白跑; 开场失败意味着"这场根本不该开始", 比中途炸干净 |
| C | **原子三态（满足 / 不满足 / 跳过）** | 全空白关键词若判为"不满足", 整幕永远触发不了 = 剧本静默失效; 判为"跳过"则其余原子照常决定, 失败方向是"这条约束无效"而不是"这一幕没了" |
| D | **rationale 追加而非覆盖** | 轨迹强覆盖后策略已变, 留着 BDI 的旧理由会让督导看到与实际策略不符的解释; 追加后两条都在 —— 谁改的、改成了什么一眼可见 |
| E | **自带类型守卫 `isTrajectoryNodeArray`** | 内置 `Array.isArray` 的守卫是 `arg is any[]`, 用在已声明类型的字段上会把整条链路静默收窄成 `any`（本轮 eslint 实测报出 5 处 unsafe assignment 才暴露） |

---

## 3. 文件清单

### 新增 · 内核 `src/engine-core/`（整包仍零框架、零 typeorm、零新第三方依赖）

```
src/engine-core/
├── domain/trajectory/
│   └── script.ts                      【新】模式 + 剧本/幕/触发/target/delta/完成/异常/trace 全部类型
│                                        + validateTrajectoryScript + orderedTrajectoryNodes
└── cognition/trajectory/              【新目录】
    ├── trigger-evaluate.ts            【新】evaluateTrigger：单条触发条件对照上下文判布尔
    ├── act-cursor.ts                  【新】planAct：线性游标推进 + 选幕 + abort 判定
    └── trajectory-applier.ts          【新】applyTrajectory：三模式合成 + 一次性 delta 叠加
```

### 修改 · 内核 `src/engine-core/`

```
src/engine-core/
├── domain/engine-session.types.ts     OpenEngineSessionInput 加 trajectory?；EngineTurnOutput 加 trajectoryTrace?
├── in-memory/in-memory-engine-session.ts  持 script/cursor/activatedOrders/终态；turn 插入轨迹步（planIntention 之后、save 之前）
└── index.ts                           导出 WP3 公开面（20 个新导出）
```

### 新增/修改 · 测试

```
test/engine-core/wp3-trajectory.spec.ts  【新】WP3 41 用例（任务单 §8 清单 1-14 + 可复现性）
test/engine-core/boundary.spec.ts        【改】断言⑥ 白名单 + 断言⑦ 目录清单同步（双向比对，20 个新导出 + 4 个新文件）
```

> WP0 / WP1 / WP2 的既有测试文件**零改动**（`engine-core.spec.ts` / `wp1-bdi.spec.ts` / `wp2-memory.spec.ts` 未动一个字符）。

---

## 4. 关键设计决策（实施层，任务单 §11 之外的补充）

1. **`scope`/模式等判别式一律用字符串联合，不用 enum**（`TrajectoryMode`）—— 与 WP2 的 `MemoryRecallScope` 同理，内核保持零运行时导出。
2. **游标推进用"下一幕的实际 order"而非写死 `cursor + 1`** —— 任务单 §5.2 写的是 `cursor+1`，那在幕序连续（0,1,2…，即 order 缺省取下标的默认情形）与之**完全等价**；但剧本允许显式 order（稀疏序 0,5,9），写死 +1 会让剧本在第一幕之后就永远推进不动。
3. **触发原子"跳过"语义** —— 全空白关键词 / 空数组视为该原子不参与判定（不是"判为不满足"），理由见 §2 额外交付 C。
4. **`ctx.turnIndex` 用本轮轮次号（从 1 起）** —— 与 `EngineTurnOutput.turnIndex` 同口径，剧本作者写 `afterTurns: 3` 就是"第三轮开始"，不必在心里换算。
5. **快照谓词区间倒挂 / NaN 界 → 判为不满足** —— 安全方向是"不触发/不推进"；一条写反的配置若被当成满足，会让剧本在不该推进的轮次推进。
6. **权重夹取到 (0,1] 而非 [0,1]** —— 任务单 §4.5/§6 两处写明 (0,1]。权重 0 会让幕目标被彻底抹掉（剧本静默失效），夹到极小正值 = 仍生效但影响微弱，失败方向是"偏弱"而非"消失"；`MIN_CORRECT_WEIGHT = 0.01`。
7. **`emotion.label` 显式给则沿用，否则由双轴重算** —— 任务单 §5.4 写"混合后由双轴重算"、§4.1 类型注释写"显式给 label 沿用"，两处口径不同。本实现统一按 §4.1（类型级契约）：显式 label 优先，避免出现"valence=-0.8 但 label=hopeful"的自相矛盾状态。
8. **`target` 与 `delta` 是两件事** —— target 改的是**本轮行为目标**（→ Intention），delta 改的是**来访状态偏移**（→ 快照，且只在进入新幕那一轮叠一次）。两者混写会让"这一轮怎么回应"与"来访内心怎么变"无法分别观测。
9. **终态后不再写 outcome** —— `TrajectoryTrace` 是**本轮观测块**（`activated` / `advanced` 同为本轮语义），outcome 也是本轮事件：终态那一轮写一次，之后的轮次只报"仍在终态、游标冻结"。终态判定本身只做一次并冻结。

---

## 5. 已知缺口与风险（交付时必须知会）

| # | 缺口 | 性质 | 影响 / 处置 |
|---|---|---|---|
| 1 | **无剧本装配路径**（无 MySQL 表 / 无 CRUD / 无样例剧本） | 任务单明确本期不做 | 剧本由 adapter 解析成纯对象注入；内置 1 条伦理盲盒样例剧本留装配轮（任务单 §11 待过目项） |
| 2 | **游标/终态仅进程内存** | 任务单明确本期不做 | 进程重启即丢；跨进程持久化（暂停/恢复/归档）留装配轮 |
| 3 | **分支图 / 回环 / 并行幕 / 跳幕评分未做** | 任务单明确本期不做（线性游标 V1） | 类型上**刻意不留跳转字段** —— 留了口子就会出现"剧本写了 goto 但内核不认"的静默失效 |
| 4 | **短时记忆自动写入 / 会话结束编排层仍未接线** | WP2 遗留（任务单 §12 明确另起单） | 与 WP3 无关；本期未动 |
| 5 | **Qdrant 写侧冲突标记能力缺口** | WP2 遗留（基建改动） | 与 WP3 无关；本期未动 |
| 6 | **`pnpm build` 全量构建与既有业务测试本轮未跑** | 范围之外 | 本期零 entity / migration / module 改动，内核未被模块引用；合并前建议补跑 |

---

## 6. 验证命令（复跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-core
npx jest test/engine-adapters
```

无新增 env 开关；本期零 `.env` 改动、零 migration/entity/新表、零 LLM 调用、零口语产出（`reply` 仍恒 `''`）、零新第三方依赖、游标不落库。
