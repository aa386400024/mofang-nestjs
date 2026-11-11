# AUDIT-D1 · 审议链路只读核查：WP-B 场景纯规则 / I-15 gate_decisions 0 行 / I-14 prompt_version 填充率（纯验证）

> 状态：✅ 已交付（2026-11-11）→ [交付记录](audit-d1-deliberation-fingerprint-2026-11-11.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §三②；`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-14 / I-15；`src/engine-adapters/deliberation/deliberation-mode.config.ts`；`src/engine-adapters/rendering/turn-render-orchestrator.ts:815-854`
> 任务性质：纯验证（只读排查 + 审计文档；本单不改业务代码）
> 改动范围：纯文档（审计记录落 `docs/worklog/completed/phase2.5/`；如需连库取证只写只读 SELECT，不写迁移、不改表）

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` —— 仓库总览
2. `docs/README.md` —— 文档导航
3. `docs/team/conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 边界、§三 16 条硬约束）
4. 阶段入口：`docs/worklog/pending/phase2.5-README.md` → `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 本任务唯一事实源：上述 wp-list §三②、p1d-known-issues I-14 / I-15
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

Phase2.5 出口条件②「考核公平」目前是部分达标：`engine_version` / `prompt_version` 已落库可追溯，但「考核场景永远纯规则模式」尚未完成代码级核实。已知问题清单里 I-14（`prompt_version` 历史 1135/1136 行为 NULL，本批 16/16 落库）与 I-15（`gate_decisions` 表始终 0 行）两条根因未查。

**本单是只读审计**：沿调用链把三条问题的现状证据钉死，给出「现状是否符合设计 / 是否存在活的代码缺口 / 后续该派修复单还是登记 backlog」的结论。**本单不写修复代码**；若排查发现活缺口，只在交付记录里登记建议任务单条目，不在本单就地改。

### 关键现状（已核对，别当新问题）

- 审议三态：`'shadow' | 'rule_only' | 'llm_active'`，定义于 `src/engine-adapters/deliberation/deliberation-mode.config.ts:43`。env：`ENGINE_DELIBERATION_ENABLED`（总开关，缺省关）、`ENGINE_DELIBERATION_EFFECTIVE_MODE`（缺省 shadow）、`ENGINE_DELIBERATION_GRAYSCALE_SESSIONS`（会话白名单）、`ENGINE_DELIBERATION_TIMEOUT_MS`。总开关关 → 一律折叠 `rule_only`（config.ts:157-160）。
- 场景路由类型 `ScenarioRouteConfig` 已预留：`freeform` / `full_simulation` / `exam`，其中 `exam` 类型上恒为 `'rule_only'`（config.ts:58-65）；但 `resolveDeliberationModeConfig()` 里三张表恒全 `rule_only`（config.ts:163-167），场景类型机制（`VoiceSessionMode` 只有 text/voice）尚未建，路由逻辑未接（注释见 config.ts:49-56、145-146）。
- 装配链：`src/engine-adapters/wiring/engine.module.ts:399-450`。`modeConfig.effectiveMode === 'shadow'` 才挂 `deliberation`；`=== 'llm_active'` 才挂 `deliberationHook`；`gate: DeliberationGateService` 始终挂上，但注释写明「纯规则模式 = 压根没有审议路径 = 闸门一次都不会被调用」（engine.module.ts:432-436）。
- 闸门评估在 `turn-render-orchestrator.ts:867-892` `evaluateGate()`：`this.deps.gate` 为空直接 `return 'run'`；异常放行。`runGatedDeliberation()`（orchestrator.ts:843-854）只在 `shadow` / `effect` 端口实际存在时才调 `evaluateGate`——两个端口都没挂时，闸门不会被问到。
- gate trace 写库链：`DeliberationGateTrace.record()`（deliberation-gate.trace.ts:148-152）→ Redis trace + stats + `GateDecisionPersistencePort.write()` 落 `gate_decisions`；写失败只 warn 不抛（trace.ts:205-214）。
- `prompt_version` 写入点：`src/auto-practice/practice-runner.service.ts:731`（`persistSession` 落 `fingerprint.promptVersion`）；指纹服务 `src/auto-practice/inference-fingerprint.service.ts:162`；列实体 `auto-practice/entities/practice-session.entity.ts`、`practice-batch.entity.ts`；迁移 `src/migration/1714900000043-AddPromptVersionColumns.ts`。
- 初步假设（待审计证实或推翻，不要当成结论）：
  - I-15：生产缺省 `rule_only`（总开关未配）→ shadow/effect 端口都不挂 → `runGatedDeliberation` 里两个 `if` 都不进 → `gate.evaluate` 从不调用 → 0 行。若属实，0 行是**预期行为**而非装配漏接；是否需要为 `rule_only` 路径也写一条 skip 决策留痕，是设计决策，不在本单拍板。
  - I-14：历史 NULL 行大概率是加列迁移之前写入的旧场次（列后加、旧行 NULL 是默认现象），需按批次/时间戳对照指纹服务上线时点证实；并确认当前不存在第二条写 `ap_practice_sessions` 却漏写 `promptVersion` 的活路径。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- **A1 · WP-B 考核场景纯规则核实**
  1. 枚举仓库内所有会构造引擎会话（`EngineTurnService` / `TurnRenderOrchestrator` / `createEngineSessionPort`）的入口通道：语音对练、自动对练、admin-debug 调试面板、drills、training-exercise、counselor-exam、long-term-case、crisis-practice 等逐个确认是否走引擎审议链。
  2. 核实「考核」在代码里的真实映射：`counselor-exam.service.ts` 为题库 mock、不碰引擎；`ScenarioType`（`inference-fingerprint.service.ts`）里 `exam` 分支已硬隔离 `rule_only`（:149）。逐条说明每个引擎通道是否可能切到 `llm_active`。
  3. 结论模板：① 考核通道是否在构造上就不进审议链；② `ScenarioRouteConfig.exam` 预留类型与现状的差距；③ 出口②「考核场景永远纯规则」是否已由当前代码满足，若不满足，缺口具体在哪个接入口。
- **A3 · I-15 `gate_decisions` 0 行根因**
  1. 沿 `engine.module.ts` 工厂 → orchestrator deps → `runGatedDeliberation` → `evaluateGate` → `gate.evaluate` → `trace.record` → persistence.write 全链画出调用图，标注每一步在什么条件下跳过。
  2. 核实 `gate-decision.store.ts` 工厂装配（redis + persistence 端口）在自动对练链路是否真的带上了 MySQL persistence（不只 Redis）。
  3. 给出 0 行的定性结论：预期行为（rule_only 无审议路径）/ 装配漏接 / persistence 端口未注入 / 其他。附只读 SQL（`SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM gate_decisions;`）与 Redis trace key 是否存在的核查方法；不要求真库连跑，方法可由用户执行。
- **A2 · I-14 `prompt_version` 填充率突变根因**
  1. grep 全仓所有写 `practice_sessions` / `practice_batches` 的代码路径，确认除 `practice-runner.service.ts` 外是否还有第二条 INSERT/UPDATE 路径漏写 `promptVersion`。
  2. 对照迁移 `1714900000043` 上线时点与历史 NULL 场次的 `started_at` 区间，判断 NULL 是否全部先于指纹接线；查 git log 定位 `promptVersion` 写入加入 runner 的提交。
  3. 核实 `resolvePromptVersion`（`prompt-fingerprint.ts` / `config-fingerprint.ts`）在指纹算不出时回落 `'unknown'` 而非 NULL；若存在把 undefined/NULL 直接落库的分支，指出位置。
  4. 结论模板：NULL 行属于「历史旧行默认 NULL」还是「活路径漏写」；若是后者，指出文件:行。
- 输出审计记录（见 §6），三条各含：调用链证据（文件:行）、根因结论、是否存在活缺口、建议后续动作（修复单 / backlog / 无需动作）。

**明确不在范围内（禁止顺手做）：**

- 不改任何 `src/` 业务代码、不配 env、不加 migration、不改表结构、不加列。
- 不动 `engine-core/`（本单纯只读；`boundary.spec.ts` 不许改）。
- 不修改 `ScenarioRouteConfig` 场景路由接线（那是后续修复/功能单的事，本单只核实差距）。
- 不跑前端构建命令；不碰 Flutter。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。
- 既有技术债不在本单清理；发现的新问题只登记进审计记录的遗留清单。

---

## 3. 目标架构 / 交付物

- **交付物 1：审计记录** —— `docs/worklog/completed/phase2.5/audit-d1-deliberation-fingerprint-2026-11-11.md`，三节（A1 / A3 / A2），每节含调用链证据表（文件:行 + 一句话职责）、根因结论、活缺口判定、后续建议。
- **交付物 2：结论对照出口条件** —— 在审计记录开头给一张表：出口②考核公平现状是否满足、I-14/I-15 各自定性；若 README §2 WP-B 行（标 ✅）与 wp-list §三行（标 🚧）口径不一致，指出应以审计结论为准并写明建议回写方向（**只写建议，不在本单改文档**）。
- **交付物 3：测试** —— 本单无代码改动，不新增测试；内循环只需跑既有定向测试确认未受影响（`pnpm test:related -- src/engine-adapters/deliberation` 与 `src/auto-practice`，若无相关变更可只跑类型闸门）。

> **口径真相源**：审议模式判定唯一真相源是 `deliberation-mode.config.ts`；版本号口径唯一真相源是 `inference-fingerprint.service.ts`；审计文档不得另抄一套阈值/模式枚举。

---

## 4. 红线（违反即返工）

- 分层归属：本单只读，`src/engine-core/**` 零改动；`git diff --stat HEAD -- src/engine-core` 必须为空。
- 心理对话原文禁止进日志 / console / crash report（只出码与计数）；审计记录里不贴会话台词。
- 不凭印象下结论：每条根因结论必须挂文件:行证据；库内数字标「需用户连库复核」，不编造 COUNT。
- 审计发现的缺口不在本单修复；修复建议写成任务单条目（改动文件、为什么、验收点），留给后续派单。
- 不自动 commit/push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范（强制，禁止裸 npx）

- 一律 pnpm：跑脚本 `pnpm <script>`；直接跑二进制 `pnpm exec <bin> <args>`。

### 5.1 日常内循环

- 本单无 src 改动；如需确认既有链未被波及：`pnpm test:related -- src/engine-adapters/deliberation` 或 `pnpm test:changed`。

### 5.2 收尾全量闸门（任务只跑一次，交付前后台执行）

| 闸门        | 命令                                            | 要求                                                                 |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit` | 0 error                                                              |
| Lint        | `pnpm lint`                                     | 0 error，记 warning 数                                               |
| 测试        | `pnpm test`                                     | 全绿，记用例总数（基线 181 文件 / 2947 例：2942 passed + 4 skipped） |
| engine-core | `git diff --stat HEAD -- src/engine-core`       | 空（本单不应有任何内核改动）                                         |
| 任务特有    | `git status --short`                            | 改动文件仅为交付记录 md（docs/ 下）                                  |

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/audit-d1-deliberation-fingerprint-2026-11-11.md`

内容必须含：

1. 本单做了什么（一句话总结：三条问题的只读审计结论）
2. 三节证据链：每条问题的调用图（文件:行）、根因定性、活缺口是 / 否、建议后续动作
3. 改动文件清单（本单预期：仅 1 份交付记录 md）
4. 闸门表：命令 / exit code / 真实数字
5. 任务特有结果：考核通道枚举清单、gate trace 写库链条件表、prompt_version 写入路径清单、NULL 行时点对照方法
6. 风险与回归：确认未碰 engine-core / schema / 内容 / 状态字段
7. 遗留项与建议人工复核（连库 SQL、Redis key 核查、待派修复单条目）

---

## 7. 【交付回写清单】做完逐项勾选

- [ ] 交付记录已写到 §6 固定路径
- [ ] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改成 `✅` 并链接交付记录
- [ ] 回写 WP 登记表：`phase2.5-wp-list-2026-11-08.md` 中 WP-B / I-14 / I-15 对应行补审计结论链接（若审计结论改变状态口径，按结论回写；口径未定时标「待后续修复单」）
- [ ] 回写阶段入口：`phase2.5-README.md` §3 表中本审计条目挪走 / 改已完成
- [ ] 回写 backlog：`phase2.5-p1d-known-issues-2026-11-11.md` I-14 / I-15 两条补审计结论指针（根因未修则保留未处理状态）
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 提交分组已核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单 md
- [ ] 给一行 commit message 草稿（**不自己 commit/push**）

---

## 8. 回复输出约定

1. 说一句「已写入交付记录」并附路径，不贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest）；
3. 报告 §7 回写清单哪几项已做、有没有遗留；
4. 不贴代码 diff 全文，让用户自己 `git diff`。
