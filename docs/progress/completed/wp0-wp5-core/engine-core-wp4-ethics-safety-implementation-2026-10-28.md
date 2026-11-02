# WP4 · 伦理安全引擎（规则层主体 + PsyGUARD 双层降级 + 双侧检测 + 会后伦理报告）后端交付记录

> 任务单: [`engine-core-wp4-ethics-safety-backend-2026-10-28.md`](./engine-core-wp4-ethics-safety-backend-2026-10-28.md)
> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP4 + §7 伦理分层
> 前置: [`engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`](./engine-core-wp0-boundary-skeleton-backend-2026-10-28.md)（边界骨架）、
>       [`engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md`](./engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md)（BDI 规则轨）、
>       [`engine-core-wp2-layered-memory-backend-2026-10-28.md`](./engine-core-wp2-layered-memory-backend-2026-10-28.md)（分层记忆 V1）、
>       [`engine-core-wp3-trajectory-control-backend-2026-10-28.md`](./engine-core-wp3-trajectory-control-backend-2026-10-28.md)（会话轨迹控制）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 状态: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest engine-core 6 套件 153 用例全绿、engine-adapters 13 用例全绿；WP0–WP3 既有用例零回归）

---

## 1. 闸门复跑结果（本轮自跑，Windows PowerShell）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx eslint "src/**/*.ts"` | **exit 0**，0 error |
| 2 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| 3 | `npx jest test/engine-core` | **6 套件 / 153 用例全绿**（WP0–WP3 既有 123 零回归 + WP4 新增 30） |
| 4 | `npx jest test/engine-adapters` | **1 套件 / 13 用例全绿**（WP2 B 层，本期未动） |

> 本轮未跑 `pnpm build`（全量构建）与既有业务测试 —— 本期零 entity / migration / module 改动，内核未被 `app.module.ts` 引用；全量构建建议合并前补跑。

---

## 2. 交付范围逐条对照（任务单 §1.1 / §9）

| 任务单条目 | 交付 | 落点 |
|---|---|---|
| §1.1-1 安全类型模型 | ✅ | `domain/safety/safety-types.ts`：`SafetyLevel` / `SafetySide` / `CounselorSafetyCategory` / `VisitorRiskCategory`（PsyGUARD 11 类）/ `SafetyCategory` / `SafetyVerdict` / `SafetyEvent` / `SafetyReport` |
| §1.1-2 PsyGUARD 11 类 → 等级映射表 | ✅ | 同文件 `PSYGUARD_LEVEL_MAP`（唯一一处），规则层与探测合并层共用 |
| §1.1-3 规则引擎纯函数 `evaluateSafety` | ✅ | `cognition/safety/rule-engine.ts`：小写子串、命中取最高级别、类别/规则 id 去重聚合 |
| §1.1-4 风险探测端口（只定义接口） | ✅ | `domain/ports/risk-probe.ts`：`RiskProbePort` / `RiskProbeResult`；MindGuard 临床层仅注释占位，**零实现、零网络代码** |
| §1.1-5 安全编排 `assessSafety` | ✅ | `cognition/safety/assess-safety.ts`：规则 →（非 block 才）探测 → `Promise.race` 150ms 超时兜底 → 合并；**超时/抛错/脏形状一律回落规则，绝不抛穿 turn** |
| §1.1-6 双侧检测骨架 | ✅ | `evaluateSafety` / `assessSafety` 均支持 `side='visitor_output'`；turn 内**只调咨询师侧**（`reply` 恒空，无来访文本可检） |
| §1.1-7 出参追加可选 `safety?` | ✅ | `EngineTurnOutput.safety?`；`pass` 且探测无额外结果时**省略该字段**（零回归） |
| §1.1-8 会话内累计 + 观测报告 | ✅ | `InMemoryEngineSession`：构造选项 `riskProbe?`；事件随句柄实例累计（**进程内存、不落库**）；非端口观测方法 `getSafetyReport(handleId)` |
| §1.1-9 MindGuard 临床层占位 | ✅ | 仅在 `domain/ports/risk-probe.ts` 注释说明，**未定义方法、未留行为字段** |
| §1.1-10 单测覆盖 | ✅ | `test/engine-core/wp4-safety.spec.ts`（30 用例，覆盖任务单 §8 清单 1-14 + 会话隔离） |
| §5.4 管线插入位置 | ✅ | `turn` 中 `userText` 校验后、`classify` 之前；安全步**只读**，不改 snapshot / intention / 轨迹游标 |
| §7 零回归 | ✅ | 无 probe + 干净对话 → 出参**无** `safety`；单测逐字比对 WP1 路径的意图与快照 |
| §1.3 不碰 `counselor/drills` / `live-hint` | ✅ | 本轮**零**文件改动（git status 可核） |

### 额外交付（任务单未点名，但属「治本」范畴）

| # | 额外项 | 理由 |
|---|---|---|
| A | **等级比较统一走 `maxSafetyLevel`**（`safety-types.ts` 一处） | 规则引擎、探测合并、报告聚合三处都要比"谁更严重"；各写一份 `block > warn > pass` 必然漂移 |
| B | **探测类别也参与等级判定**（类别经 `PSYGUARD_LEVEL_MAP` 归一后取最高） | 探测实现可能返回 `level='pass'` 却带着 `suicide_plan` 类别（脏形状）。只信 level 会把高危降级；取三者最高（规则 / 探测 level / 类别映射）是安全方向 |
| C | **未知类别与 `neutral` 一律不入 categories** | `neutral` 是"无风险"标记不是"发现"；把 neutral 塞进类别列表会让报告里出现"命中类别：neutral"这种自相矛盾的条目 |
| D | **命中片段截断 120 字** | 完整原文已落在 WP2 工作记忆里，报告再抄一份全文等于把敏感对话复制进第二个存储面 |
| E | **`getSafetyReport` 返回数组副本** | 调用方随手 `push` 不应回写内部状态（任务单 §8-11 明确要求） |

---

## 3. 文件清单

### 新增 · 内核 `src/engine-core/`（整包仍零框架、零 typeorm、零新第三方依赖）

```
src/engine-core/
├── domain/
│   ├── safety/
│   │   └── safety-types.ts            【新】level/side/类别/verdict/event/report + PSYGUARD_LEVEL_MAP + 等级归一 helper
│   └── ports/
│       └── risk-probe.ts              【新】RiskProbePort 接口 + RiskProbeResult（MindGuard 仅占位注释）
└── cognition/
    └── safety/                        【新目录】
        ├── rule-engine.ts              【新】规则词典（咨询师 7 条 + 来访 10 条）+ evaluateSafety 纯函数
        └── assess-safety.ts            【新】规则→可选探测→合并/降级编排 + DEFAULT_PROBE_TIMEOUT_MS
```

### 修改 · 内核 `src/engine-core/`

```
src/engine-core/
├── domain/engine-session.types.ts     EngineTurnOutput 加 safety?
├── in-memory/in-memory-engine-session.ts  riskProbe 构造注入 + 只读安全步 + 事件累计 + getSafetyReport
└── index.ts                           导出 WP4 公开面（18 个新导出）
```

### 新增/修改 · 测试

```
test/engine-core/wp4-safety.spec.ts    【新】WP4 30 用例（任务单 §8 清单 1-14 + 会话隔离）
test/engine-core/boundary.spec.ts      【改】断言⑥ 白名单 + 断言⑦ 目录清单同步（18 个新导出 + 4 个新文件）
```

> WP0–WP3 的既有测试文件**零改动**。

---

## 4. 关键设计决策（实施层，任务单 §11 之外的补充）

1. **`SafetyLevel` 用字符串联合而非 enum** —— 与 WP2 `MemoryRecallScope` / WP3 `TrajectoryMode` 同理，内核零运行时导出。
2. **规则词典是内核种子常量** —— 本期零落库零运营后台，改规则 = 改代码 = 走 review；后期做热更新/灰度时再把这份表搬到存储，接口形状不变。
3. **种子词按真实口语形态列全** —— 施工中实测发现「我保证**你**能治好」里「保证」与「能治好」之间夹着「你」，只列 `保证能治好` 会漏判最常见的说法。词典必须按真实说法写，不能只写一种形态。
4. **词典刻意保守**（block 只放最硬越界、warn 只放明显说教） —— 误报会把正常训练对话判成高危，直接毁掉可用性；漏报只是督导事后少看一条。宁可漏报，不可误拦。
5. **未用 `AbortSignal` 取消探测** —— 探测实现可能不支持取消，强行 abort 会在实现侧留下未处理拒绝；改用 `Promise.race` + `node:timers` 计时器，探测实现零要求。
6. **规则已 block 时不发起探测** —— 高危已由规则兜住，为一个不需要的结果付网络延迟与失败率纯亏。
7. **探测失败一律静默回落** —— 安全层是护栏不是门禁：护栏挂掉不该让对话挂掉。
8. **`reason` 只给类别级中性说明** —— 不做自然语言润色（润色属模型轨，任务单 §11 待过目项）。
9. **来访侧规则**已备好但 turn 内不调用 —— `reply` 恒空，无文本可检；WP5 拿到真实来访口语后直接复用同一规则器与端口形状。

---

## 5. 已知缺口与风险（交付时必须知会）

| # | 缺口 | 性质 | 影响 / 处置 |
|---|---|---|---|
| 1 | **报告随句柄释放** —— `closeSession` 只删句柄登记，事件随之释放 | 取数口径 | 需要报告的调用方必须**在 `closeSession` 之前**取走 `getSafetyReport`；报告落库/入档案属装配轮 |
| 2 | **无 PsyGUARD 真实实现** | 任务单明确本期不做 | 只留 `RiskProbePort` 接口与降级路径；独立 Python FastAPI + B 层 HTTP 适配留装配轮 |
| 3 | **规则词典未标定** | 需真实语料 | 本期只放最硬的种子词；扩充靠训练语料与误报样本回流（规则运营轮），不靠拍脑袋加词 |
| 4 | **全半角/繁简不做归一** | 任务单明确本期不做 | 种子词选常用写法；误报留后期 |
| 5 | **`assessSafety` 的 `now` 字段本期未被使用** | 契约预留 | 事件 `at` 由运行时自己的时钟记录；判定本身**不得**依赖时钟（同一条文本在不同轮次必须得到同一结论） |
| 6 | **`pnpm build` 全量构建与既有业务测试本轮未跑** | 范围之外 | 本期零 entity / migration / module 改动，内核未被模块引用；合并前建议补跑 |
| 7 | **WP2 遗留两项另起单** | WP2 范围 | Qdrant 写侧冲突标记（需给 `QdrantService` 补 `setPayload`）、短时记忆自动写入与会话结束编排层接线；本期未动 |

---

## 6. 验证命令（复跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-core
npx jest test/engine-adapters
```

无新增 env 开关；本期零 `.env` 改动、零 migration/entity/新表、零 LLM 调用、零口语产出（`reply` 仍恒 `''`）、零新第三方依赖（超时用 `node:timers`）、事件与报告不落库。
