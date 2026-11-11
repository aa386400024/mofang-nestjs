# G123-P1E3 · 审议场景硬隔离 + 指纹诚实化 + rule_only 留痕 + 真实 LLM 批次验证（企业级修复 + 验证）

> 状态：✅ 已交付（2026-11-11）→ 交付记录：[g123-p1e3-deliberation-scenario-fingerprint-semantic-batch-implementation-2026-11-11.md](./g123-p1e3-deliberation-scenario-fingerprint-semantic-batch-implementation-2026-11-11.md)
> 执行方：MiniMax Code（用户手动转述，单任务队列，一次只做这一单）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`（基线 HEAD `4eda25a`，工作树干净）
> 唯一事实源：
>
> 1. `docs/worklog/completed/phase2.5/audit-d1-deliberation-fingerprint-2026-11-11.md`（G-1/G-2/G-3 根因与修复方向，§三 A1.4/A2.4/A3.4、§7.2）
> 2. `docs/worklog/completed/phase2.5/p1e3-visitor-semantic-tag-migration-2026-11-11.md`（真实批次步骤 §5.5、L-P1e 遗留 §六）
>    任务性质：bug 修复（G-1/G-2/G-3）+ 纯验证（P1e-3 真实 LLM 批次）
>    改动范围：**仅后端 `src/test/scripts` + 远程库只读/写入验证**；不写 `admin-dashboard/`，不碰 Flutter

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` —— 仓库总览
2. `docs/README.md` —— 文档导航
3. `docs/team/conventions.md` —— 代码红线 + 交付格式（engine-core 分层、16 条硬约束、隐私分层）
4. `docs/team/wp-task-template.md` —— 任务单结构与交付回写清单
5. 本任务两份事实源（见头部），逐条核对，**不要照抄本单措辞，以现场代码为准**
6. 本任务单（你在读的这份）

> 纪律：本单所有文件:行号均已在基线 `4eda25a` 上核实。若现场代码与本单锚点不符，先 grep 定位真实函数/调用链，在交付记录里写明偏差与理由，不许凑活做、不许默默改了不提。

---

## 1. 背景（先读，方向别错）

Phase2.5 A 类 10 项已落成 7 单并整批验收通过（tsc/lint/全量 2991 例全绿，单 commit `4eda25a` 已推送）。AUDIT-D1 在审计审议链路与推理指纹时，发现三个**记录与运行时不一致 / 不可审计**的缺口，按严重度登记为 G-1（P0）、G-2（P3）、G-3（P2）；P1e-3 的代码迁移已交付，离线 76 份/802 轮三形态对比证明新形态解析零降级，但**真实 LLM 批次验证**当时因本地 MySQL/Redis 未启动被阻塞。

**新事实（阻塞已解除）**：MySQL 与 Redis 都在**远程服务器**上，`.env` 已配置且安全组开放端口，无需本地起容器。

### 关键现状（已核对，别当新问题）

- 审议三态：`DeliberationEffectiveMode = 'shadow' | 'rule_only' | 'llm_active'`（`deliberation-mode.config.ts:43`）。
- 运行时逐场判定 `resolveSessionEffectiveMode(modeConfig, sessionId)`（`:188`）当前**只看会话白名单，不看场景类型**；`isLlmDeliberationActiveForSession`（`:204`）同理。
- `ScenarioRouteConfig`（`:58-65`）是**死结构**：`scenarioRoutes` 零业务消费方，exam 恒 `'rule_only'` 只写在类型里，运行时没接。
- 内核侧 `DeliberationHookContext`（`engine-core/runtime/deliberation-hook.port.ts:45-77`）只有 snapshot/ruleDelta/counselorText/tenantId/sessionId/turnIndex/currentRevision，**物理上不含场景类型**；内核零改动红线禁止给该端口加字段 → 场景只能在**适配层**按 sessionId 反查，不能改内核契约。
- 推理指纹 `inference-fingerprint.service.ts:149` 用 `scenarioType==='exam' ? 'rule_only' : resolveGlobalDeliberationMode()`：exam 落库正确，但非 exam 只回**全局模式**、不做逐场白名单匹配，且与运行时是**两份独立实现**，存在漂移风险。
- **sessionId 双口径（关键陷阱）**：自动对练里运行时钩子的 `context.sessionId` 是**引擎/调试会话 id（debugSessionId，`debug-chat-...`）**——`EngineTurnService.open` 经 `debug-session.service.ts:458` 用 `sessionId: debugSessionId` 注册；而指纹 `build` 末尾收到的是**业务场次 id（practiceSessionId）**。两者不同。要让落库与运行时同源，指纹侧必须用与运行时一致的**引擎侧 session id（debugSessionId）**调同一判定函数。
- 闸门 `DeliberationGateService` 恒挂（`engine.module.ts:445`），但 `rule_only` 下 shadow/effect 两端口都不装配，`deliberationRound`（`turn-render-orchestrator.ts:785`）提前 return，`gate.evaluate` 一次都不调用 → `gate_decisions` 恒 0 行，无法区分"该跑没跑"与"本不该跑"。
- 失败场次：`openSessionOrFail` 失败分支（`practice-runner.service.ts:668-679`）`persistSession` 不带 promptVersion；`run()` 在 `openResult.failed` 提前 return（`:269-271`）→ failed 行 `prompt_version` 恒 NULL。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **G-1（P0）**：场景类型接入审议运行时——exam 场次任何全局模式下都不跑 LLM 审议；落库 `deliberation_mode` 与运行时经**同一判定函数、同一引擎侧 session id、同一场景**出值。
2. **G-2（P3）**：引擎开不起来的失败场次也写入 prompt 模板版本（fail-closed 回落 `'unknown'`），其余指纹字段保持 NULL（引擎未开），只补 promptVersion 一个。
3. **G-3（P2）**：`rule_only` 路径补一条结构性 skip 留痕（新增可枚举 reason/mode），三写各自 try/catch、写失败只 warn 不炸主流程。
4. **P1e-3 收尾**：连远程 MySQL/Redis → 必要时 `migration:run`（仅应用既有迁移，本单不加迁移）→ 起服务 → 调真实批次接口 → 按 §3.4 SQL/扫描取真实数字并回填。

### 明确不在范围内（禁止顺手做）

- **不改 `src/engine-core/**` 任何文件**：`git diff --stat HEAD -- src/engine-core` 必须为空；`boundary.spec.ts` 不许改。场景在适配层反查，不碰内核端口。
- **本单不加表、不加列、不加 migration**：G-1/G-2/G-3 全部走逻辑/枚举改动；gate 的 mode/decision/reason 列均为 varchar，接受新枚举值，无需 DDL。
- 不写 `admin-dashboard/` 前端；Flutter 不碰；不跑前端构建。
- 不改 `semantic-tag-parser`/TTS 映射/`visitor_semantic_level` 落库口径；不把 TTS 层机制混进本单（本单是文字/审议链路）。
- 不碰任何角色的 `enabled`/`audit_status`/`version`/内容字段；不清理既有技术债（L-P1e-1/2/3、I-20 L-4 等保持登记，不就地清）。
- **在线放量/灰度比例/回滚条件由用户拍板**，执行方不自动做在线切换；本单只交付真实批次的验证数字。
- 不自动 commit/push；写完给一行 conventional commit 草稿，等用户指令。
- **`.env` 已 gitignore，本单会进版本库：禁止把任何密码/密钥/连接串写进任务单或交付记录，只引用 `.env` 键名（`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`、`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_DB`/`REDIS_KEY_PREFIX`）。**

---

## 3. 目标架构 / 交付物

> 设计原则固定四条：单一真相源 / 内容与逻辑分离 / 出错当场炸不进库 / 幂等。
> 口径真相源：逐场审议模式的**唯一**判定函数是 `resolveSessionEffectiveMode`；运行时钩子与落库指纹都调它，谁也不另抄一份。

### 3.1 工作项一 · G-1：场景类型接入审议运行时（P0）

#### 3.1.1 纯配置层 —— `src/engine-adapters/deliberation/deliberation-mode.config.ts`

1. 新增规范场景类型（与 `ScenarioRouteConfig` 键、auto-practice `ScenarioType` 三者对齐）：

```ts
/** 审议侧规范场景类型（适配层权威定义；auto-practice 的 ScenarioType 改为 import/re-export 本类型，禁止两份漂移）. */
export type DeliberationScenarioType = 'freeform' | 'full_simulation' | 'exam';
```

2. 改 `resolveSessionEffectiveMode`，加第三入参，**exam 首条命中**（在全局模式/白名单一切判定之前）：

```ts
export function resolveSessionEffectiveMode(
  modeConfig: DeliberationModeConfig,
  sessionId: string,
  scenarioType: DeliberationScenarioType,
): DeliberationEffectiveMode {
  // 场景红线：考核场景恒 rule_only（可复现性，优先于一切全局/白名单判定，不接受配置覆盖）.
  if (scenarioType === 'exam') return 'rule_only';
  if (modeConfig.effectiveMode === 'rule_only') return 'rule_only';
  if (modeConfig.effectiveMode === 'shadow') return 'shadow';
  if (modeConfig.grayscaleSessions.size === 0) return 'llm_active';
  return modeConfig.grayscaleSessions.has(sessionId) ? 'llm_active' : 'rule_only';
}

export function isLlmDeliberationActiveForSession(
  modeConfig: DeliberationModeConfig,
  sessionId: string,
  scenarioType: DeliberationScenarioType,
): boolean {
  return resolveSessionEffectiveMode(modeConfig, sessionId, scenarioType) === 'llm_active';
}
```

#### 3.1.2 钩子层 —— `src/engine-adapters/deliberation/llm-deliberation-hook.ts`

内核上下文不含场景，钩子经**外部场景解析器**按 sessionId 反查：

1. 新增窄端口（零内核改动）：

```ts
/** 场景反查端口（适配层；内核拿不到场景，由装配侧提供按 sessionId 的解析）. */
export interface DeliberationScenarioResolver {
  resolveScenario(sessionId: string): DeliberationScenarioType | undefined;
}
```

2. 构造函数追加**可选**解析器（放在现有 `now` 之后，保持既有 2/3 参构造的测试零回归），缺省解析器返回 `undefined`：

```ts
constructor(
  private readonly modeConfig: DeliberationModeConfig,
  private readonly runner: DeliberationRunner,
  private readonly now: () => number = () => Date.now(),
  private readonly scenarioResolver: DeliberationScenarioResolver = { resolveScenario: () => undefined },
) {}

/** 解析场景：反查不到时回落 full_simulation（exam 场次必然在 open 时已登记，不会被该兜底误降级）. */
private resolveScenario(sessionId: string): DeliberationScenarioType {
  return this.scenarioResolver.resolveScenario(sessionId) ?? 'full_simulation';
}
```

3. 两处闸门（现 `:196` applyDeliberation、`:226` produce）改为透传场景：

```ts
const scenario = this.resolveScenario(context.sessionId);
if (!isLlmDeliberationActiveForSession(this.modeConfig, context.sessionId, scenario)) return null; // produce 处为 return;
```

> 钩子是**最终强制点（defense-in-depth）**：即便闸门误判，produce 内这道判定仍会拦住 exam 的 LLM 调用。

#### 3.1.3 场景透传链（适配层，逐段接上，缺一段则该路径静默失效）

| #   | 文件                                                                                     | 改动                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/auto-practice/adapters/debug-turn-engine.adapter.ts`                                | `open(characterSlug, scenarioType)`（`:32`）把 scenario 传给 `debugSession.createSession(characterSlug, scenarioType)`，不再丢弃（`:33`）。                                                                                                                           |
| 2   | `src/admin-debug/debug-session.service.ts`                                               | `createSession`（`:444`）加可选 `scenarioType?: DeliberationScenarioType`；在 `engine.open(input, options)`（`:456`）的 options 加 `...(scenarioType ? { scenarioType } : {})`。恢复路径（`:688`）同口径，场景从调试记录读取（见 #6），旧记录缺省 `full_simulation`。 |
| 3   | `src/engine-adapters/wiring/engine-turn.service.ts`                                      | `open` 的 options（`:146-189`）加 `readonly scenarioType?: DeliberationScenarioType`；`registry.register`（`:196-215`）条件展开 `...(options?.scenarioType ? { scenarioType: options.scenarioType } : {})`。                                                          |
| 4   | `src/engine-adapters/rendering/turn-render-orchestrator.ts`                              | `TurnSessionContext`（`:150`）加 `readonly scenarioType?: DeliberationScenarioType`。                                                                                                                                                                                 |
| 5   | `src/engine-adapters/wiring/engine-turn.service.ts`（`EngineSessionRegistry`，`:52-88`） | 实现 `DeliberationScenarioResolver`：加 `resolveBySessionId(sessionId)` 扫描 contexts 匹配 `context.sessionId`，再加 `resolveScenario(sessionId)` 返回 `this.resolveBySessionId(sessionId)?.scenarioType`。                                                           |
| 6   | `src/admin-debug/debug-session-store.ts`（文件存储，非 DB）                              | `DebugSessionRecord`（`:77-111`）加**可选** `scenarioType?`；createSession 写入，restore 读取；旧文件无该字段 → `full_simulation`（向后兼容，非 migration）。                                                                                                         |
| 7   | `src/engine-adapters/wiring/engine.module.ts`                                            | `ENGINE_DELIBERATION_HOOK` 工厂（`:333-339`）`inject` 加 `EngineSessionRegistry`（同模块 `:173` 已提供），把 registry 作为第 4 参传给 `new LlmDeliberationHook(...)`。                                                                                                |

#### 3.1.4 落库指纹同源 —— `src/auto-practice/inference-fingerprint.service.ts`

1. 顶部 `ScenarioType`（`:85`）改为从审议配置 import/re-export 规范类型：`export type ScenarioType = DeliberationScenarioType;`（值集合不变，仅消除双定义）。
2. `build` 加**可选**第 6 参 `engineSessionId?: string`（引擎侧 session id）；删除 `:149` 的独立硬编码，改为调同一判定函数：

```ts
const modeConfig = resolveDeliberationModeConfig(this.config);
const engineSession = engineSessionId ?? practiceSessionId;
const deliberationMode = resolveSessionEffectiveMode(modeConfig, engineSession, scenarioType);
```

- `resolveDeliberationModeConfig` 为纯函数，与运行时注入的 `ENGINE_DELIBERATION_MODE_CONFIG` 同源（同一 ConfigService、同一纯函数，确定性逐字相等）。
- 会话种子 `sessionSeed` 仍按 practiceSessionId 计算（业务口径不变）。

3. `practice-runner.service.ts` 的 `buildFingerprintAndPersist`（`:707-713`）把已有的 `debugSessionId`（`:703`）作为第 6 参传入 → 指纹与运行时用**同一个 debugSessionId**，白名单匹配口径一致。

> 验收：同一 exam 场次，运行时 `resolveSessionEffectiveMode` 与落库 `deliberation_mode` 都得 `rule_only`；非 exam + llm_active 白名单内外，两侧逐场结果一致。

### 3.2 工作项二 · G-2：失败场次补 prompt 版本（P3）

1. `inference-fingerprint.service.ts` 加轻量公有方法（复用私有 `describePromptVersion` 与 `resolvePromptVersion`，**不跑**完整 build 的角色版本等）：

```ts
/**
 * 只解析 prompt 模板版本（引擎无关；fail-closed 回落 'unknown'）.
 * 用于引擎开不起来的失败场次：prompt 模板是静态文件，版本与引擎是否成功开启无关.
 */
resolvePromptVersionOnly(): string {
  return resolvePromptVersion(this.config.get('PROMPT_VERSION'), () => this.describePromptVersion());
}
```

2. `practice-runner.service.ts` 失败分支（`:668-679`）catch 内补写：

```ts
const promptVersion = this.fingerprintService.resolvePromptVersionOnly();
await this.persistSession(practiceSessionId, {
  /* 现有字段全部保留 */ ...,
  promptVersion,
});
```

> 最小修复：失败行只补 `prompt_version`（模型/种子/角色版本/审议模式/引擎版本仍 NULL——引擎未开，这些无定义）。`resolvePromptVersion` 显式 env → 模板指纹 → `'unknown'`，永不返 NULL/undefined。

### 3.3 工作项三 · G-3：rule_only 结构性 skip 留痕（P2）

#### 3.3.1 枚举与端口 —— `src/engine-adapters/deliberation-gate/deliberation-gate.types.ts`

1. `GATE_MODE_VALUES`（`:45`）追加 `'rule_only'`：`['shadow','effect','rule_only'] as const`（列是 varchar(16)，无 DDL）。
2. `GATE_REASON_VALUES`（`:76-108`）末尾追加 `'rule_only_skip'`（语义：本就处于纯规则态、不该跑审议，属"结构性跳过"，区别于 gate_error）。
3. 新增入参类型，并在窄端口 `DeliberationGatePort`（`:279`）加方法：

```ts
export interface GateRuleOnlySkipInput {
  readonly sessionId: string;
  readonly dbSessionId?: string | null;
  readonly userId?: string | null;
  readonly turnIndex: number;
}

// DeliberationGatePort 内：
recordRuleOnlySkip(input: GateRuleOnlySkipInput): Promise<void>;
```

4. 结构性跳过无阈值：定义空阈值记录并放宽 trace 类型。`GateTraceRecord.thresholdUsed`（`deliberation-gate.trace.ts:86`）放宽为 `GateThresholds | Record<string, never>`；新增 `export const EMPTY_GATE_THRESHOLDS: Record<string, never> = {}`。视图侧 `normalizeThresholds`（`gate-decision-view.ts:225`）对空对象已能回落零值，无需改读取逻辑。

#### 3.3.2 服务实现 —— `src/engine-adapters/deliberation-gate/deliberation-gate.service.ts`

```ts
async recordRuleOnlySkip(input: GateRuleOnlySkipInput): Promise<void> {
  const startedAt = Date.now();
  await this.deps.trace.record({
    sessionId: input.sessionId,
    dbSessionId: input.dbSessionId ?? null,
    userId: input.userId ?? null,
    turnIndex: input.turnIndex,
    mode: 'rule_only',
    decision: 'skip',
    reason: 'rule_only_skip',
    deltaSummary: {},
    thresholdUsed: EMPTY_GATE_THRESHOLDS,
    elapsedMs: Date.now() - startedAt,
    recordedAt: startedAt,
  });
}
```

#### 3.3.3 编排接线 —— `src/engine-adapters/rendering/turn-render-orchestrator.ts`

1. **全局 rule_only（两端口未装配）**：`deliberationRound` 现 `:785` 的 `if (!shadow && !effect) return;` 改为先留痕再返回：

```ts
if (!shadow && !effect) {
  this.fireRuleOnlySkip(handleId); // 内部 fire-and-forget + .catch(warn)
  return;
}
```

2. **exam 场景（effect 已装配但场景强制 rule_only）**：`runGatedDeliberation`（`:843`）在评估闸门前加场景短路：

```ts
if (round.context.scenarioType === 'exam') {
  this.fireRuleOnlySkipRound(round);
  return;
}
```

3. 新增私有 helper（复用 `resolveContext`/`output.turnIndex`），调 `this.deps.gate?.recordRuleOnlySkip(...)`，`void ... .catch((e) => warn(...))`；gate 缺省缺席时静默跳过（与既有窄端口纪律一致）。

#### 3.3.4 留痕形状、表体积与主流程安全（必须在交付记录里照实写）

- **形状**：每条结构性 skip 一行 `gate_decisions`（mode=`rule_only`、decision=`skip`、reason=`rule_only_skip`、delta_summary=`{}`、threshold_used=`{}`），同时 Redis 7 天 trace key + 日计数各写一次。
- **表体积**：每轮一条，N 场 × T 轮 = N×T 行（例：100 场 × 15 轮 = 1500 行；MySQL 量级可忽略）。Redis 每轮一个 7 天 TTL key + 日计数 HINCRBY。
- **主流程安全**：`DeliberationGateTrace.record` 的三写（Redis/stats/persistence）各自独立 try/catch（`deliberation-gate.trace.ts:148-152`），写失败只 `warn`，不抛、不阻塞对练；编排侧再兜一层 `.catch`。
- **统计响应口径**：`buildGateStatsResponse`（`gate-decision-stats.ts:209`）的 `byMode` 保持 `{shadow, effect}` 两键**不变**（不破坏响应契约）；rule_only 行计入 `total` 与 `byReason.rule_only_skip`，列表端点支持 `?mode=rule_only` 过滤。若看板要在 byMode 增加 rule_only 桶，登记为前端后续单，不在本单做。

### 3.4 工作项四 · P1e-3 真实 LLM 批次验证（远程库，纯验证）

#### 3.4.1 连接与起服务（凭证只在 `.env`，命令里不写明文）

1. 先验证远程连通（PowerShell）：`Test-NetConnection -ComputerName <$env:DB_HOST> -Port <$env:DB_PORT>` 与 Redis 端口同理，期望 `TcpTestSucceeded : True`。
2. 确保 schema 最新（本单不加迁移，仅应用既有迁移，幂等）：`pnpm migration:run`；连跑第二次应无 pending、不报错。
3. 起后端：`pnpm start:dev`（读 `.env` 指向远程 MySQL/Redis）。

#### 3.4.2 触发真实批次

- 入口：`POST /admin/api/auto-practice/batch`（`auto-practice.controller.ts:132`，前缀 `admin/api/auto-practice`，`AdminRoleGuard` 鉴权）。
- Body 形状（`BatchBody`，`:45`）：

```json
{
  "characterSlugs": ["<角色 slug>"],
  "counselorModeIds": ["<咨询师模式 id>"],
  "maxTurns": 15,
  "repeats": 1
}
```

- 建议先小批量（1 角色 × 1 模式 × repeats 1）跑通，再按需要放大；返回 `{ batchId, enqueued }`。批次经队列逐场执行，逐场落 `ap_practice_sessions`/`ap_practice_turns`。

#### 3.4.3 取数与判定（把真实数字回填交付记录，不许留空）

`ap_practice_turns` 中 `visitor_semantic_json` 存的是 `parsed.turn` 结构（`text/preSpeech/pauses/controlTags/emotion/unknownTags`）：

```sql
-- ① 降级级别分布（visitor_semantic_level NULL/0/1/2；NULL 与 0 语义不同，分别计数）
SELECT visitor_semantic_level, COUNT(*) AS n
FROM ap_practice_turns GROUP BY visitor_semantic_level ORDER BY visitor_semantic_level;

-- ② [pause] 命中率（pauses 数组非空）
SELECT COUNT(*) AS turns_with_pause FROM ap_practice_turns
WHERE JSON_LENGTH(JSON_EXTRACT(visitor_semantic_json, '$.pauses')) > 0;

-- ③ 情绪命中率（emotion 非 null）
SELECT COUNT(*) AS turns_with_emotion FROM ap_practice_turns
WHERE JSON_EXTRACT(visitor_semantic_json, '$.emotion') IS NOT NULL;
```

厂商标记扫描（逐字稿原文在文件、不在 DB；期望 **0 命中**）：

```powershell
# PowerShell 等价写法（避免裸 grep；在仓库根执行）
Get-ChildItem -LiteralPath data/debug-sessions -Filter 'debug_*.json' |
  Select-String -Pattern '[(](sighs|breath|laughs|chuckle|sniffs|humming|emm)[)]'
```

判定口径（对照 P1e-3 离线基线 §5.2 形态 C：新形态 0 降级 / pause 100% / emotion 100%）：

- 真实批次出现 L1/L2：先分清是**模型写错标记**（解析层纠正）还是解析层缺陷；解析层本身离线已证零降级。
- pause/emotion 命中率低于 100%：属**模型遵守率**问题（prompt 教法），不是解析问题；旧 prompt 实测带标记率 0/802，需在交付记录里如实对比。
- 厂商标记扫描期望 0；`convertedVendorTags` 上线后应恒 0，出现非 0 即两套标记混用/偷写。

> 本工作项只产出验证数字与结论；**在线放量/灰度/回滚由用户拍板**，执行方不自动切换。

---

## 4. 红线（违反即返工）

- **engine-core 零 diff**：`git diff --stat HEAD -- src/engine-core` 必须为空；`boundary.spec.ts` 不许改。场景经适配层反查，不碰内核端口与契约。
- **隐私**：心理对话原文/心理画像禁止进日志、console、crash report；本单所有留痕只含枚举/数值/id/阈值，trace 与 gate_decisions 零原文。
- **单一真相源**：逐场审议模式只由 `resolveSessionEffectiveMode` 出值；指纹与运行时不得各写一份判定；消费端不复算阈值。
- **不碰 schema/migration/映射口径**（本单无 DDL）；不越权加需求外功能；不清理既有债（显式登记）。
- 留痕三写失败只 warn，**永不绑架主流程**；失败场次只补 promptVersion，其余指纹字段保持 NULL。
- 不自动 commit/push；不使用 `--no-verify`；任务单/交付记录不写任何明文凭证。

---

## 5. 闸门（分层执行，填真实数字，禁止留"待用户执行"）

### 5.0 命令规范

- 一律 pnpm：脚本用 `pnpm <script>`，二进制用 `pnpm exec <bin>`；禁止裸 npx。

### 5.1 内循环（定向，高频）

- 单测：`pnpm exec vitest run <spec...>`（PowerShell 传多文件须 splat：`@files`，不要直接传数组变量）。
- 相关：`pnpm test:related -- <src/...>`；lint 走缓存 `pnpm lint`。

### 5.2 收尾全量闸门（交付前各跑一次，记录真实命令/exit/数字）

| 闸门        | 命令                                                    | 要求                                                                                |
| ----------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit`         | 0 error                                                                             |
| Lint        | `pnpm lint`                                             | 0 error，记 warning 数（区分既有债）                                                |
| 定向        | `pnpm exec vitest run <本单新增/受影响 spec...>`        | 全绿，记文件/用例数                                                                 |
| 全量测试    | `pnpm test`                                             | 全绿，记文件数/用例总数（基线 185 文件/2991 例：2987 passed + 4 skipped，0 failed） |
| engine-core | `git diff --stat HEAD -- src/engine-core`               | **空**                                                                              |
| 范围隔离    | `git status --short` + `git diff --stat`                | 仅本单授权文件，无 dist/锁文件/前端混入                                             |
| 任务特有    | 远程连通性、`migration:run` 幂等、§3.4 SQL/扫描真实结果 | 如实填数                                                                            |

> 跑不起来就写明报错原因，不许 silently skip；失败用例先单文件复跑区分确定性缺陷与 flake。

---

## 6. 交付记录（完成后写，路径固定）

写到：`docs/worklog/completed/phase2.5/g123-p1e3-deliberation-scenario-fingerprint-semantic-batch-implementation-2026-11-11.md`

内容必须含：

1. 一句话总结（四项各自结论）。
2. 实际实现 vs 本单方案，偏差逐条写原方案/实际/理由（conventions §2.5）。
3. 改动文件清单（新建/修改/删除，逐个一句用途）。
4. 闸门表：命令/exit/真实数字（error、warning、用例数）。
5. G-1 同源证据：exam 与非 exam 白名单内外，运行时与落库逐场对照；G-3 留痕形状与表体积；G-2 失败行 prompt_version 实际值。
6. P1e-3 真实批次：§3.4 三条 SQL 真实分布 + pause/emotion 命中率 + 厂商标记扫描结果（期望 0）。
7. 风险与回归：确认未碰 engine-core/schema/前端/解析口径；遗留项与人工复核清单。

---

## 7. 【交付回写清单】做完逐项勾选

- [x] 交付记录已写到 §6 固定路径。
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行 `📋 待执行` → `✅` 并链接交付记录。
- [x] 回写 `phase2.5-wp-list-2026-11-08.md` 本任务行状态与交付记录链接。
- [x] 回写 `phase2.5-README.md` §3 当前活表；G-1/G-2/G-3 状态在 backlog/活文档更新为已修复。
- [x] 既有遗留（L-P1e-1/2/3、I-20 L-4、byMode rule_only 前端桶等）保持登记，未就地清理。
- [x] `git diff --stat HEAD -- src/engine-core` 为空；范围隔离无 dist/前端/并行产物混入。
- [x] 给一行 conventional commit 草稿（**不自己 commit/push**，等用户指令）。

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文。
2. 报告闸门真实数字（tsc / eslint / 定向 / 全量）。
3. 报告 G-1/G-2/G-3 修复结论与 P1e-3 真实批次验证数字（含 pause/emotion 命中率、厂商标记扫描）。
4. 报告 §7 回写清单完成情况与遗留；不贴代码 diff，让用户自行 `git diff`。

---

## 附录 A · 专业依据与文献交叉引用

本单主体是**工程一致性与可审计性修复**，其依据是可观测性/审计的通用工程原则（单一真相源、fail-closed、观察面与主流程隔离、写失败不阻塞主流程），不构成新的学术主张，故不另造学术引用。

与"文字真人度 / 停顿 / 情绪"相关的设计依据，已在 `phase3-text-disfluency-humanization-plan-2026-11-11.md` **附录 C 文献依据**中固化（含不流利六分类、填充词/停顿/自我修正的频率锚点与 16 项三级证据），本单的 `[pause]`/`[emotion]` 语义标记与 rule_only 留痕沿用同一证据体系，直接交叉引用，不重复登记。

打断/插话按用户拍板**本轮不实现**，目标态与预留边界见 phase3 方案第 10 章（指标命名 `text.interruption.*` 本期不占 id）；未来接语音时纳入，不在本单开工。
