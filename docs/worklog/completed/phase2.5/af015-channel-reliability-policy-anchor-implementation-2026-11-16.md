---
taskId: AF-015
contextId: phase2.5-orchestration-closed-loop
title: 通道可靠性口径锚定与补全（终态出口 / 任务级重试预算 / 退避序列 / 失败定性三分法 / 逐次留痕）
type: implementation
status: completed
baselineRef: f6f69b1
dependsOn: [AF-013, AF-014]
policyRefs: [framework/reliability.md, autonomous-team-design.md#gui-channel]
createdAt: 2026-11-16
---

# AF-015 · 通道可靠性口径锚定与补全 — 交付记录

- **状态**：✅ 已交付（2026-11-16，本机闸门全绿；编排层单测 94 passed）
- **基线 HEAD**：`f6f69b1`（与 `origin/integrate` 一致；本批改动尚未提交）
- **编排**：主控 Doubao（orchestrator 自做）｜**任务性质**：adapter 层纯规则 + 单测 + 活文档口径；零业务源码改动、零进程 / 剪贴板 IO、零新增依赖
- **方案契约**：框架仓 `docs/reliability.md` §3（租约超时与重派）、§4.1（可恢复 / 不可恢复四类）、§4.2（定性三分法 + 基线当场复核）、§5（熔断 / 死信预留位）、§7（终态不重启）；本仓 `autonomous-team-design.md` §3（通道落地口径）、§6.1（发布分层）；回执 `relay-response-af013-drill-20261116.md` 12 条 D 差异与 5 个开放问题

---

## 一、本单做了什么（一句话）

把 AF-013 演练回执核对出的通道可靠性 12 条差异 / 缺口在 adapter 层锚定框架 `reliability.md` §4 并补全：任务级统一重试预算、指数退避序列、不可恢复四类终态出口、失败定性三分法与基线分栏、逐次重试留痕载体、重派策略成文、熔断 / 死信预留位对齐；框架通用规则正文留在框架仓，本仓只落地通道侧枚举、预算数值与审计字段并以锚点引用，不复制正文。

## 二、改动文件清单

| 文件                                                                                     | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/dispatch-channel.mjs`                                             | 新增常量 `MAX_TOTAL_ATTEMPTS=3`（任务级总尝试预算，定位层 / 会话路径切换各计一次尝试，局部 start / send 上限受其封顶）、`BACKOFF_MS=[0,500,1000]`（指数退避毫秒，纯数据；等待由 relay 层执行，规则层不 sleep；序列用尽复用末位）、`IRRECOVERABLE_CAUSES`（`contract-invalid / input-invalid / permission-denied / deterministic-defect` 四类）、`FAILURE_CLASSIFICATIONS`（`deterministic / flaky / legacy-debt`）、`CIRCUIT_BREAKER_RESERVED` / `DEAD_LETTER_RESERVED`（§5 预留位，`reserved: true`，本版本不实现逻辑）；新增 `isIrrecoverable(cause)`、`nextBackoff(attemptIndex)`；`resolveDispatchDecision` 输入增 `cause` / `attemptCount`，终态出口：登录门最高优先 → `human-login` / `human-escalated`；不可恢复 → `fail-terminal` / `failed`（不重试）；预算耗尽 → `human-escalate` / `held-ready`；其余动作 `result: null`；返回对象增 `result` / `cause` / `backoffMs`。`buildDispatchAudit` 增可选 `classification`（枚举校验）、`baseline={legacyDebt,changeIntroduced}`（对象 + 两键字符串或 null）、`attempts` 数组（每项 `sessionPath / locateLayer / reason / backoffMs / result / timestamp`，枚举校验，缺项归一化为 null）；审计仍不含 `messageText`。`summarizeChannelOutcomes` 把 `held-ready` 计入未成功 failed bucket；既有导出签名与行为向后兼容 |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`                                 | import 补入新常量与函数；新增 5 组用例：不可恢复类别判定与短路终态（登录门优先于不可恢复短路）、任务级预算封顶（耗尽 `held-ready`，预算内继续定位）、退避序列（首试 0、序列用尽复用末位、负索引归零）、审计定性 / 基线分栏 / 逐次留痕合法落库与非法枚举 / 基线形态 / 逐次条目拒绝、路径聚合 `held-ready` 计入未成功 + 预留位常量与三分法枚举                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/team/agent-orchestration/autonomous-team-design.md`                                | §3.1 进程自愈重写：锚定 §4.1 / §4.2，补终态出口四条与退避口径；§3.2 表格后补任务级预算与降级计次段；§3.3 补降级路径切换计次；§3.5 审计重写：终态出口映射、定性三分法 + 基线分栏、逐次留痕 `attempts`、重派策略、熔断 / 死信预留位、通道演练基线（稳定路径清单 + 当日成功率快照两者）；§6.4 追加 AF-015 同步记录段                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/team/conventions.md`                                                               | §132 由「不自动 commit / push，写完给 commit 文字等用户指令」改为「executor 不建分支、不提交、不推送；只产出 commit message 草稿；提交与推送由 orchestrator 按设计备忘 §6.1 分层执行（L1–L3 前置条件满足自动，L4 人工冻结）」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/team/agent-orchestration/relay-receipt-template.md`                                | §68 同步对齐：executor 不提交、不推送，提交与推送由 orchestrator 按 §6.1 分层执行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/team/agent-orchestration/improvement-log.json`                                     | IM-004（归档回填缺口）→ done；IM-014 / IM-015 / IM-016 经 queued → accepted → done；新增候选 IM-017（熔断阈值参数化，P2 / framework / guardrail）、IM-018（L3 远端 CI 门禁接入，P2 / adapter / gap）、IM-019（`development` 分支退役待人工拍板，adapter / gap）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js` | CLI 双写刷新（台账条目与队列快照同步）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 2.1 回执 12 条差异 / 缺口逐条映射

| #    | 回执缺口                                                               | 本单处置                                                                                                                                | 落点                                                           |
| ---- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| D-10 | 通道两条重试规则未锚定框架 §4（共同根因）                              | **已落地**：备忘 §3 各小节锚定 §4.1 / §4.2 / §5；脚本头注释与常量注释带框架锚点；不复制 §4 正文                                         | 备忘 §3.1–§3.5；`dispatch-channel.mjs` 头注释                  |
| D-2  | 重试形态 / 数值不一致：通道写死重试一次、无退避；框架要求指数退避      | **已落地**：`BACKOFF_MS=[0,500,1000]` + `nextBackoff`；纯数据序列，实际等待由 relay 层执行，规则层不 sleep                              | `dispatch-channel.mjs` `BACKOFF_MS` / `nextBackoff`；备忘 §3.1 |
| D-4  | 多路降级无统一重试预算；降级切换是否计一次重试未定义                   | **已落地**：`MAX_TOTAL_ATTEMPTS=3` 任务级单一预算；定位层 / 会话路径切换各计一次尝试；局部上限受总预算封顶                              | `MAX_TOTAL_ATTEMPTS`；备忘 §3.2 预算段 / §3.3 计次口径         |
| D-5  | 失败终态出口双轨（保持 `ready` + 转人工 vs 直接 `failed`），无权威出口 | **已落地**：终态出口四条——不可恢复 → `failed`；可恢复耗尽 → `held-ready` 升级人工；登录门 → `human-escalated`；成功 → `dispatched`      | `resolveDispatchDecision`；备忘 §3.5 终态出口映射              |
| D-7  | 确定性缺陷在通道层缺终止规则，与偶发失败用同一套动作                   | **已落地**：`deterministic-defect` 列入不可恢复四类，短路 `fail-terminal` / `failed`，不换路径重试                                      | `IRRECOVERABLE_CAUSES` / `isIrrecoverable`；决策短路           |
| D-12 | 通道侧「不可恢复」无枚举映射，用兜底措辞                               | **已落地**：四类枚举 `IRRECOVERABLE_CAUSES`，与框架 §4.1 一一对应                                                                       | `IRRECOVERABLE_CAUSES`                                         |
| D-1  | 通道层失败未纳入定性三分法（确定性 / 偶发 / 既有债）                   | **已落地**：`FAILURE_CLASSIFICATIONS` 三分法；审计 `classification` 字段枚举校验；通道失败不豁免定性                                    | `FAILURE_CLASSIFICATIONS`；`buildDispatchAudit`；备忘 §3.5     |
| D-11 | 审计字段与失败原因 / 基线分栏要求不自洽；无既有债 / 本次改动分栏       | **已落地**：`baseline={legacyDebt,changeIntroduced}` 分栏对象；`reason` 既有；备忘 §3.1 与 §3.5 口径对齐                                | `buildDispatchAudit` `baseline`；备忘 §3.5                     |
| D-3  | 「每次重试留痕」无逐次载体，审计只留尝试次数聚合值                     | **已落地**：`attempts` 数组，每项留定位层 / 会话路径 / 原因 / 退避毫秒 / 结果 / 时间戳；聚合 `attempt` 仅计数                           | `buildDispatchAudit` `attempts`；备忘 §3.5 逐次留痕            |
| D-6  | 非超时派发失败的重派策略无框架依据；触发方 / 是否需人工确认未写        | **已落地**：备忘 §3.5 重派策略——超时不自动重派；非超时可恢复失败保持 `ready`，是否重派由 orchestrator 显式触发，通道层不自行重排        | 备忘 §3.5 重派策略段；锚定 §3                                  |
| D-9  | 熔断 / 死信通道侧无扩展位，成熟度标注不一致                            | **对齐预留位**：`CIRCUIT_BREAKER_RESERVED` / `DEAD_LETTER_RESERVED` 复用框架 §5 预留位语义；通道侧不独立计数；阈值参数化归 P2（IM-017） | 两个预留位常量；备忘 §3.5；台账 IM-017                         |
| D-8  | 「基线当场复核」未覆盖通道演练基线；只读零代码任务无可比代码基线       | **已落地**：通道演练基线 = 稳定路径清单 + 当日各路径成功率快照两者；用于区分既有通道债与本次引入（对齐 §4.2）                           | 备忘 §3.5 通道演练基线段                                       |

### 2.2 五个开放问题结论

| #   | 开放问题                                                   | 结论（本单口径）                                                                                                                              |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ1 | 权威终态出口以哪侧为准？§7「终态不重启」是否约束通道失败？ | 不可恢复类别直接 `failed`；可恢复故障预算耗尽保持 `held-ready` 升级人工，不直接置 `failed`；`failed` 终态受 §7 终态不重启约束，返修路径唯一。 |
| OQ2 | 通道级重试总预算归谁定义？降级路径切换是否计一次重试？     | 任务级单一预算 `MAX_TOTAL_ATTEMPTS`（对齐 §4.1）；定位层切换与会话路径切换各计一次尝试；分层内局部重试不突破总预算。                          |
| OQ3 | 熔断阈值在通道侧复用通用熔断，还是独立计数？               | 复用框架 §5 通用熔断预留位，通道侧不独立计数；阈值参数化与连续失败阈值落地归 P2（IM-017）。                                                   |
| OQ4 | §4.2 定性三分法是否豁免通道层失败，还是另立通道定性？      | 不豁免：通道失败同样纳入 `deterministic / flaky / legacy-debt` 三分法；既有债基线与本次改动分栏记录。                                         |
| OQ5 | 通道演练「可复核基线」具体取什么？                         | 稳定路径清单 + 当日成功率快照两者并列；只读零代码任务不以「无基线」冒充通过，基线来源当场标注。                                               |

### 2.3 零改动确认

- `src/engine-core/`、`src/migration/`、`src/**/*.ts` 业务代码、整个 `test/`、`bin/` —— **零 diff**（`git diff --stat HEAD -- src test` 为空）。
- **未新增第三方依赖**；未改动 `package.json` / lockfile / CI 工作流；未执行 `development` 分支退役；未接入远端 CI 门禁。
- 向后兼容：既有导出（`SESSION_PATHS` / `LOCATE_LAYERS` / `MAX_START_RETRIES` / `MAX_SEND_RETRIES` / `nextSessionPath` / `nextLocateLayer` / `canDispatch` / `resolveDispatchDecision` / `buildDispatchAudit` / `summarizeChannelOutcomes` / `buildEscalationMessage`）签名保留；新输入字段缺省不触发新分支；新审计字段缺省归一化为 `null` / `[]`。
- 进程 / 窗口 / 剪贴板 / 退避等待与发送仍留 relay 层注入接口位；模块内零 IO，单测不起真实桌面。

## 三、关键决策与偏差

1. **锚定而非复制（SSOT）**：重试形态、三分法定义、不可恢复判定规则、熔断语义的通用正文只写在框架 `reliability.md` §4 / §5；本仓脚本与备忘只落地通道侧枚举值、任务级预算数值、审计字段结构，并以锚点指向框架，避免口径多份副本漂移。
2. **决策优先级固定**：登录门 > 不可恢复短路 > 进程 / 窗口拉起 > 逐层定位 > 沿链发送 > 预算耗尽升级人工。登录门优先于不可恢复判定——认证未完成先交人工接管，登录解除后再按失败类别定终态（测试用例锁定该顺序）。
3. **任务级预算封顶局部重试**：`MAX_START_RETRIES=1`、`MAX_SEND_RETRIES=1` 保留为分层内局部约束，但受 `MAX_TOTAL_ATTEMPTS=3` 总预算封顶；降级路径切换显式计一次尝试，避免最坏路径操作次数超出框架限次意图。
4. **退避为纯数据、等待在 relay 层**：`BACKOFF_MS` 只提供毫秒序列与查询函数，规则层不 `sleep`；实际等待时机与时长由 relay / 桌面层执行，保持模块可替身单测。
5. **预留位不提前实现**：熔断与死信本版本只登记预留位常量与语义注释，通道侧不建独立计数器、不建隔离区；阈值参数化与连续失败事件落地归 P2（IM-017），不把预留位写成已实现能力。
6. **偏差**：无。任务单 §2 范围内落地；未改框架仓文档，未实现通道独立熔断 / 隔离区，未接入 CI 门禁，未删除 `development` 分支，未清算既有历史技术债。

## 四、闸门证据

| 命令                                                                          | 退出码 | 结果                                                                                                          |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 94 passed（基线 89 + AF-015 新增 5 组用例），1 file，约 1.06–1.65s                                            |
| `pnpm lint:fast`（`oxlint src test bin`）                                     | 0      | 0 warning / 0 error，1350 文件，93 规则                                                                       |
| `node scripts/orchestration/cli.mjs validate`                                 | 0      | 5 / 5 PASS：状态索引、工具契约清单、executor / human / orchestrator 三份角色卡 schema                         |
| JSON `Test-Json`（三角色卡 + 索引 + 台账 + 快照）                             | 0      | 6 / 6 `valid=True`                                                                                            |
| 编码探测（BOM / CR）                                                          | —      | 改动 `.mjs` / `.json` / `.md` / `data.js` 均 `bom=False`、纯 LF（`cr=0`）；`conventions.md` 行尾已校正为纯 LF |
| `git diff --stat HEAD -- src test`                                            | 0      | 空（0 文件，业务源码与测试零 diff）                                                                           |

- **未跑全量 typecheck**：本单改动不进入 `src/test` 运行时（仅 `scripts/orchestration/*.mjs` 纯规则与 docs JSON / MD）；`lint:fast` 范围仅 `src/test/bin`，docs JSON / MD 不经 oxlint。编排层定向单测已覆盖新模块全部纯函数路径与枚举分支。

## 五、遗留与未决

- **IM-017（candidate · framework · guardrail · review · related AF-015）**：熔断阈值参数化与通道独立计数预留。框架 §5 熔断 / 死信为本版本预留位，通道侧不独立计数；P2 复用通用熔断扩展位，落地连续失败阈值与快速失败事件，不另立通道独立熔断。
- **IM-018（candidate · adapter · gap · review · related AF-015）**：L3 合并接远端 CI 状态门禁。本机无 gh CLI 与 `GITHUB_TOKEN`，CI 状态本机不可读；当前以本地等价闸门替代远端 CI 门禁，属过渡方案。接入 token / gh 后改为以 CI 状态作为 L3 自动合并门禁；过渡口径标注目标态，不固化为永久设计（备忘 §6.2）。
- **IM-019（candidate · adapter · gap · review · related AF-015）**：`development` 分支退役执行待人工拍板。退役需删除本地与远端 `development` 分支，属高风险不可逆动作；须人工确认 `integrate..development` diff 为空后按备忘 §4.4 流程执行，本批不删除分支。
- **历史技术债不顺手清理**：台账 IM-001 / 002 / 003 / 005~013 为更早 backlog，不在本批范围；保留原状态跟踪，未就地重构。
- **框架仓通用层未改**：`reliability.md` §4 规则已完备，本批仅锚定引用；若后续框架 §4 文本需修订，归框架仓独立任务，不在本仓 adapter 层处理。
- **历史只读豁免（不改，仅归类）**：`docs/worklog/archive/`、`docs/worklog/pending/archive/` 回执、`docs/team/gate-performance-remediation-2026-11-11.md` §532、台账 / 快照中 IM-016 历史标题与 impact 文本、备忘 G6 与 AF-014 历史叙述均为历史记录，按只读纪律不就地改写；快照与 data.js 由 CLI 刷新重建。

## 六、审计链与回写清单

- [x] 交付记录落固定路径；任务单与交付记录成对归档 `completed/phase2.5/`
- [x] 索引状态迁移追加 `history`，工件指针（任务单 / 交付记录）填全；AF-015 无回执工件
- [x] 快照与看板 data.js 经 CLI 双写刷新
- [x] `taskId`（AF-015）贯穿任务单 / 交付记录 / 台账 IM-014~019 关联 / commit message
- [x] 回执 12 条 D 差异逐条映射（§2.1）；5 个开放问题结论落表（§2.2）
- [x] 并行线产物 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 未混入本单 stage；运行态 `transport/`、`orchestration-store.sqlite`、`tool-audit-log.json` gitignore 不入库
