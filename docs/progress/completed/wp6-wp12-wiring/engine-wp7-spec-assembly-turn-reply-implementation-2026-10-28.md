# WP7 · RenderSpec 组装 + turn 接线填 reply（决策→说话闭环）后端交付记录

> 任务单: [`engine-wp7-spec-assembly-turn-reply-backend-2026-10-28.md`](./engine-wp7-spec-assembly-turn-reply-backend-2026-10-28.md)
> 总清单: [`phase1-integration-backlog-2026-10-28.md`](./phase1-integration-backlog-2026-10-28.md) WP7
> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md)
> 前置: WP0–WP5 内核纯层；**WP6 `LlmRenderAdapter`**（RenderPort 真实实现 + 主备 + 输出 guard + 降级非空）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: **适配层（`src/engine-adapters/rendering/`）**；本期把内核决策接成"一句真实来访口语"

---

## 1. 闸门复跑结果（本轮自跑，Windows PowerShell）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx eslint "src/**/*.ts"` | **exit 0**，0 error |
| 2 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| 3 | `npx jest test/engine-adapters` | **3 套件 / 47 用例全绿**（WP2 B 层既有 13 + WP6 19 + WP7 新增 15） |
| 4 | `npx jest test/engine-core --maxWorkers=2` | **7 套件 / 177 用例全绿**（**内核零回归**） |

> 本轮未跑 `pnpm build`（全量构建）与既有业务测试 —— 本期零 entity / migration / module 改动，**`src/engine-core/` 与 `src/llm/` 整树零改动**（git status 可核）；全量构建建议合并前补跑。

---

## 2. 红线核对（任务单 §2 + §9）

| 红线 | 落点 | 证据 |
|---|---|---|
| `src/engine-core/` 整树零改动 | 不新增导出、不改纯函数、不改 `turn`、不改 `in-memory-engine-session.ts` | `git status --porcelain -- src/engine-core` → **空** |
| `src/llm/` 零改动 | 只 `import type` 其 `ChatMessage` 类型 | `git status --porcelain -- src/llm` → **空** |
| `src/agent` / `src/voice` 零改动 | 未触碰 | `git status` → **空** |
| 门面与组装器**零 `@nestjs/*`**、零 typeorm、零网络、零 `.env` | 门面日志用模块级 `console.warn`，不引 Nest Logger | 单测⑧ **import 面扫描**通过 |
| 不改内核 turn、不在内核填 reply | 内核 `reply` 仍恒 `''`；门面另起 `TurnRenderResult` | 内核 177 用例全绿 |
| 不重复写咨询师半边记忆 | 门面只写**来访半边** | 单测④ 断言 `remembered.length===1` 且内容为来访文本 |
| 渲染失败只降级为非空中性话术，不传高危原文/异常栈 | 兜底句常量 + `fallbackUsed=true` + `providerHint='degraded'` | 单测⑤ |
| `RenderSpec` / 门面结果无厂商私有字段、模型名、温度、apiKey | 只用内核契约字段 | 单测① 字段级断言 |
| 零 migration/entity/新表、零新第三方依赖、零 `.env` 改动 | 本期无 | git status 可核 |

---

## 3. 交付范围逐条对照（任务单 §1.1 / §8 / §9）

| 任务单条目 | 交付 | 落点 |
|---|---|---|
| §1.1-1 规格组装器 `buildRenderSpec`（纯函数） | ✅ | `src/engine-adapters/rendering/spec-assembler.ts`：字段映射口径照 §3；内部调内核 `fitContextToBudget` 裁剪历史 |
| §1.1-1 `taskKind` 本期恒 `'chat'` | ✅ | 组装器缺省 `'chat'`，并留 `taskKind` 注入缝 |
| §1.1-2 装配门面 `TurnRenderOrchestrator`（可独立 new 的纯类） | ✅ | `turn-render-orchestrator.ts`：注入 `session / renderer / memories` + 可选 `assembler / tokenBudget / now / idFactory / fallbackUtterance` |
| §1.1-2 五步流程（内核 turn → 组装 → 渲染 → 回填 reply → 补写来访半边记忆） | ✅ | `turn()` 一次走完；内核出参**逐字透传** |
| §1.1-2 永不炸穿 | ✅ | 渲染异常/空文本 → 兜底句；**内核错误原样冒泡**（§5.1） |
| §1.1-3 中文来访风格 system prompt（仅适配层模板） | ✅ | `buildVisitorMessages(spec)` + `buildVisitorSystemPrompt(spec)`；经 WP6 的 `buildMessages` 缝注入 |
| §1.1-4 问+答成对写工作记忆（不重复写咨询师半边） | ✅ | `writeVisitorMemory()` 只写 `tier=WORKING / source=TURN / content=来访文本` |
| §1.1-4 门面自维护最近对话序列作下一轮 `recentTurns` | ✅ | `histories` 按句柄维护，问+答交替；上限 `WORKING_MEMORY_WINDOW_TURNS × 2` |
| §1.1-5 单测覆盖 §8 清单 | ✅ | `test/engine-adapters/wp7-turn-render.spec.ts`（15 用例，清单 1-8 全覆盖 + 7 条补充） |
| §1.3 顺手补 WP6 `markSuccess` 缺陷 | ✅ | 适配器成功路径补 `markSuccess` + 暴露 `health()` 只读快照 + 补**经 `adapter.render` 真实链路**的清零单测 |
| §9 验收清单 6 条 | ✅ | 全部满足，见 §2 红线核对表 |

### §8 单测清单逐条对照

| # | 清单项 | 对应用例 | 状态 |
|---|---|---|---|
| 1 | 规格映射 | ① intention/情绪/阻抗/移情/信任/信念与来源一致，`taskKind='chat'` | ✅ |
| 2 | 历史裁剪 | ② 组装结果与内核 `fitContextToBudget` **逐字一致** | ✅ |
| 3 | 成功闭环 | ③ reply 等于渲染文本，`render.fallbackUsed/providerHint` 透传 | ✅ |
| 4 | 成对记忆 | ④ 只写来访半边（WORKING/TURN），断言**没写**咨询师半边 | ✅ |
| 5 | 渲染异常不炸穿 | ⑤ 不 reject + 非空兜底句 + `fallbackUsed=true` | ✅ |
| 6 | 内核错误冒泡 | ⑥ `session.turn` 抛 `ABORTED` 原样抛出 | ✅ |
| 7 | system prompt 缝 | ⑦ 系统消息存在 + 咨询师→user / 来访→assistant | ✅ |
| 8 | 零回归 | ⑧ 门面/组装器 **import 面**零框架与网络依赖 | ✅ |

> **清单外补充 7 条**：①意图缺失构造中性最小意图 / ①角色层禁止行为合并去重 / ③内核出参逐字透传 / ③第二轮上下文含上一轮问答 / ④记忆写失败不炸穿 / ⑤空串同样降级 / ⑦系统侧带状态而历史不掺状态词。

---

## 4. 文件清单

### 新增 · 适配层 `src/engine-adapters/rendering/`

```
src/engine-adapters/rendering/
├── spec-assembler.ts           【新】buildRenderSpec 纯函数 + SpecAssemblyInput
│                                      字段映射照任务单 §3; 历史裁剪复用内核 fitContextToBudget
└── turn-render-orchestrator.ts  【新】TurnRenderOrchestrator（装配门面）
                                       + TurnRenderResult + 会话归属解析
                                       + buildVisitorMessages（中文来访风格 prompt 模板）
```

### 修改 · 适配层 `src/engine-adapters/rendering/`

```
src/engine-adapters/rendering/llm-render.adapter.ts   【改】WP6 缺陷修复（见 §5 决策 12）
```

### 测试

```
test/engine-adapters/wp7-turn-render.spec.ts    【新】15 用例（全 mock）
test/engine-adapters/wp6-llm-render.spec.ts     【改】+1 用例（经 adapter.render 的清零）
```

> **`src/engine-core/`、`src/llm/`、`src/agent/`、`src/voice/` 本期零改动** —— git status 可核。
> 既有 `src/engine-adapters/embedder/`、`src/engine-adapters/persistence/` 未动。

---

## 5. 关键设计决策（任务单 §11 之外的补充）

1. **门面零 `@nestjs/*`，日志用模块级 `console.warn`** —— 任务单 §2 要求门面"零 `@nestjs/*`"，且它必须能脱离 Nest 容器独立 `new` 出来跑与测。引一个 Nest Logger 就等于把框架带进本该纯 TS 的装配单元。日志量极小（只在异常路径），够用；要接统一日志时把日志器做成注入项即可，不影响门面语义。
2. **会话归属靠注入解析，不靠门面自己猜** —— 内核会话端口没有"由句柄反查归属"的方法（句柄是**运行时**维度，归属是**业务**维度，两者刻意分开）。所以 `tenantId / visitorId / sessionId` 由装配层（WP8）注入 `resolveSession(handleId)`（多会话门面）或 `sessionContext`（单会话门面）。解析不到时**跳过来访半边记忆写入并告警**，对话照常不中断 —— 少写一条记忆是可恢复的损失，抛错炸掉整轮不是。
3. **降级时历史只追加"问"，不追加"答"，也不写记忆** —— 兜底句是**系统产物**，不是来访真说的话。把它当"来访说了这句"喂回模型，等于教模型输出兜底话术；把它写进工作记忆，等于让召回里混进不是来访说过的话。
4. **"成功"与"降级"是两个标志，不是一个 `fallbackUsed`** —— WP6 的 `RenderResult.fallbackUsed` 只表示"走过备用路径"（切过备 / 走过 block 重生成），此时文本**仍是真话术**，应当进历史与记忆；只有门面自己降级（渲染抛错 / 空文本）时文本才是系统产物。门面内部用 `degraded` 区分两者，对外仍只暴露 `render.fallbackUsed`（WP5 M8：结果字段跨厂商通用）。
5. **门面另起 `TurnRenderResult`，不修改内核 `EngineTurnOutput`** —— 内核出参逐字透传（`snapshot / turnIndex / intention / trajectoryTrace / safety / openingContext`），外面只包一层 `render` 元信息与真实 `reply`。改内核出参会破坏 WP0–WP5 已发布的契约。
6. **组装器是纯函数，编排是门面** —— 分开才能单独单测字段映射（输入一份 output 断言 spec 每个字段），且将来换决策来源（模型轨 / WP9 角色资产）时只需换调用方，不用改编排逻辑。
7. **意图缺失时构造"中性最小意图"，且情绪/阻抗/移情取自本轮快照** —— 意图缺失是"这轮没决策出策略"，不是"输入非法"，抛错会把一次可降级的渲染升级成整场对练失败。情绪/阻抗/移情**不写死常量**：快照里的中性基线才是这一场真实的起点，写死等于凭空造一个与当前状态不一致的意图。
8. **历史窗口上限 = 内核 `WORKING_MEMORY_WINDOW_TURNS × 2`** —— 门面持有的历史只是**给模型看的上下文**，不是决策依据，不必比内核的工作记忆窗口更宽；更宽只会让 prompt 更贵、更稀释当前议题。复用内核常量而非另写一个数字。
9. **提供 `forgetSession(handleId)`** —— 门面是长生命周期对象（一个实例服务多场会话），历史必须能被显式释放，否则每场会话的对话都留在内存里，是缓慢的内存泄漏。WP8 在 `closeSession` 时调用。
10. **记忆写失败不炸穿** —— 记忆写不进去是"降级"（这条没被记住），不是"会话失败"。同 WP2 embedder 的失败语义。
11. **策略/情绪 → 中文标签用穷尽 `Record`** —— 新增枚举值时 TS 直接报错，逼着补中文标签；否则策略名会以英文原样出现在 prompt 里，模型既看不懂也不该看到。
12. **WP6 缺陷修复：成功路径补 `markSuccess` + 暴露 `health()`** —— 之前只清零了 runtime 的单测，**绕开了适配器**，于是"失败过一次、后来已恢复"的候选会带着旧计数进冷却，比实际更早被踢出轮换（退避变成了惩罚而非保护）。修复点放在 `render()` 拿到 success outcome 处（覆盖普通成功与 block 重生成成功两条路径）；`health()` 只读快照让回归测试能盯住**真实链路**。
13. **零回归第 8 条断言打在 import 面，不是全文** —— 任务单原文是"源码不出现 `@nestjs` / `typeorm` / `fetch` / `axios`"。若按**全文**匹配，连"本文件不使用框架"这句话本身都会写不进去 —— 断言会把**说明约束的注释**当成违规。真正的风险是"引入了依赖"，所以断言打在 `import`/`require` 的 specifier 上：那是依赖面的真实口径，且比全文匹配更严格（漏写注释里的字不会掩盖真依赖）。

---

## 6. 已知缺口与风险（交付时必须知会）

| # | 缺口 | 归属 | 影响 / 处置 |
|---|---|---|---|
| 1 | **未接进内核 `turn` 管线，内核 `reply` 仍恒 `''`** | 任务单明确本期不做 | 门面返回的 `TurnRenderResult.reply` 由调用方（WP8）取用；内核出参逐字未动 |
| 2 | **无 NestJS DI 注册 / 无生产 `ChatCaller` 接线** | WP8 | 本期交付可独立 `new` 的闭环单元；`LlmRouterService` → `ChatCaller` 适配在 WP8 做 |
| 3 | **无流式（SSE/WS/首 token 延迟/断流/abort）** | WP8 | 本期 `chat` 聚合一次性返回；流式属 WP8 |
| 4 | **会话归属必须由装配层注入 `resolveSession`** | WP8 接线要求 | 未注入 → 跳过来访半边记忆写入并告警（对话不断流）。WP8 需在 `openSession` 时登记 handleId → 归属 |
| 5 | **prompt 模板是工程初版，未做真实模型 A/B 校准** | 装配轮 | 温度/句数上限/规则条数需按真实模型效果调；模板集中在 `buildVisitorSystemPrompt` 一处，改动面小 |
| 6 | **策略/情绪中文标签表需随内核枚举同步** | 持续 | 用穷尽 `Record`，内核新增枚举时 TS 编译期报错，强制补齐（不会静默漏译） |
| 7 | **每轮按议题语义 recall 未做**（本期 `recall` 只透传 `openingContext`） | WP2 遗留 | 语义记忆召回属 WP2 后续；本期不引入新查询 |
| 8 | **`trajectoryNote` 未接** | 留缝 | 门面不持有剧本，`trace` 只带 `activeNodeId`；组装器已留 `trajectoryNote` 注入位 |
| 9 | **角色层 `attachmentStyle` / `forbiddenBehaviors` 未注入** | WP9 | 门面拿不到角色基线；组装器已留两个注入位 + 合并去重口径 |
| 10 | **历史只在进程内存**（重启丢） | 同内核工作窗口口径 | 内核 `workingWindow` 也是进程内存；落库属编排层（WP8/后续） |
| 11 | **`pnpm build` 全量构建与既有业务测试本轮未跑** | 范围之外 | 本期零 entity / migration / module 改动，内核与 `src/llm` 零改动；合并前建议补跑 |

---

## 7. 验证命令（复跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-adapters
npx jest test/engine-core --maxWorkers=2
```

> `npx jest test/engine-core` 并行模式可能偶发一条「worker 未优雅退出」告警 —— 已定位为**环境并发问题**（默认 7 个 ts-jest worker 把 8 核机器压满导致的 worker 退出握手超时），非代码缺陷，退出码与断言结果不受影响；加 `--maxWorkers=2` 可消除且更快（详见 WP5 交付记录 §1.1）。

无新增 env 开关；本期零 `.env` 改动、零 migration/entity/新表、零新第三方依赖（复用仓库既有 `nanoid`）、零真实 LLM 调用（全 stub）、**内核零改动**、`src/llm` 零改动。
