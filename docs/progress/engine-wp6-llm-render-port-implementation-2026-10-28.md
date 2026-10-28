# WP6 · RenderPort LLM 适配 + 主备执行（适配层）后端交付记录

> 任务单: [`engine-wp6-llm-render-port-backend-2026-10-28.md`](./engine-wp6-llm-render-port-backend-2026-10-28.md)
> 总清单: [`phase1-integration-backlog-2026-10-28.md`](./phase1-integration-backlog-2026-10-28.md) WP6
> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP5 渲染契约 + WP6 装配轮
> 前置: WP0 边界骨架 / WP1 BDI / WP2 分层记忆 / WP3 轨迹 / WP4 伦理安全 / **WP5 渲染契约层**（`RenderPort` / `RenderSpec` / `RenderResult` / `selectFailoverTarget` / `guardVisitorOutput` / token-budget）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: **适配层（`src/engine-adapters/rendering/`）**，本期首次触碰真实 LLM 调用路径

---

## 1. 闸门复跑结果（本轮自跑，Windows PowerShell）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx eslint "src/**/*.ts"` | **exit 0**，0 error |
| 2 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| 3 | `npx jest test/engine-adapters` | **2 套件 / 31 用例全绿**（WP2 B 层既有 13 + WP6 新增 18） |
| 4 | `npx jest test/engine-core` | **7 套件 / 177 用例全绿**（**内核零回归**） |

> 本轮未跑 `pnpm build`（全量构建）与既有业务测试 —— 本期零 entity / migration / module 改动，**`src/engine-core/` 与 `src/llm/` 整树零改动**（git status 可核）；全量构建建议合并前补跑。

---

## 2. 红线核对（任务单 §2 + §9）

| 红线 | 落点 | 证据 |
|---|---|---|
| `src/engine-core/` 整树零改动 | 不新增导出、不改纯函数、不改 `turn` | `git status --porcelain -- src/engine-core` → **空** |
| `src/llm/` 零改动 | 只**调用**公开类型 `ChatCompletionRequest/Response`（`import type`），不碰 router / provider / config / 注册 | `git status --porcelain -- src/llm` → **空** |
| `src/counselor` / `src/agent` / `src/voice` 零改动 | 未触碰 | `git status` → **空** |
| 适配器可脱离 NestJS `new` 出来跑 | 纯类，无 `@Injectable()`、无 DI 装饰器 | `test/engine-adapters/wp6-llm-render.spec.ts` 直接 `new LlmRenderAdapter({...})` |
| 冷却 / 恢复逻辑用注入时钟可测 | `deps.now` 注入假时钟，**不等真实时间** | 单测③/④ 用 `FakeClock` 推进 |
| block 高危文本不被传出 | 仍 block → 丢弃原文，返回兜底话术 | 单测⑥ 断言 `result.text` 不含高危原文 |
| 最终降级返回非空兜底、不 reject | `degrade()` 恒返回 `fallbackUtterance` | 单测⑤ 断言 `providerHint='degraded'`、`usage` 归零 |
| `RenderResult` 无厂商私有 / 安全 verdict 私有字段 | 只映射 `text / taskKind / usage{2} / fallbackUsed / providerHint` | 单测⑪ 断言**字段集合**精确等于 5 个键 |
| 零 migration/entity/新表、零新第三方依赖、零 `.env` 改动 | 本期无 | git status 可核 |

---

## 3. 交付范围逐条对照（任务单 §1.1 / §8 / §9）

| 任务单条目 | 交付 | 落点 |
|---|---|---|
| §1.1-1 `LlmRenderAdapter implements RenderPort` | ✅ | `src/engine-adapters/rendering/llm-render.adapter.ts`：窄面 `ChatCaller` + 配置 + 可选 guard + 可注入时钟 |
| §1.1-2 适配层主备运行时 `RenderFailoverRuntime` | ✅ | `render-failover.runtime.ts`：失败计数 / 冷却 / 指数退避 / 恢复切回，**"选谁"调内核 `selectFailoverTarget`** |
| §1.1-3 任务分层 → 请求参数映射（配置驱动） | ✅ | `render-adapter.config.ts` 的 `taskDefaults` + 候选 `overrides`；stable 低温 / chat 高温 / advanced 回退 chat |
| §1.1-4 输出侧 guard 处置（pass/warn/block） | ✅ | `handleText` / `regenerate`：warn 放行记信号、block 重生成一次、仍 block 降级且**不传原文** |
| §1.1-5 `RenderResult` 归一 | ✅ | `usage` 由 `ChatCompletionResponse.usage` 映射 `completionTokens / totalTokens`；厂商私有字段不外露 |
| §1.1-6 错误归一与切备判定 | ✅ | 超时 / 网络 / 5xx / 空内容 → 可切备；401/403 / 缺 key → **直接最终降级，不循环** |
| §1.1-7 单测（§8 清单 1-11） | ✅ | `test/engine-adapters/wp6-llm-render.spec.ts`（18 用例，§8 清单逐条覆盖 + 3 条补充） |
| §1.2 不组装 RenderSpec / 不接 turn / 不填 reply / 不流式 | ✅ | 适配器只**消费**已给定的 `RenderSpec`；`in-memory-engine-session.ts` 未动；未引 `streamChat` |
| §1.3 只复用 `LlmRouterService.chat`，不改 router | ✅ | 只 `import type` 其请求/响应类型；**未 import router 具体类**（生产接线归 WP8） |
| §9 验收清单 8 条 | ✅ | 全部满足，见 §2 红线核对表 |

### §8 单测清单逐条对照

| # | 清单项 | 对应用例 | 状态 |
|---|---|---|---|
| 1 | 主成功 | ① 主一次返回 → 不切备 / providerHint=主id / usage 正确映射 | ✅ |
| 2 | 主失败切备 | ② 主 reject → 备成功 → fallbackUsed=true / providerHint=备id | ✅ |
| 3 | 失败计数进冷却 | ③ 连续失败达阈值 → 跳过主选备；假时钟未推进仍跳过主 | ✅ |
| 4 | 冷却到期恢复切回主 | ④ 假时钟推进过 cooldownUntil → 主重新被优先选中 | ✅ |
| 5 | 全部耗尽最终降级 | ⑤ 兜底话术 / fallbackUsed=true / providerHint=degraded / 不 reject | ✅ |
| 6 | block 重生成 | ⑥ 首返 block 重生成 pass → 返回重生成文本；两次都 block → 兜底不传原文 | ✅ |
| 7 | warn 放行 | ⑦ 文本原样放行且有信号记录 | ✅ |
| 8 | 空内容切备 | ⑧ 主返回空串 → 切备 | ✅ |
| 9 | 鉴权失败不循环 | ⑨ 401 → 直接降级，不对后续候选逐个尝试 | ✅ |
| 10 | taskKind 参数注入 | ⑩ stable 低温 / chat 高温 / 候选 overrides 优先 | ✅ |
| 11 | 零回归 | ⑪ 内核 177 用例全绿 + 内核出口不含适配层符号 | ✅ |

> **清单外补充 3 条**（均为施工中发现的高价值缺口）：② 主调用超时 → 切备；④ 成功后计数与冷却一并清零；⑪ `RenderResult` 字段集合精确断言。

---

## 4. 文件清单

### 新增 · 适配层 `src/engine-adapters/rendering/`

```
src/engine-adapters/rendering/
├── render-adapter.config.ts   【新】RenderCandidate / RenderTaskDefaults / RenderAdapterConfig
│                                     + 种子默认值 + createRenderAdapterConfig 工厂
├── render-failover.runtime.ts 【新】RenderFailoverRuntime：失败计数 / 冷却 / 指数退避 / 恢复切回
│                                     + health() 观测快照（选谁仍走内核 selectFailoverTarget）
└── llm-render.adapter.ts      【新】LlmRenderAdapter implements RenderPort
                                      + ChatCaller 窄面 + createVisitorOutputGuard
                                      + 错误归一（超时 / 鉴权 / 空内容）+ block 重生成处置
```

### 新增 · 测试

```
test/engine-adapters/wp6-llm-render.spec.ts 【新】18 用例（全 mock，不起 NestJS，不发网络）
```

> **`src/engine-core/`、`src/llm/`、`src/counselor/`、`src/agent/`、`src/voice/` 本期零改动** —— git status 可核。
> 既有 `src/engine-adapters/embedder/`、`src/engine-adapters/persistence/` 未动。

---

## 5. 关键设计决策（任务单 §11 之外的补充）

1. **block 重生成 = 同候选 + 降温度，而不是换候选** —— 候选刚刚成功返回了内容，说明它是**健康的**；换掉它等于拿一个没验证过的候选去赌第二次。而 block 的最可能成因是采样飘了（高温抽到了不该说的内容），降温是最直接、对症、且不引入新变量的干预。**若重生成本身失败（错误/空内容），则回到主备循环切下一个候选 —— 那时"换候选"才成立。**
2. **消息构造留 `buildMessages` 缝**（任务单 §4.4 未列）—— 本期红线是"不拼 prompt"，而 prompt 属 WP7；若不留缝，WP7 就得改本文件，那是把"本期的克制"变成"下期的返工"。缺省按 `spec.recentTurns` 直映射：**咨询师 → `user`、来访 → `assistant`**（模型扮演来访者，所以咨询师的话是"对方说的"）。
3. **guard 返回值补 `categories` 字段**（任务单 §4.4 的 `{ level }` 最小形状 → `{ level, categories? }`）—— §5.3 要求"onSafetySignal 记录类别"，没有类别就无从记录；`categories` 可选，旧形状仍可赋值。
4. **模型名缺失 → 直接降级，不发请求** —— `ChatCompletionRequest.model` 是**必填**，而 provider 基类写的是 `request.model ?? this.defaultChatModel`，空串**不是 nullish**，所以传 `''` 会真的拿空模型去调（必然失败，还可能被厂商按"模型不存在"计费）。宁可降级也不发一个注定失败的请求。
5. **guard 抛错 → 回落到内核规则层；规则层也异常才按 block 处理** —— 输出侧校验是最后一道闸，闸门故障时"未校验的文本直接出声"不可接受；但也不能因为校验器自身故障就让对话全挂。内核 `guardVisitorOutput` 永不抛（WP4 口径），所以这条是纯防御路径，用的是与 WP4"探测挂了回落规则"完全同款的思路。
6. **上下文为空 → 直接降级** —— 没有对话轮次就没法渲染；这是**退化输入**（不是 provider 故障），但同样走降级出口，保证 WP7 拿到的永远是非空文本。
7. **`maxTokens` 整数化 + 正数下限** —— `maxTokens` 是"最多生成多少 token"，非整数会被厂商截断/报错，0 等于"不要输出"。归一走内核 `resolveCompletionTokens`（口径与内核唯一），再取整并夹到 ≥ 1。
8. **候选序列为空 → 构造即抛** —— 那是**接线错误**：拖到第一次 `render` 才发现，表现为"用户问了一句，咨询师只会说兜底话术"，排查成本极高。在装配期炸掉，错误信息直接指向配置。
9. **冷却到期不清零连续失败计数（成功才清零）** —— 若到期就清零，指数退避永远停在第一档，持续故障的候选会以固定间隔被反复唤醒，退避就白做了。"真的恢复了才恢复额度"由 `markSuccess` 负责。
10. **鉴权失败是启发式判定（结构化 status 优先 + 文案兜底）** —— 厂商异常形状不统一。误判代价是"多降级一次"（少一次切备机会），而不是"把高危文本放出去"，失败方向可接受。

---

## 6. 已知缺口与风险（交付时必须知会）

| # | 缺口 | 归属 | 影响 / 处置 |
|---|---|---|---|
| 1 | **适配器未接进 `turn`，`reply` 仍恒空** | WP7 | 本期只交付"可独立 `new` 的渲染适配器"；WP7 负责组装 `RenderSpec` + 接线 + 填 `reply` |
| 2 | **无 `RenderSpec` 组装器 / 无 prompt 组装** | WP7 | 适配器只消费已给定的 spec；`buildMessages` 缝已留给 WP7 注入系统 prompt |
| 3 | **无 NestJS DI 注册 / 无 Module** | WP8 | 本期按 M6 交付纯类；DI 注册与 `LlmRouterService` → `ChatCaller` 的生产接线在 WP8 统一做 |
| 4 | **窄面 `ChatCaller` 无 `uid` / 无 `AbortSignal`** | WP8 | 任务单 §4.2 定义的窄面只有 `(req, providerId?)`；用户级 key 与请求取消在 WP8 接线时可能需要**扩窄面**（内核契约不动，窄面是适配层内部契约） |
| 5 | **无流式** | WP8 | 本期用 `chat` 聚合一次性返回（M2）；`streamChat` 增量推送属 WP8 |
| 6 | **主备冷却为适配器实例级全局** | WP8 | 任务单 §7 明确本期不做会话级隔离；"provider 刚挂了"是 provider 级事实，实例级共享是刻意的 |
| 7 | **温度 / 阈值 / 冷却时长等种子值未标定** | 装配轮 | `stable 0.2` / `chat 0.85` 为工程种子值，集中在 `render-adapter.config.ts`，WP8 按真实模型与实测校准 |
| 8 | **`fallbackUtterance` 文案未由产品定稿** | WP8 | 种子文案"我先缓一下，我们接着说。"中性、不越界、不给建议；正式文案由产品/专业口径定稿 |
| 9 | **`pnpm build` 全量构建与既有业务测试本轮未跑** | 范围之外 | 本期零 entity / migration / module 改动，内核与 `src/llm` 零改动；合并前建议补跑 |

---

## 7. 验证命令（复跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-adapters
npx jest test/engine-core
```

> `npx jest test/engine-core` 在**并行模式**下可能偶发一条「worker 未优雅退出」告警 —— 已定位为**环境并发问题**（默认 7 个 ts-jest worker 把 8 核机器压满导致的退出握手超时），非代码缺陷，退出码与断言结果不受影响。复跑加 `--maxWorkers=2` 可消除且更快（详见 WP5 交付记录 §1.1）。

无新增 env 开关；本期零 `.env` 改动、零 migration/entity/新表、零新第三方依赖、零 LLM 实调（全部 stub）、**内核零改动**、`src/llm` 零改动。
