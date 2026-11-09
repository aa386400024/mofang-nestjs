# WP-C 触发式审议闸门（Deliberation Gate Service）· 交付回复

> **回复完成时间**：2026-11-09 12:57:58 (GMT+8)
> **任务单**：`docs/worklog/completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate.md`
> **交付记录**：`docs/worklog/completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate-implementation-2026-11-09.md`

---

## 一、一句话结论

**WP-C 已一次性做完并全绿**：在 `src/engine-adapters/deliberation-gate/` 建了一个可独立拆分的审议闸门——
编排门面每轮渲染后先问它"这一轮要不要跑 LLM 审议"，只在**规则算不准**的地方跑（关键事件 / 置信清单外的事件类型 / 同盟或阻抗维度突变），
平静轮次直接跳过；冷却、会话配额、全局每分钟配额、熔断**全部走 Redis**（不依赖进程内存），影子与生效两套参数**互不干扰**。

验收四条全部达标：

| 验收项 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| `npx eslint`（本单涉及文件） | **0 error** |
| `npx vitest run test/engine-adapters/deliberation-gate/` | **2 文件 / 55 例全绿** |
| `git diff --stat HEAD -- src/engine-core` | **空**（红线达标） |

额外跑了全量回归：**144 文件通过 / 5 跳过；2468 例中 2449 通过 / 19 跳过，0 失败**。

---

## 二、实际实现（与任务单的方案对照）

### 2.1 七件套 + 三层分工

```
src/engine-adapters/deliberation-gate/
  ├── deliberation-gate.types.ts      ← 类型契约 (纯 TS, 零 @nestjs)
  ├── deliberation-gate.config.ts     ← env → GateConfig (12 个键, 逐个字面量读)
  ├── deliberation-gate.evaluator.ts  ← 八步决策流程 (纯函数, 零 IO)
  ├── deliberation-gate.quotas.ts     ← 冷却/计数/配额/熔断 (独占全部 Redis 读)
  ├── deliberation-gate.trace.ts      ← 决策 trace 写 Redis (TTL 7 天)
  ├── deliberation-gate.service.ts    ← 入口: 读状态 → 判定 → 记账 → 留痕
  └── deliberation-gate.module.ts     ← NestJS 模块 (注册 service)
```

| 层 | 文件 | 职责 | 红线 |
|---|---|---|---|
| **IO 层** | `quotas.ts` | 只读数字 / 写数字，**一个比较都不做** | 读失败一律取"最宽松"缺省（放行） |
| **判定层** | `evaluator.ts` | 只做比较，**一个 IO 都不做** | 纯函数，零 env / 零 Redis |
| **入口层** | `service.ts` | 串链路 + 兜异常 + 留痕 | 不抛；出错按"放行"处理 |

**为什么这么切**（本单最关键的一条治本）：任务单八步里有三步（冷却 / 配额 / 熔断）要读 Redis。
若把 IO 与判定混在一个 service 里，整条流程就只能"起 Redis 才能测"；切开后，
`evaluator.spec.ts` 能**不起 Redis 就覆盖整条八步流程**，而 Redis 抖动时的降级方向也一眼可见
（读失败 → 数字取最宽松缺省 → 判定自然放行）。

### 2.2 八步决策流程（逐条对齐任务单 §2.2）

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

- `unknown_event_type`：出现**规则置信清单外**的事件（LLM 专属的隐性阻抗 / 微表情 / 关系氛围，或内核 `neutral` 占位）——规则这轮没把握，交给 LLM 看；
- 置信清单**不复制**：直接引用 WP63 的 `DELIBERATION_RULE_ALIGNED_TAGS`（复制一份迟早漂移 = 影子期对比数据全废）；
- 状态前后对比**复用** WP-A 的 `buildStateComparison`，"能不能出境"**复用** WP-A 的 `isDeliberationRiskAcceptable` —— 判定只有一份。

### 2.3 两套参数（全部走 env，缺省值 = 任务单参数表）

| 参数 | 生效 | 影子 | env 键 |
|---|---|---|---|
| 同盟三维阈值 | 0.05 | 0.03 | `ENGINE_DELIBERATION_GATE_ALLIANCE_THRESHOLD_EFFECT` / `_SHADOW` |
| 阻抗三维阈值 | 0.08 | 0.05 | `ENGINE_DELIBERATION_GATE_RESISTANCE_THRESHOLD_EFFECT` / `_SHADOW` |
| 全平静阈值 | 0.03 | 0.03 | `ENGINE_DELIBERATION_GATE_CALM_THRESHOLD_EFFECT` / `_SHADOW` |
| 冷却轮数 | 4 | 1 | `ENGINE_DELIBERATION_GATE_COOLDOWN_EFFECT` / `_SHADOW` |
| 每会话最大次数 | 6 | 不限 | `ENGINE_DELIBERATION_GATE_MAX_PER_SESSION_EFFECT` |
| 全局每分钟配额 | 20 | 不限 | `ENGINE_DELIBERATION_GATE_GLOBAL_RPM` |
| 熔断 | 连续 5 次失败 → 10 分钟 | 不熔断 | `ENGINE_DELIBERATION_GATE_CIRCUIT_FAIL_COUNT` / `_CIRCUIT_COOLDOWN_MS` |
| 首轮强制跑 / 关键事件硬触发 / 危机轮跳过 | ✅ | ✅ | —— |

影子模式的三项"不限制"写成**显式哨兵值**（`GATE_UNLIMITED`），而不是"运行时按 mode 分支"——判定层因此完全不需要知道模式差异。

### 2.4 Redis key（状态全在 Redis，红线 3）

| 用途 | key | TTL |
|---|---|---|
| 会话冷却轮次 | `deliberation:gate:{会话长度}:{会话}:{mode}:last_turn` | 24 h |
| 会话计数 | `deliberation:gate:{会话长度}:{会话}:{mode}:count` | 24 h |
| 全局每分钟配额 | `deliberation:gate:global:rpm:{minute}` | 120 s |
| 熔断失败计数 / 截止时间 | `deliberation:gate:circuit:fail_count` / `:open_until` | 冷却时长 |
| 决策 trace | `deliberation:gate:trace:{会话长度}:{会话}:{轮次}:{mode}` | 7 天 |

### 2.5 对接点

- `turn-render-orchestrator.ts`：`deliberationRound()` 拆成"闸门判定 + 发起审议"两段；影子 / 生效的发起逻辑抽成
  `fireShadowDeliberation` / `fireEffectDeliberation`（**共用同一份入参**，杜绝"影子拿 A 快照、生效拿 B 快照"的分裂）；
  审议执行结局回报给熔断器。**没装闸门时走同步老路**（与本单之前逐字一致，既有单测不飘）。
- `engine.module.ts`：import `DeliberationGateModule`，门面 useFactory 注入。
- `engine.providers.ts`：`EngineOrchestratorDeps.gate?` + 工厂透传。

---

## 三、偏差说明（9 条，全部有理由）

| # | 任务单原方案 | 实际方案 | 理由 |
|---|---|---|---|
| D1 | deps 加 `gateService` 字段 | 加窄端口 `gate?: DeliberationGatePort` | 编排门面是**纯类**（零 @nestjs），塞 Nest service 会把框架拖进门面；仓库同款纪律（ShadowPort / EffectPort） |
| D2 | 每次 evaluate 两次（shadow+effect） | 只问**实际挂上去**的那条路径 | 二者在装配上互斥；问用不上的闸门会白消耗那一侧计数，观测也会失真 |
| D3 | `riskLevel === 'crisis'` | 复用 WP-A 口径：**只有 low 放行**，medium/high 都 skip | 仓库枚举没有 'crisis'；只挡 high 会让"危机意念层"出境 —— 是合规方向的倒退 |
| D4 | 理由码 11 个；不列"全平静"阈值 | 新增 `gate_error`（第 12 个）+ 2 个 CALM env 键 | 闸门自身故障要有可统计的码（复用 `rule_confident` = 撒谎）；0.03 是阈值，红线要求不写死 |
| D5 | `deliberation:gate:{sessionId}:{mode}:last_turn` | 加**会话长度前缀** | 仓库既有纪律（trace / circuit / BDI 状态仓储全用长度前缀）；撞键 = 跨会话串状态，且静默 |
| D6 | quotas 提供 `checkCooldown` 等带判定的方法 | quotas 只给 `read*` 原语，比较全在纯函数里 | "判定只有一份"：IO 层也做比较就有两份口径，漂移的症状是"看板说跳过、实际却跑了" |
| D7 | —— | 顺手补齐 WP-D 的 3 个 env 登记缺口 | `AUTO_PRACTICE_COUNSELOR_MODEL` / `AUTO_PRACTICE_WORKER_CONCURRENCY` / `ENGINE_VERSION` 代码里早就在读，模板没登记 → **WP25 守卫在 HEAD 上就是红的**；补上（留空 = 用代码缺省，零行为变化） |
| D8 | —— | 影子路径的"成功"只表示链路通 | 影子只是入队（BullMQ），真正知道 LLM 结果的是 Worker；熔断按任务单只保护生效路径 |
| D9 | §5.2 要跑一场 auto-practice 批量验证 | 未做（环境所限） | 需要真实 MySQL/Redis/模型服务；已用单测覆盖等价路径（trace 内容 + key 形状 + TTL + 记账副作用），真实链路留给大炮 |

---

## 四、交付物清单

### 新增（9 个）

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

### 修改（5 个）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | deps 加闸门端口；审议旁路拆成"闸门 + 发起"两段；结局回报熔断器 |
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineOrchestratorDeps.gate?` + 透传 |
| `src/engine-adapters/wiring/engine.module.ts` | import `DeliberationGateModule` + 注入门面 |
| `.env.example` | 12 个闸门键（生效区，生效行留空 = 用代码缺省）+ WP-D 的 3 个（D7） |
| `typings/global.d.ts` | 同 15 个键登记进 `ProcessEnv` |

### 文档

- 新增交付记录：`docs/worklog/completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate-implementation-2026-11-09.md`
- 任务单从 `pending/` 迁到 `completed/phase2.5/phase2.5-wp-c-triggered-deliberation-gate.md`，状态行 → ✅ 已交付
- 回写 `docs/worklog/pending/phase2.5-README.md`（WP-C 行 + 状态行 + 下一个活 → WP-E）
- 回写 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`（WP-C 行 + 状态行 + 出口条件 ③）

---

## 五、红线核对

- ✅ **engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` 为空。
- ✅ **不写死阈值**：12 个阈值/配额/熔断参数全部走 env，缺省值在 `deliberation-gate.config.ts`；非法值回退缺省，不抛错。
- ✅ **不依赖进程内存做状态**：冷却/计数/配额/熔断全在 Redis。
- ✅ **不改对话原文流向**：闸门只看结构化数据（前后快照 / 事件标签 / 风险等级），`GateInput` 类型层面装不下原文。
- ✅ **不改审议输出格式 / 不改审议钩子调用方式**：只在外面加了一道"要不要跑"的闸门。
- ✅ **高风险轮次永远不跑 LLM 审议**：① 是纯判定，永远先于任何 Redis 读执行。
- ✅ **不自动 git commit / push**：未提交任何东西。

---

## 六、遗留与后续

1. **阈值是工程种子值，不是临床数字**——影子期跑数据后由 WP-E 拿督导解析当 ground truth 回来校准。
2. **影子路径熔断口径有限**（D8）——要精确反映 LLM 失败率，需由 BullMQ Worker 回报。
3. **闸门没有总开关**——任务单参数表未列；将来要"一键回到每轮都跑"，加一个 `ENGINE_DELIBERATION_GATE_ENABLED` 即可（配置层一行）。
4. **集成验证待补**（D9）——需真实环境的 auto-practice 批量跑 + Redis trace 抽查。
5. `admin-dashboard/` 下的改动（`GateDecisions.vue` 等）是**另一个 AI 的工作**，本单没碰前端。

---

## 七、commit message 草稿

```
feat(wp-c): 触发式审议闸门——不确定性驱动+影子/生效双轨+配额熔断保护
```