# G123-P1E3 交付记录 · 审议场景硬隔离 + 指纹诚实化 + rule_only 留痕 + 真实 LLM 批次验证

> **状态**：✅ 已交付（2026-11-11）
> **执行方**：MiniMax Code（用户手动转述，单任务队列，一次只做这一单）
> **仓库 / 分支**：`E:\Work\Project\backend\mofang-nestjs` · `integrate`
> **基线 HEAD**：`4eda25a`（工作树干净起步）
> **任务单**：[g123-p1e3-deliberation-scenario-fingerprint-semantic-batch-2026-11-11.md](./g123-p1e3-deliberation-scenario-fingerprint-semantic-batch-2026-11-11.md)
> **事实源**：[audit-d1-deliberation-fingerprint-2026-11-11.md](./audit-d1-deliberation-fingerprint-2026-11-11.md) · [p1e3-visitor-semantic-tag-migration-2026-11-11.md](./p1e3-visitor-semantic-tag-migration-2026-11-11.md)
> **改动范围**：仅后端 `src/` + `test/` + 本任务单/本记录；**未写** `admin-dashboard/`、**未碰** Flutter、**未改** `src/engine-core/**`

---

## 一、一句话总结（四项各自结论）

1. **G-1（P0）✅ 已修复**：场景类型接进审议运行时，`exam` 在**任何**全局模式/白名单下恒 `rule_only`；落库 `deliberation_mode` 与运行时改调**同一个** `resolveSessionEffectiveMode(modeConfig, sessionId, scenarioType)`，且**同一个引擎侧 session id（`debugSessionId`）**、**同一个场景类型**出值 —— 原"指纹用业务侧 practiceSessionId、运行时用引擎侧 debugSessionId"的**双口径漂移消失**。真实批次已验证：`llm_active` 与 `rule_only` 两侧落库值与运行时闸门留痕逐场一致。
2. **G-2（P3）✅ 已修复**：引擎开启失败的场次也写 `prompt_version`（fail-closed 回落 `'unknown'`，本机实测 `ed0430680b4c8837`），**其余指纹字段保持 NULL**（模型/种子/角色版本/审议模式/引擎版本全 NULL —— 引擎没开，这些无定义，硬填即撒谎）。
3. **G-3（P2）✅ 已修复**：`rule_only` 路径补结构性 skip 留痕，新增枚举 `mode='rule_only'` / `reason='rule_only_skip'`（`decision='skip'`）；写入走既有三写（各自 try/catch + 只 warn），编排侧再兜一层 `.catch`，**不绑主流程**。真实批次产出 **195 行**结构化留痕（14 个 session）。
4. **P1e-3 ✅ 验证完成**：远程 MySQL/Redis 连通、`migration:run` 幂等、起服务跑真实批次 → §3.4 三条 SQL 真实数字已取：全表 **581 轮，`visitor_semantic_level=0` 占 581（零降级、零 NULL）**；`[pause]` 命中率 **0/581 = 0%**；`[emotion]` 命中率 **0/581 = 0%**（严格口径）；**厂商标记扫描 0 命中**（达成期望）。pause/emotion 为 0 属**模型遵守率**问题（prompt 教法），非解析层缺陷 —— 离线基线形态 C 已证新形态解析零降级且命中率 100%，但**实测旧 prompt 带标记率 0/802**，故真实批次同样是"从 0 到 1"。

---

## 二、实际实现 vs 本单方案（偏差逐条）

> 纪律：本单锚点均在基线 `4eda25a` 核实过；现场代码与本单不一致处按"先 grep 定位真实实现 → 取企业级最佳方案 → 在此登记"处理，**未凑活、未默默改**。

| #   | 本单原方案                                                                        | 实际实现                                                                                                                                                                        | 理由                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | §3.3.3-2：exam 短路加在 `runGatedDeliberation`（:843）评估闸门前                  | 短路加在 **`deliberationRound` 内、context 解析之后**（`turn-render-orchestrator.ts:817`）                                                                                      | 全局 `shadow` 模式下**影子端口是挂着的、同样会发 LLM 请求**。只短路 effect 路径挡不住影子路径 → exam 仍会烧 LLM。红线要求"exam 恒不发 LLM"，故短路必须挡在**两条路径之前**                                                                                     |
| D2  | §3.3.1-3：`DeliberationGatePort.recordRuleOnlySkip(input): Promise<void>`（必选） | **可选方法** `recordRuleOnlySkip?(input): Promise<void>`                                                                                                                        | 与既有窄端口纪律一致（`reportOutcome?` 同款）。编排侧 `typeof gate.recordRuleOnlySkip !== 'function'` 守卫 → 闸门缺席/旧实现时静默跳过，不炸主流程（红线：留痕永不绑架主流程）                                                                                 |
| D3  | §3.3.1-4：放宽 `GateTraceRecord.thresholdUsed`                                    | 放宽范围**多两处**：`gate-decision-view.ts` 的 `normalizeThresholds` 入参 + `gate-decision.entity.ts` 的列类型                                                                  | 空阈值 `{}` 会流到视图归一化与实体映射，类型不同步则 tsc 不过。**列仍是 json，无 DDL**                                                                                                                                                                         |
| D4  | §3.1.3-3：`registry.register` 条件展开 `{ scenarioType }`                         | 归属组装拆成 `buildSessionContext` / `buildRenderAttribution` / `buildDeliberationAttribution` 三个方法，保留 `{ verbalVoice: options.verbalVoice }` 等既有**字面量形态**       | 仓库既有 `wp-j-p2-verbal-voice-wiring.spec.ts` 用**源码扫描**钉死该字面量。第一次改成"循环表 + 字段名映射"导致该守卫测试失败（`expected ... to contain '{ verbalVoice: options.verbalVoice }'`）→ 改用拆方法保留字面量形态，同时把 `open` 的 complexity 降下来 |
| D5  | §3.1.3-2：恢复路径场景"从调试记录读取"，未指定载体                                | 载体是**调试记录文件**（非 DB）：`DebugSessionRecord.scenarioType?`（`debug-session-store.ts`），写于 `persistCreate`，恢复读 `record.scenarioType ?? 'full_simulation'`        | 调试记录本就是文件存储；旧文件缺该字段 → 回落 `full_simulation`（向后兼容，**非 migration**）                                                                                                                                                                  |
| D6  | §3.4.1：`pnpm start:dev` 起服务                                                   | 改用 `pnpm exec nest start`（**不带 `--watch`**）                                                                                                                               | 本次跑批时 `nest start --watch` 陷入"编译完成 → 检测到文件变化 → 再编译"死循环（连 6 轮未进入 Nest 启动）。改用无 watch 形态启动，日志确认 `[r9] 审议生效模式=llm_active 灰度名单=全量`                                                                        |
| D7  | §3.4.3-③：`JSON_EXTRACT(...,'$.emotion') IS NOT NULL`                             | 该口径在 MySQL 上**有缺陷**：JSON `null` 的 `IS NOT NULL` 返回 1（实测 `JSON_EXTRACT('{"a":null}','$.a') IS NOT NULL` = 1，`JSON_TYPE` = `'NULL'`）→ 原 SQL 实测 581/581 = 100% | 本单 §3.4 的 SQL 原样跑（原始数字如实登记），**同时并列给出严格口径** `JSON_TYPE(...)= 'STRING'` → **0/581 = 0%**、`emotion_null=581`。属**任务单 SQL 口径缺陷**，不是代码缺陷 → 建议后续单修 §3.4 文档口径                                                    |
| D8  | §3.4.2：批次接口触发"真实批次"                                                    | 批次接口 `BatchBody` **不暴露 `scenarioType`**（只有 4 个字段）→ **exam 场景无生产 HTTP 入口**                                                                                  | 本单不改公共契约（范围外）。exam 的证据来自**单测层**（同判定函数 + 真实 hook 调用次数），已在 §五 如实标注                                                                                                                                                    |
| D9  | §3.1.2：钩子默认 resolver `{ resolveScenario: () => undefined }`                  | 实现写 `() => void 0`                                                                                                                                                           | 逐字等价，仅语法偏好                                                                                                                                                                                                                                           |
| D10 | （本单未提）                                                                      | `ENGINE_DELIBERATION_GRAYSCALE_SESSIONS` **不支持通配符**：填 `'*'` 会被当普通 id → 名单非空 → 全部落 `rule_only`；**空名单才 = 全量**                                          | 实操踩坑记录：首轮想用 `'*'` 表达"全量"失败（0 命中），改为**不设该键**（空 = 全量）才跑通 `llm_active`。运维注意项，不属代码缺陷                                                                                                                              |
| D11 | §3.1.4：指纹改调同一判定函数                                                      | 额外**删除**了 `inference-fingerprint.service.ts` 里独立的 `resolveGlobalDeliberationMode()`（第二份真相源）                                                                    | 单里要求"删掉 `resolveGlobalDeliberationMode` 这份独立实现"，但未点名函数名；现场核实其存在并删除，避免"同一件事两份判定"复发                                                                                                                                  |
| D12 | §3.3.2：`thresholdUsed` 空阈值                                                    | 用 `EMPTY_GATE_THRESHOLDS = {}`（空对象），**不是**零值三元组                                                                                                                   | 结构性跳过**没做判定**，填零值阈值等于伪造判定依据                                                                                                                                                                                                             |

---

## 三、改动文件清单（18 改 + 1 新增，`git diff --stat`：669 insertions(+) / 103 deletions(-)）

### 3.1 G-1 · 场景类型接入审议运行时 + 指纹同源（9 文件）

| 文件                                                           | 改动                                                                                                                                                                                                                                                                                                                 | 用途                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/engine-adapters/deliberation/deliberation-mode.config.ts` | 新增 `DeliberationScenarioType` + `DELIBERATION_SCENARIO_TYPES`；`resolveSessionEffectiveMode` / `isLlmDeliberationActiveForSession` 加第 3 参，**exam 首条命中返回 `rule_only`**                                                                                                                                    | 场景类型的**唯一权威定义** + 逐场模式的**唯一判定函数**                 |
| `src/engine-adapters/deliberation/llm-deliberation-hook.ts`    | 新增窄端口 `DeliberationScenarioResolver`；构造器加**可选第 4 参**（在 `now` 之后，既有 2/3 参构造零回归）；`applyDeliberation` / `produce` 两处判定透传场景；解析失败回落 `full_simulation`                                                                                                                         | 钩子是最终强制点：即便闸门误判，`produce` 内判定仍拦住 exam 的 LLM 调用 |
| `src/engine-adapters/wiring/engine-turn.service.ts`            | `EngineSessionRegistry implements DeliberationScenarioResolver`：新增 `resolveBySessionId` / `resolveScenario`；`open` options 提取为具名接口 `EngineTurnOpenOptions`（含 `scenarioType?`）；归属组装拆三方法                                                                                                        | 场景在**适配层按 sessionId 反查**，不碰内核端口契约；不建第二份状态     |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts`    | `TurnSessionContext` 加 `readonly scenarioType?`                                                                                                                                                                                                                                                                     | 编排层拿到场景（exam 短路用）                                           |
| `src/engine-adapters/wiring/engine.module.ts`                  | `ENGINE_DELIBERATION_HOOK` 工厂 inject `EngineSessionRegistry`，作第 4 参传入                                                                                                                                                                                                                                        | 装配侧提供场景反查能力                                                  |
| `src/admin-debug/debug-session.service.ts`                     | `createSession(characterSlug, scenarioType?)` → `engine.open` options 条件展开；`persistCreate` 落盘 `scenarioType`；恢复路径读 `record.scenarioType ?? 'full_simulation'`                                                                                                                                           | 场景随调试会话登记/恢复                                                 |
| `src/admin-debug/debug-session-store.ts`                       | `DebugSessionRecord` 加可选 `scenarioType?`；`parseRecord` 用 `readScenarioType()` 解析（非法值 → undefined）                                                                                                                                                                                                        | 文件存储承载场景（无 DB 变更）                                          |
| `src/auto-practice/adapters/debug-turn-engine.adapter.ts`      | `open` 把 `scenarioType` 透传给 `createSession`                                                                                                                                                                                                                                                                      | 自动对练 → 调试会话 → 引擎的透传链补齐（原在此处**丢弃**了场景）        |
| `src/auto-practice/inference-fingerprint.service.ts`           | `ScenarioType` 改为 `export type ScenarioType = DeliberationScenarioType`（re-export）；`build` 加**可选第 6 参** `engineSessionId?`；内部改用 `resolveDeliberationModeConfig(this.config)` + `resolveSessionEffectiveMode(modeConfig, engineSession, scenarioType)`；**删除**独立 `resolveGlobalDeliberationMode()` | 落库与运行时同函数、同 session id、同场景                               |

### 3.2 G-2 · 失败场次补 promptVersion（2 文件）

| 文件                                                 | 改动                                                                                                                                          | 用途                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/auto-practice/inference-fingerprint.service.ts` | 新增公有 `resolvePromptVersionOnly()`（复用 `resolvePromptVersion` + 私有 `describePromptVersion`）                                           | 只解析 prompt 模板版本（引擎无关），fail-closed 回落 `'unknown'` |
| `src/auto-practice/practice-runner.service.ts`       | `openSessionOrFail` 的 catch 分支 `persistSession` 补 `promptVersion: this.fingerprintService.resolvePromptVersionOnly()`；其余指纹字段仍不写 | 失败行只补一个字段，其余保持 NULL                                |

### 3.3 G-3 · rule_only 结构性 skip 留痕（6 文件）

| 文件                                                                                                    | 改动                                                                                                                                                                                                                                       | 用途                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/deliberation-gate/deliberation-gate.types.ts`                                      | `GATE_MODE_VALUES` 追加 `'rule_only'`；`GATE_REASON_VALUES` 末尾追加 `'rule_only_skip'`；新增 `GateRuleOnlySkipInput`；端口加**可选** `recordRuleOnlySkip?`                                                                                | 新枚举走 varchar 列（**无 DDL**）                                                                                                        |
| `src/engine-adapters/deliberation-gate/deliberation-gate.trace.ts`                                      | 新增 `export const EMPTY_GATE_THRESHOLDS: Record<string, never> = {}`；`GateTraceRecord.thresholdUsed` 放宽                                                                                                                                | 结构性跳过无阈值 → 用空对象而非伪造零值                                                                                                  |
| `src/engine-adapters/deliberation-gate/deliberation-gate.service.ts`                                    | 实现 `recordRuleOnlySkip()`（mode=`rule_only`、decision=`skip`、reason=`rule_only_skip`、deltaSummary=`{}`、thresholdUsed=`EMPTY_GATE_THRESHOLDS`；**不记配额**；写失败只 warn）                                                           | 留痕写入（复用既有三写器，不重写）                                                                                                       |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts`                                             | `deliberationRound`：① "两端口未装（全局 rule_only）"分支改为先 `fireRuleOnlySkip(...)` 再 return；② 新增 exam 场景短路；③ 新增私有 `fireRuleOnlySkip(context, turnIndex)`（fire-and-forget + `.catch(warn)`；闸门缺席/未实现 → 静默跳过） | 两条结构性跳过路径都留痕，且不绑主流程                                                                                                   |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision-stats.ts`                            | `byMode` **保持 `{shadow, effect}` 两键不变**（仅加注释）                                                                                                                                                                                  | 不破坏响应契约；rule_only 行计入 `total` 与 `byReason.rule_only_skip`；列表端点 `?mode=rule_only` 过滤由 `GATE_MODE_VALUES` 扩展自然支持 |
| `src/engine-adapters/deliberation-gate/gate-decision/gate-decision-view.ts` + `gate-decision.entity.ts` | `normalizeThresholds` 入参与 `thresholdUsed` 类型同步放宽                                                                                                                                                                                  | 见 D3                                                                                                                                    |

### 3.4 测试（1 新增 + 2 更新）

| 文件                                                                                     | 改动                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/engine-adapters/g123-deliberation-scenario-fingerprint.spec.ts`（**新增**，13 例） | G-1 落库↔运行时同源逐场对照、exam 两侧恒 rule_only、运行时钩子 exam 时 runner 调用数=0、白名单用引擎侧 session id、场景类型单一定义、registry 反查；G-2 `resolvePromptVersionOnly` fail-closed 与 env 优先；G-3 留痕形状（mode/reason/decision/thresholdUsed/deltaSummary）、写失败只 warn、不消耗配额 |
| `test/engine-adapters/r9-deliberation-mode-config.spec.ts`（更新，+3 例）                | 6 处 `resolveSessionEffectiveMode` 断言补第 3 参；新增：exam 在 llm_active+名单内 / 全局 shadow / 全局 rule_only 下**恒** rule_only；非考核场景不受影响；场景清单与 `ScenarioRouteConfig` 键一一对应                                                                                                   |
| `test/engine-adapters/r9-deliberation-hook.spec.ts`（更新，+3 例）                       | exam 场次一次 LLM 都不发 / 场景反查查不到回落 `full_simulation` / 逐场生效只有被标 exam 的那场被拦住                                                                                                                                                                                                   |

> **未改** `src/engine-core/**`（零 diff）、未改 `boundary.spec.ts`、未改 `admin-dashboard/`、未加表/列/migration。

---

## 四、闸门表（真实命令 / exit / 真实数字）

| 闸门             | 命令                                                                                                                                                                                                  | exit | 真实数字                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型             | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                                                       | 0    | **0 error**                                                                                                                                       |
| Lint             | `pnpm lint`                                                                                                                                                                                           | 0    | **0 error / 2 warning** —— 2 个 warning 均在 `src/auto-practice/metrics/batch-metrics.service.ts:23,25`（import/order），属**既有债**，与本单无关 |
| 定向（本单核心） | `pnpm exec vitest run test/engine-adapters/g123-deliberation-scenario-fingerprint.spec.ts test/engine-adapters/r9-deliberation-mode-config.spec.ts test/engine-adapters/r9-deliberation-hook.spec.ts` | 0    | **3 文件 / 44 例全绿**                                                                                                                            |
| 定向（闸门侧）   | `pnpm exec vitest run test/engine-adapters/deliberation-gate/quotas.spec.ts test/admin-debug/gate-decisions.spec.ts`                                                                                  | 0    | **4 文件 / 67 例全绿**                                                                                                                            |
| 全量测试         | `pnpm test`                                                                                                                                                                                           | 0    | **186 文件（185 passed + 1 skipped）/ 3008 例（3004 passed + 4 skipped，0 failed）**，Duration 80.42s                                             |
| engine-core      | `git diff --stat HEAD -- src/engine-core`                                                                                                                                                             | 0    | **输出为空**（零 diff 确认）                                                                                                                      |
| 范围隔离         | `git status --short` + `git diff --stat`                                                                                                                                                              | 0    | **18 个已修改文件 + 1 个新增测试**；18 files changed, 669 insertions(+), 103 deletions(-)；无 dist/锁文件/前端/临时脚本混入                       |

**基线对比**：基线 185 文件 / 2991 例（2987 passed + 4 skipped，0 failed）→ 本单后 **186 文件 / 3008 例**（**+1 文件 / +17 例**，0 failed）。

### 任务特有闸门（P1e-3）

| 项             | 命令 / 方式                                                   | 结果                                                                                                            |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 远程连通       | `Test-NetConnection`（从 `.env` 读主机/端口，**凭证未打印**） | `DB_TCP=True REDIS_TCP=True`                                                                                    |
| migration 幂等 | `pnpm migration:run` 连跑两次                                 | 两次均 `No migrations are pending`，exit=0（**本单未加任何迁移**）                                              |
| 起服务         | `pnpm exec nest start`（见 D6）                               | 启动日志 `[r9] 审议生效模式=llm_active 灰度名单=全量`（临时进程级 env 覆盖，**未改 `.env`**、未落任何配置文件） |
| 厂商标记扫描   | `Get-ChildItem data/debug-sessions -Filter 'debug_*.json'     | Select-String -Pattern '[(](sighs                                                                               | breath | laughs | chuckle | sniffs | humming | emm)[)]' | Measure-Object` | **0 命中** ✅（期望 0，达成） |

---

## 五、G-1 / G-2 / G-3 真实证据

### 5.1 G-1 同源证据（落库 vs 运行时，逐场对照）

**判定链**：落库侧 `inference-fingerprint.service.build` → `resolveSessionEffectiveMode(modeConfig, engineSessionId, scenarioType)`；运行时侧 `llm-deliberation-hook` → `isLlmDeliberationActiveForSession(modeConfig, context.sessionId, scenario)` → **同一个** `resolveSessionEffectiveMode`。两侧的 `sessionId` 都是**引擎侧** `debugSessionId`（指纹侧由 `practice-runner` 把已有 `debugSessionId` 作为第 6 参传入；`sessionSeed` 仍按业务侧 practiceSessionId，**业务口径不变**）。

| 场景                               | 批次 / 场次                                                                                                          | 落库 `deliberation_mode`                 | 运行时闸门留痕                                                                   | 判定                                                                                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全局 `llm_active`（名单空 = 全量） | `JEVjsoQx1HLtWHjzD4fbk` / session `rUpFI84Kj0izTUC1VuA4o`（debug `debug_vzsoFq1fuAsB_2nSFWM7D`），6 轮 completed     | **`llm_active`**                         | **mode=`effect` 5 行**（decision=`run` 1 + decision=`skip`/reason=`cooldown` 4） | ✅ **两侧同值**：库写 llm_active，运行时确实走审议路径（真发了 LLM 审议），不是被短路                                                                                                                                                                     |
| 全局 `rule_only`（缺省：总开关关） | `Z63FaBUOoYzNJt5eQq9dr` 12 场 / 165 轮 + `z_wnZoUfMZOzGcwiLeX-j` 1 场 / 15 轮 + `1ny10K91mHJjrAkidqQjY` 1 场 / 15 轮 | **`rule_only`**（全部 14 场）            | **mode=`rule_only` / decision=`skip` / reason=`rule_only_skip` 195 行**          | ✅ **两侧同值**                                                                                                                                                                                                                                           |
| `exam` 场景                        | **无生产 HTTP 入口**（批次接口不暴露 scenarioType，见 D8）                                                           | —                                        | —                                                                                | ⚠️ 证据在**单测层**：① `resolveSessionEffectiveMode` 在「llm_active+名单内 / 全局 shadow / 全局 rule_only」三种配置下 exam **恒 `rule_only`**；② 真实 hook 在 exam 场次 **runner 调用数 = 0**（一次 LLM 都不发）；③ 落库侧同函数同值 → 指纹与运行时恒一致 |
| 白名单内外对照                     | 单测层（`g123-...spec.ts`）                                                                                          | 名单内 `llm_active` / 名单外 `rule_only` | 逐场一致                                                                         | ✅ 口径统一到引擎侧 session id 后两侧逐场相同                                                                                                                                                                                                             |

> **全库 `gate_decisions` 现状**：**200 行 / 15 个 distinct session** —— `rule_only` 195 行 + `effect` 5 行。此前该表在 `rule_only` 下恒 0 行（无法区分"该跑没跑"与"本不该跑"），本单起有留痕。

### 5.2 G-2 失败行 `prompt_version` 实际值

| 场次                    | 批次                                                         | status / exit_reason | prompt_version            | model_version | seed_value | character_version | deliberation_mode | engine_version |
| ----------------------- | ------------------------------------------------------------ | -------------------- | ------------------------- | ------------- | ---------- | ----------------- | ----------------- | -------------- |
| `w5vvqhdI_0wsUz_vLapxM` | `m4RhhxYuOFdbYuvzf02aW`（用不存在的角色 slug，引擎开不起来） | failed / error       | **`ed0430680b4c8837`** ✅ | NULL          | NULL       | NULL              | NULL              | NULL           |

- 该场次是本单**故意触发**的失败路径（角色 slug 不存在 → `openSessionOrFail` 走 catch 分支）。
- 库中 28 条 failed 行里**仅此 1 条**（2026-11-11 本单窗口）有 `prompt_version`；其余 27 条均为 2026-11-09 的**修复前旧数据**（`with_prompt_version=0`）。
- 语义正确性：引擎没开起来时，模型/种子/角色版本/审议模式/引擎版本**无定义** → 保持 NULL 才是诚实（硬填即撒谎）。

### 5.3 G-3 留痕形状与表体积

**形状**（`gate_decisions` 一行）：

```text
mode = 'rule_only' | decision = 'skip' | reason = 'rule_only_skip'
delta_summary = {}   | threshold_used = {}   | elapsed_ms = <有值> | recorded_day = '2026-11-11'
```

- **不记配额**（结构性跳过不是一次闸门评估，不消耗冷却/额度）。
- **三写各自 try/catch + 只 warn**（`DeliberationGateTrace.record` 既有实现，**未重写**）；编排侧 `fireRuleOnlySkip` 再兜一层 `.catch(warn)`；闸门缺席或未实现该方法 → 静默跳过。
- **表体积**：每轮 1 行 → N 场 × T 轮。本次 14 个 rule_only 场次共 195 行（量级可忽略）。Redis 侧每轮 1 个 7 天 TTL trace key + 日计数 `HINCRBY`。
- **统计口径**：`byMode` 保持 `{shadow, effect}` 两键不变（不破坏响应契约）；rule_only 行计入 `total` 与 `byReason.rule_only_skip`；列表端点 `?mode=rule_only` 过滤由 `GATE_MODE_VALUES` 扩展自然支持。
- **零原文**：留痕只含枚举/数值/id/阈值，**零对话原文**（隐私红线 ✅）。

---

## 六、P1e-3 真实批次验证数字

### 6.1 批次清单（本单窗口）

| 批次 id                 | 场次 / 轮次                      | 审议模式       | 用途                                              |
| ----------------------- | -------------------------------- | -------------- | ------------------------------------------------- |
| `1ny10K91mHJjrAkidqQjY` | 1 场 / 15 轮                     | rule_only      | 真实批次（rule_only 侧）                          |
| `z_wnZoUfMZOzGcwiLeX-j` | 1 场 / 15 轮                     | rule_only      | 真实批次（rule_only 侧）                          |
| `Z63FaBUOoYzNJt5eQq9dr` | 12 场 / 165 轮                   | rule_only      | 真实批次放大（3 角色 × 2 咨询师模式 × repeats 2） |
| `m4RhhxYuOFdbYuvzf02aW` | 1 场 / 0 轮                      | —（NULL）      | **故意失败**（引擎开不起来）→ G-2 证据            |
| `JEVjsoQx1HLtWHjzD4fbk` | 1 场 / 6 轮                      | **llm_active** | **G-1 同源对照**（临时 env 覆盖，见 §四）         |
| **合计**                | **16 场（含 1 failed）/ 201 轮** | —              | —                                                 |

### 6.2 §3.4 三条 SQL 真实结果（全表 **581 轮**）

**① 降级级别分布**

```sql
SELECT visitor_semantic_level, COUNT(*) AS n FROM ap_practice_turns GROUP BY visitor_semantic_level ORDER BY visitor_semantic_level;
-- 实测: level=0 → n=581   （NULL=0 / L1=0 / L2=0）
```

→ **零降级达成**（L0 = 100%），且**无 NULL**（解析层没有"未知级别"漏写）。

**② `[pause]` 命中率**

```sql
SELECT COUNT(*) AS turns_with_pause FROM ap_practice_turns WHERE JSON_LENGTH(JSON_EXTRACT(visitor_semantic_json,'$.pauses')) > 0;
-- 实测: 0  →  0/581 = 0%
```

**③ 情绪命中率**

```sql
-- 任务单原口径（原始数字如实登记）
SELECT COUNT(*) AS turns_with_emotion FROM ap_practice_turns WHERE JSON_EXTRACT(visitor_semantic_json,'$.emotion') IS NOT NULL;
-- 实测: 581 → 581/581 = 100%   ⚠️ 该口径有缺陷, 见 D7
-- 严格口径（并列给出）
SELECT COUNT(*) AS total,
       SUM(JSON_TYPE(JSON_EXTRACT(visitor_semantic_json,'$.emotion'))='STRING') AS emotion_string,
       SUM(JSON_TYPE(JSON_EXTRACT(visitor_semantic_json,'$.emotion'))='NULL')    AS emotion_null,
       SUM(JSON_LENGTH(JSON_EXTRACT(visitor_semantic_json,'$.pauses'))>0)       AS with_pause,
       SUM(JSON_TYPE(JSON_EXTRACT(visitor_semantic_json,'$.preSpeech'))='STRING') AS prespeech_string
FROM ap_practice_turns;
-- 实测: total=581, emotion_string=0, emotion_null=581, with_pause=0, prespeech_string=0
```

→ **真实 emotion 命中率 0/581 = 0%**（严格口径）；原口径的 100% 是 MySQL JSON `null` 语义造成的假阳性。

**按批次拆分**（每个批次均为 l0 100%、with_pause=0、emotion_string=0）：

| batch_id                                    | 轮次 | L0  | L1  | L2  | NULL | with_pause | emotion_string |
| ------------------------------------------- | ---- | --- | --- | --- | ---- | ---------- | -------------- |
| `p1d-r3-intake-2026-11-11`                  | 188  | 188 | 0   | 0   | 0    | 0          | 0              |
| `verify-route1-p1d-2026-11-10`              | 172  | 172 | 0   | 0   | 0    | 0          | 0              |
| `Z63FaBUOoYzNJt5eQq9dr`（本单）             | 165  | 165 | 0   | 0   | 0    | 0          | 0              |
| `z_wnZoUfMZOzGcwiLeX-j`（本单）             | 15   | 15  | 0   | 0   | 0    | 0          | 0              |
| `1ny10K91mHJjrAkidqQjY`（本单）             | 15   | 15  | 0   | 0   | 0    | 0          | 0              |
| `JEVjsoQx1HLtWHjzD4fbk`（本单, llm_active） | 6    | 6   | 0   | 0   | 0    | 0          | 0              |
| `verify-jingchen-expert-retry-2026-11-11`   | 12   | 12  | 0   | 0   | 0    | 0          | 0              |
| `verify-verbal-voice-smoke-2026-11-10`(-r2) | 8    | 8   | 0   | 0   | 0    | 0          | 0              |

### 6.3 厂商标记扫描

- 命令见 §四；**命中 0**（期望 0，达成）。
- 含义：逐字稿里**没有** `(sighs)`/`(breath)`/`(laughs)`/`(chuckle)`/`(sniffs)`/`(humming)`/`(emm)` 等旧厂商标记 → **两套标记未混用**（`convertedVendorTags` 上线后应恒 0）。

### 6.4 结论与判读

| 观察                                                                          | 判读                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真实批次 `visitor_semantic_level` 全 0（581/581），零 NULL                    | ✅ **解析层零降级达成** —— 与离线基线形态 C（802 轮零降级）一致，真实 LLM 输出未引入新降级                                                                                                                                                                  |
| `[pause]` / `[emotion]` 命中率 **0%**                                         | ⚠️ **模型遵守率**问题（prompt 教法），**不是**解析层缺陷：离线用同一生产解析器解析 76 份真实逐字稿 → 新形态零降级、停顿/情绪命中 100%；而**旧 prompt 实测带标记率 0/802** → 本次真实批次同样是"从 0 到 1"，语义标记迁移的收益要在**新 prompt 上线后**才体现 |
| 厂商标记 0 命中                                                               | ✅ 达成期望，两套标记未混用                                                                                                                                                                                                                                 |
| `llm_active` 批次 1 场 6 轮：1 次 `effect/run` + 4 次 `effect/skip(cooldown)` | 闸门在 llm_active 下**确实评估并执行**（非结构性跳过）；`cooldown` 命中说明冷却机制按预期工作                                                                                                                                                               |

---

## 七、风险、回归与遗留

### 7.1 确认未碰（回归边界）

- **`src/engine-core/**` 零 diff**（`git diff --stat HEAD -- src/engine-core` 输出为空）；`boundary.spec.ts` 未改 → 内核端口契约与公开导出零变化。
- **零 DDL**：`gate_decisions.mode`/`reason`、`ap_practice_sessions.deliberation_mode` 均为既有 varchar 列，本单只扩**枚举取值**，未加表/列/索引/migration。
- **未写** `admin-dashboard/`、**未碰** Flutter、**未跑**前端构建。
- **未改** `semantic-tag-parser` / TTS 映射 / `visitor_semantic_level` 落库口径 —— §6 的 0% 命中率**未**通过改解析器"修"（那会把验证做成作弊）。
- **未做在线放量/灰度/回滚切换**（用户拍板事项）：`llm_active` 仅以**进程级临时 env 覆盖**用于验证，**未改 `.env`、未改任何配置文件**，跑完即停服。

### 7.2 遗留项（登记，**未就地清理**）

| 编号     | 遗留                                                                                                                              | 状态                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| L-G123-1 | 批次接口 `POST /admin/api/auto-practice/batch` 不暴露 `scenarioType` → **exam 场景无生产 HTTP 入口**，exam 的端到端证据只有单测层 | 待后续单（考核场景接线）                                |
| L-G123-2 | 闸门统计 `byMode` 仍只有 `{shadow, effect}` 两桶 → 看板看不到 `rule_only` 桶                                                      | 登记为**前端/看板后续单**（本单刻意不改响应契约）       |
| L-G123-3 | 任务单 §3.4 第 ③ 条 SQL 的 `IS NOT NULL` 口径对 JSON `null` 假阳性（实测 100% vs 严格 0%）                                        | 建议后续单修 §3.4 文档口径为 `JSON_TYPE(...)= 'STRING'` |
| L-G123-4 | 真实批次 `[pause]`/`[emotion]` 命中率 0% → 新语义标记 prompt 尚未放量                                                             | 待**在线切换**（用户拍板）+ 新 prompt 复跑              |
| L-G123-5 | `ENGINE_DELIBERATION_GRAYSCALE_SESSIONS` 不支持通配符（`'*'` ≠ 全量；空名单才是全量）                                             | 运维注意项，建议后续单在 `.env.example` 补注释          |
| 既有     | L-P1e-1/2/3、I-20 L-4、`disgusted`/`surprised` 语义层不表达等                                                                     | **保持登记，未就地清理**（任务单明令）                  |

### 7.3 人工复核清单

1. 看一眼 `gate_decisions` 中 `mode='rule_only'` 的 195 行：确认 `delta_summary={}`/`threshold_used={}`、`recorded_day='2026-11-11'`。
2. 看一眼失败场次 `w5vvqhdI_0wsUz_vLapxM`：`prompt_version` 有值、其余指纹字段全 NULL。
3. `llm_active` 批次的 `effect/run` 行 `delta_summary` 全 0（本次审议建议未产生状态增量，属模型输出，非本单链路问题）。
4. 在线切换（放量 / 灰度比例 / 回滚条件）**等用户拍板**，本单不代劳。

### 7.4 范围隔离登记

- 本单工作树产物：18 个已修改源文件 + 1 个新增测试 + 本任务单/本记录。
- **非本单产物（未跟踪、不触碰、不清理）**：`docs/team/gate-performance-remediation-2026-11-11.md`（另一次会话写的闸门提速方案）。
- 本单用过的临时脚本（`tmp-p1e3-*.mjs` 5 个）**已全部删除**（回收站可恢复），未进版本库；临时起服务的后台进程**已停**。

---

## 八、commit 草稿（**未执行**，等用户指令）

```text
fix(g123): 审议场景硬隔离+指纹同源+rule_only留痕，P1e-3 真实批次验证
```

> 建议正文补一行范围说明：`engine-core 零 diff / 零 DDL / 闸门 tsc 0 错 lint 0 错 2 warning(既有债) 全量 3008 例全绿`。
