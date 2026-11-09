# WP-C 交付记录：触发式审议闸门（Deliberation Gate Service）

> **任务单**：[phase2.5-wp-c-triggered-deliberation-gate.md](phase2.5-wp-c-triggered-deliberation-gate.md)
> **交付日期**：2026-11-09
> **状态**：✅ 已交付
> **红线**：engine-core 零改动（`git diff --stat HEAD -- src/engine-core` = 空）

---

## 一、本单做了什么（一句话）

在 `src/engine-adapters/deliberation-gate/` 建了一个**可独立拆分**的审议闸门：编排门面每轮渲染后先问它"这一轮要不要跑 LLM 审议"，
只在**规则算不准**的地方跑（关键事件 / 不在置信清单的事件类型 / 同盟或阻抗维度突变），平静轮次直接跳过；
冷却、会话配额、全局每分钟配额、熔断**全部走 Redis**（不依赖进程内存），影子与生效两套参数**互不干扰**。

---

## 二、方案设计

### 2.1 文件结构（7 个源文件 + 2 个测试文件）

```
src/engine-adapters/deliberation-gate/
  ├── deliberation-gate.types.ts      ← 类型契约 (纯 TS, 零 @nestjs)
  ├── deliberation-gate.config.ts     ← env → GateConfig (12 个键, 逐个字面量读)
  ├── deliberation-gate.evaluator.ts  ← 八步决策流程 (纯函数, 零 IO)
  ├── deliberation-gate.quotas.ts     ← 冷却/计数/配额/熔断 (独占全部 Redis 读)
  ├── deliberation-gate.trace.ts      ← 决策 trace 写 Redis (TTL 7 天)
  ├── deliberation-gate.service.ts    ← 入口: 读状态 → 判定 → 记账 → 留痕
  └── deliberation-gate.module.ts     ← NestJS 模块 (注册 service)

test/engine-adapters/deliberation-gate/
  ├── evaluator.spec.ts               ← 33 例 (纯判定 + 配置解析)
  └── quotas.spec.ts                  ← 22 例 (配额/冷却/熔断 + 入口链路)
```

### 2.2 三层分工（本单最关键的一条治本）

| 层 | 文件 | 职责 | 红线 |
|---|---|---|---|
| **IO 层** | `quotas.ts` | 只读数字 / 写数字，**一个比较都不做** | 读失败一律取"最宽松"缺省（放行） |
| **判定层** | `evaluator.ts` | 只做比较，**一个 IO 都不做** | 纯函数，零 env / 零 Redis |
| **入口层** | `service.ts` | 串链路 + 兜异常 + 留痕 | 不抛；出错按"放行"处理 |

**为什么这么切**：任务单的八步流程里有三步（冷却 / 配额 / 熔断）要读 Redis。若把 IO 与判定混在一个 service 里，
整条流程就只能"起 Redis 才能测"。切开后，§5.1 要求的 evaluator.spec.ts 覆盖**整条八步流程**且**零外部依赖**，
而 Redis 抖动时的降级方向也一眼可见（读失败 → 数字取最宽松缺省 → 判定自然放行）。

### 2.3 八步决策流程（与任务单 §2.2 逐条对齐）

```
① 危机红线  → skip(crisis_skip)          ← 纯判定, 永远最先执行
② 首轮      → run(first_turn_baseline)
③ 关键事件  → run(key_event)              ← 硬触发, 不受冷却/配额限制
④ 冷却      → skip(cooldown)
⑤ 配额      → skip(quota_exceeded)       ← 会话次数 / 全局 RPM
⑥ 熔断      → skip(circuit_open)          ← 仅生效模式
⑦ 不确定性  → run(unknown_event_type | alliance_delta_high | resistance_delta_high)
              skip(calm_turn)
⑧ 默认      → skip(rule_confident)
```

**⑦ 的三个触发口径**：
- `unknown_event_type`：出现**规则置信清单外**的事件（LLM 专属的隐性阻抗 / 微表情 / 关系氛围，或内核的 `neutral` 占位）
  —— 规则这一轮没把握，交给 LLM 看；
- `alliance_delta_high`：同盟三维（trust / safety / bond）任一 |delta| 超阈值；
- `resistance_delta_high`：阻抗三维（verbal / depth / style）任一 |delta| 超阈值。

**置信清单不复制**：直接引用 WP63 的 `DELIBERATION_RULE_ALIGNED_TAGS`（10 个规则对齐标签），
复制一份就意味着两处迟早漂移（漂移 = 影子期对比数据全废）。

### 2.4 两套参数（影子 / 生效）

| 参数 | 生效模式 | 影子模式 | env 键 |
|---|---|---|---|
| 同盟三维阈值 | 0.05 | 0.03 | `..._ALLIANCE_THRESHOLD_EFFECT` / `_SHADOW` |
| 阻抗三维阈值 | 0.08 | 0.05 | `..._RESISTANCE_THRESHOLD_EFFECT` / `_SHADOW` |
| 全平静阈值 | 0.03 | 0.03 | `..._CALM_THRESHOLD_EFFECT` / `_SHADOW` |
| 冷却轮数 | 4 | 1 | `..._COOLDOWN_EFFECT` / `_SHADOW` |
| 每会话最大次数 | 6 | 不限 | `..._MAX_PER_SESSION_EFFECT` |
| 全局每分钟配额 | 20 | 不限 | `..._GLOBAL_RPM` |
| 熔断 | 连续 5 次失败 → 10 分钟 | 不熔断 | `..._CIRCUIT_FAIL_COUNT` / `..._CIRCUIT_COOLDOWN_MS` |
| 首轮强制跑 | ✅ | ✅ | —— |
| 关键事件硬触发 | ✅ | ✅ | —— |
| 危机轮跳过 | ✅ 永远不跑 | ✅ 永远不跑 | —— |

影子模式的三项"不限制"在配置层写成**显式哨兵值**（`GATE_UNLIMITED = Number.MAX_SAFE_INTEGER`），
而不是"运行时按 mode 分支" —— 判定层因此完全不需要知道模式差异。

### 2.5 Redis key 设计

| 用途 | key | TTL |
|---|---|---|
| 会话冷却轮次 | `deliberation:gate:{会话长度}:{会话}:{mode}:last_turn` | 24 h |
| 会话计数 | `deliberation:gate:{会话长度}:{会话}:{mode}:count` | 24 h |
| 全局每分钟配额 | `deliberation:gate:global:rpm:{minute}` | 120 s |
| 熔断失败计数 | `deliberation:gate:circuit:fail_count` | 冷却时长 |
| 熔断截止时间 | `deliberation:gate:circuit:open_until` | 冷却时长 |
| 决策 trace | `deliberation:gate:trace:{会话长度}:{会话}:{轮次}:{mode}` | 7 天 |

**状态全在 Redis**（红线 3）：冷却 / 计数 / 配额 / 熔断都是"跨进程的事实" —— 同一场会话可能被两个实例先后服务，
同一分钟的全局配额更是跨实例共享。放进程内存 = 换实例就失忆，于是限流在多实例部署下**静默**失效。

### 2.6 对接点

```
turn-render-orchestrator.deliberationRound()
  └─ 本轮渲染后 → 装配好的闸门 → 判 run / skip → 决定是否发起审议

engine.module.ts
  └─ import DeliberationGateModule → TurnRenderOrchestrator 的 useFactory 注入

engine.providers.ts
  └─ EngineOrchestratorDeps.gate?: DeliberationGatePort
```

**影子与生效两条路径共用同一份结构化输入**（WP-A 的 `structured`），闸门判的是同一份数据 —— 与"两种审议共用一个调用点"同款纪律。

---

## 三、偏差说明（与任务单的出入 + 理由）

### D1 · 门面依赖**窄端口** `DeliberationGatePort`，而不是 `gateService` 字段

- **任务单 §4.3**：TurnRenderOrchestrator 的 deps 加一个 `gateService` 字段。
- **实际**：deps 加 `gate?: DeliberationGatePort`（接口在 `deliberation-gate.types.ts`，零 @nestjs）；Nest service 实现它。
- **理由**：编排门面是**纯类**（零 @nestjs，见 `turn-render-orchestrator.ts` 文件头）。直接依赖一个 Nest service 会把框架拖进门面，
  让"装配缺席"从"没有闸门"退化成"门面起不来"。仓库同款纪律：`DeliberationShadowPort` / `DeliberationEffectPort` 都是窄端口。

### D2 · 只问**实际挂上去**的那条路径，而不是每次都问两次

- **任务单 §4.1 示例**：每次都 `evaluate` 两次（shadow 一次 + effect 一次）。
- **实际**：只对装上去的路径问一次（装配上二者互斥 —— shadow 模式挂影子端口，`llm_active` 模式挂生效钩子）。
- **理由**：问一次用不上的闸门会白消耗那一侧的冷却 / 计数（那份决策没人消费），且让"影子跑了多少次"这类观测失真。

### D3 · 危机口径映射：`medium` / `high` **都**算危机

- **任务单 §2.2**：`safety.riskLevel === 'crisis'`。
- **实际**：闸门复用 WP-A 的 `isDeliberationRiskAcceptable` —— **只有 `low` 允许出境**，`medium` / `high` 一律 `crisis_skip`。
- **理由**：仓库的审议风险等级枚举是 low/medium/high，**没有 'crisis'**。若只挡 high，`medium`（危机意念层：被动自杀意图 / 自伤意念 / 自杀探索）
  就会被放行出境 —— 比任务单口径更宽松，是**合规方向的倒退**。

### D4 · 新增 `gate_error` 理由码 + 补 2 个"全平静"阈值 env 键

- **任务单**：`GateReason` 枚举 11 个值；参数表未列"全平静"阈值。
- **实际**：枚举 12 个值（新增 `gate_error`）；新增 `ENGINE_DELIBERATION_GATE_CALM_THRESHOLD_EFFECT` / `_SHADOW`（缺省 0.03，与任务单 §2.2 流程图一致）。
- **理由**：① 闸门自身故障（Redis 读不出来）需要一个可统计的码 —— 复用 `rule_confident` 会让看板把"闸门挂了"统计成"规则有把握"，
  那是**撒谎**（与审议层 `skipped_high_risk` / `circuit_open` 分开是同一款理由）；② 任务单流程图里的 0.03 是个阈值，
  而红线要求"不写死阈值"，所以它必须走 env。

### D5 · Redis key 加**会话长度前缀**

- **任务单 §3.1**：`deliberation:gate:{sessionId}:{mode}:last_turn`。
- **实际**：`deliberation:gate:{会话长度}:{会话}:{mode}:last_turn`。
- **理由**：仓库既有纪律（`deliberation_trace` / `deliberation_circuit` / `RedisBdiStateRepository` 全部用长度前缀复合键）。
  直接用 ':' 拼的话，(会话 "a" + 模式 "b") 与 (会话 "a:b") 可能撞键 —— 撞键 = **跨会话串状态**（A 场的冷却压住 B 场），而且是静默的。

### D6 · `quotas.ts` 的 API 收口成"读数字"原语 + 纯函数判定

- **任务单 §3.1**：列的是 `checkCooldown` / `checkQuota` / `checkGlobalRpm` / `checkCircuit` 一组**带判定**的方法。
- **实际**：`quotas.ts` 只提供 `read*` 原语（不做任何比较），全部比较集中在 `evaluator.ts` 的纯函数里。
- **理由**：仓库纪律"**判定只有一份**"。若 IO 层也做比较，冷却 / 配额就有两份口径，迟早漂移 —— 而漂移的症状是
  "看板说跳过了、实际却跑了"（白花钱）或反过来（该跑没跑）。副作用是好的：整条八步流程可以不起 Redis 就单测。

### D7 · 顺手补齐 WP-D 的 3 个 env 登记缺口（跨单修补）

- `AUTO_PRACTICE_COUNSELOR_MODEL` / `AUTO_PRACTICE_WORKER_CONCURRENCY` / `ENGINE_VERSION` 这 3 个键**代码里早就在读**
  （`src/auto-practice/`），但 `.env.example` 一直没登记 —— 导致 WP25 的 env 双向守卫断言①在 **HEAD 上就是红的**。
- **处理**：本单顺手登记（生效行留空 = 用代码缺省，**不改任何行为**），并在 `.env.example` 与 `typings/global.d.ts` 里注明来由。

### D8 · 影子路径的"成功"口径有限（已知局限）

- 熔断只保护生效路径（任务单 §2.1：熔断是生效模式才有的）。生效路径的 `produce()` 是**真的跑 LLM**，它的失败是真失败。
- 影子路径的 `runShadowMode` 只是**入队**（BullMQ），入队成功 ≠ LLM 成功 —— 真正知道 LLM 结果的是 Worker。
- **结论**：影子的"成功"只表示链路通。若将来要让熔断精确反映 LLM 失败率，应由 Worker 回报（登记为后续项）。

### D9 · 任务单 §5.2 第 5 条"集成验证"未做（环境所限）

- "跑一场 auto-practice 批量验证，确认 Redis 里有 trace 数据"需要真实 MySQL / Redis / 模型服务，开发机不具备。
- **替代**：单测覆盖了等价路径（trace 写入内容 + key 形状 + TTL 常量 + 记账副作用）；真实链路留给大炮在有环境时验。

---

## 四、测试闸门（数字）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| Lint（本单涉及文件） | `npx eslint src/engine-adapters/deliberation-gate src/engine-adapters/rendering/turn-render-orchestrator.ts src/engine-adapters/wiring/engine.providers.ts src/engine-adapters/wiring/engine.module.ts test/engine-adapters/deliberation-gate` | **0 error** |
| Lint（`src` + `test` 全量） | `npx eslint src test` | 本单 **0 error**；仅剩 2 个**既有** CRLF 报错文件（`test/vitest.e2e.mts` / `test/vitest.graphql-plugin.mts`，与本单无关，HEAD 即红） |
| 闸门单测 | `npx vitest run test/engine-adapters/deliberation-gate/` | **2 文件 / 55 例全绿** |
| 全量回归 | `npx vitest run` | **144 文件通过 / 5 跳过；2468 例中 2449 通过 / 19 跳过，0 失败** |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | **空** |

---

## 五、交付物清单

### 5.1 新增（9 个文件）

```
src/engine-adapters/deliberation-gate/deliberation-gate.types.ts
src/engine-adapters/deliberation-gate/deliberation-gate.config.ts
src/engine-adapters/deliberation-gate/deliberation-gate.evaluator.ts
src/engine-adapters/deliberation-gate/deliberation-gate.quotas.ts
src/engine-adapters/deliberation-gate/deliberation-gate.trace.ts
src/engine-adapters/deliberation-gate/deliberation-gate.service.ts
src/engine-adapters/deliberation-gate/deliberation-gate.module.ts
test/engine-adapters/deliberation-gate/evaluator.spec.ts
test/engine-adapters/deliberation-gate/quotas.spec.ts
```

### 5.2 修改（4 个文件）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | deps 加 `gate?` 端口；`deliberationRound()` 拆成"闸门判定 + 发起审议"两段；影子 / 生效的发起逻辑抽成 `fireShadowDeliberation` / `fireEffectDeliberation`（共用同一份入参）；审议执行结局回报给熔断器 |
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineOrchestratorDeps.gate?` + 工厂透传 |
| `src/engine-adapters/wiring/engine.module.ts` | import `DeliberationGateModule`；门面 useFactory 注入闸门 |
| `.env.example` / `typings/global.d.ts` | 登记 12 个闸门 env 键（生效区 + ProcessEnv）+ 顺手补 WP-D 的 3 个（见 D7） |

### 5.3 没碰的

- ❌ `src/engine-core/**` —— **零改动**（红线）。
- ❌ 审议输出格式（deltas + reason + operatorTags + intentionShift）—— 未动。
- ❌ 审议钩子的调用方式（`produce()` / `runShadowMode()` 的签名与参数）—— 未动，只在外面加了一道闸门。
- ❌ 审议 prompt —— 未动（闸门只在**要不要跑**这一层做文章）。
- ❌ 对话原文流向 —— 未动。闸门只看结构化数据（前后快照 / 事件标签 / 风险等级），**类型层面装不下原文**。

---

## 六、回写清单

| 位置 | 改了什么 |
|---|---|
| `docs/worklog/pending/phase2.5-README.md` | 状态行 → WP-C 已完成；WP 清单行 → ✅ + 任务单/交付记录链接；§3 下一个活 → WP-E |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` | 状态行 → WP-C 已交付；WP-C 行 → ✅ + 链接；出口条件 ③ → 🚧 闸门已交付、阈值待 WP-E 校准 |
| `docs/worklog/completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate.md` | 任务单从 `pending/` 迁到 `completed/`，状态行 → ✅ 已交付 |

---

## 七、遗留与后续

1. **阈值是工程种子值，不是临床数字** —— 影子期跑数据后由 WP-E 拿督导解析当 ground truth 回来校准。
2. **影子路径的熔断口径有限**（D8）—— 要精确反映 LLM 失败率，需由 BullMQ Worker 回报。
3. **闸门没有总开关** —— 任务单参数表未列；将来若要"一键回到每轮都跑"，加一个 `ENGINE_DELIBERATION_GATE_ENABLED` 即可（配置层一行）。
4. **集成验证待补**（D9）—— 需要真实环境的 auto-practice 批量跑 + Redis trace 抽查。
5. **admin 面板**（`admin-dashboard/src/views/GateDecisions.vue`）由另一个 AI 负责，本单只保证 trace 的 key 形状与字段口径稳定可读。

---

## 八、commit message 草稿

```
feat(wp-c): 触发式审议闸门——不确定性驱动+影子/生效双轨+配额熔断保护
```