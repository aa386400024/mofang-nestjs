# AF-279 · AF-278 渲染遥测只读评审（生产可用性）

## 一、结论

AF-278 的渲染遥测**不影响渲染主流程**（纯旁路、未注入即跳过、实现抛错被吞、`engine-core` 零改动），六类指标的**隐私契约成立**（标签只有封闭枚举与配置项，无 prompt / 台词 / 会话 id / 原始错误文案）。

但其**指标口径不足以支撑线上告警与灰度判读**，发现 2 条 P0、8 条 P1、8 条 P2：

- **P0-1**：正常用户打断（barge-in）被计成 `degraded{cause="other"}` + `attempts{outcome="degrade"}`；
- **P0-2**：末次候选（及单候选部署）的失败原因在六个指标里**完全消失**——AF-278 立项要回答的「是超时、鉴权、限流还是候选耗尽」在最常见形态下仍回答不了。

**最终判定：需修后上**（若只做留痕观察可先合，看板侧标注偏差即可；若用于告警/判读须先修 P0）。

完整报告：`docs/worklog/pending/relay-response-AF-278-REVIEW-20261122-1400.md`。

## 二、评审方法

1. **逐行读 AF-278 实现的 11 个文件 diff**（用户指定的提交 `cf9cac4a` 在评审期间被 L3 squash 两次重写为 `af4c370c` → `f7da3455`；已逐文件比对当前 HEAD 与 `cf9cac4a`，`src/` 六个实现文件**逐字节一致**，仅指标 spec 类型标注微调，故行号按当前树给出、结论按内容绑定）。
2. **实测取证**：`pnpm exec tsx -`（stdin 内联，**不落盘任何文件**）构造真实 `LlmRenderAdapter` + 记录型 `RenderTelemetryPort`，跑 7 条路径：
   - A barge-in → `degraded:["other"]` `outcomes:["primary:degrade"]`
   - B 两候选都 429 → `fallbacks:["primary->backup:rate-limit"]` `degraded:["exhausted"]`（**backup 原因丢失**）
   - C 单候选 429 → `fallbacks:[]` `degraded:["exhausted"]`（**429 在六个指标里全无**）
   - D 锁定后 401 → `degraded:["other"]` `auth:[]`（**鉴权失败未记 auth**）
   - E 输出 guard 命中 block → `degraded:["other"]`（**应为 `guard`**）
   - F 纯推理流 → `timeouts:[]` `firstDeltas:[]`（**全程零信号**）
   - G 未配置模型名 → `attempts:["primary|"]`（**`model=""` 空标签**）
3. **闸门复跑**：`pnpm typecheck` exit 0；两个定向 spec 2 files / 9 tests passed（972ms）。

## 三、问题清单（摘要，详见报告 §2–§4）

| 级别 | # | 问题 | 位置 |
| --- | --- | --- | --- |
| P0 | 1 | barge-in 被计成降级；`'cancelled'` 枚举定义未用 | `llm-render.adapter.ts:815` → `:404` → `:1328` |
| P0 | 2 | 末次/单候选失败原因无指标承载 | `metrics.service.ts:162-166`；`llm-render.adapter.ts:457`、`:474` |
| P1 | 1 | 安全拦截 cause 口径不一致（`guard` vs `other`） | `:387` vs `:582`/`:736`/`:642` |
| P1 | 2 | 纯推理流零信号（首包与 idle 保护都被绕过） | `:1127-1129`、`:1533-1565`、`:857-868` |
| P1 | 3 | 锁定后鉴权失败不记 auth、cause 归 `other` | `:901-903` |
| P1 | 4 | 熔断全损与「候选试完全败」不可区分 | `:457` vs `render-failover.runtime.ts:114-118` |
| P1 | 5 | regen / 真人度重试的二次调用不入 attempts、cause 丢失 | `:704-741`、`:596-658` |
| P1 | 6 | `guard.timedOut()` 优先判定误归因真实错误 | `:1142-1149`、`:1491-1495` |
| P1 | 7 | `first-delta` 同名两义（raw chunk vs 可见闭合句） | `:1089-1129` vs `:836-846` |
| P1 | 8 | 聚合路径无 first_delta/stream_timeout 且零测试 | `:393`、`:1175-1201` |
| P2 | 1–8 | attempts≠调用次数/`model=""`；`retry` 命名；attempt/outcome 可不配对；分层自相矛盾；工厂手写 `new`；隐私通过但无白名单；TTFT 生存者偏差；既有日志带兜底句 | 见报告 §4 |

## 四、测试缺口（12 条）

T1 barge-in、T2 单候选 429、T3 末次候选原因、T4 候选耗尽、T5 预检 block、T6 熔断全损、T7 锁定后 401、T8 输出 guard block、T9 纯推理流、T10 聚合路径、T11 空内容/截断、T12 regen/真人度重试。

其中 **T1–T5 正是本次 P0/P1 的所在路径，当前零覆盖**；T4/T5 是已决方案（耗尽只记 `degraded{exhausted}`、预检 block 记 `guard`）的**直接断言**，当前也无任何测试。

## 五、建议的最小修改顺序（本次不实施）

P0-1 取消独立终局 → P0-2 加 `visitor_render_failure_total{candidate,model,cause}` → P1-1/P1-5 补 cause → P1-3/P1-6 复用鉴权判定 → P1-7 命名对齐 → P1-2 可见首句预算 → P2-4/P2-5 分层与 DI → 补 T1–T12。

## 六、机读标记

### gateResults（闸门结果）

- `pnpm typecheck`：exit 0。
- `pnpm exec vitest run test/engine-adapters/af278-render-telemetry.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts`：2 files / 9 tests passed，972ms。
- `git diff --stat HEAD -- src/engine-core`：空。
- `git diff --stat HEAD -- src/ test/`：**评审时刻（14:05，AF-278 分支）为空**；14:13 起出现的 `src/agent/visitor/*` 改动属并发会话（AF-281 visitor v5 parity），非本次评审产物。
- 内联探针 7 条（A–G）全部复现（`pnpm exec tsx -`，stdin，不落盘）。

### scopeCheck（范围核对）

只写 `docs/worklog/pending/relay-response-AF-278-REVIEW-20261122-1400.md`、`docs/worklog/completed/phase2.5/af279-af278-render-telemetry-review-2026-11-22.md`、`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-279/`、`docs/worklog/inbox/af279-*.md`。未改 `src/`、`test/`、`bin/`、`admin-dashboard/`、Flutter、`engine-core`。

### contractChecks（契约核对）

- taskId：AF-279；register / promote / run 均经 CLI，状态面未手改。
- index-schema：交付记录六组机读字段齐全。
- engine-boundary：`src/engine-core` 零改动。
- telemetry-privacy：确认六类指标标签不含 prompt、台词、会话 id 或原始错误文案。
- read-only：未修改任何实现或测试文件；未 commit / push / 切分支。

### backlogItems（遗留项）

- `visitor-render-telemetry-barge-in-not-degraded`
- `visitor-render-telemetry-failure-cause-metric`
- `visitor-render-telemetry-guard-cause-unified`
- `visitor-render-telemetry-visible-first-budget`
- `visitor-render-telemetry-cooldown-distinct`
- `visitor-render-telemetry-regen-attempt`

### deviationTable（偏差说明）

1. 评审对象 SHA 由用户指定的 `cf9cac4a` 变为 squash 后的 `af4c370c`；已逐文件比对实现一致（仅指标 spec 类型标注微调），行号按当前树给出。
2. 评审**不改动任何实现**：只出报告与建议，P0/P1 修复另开返修单。
3. 探针脚本走 `pnpm exec tsx -`（stdin 内联），仓内零临时文件。

### reviewVerdict（验收结论）

**needs-fixes**（评审口径）：遥测不影响渲染主流程且隐私契约成立，但 P0-1 / P0-2 使其不足以支撑线上告警与灰度判读，建议修完两条 P0 再上生产。编排任务状态与回执见 AF-279 记录包。
