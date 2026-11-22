# IM-021 备忘审计字段自洽修正 — 交付记录

- **状态**：✅ 完成（2026-11-16，纯文档修正，零规则代码改动）；IM-021 流转 `candidate → queued → accepted → done`
- **基线 HEAD**：`4b1eafc`（IM-022 批次推送后；本批仅备忘文档、台账与双写产物变更）
- **范围**：`docs/team/agent-orchestration/autonomous-team-design.md` §3.5 字段清单对齐 `dispatch-channel.mjs` `buildDispatchAudit` 顶层字段；`src/engine-core`、`src/migration`、业务 `src/**/*.ts`、`test/` 零 diff；零新增依赖
- **取证来源**：回执 `docs/worklog/pending/archive/relay-response-af013-drill-20261116.md`（D-11）；`dispatch-channel.mjs#buildDispatchAudit`；备忘 §3.1 / §3.5

---

## 一、背景

回执 D-11 记录：备忘 §3.1 要求写审计失败原因，但 §3.5 字段清单未列该项，且缺既有债 / 本次改动分栏；框架要求的基线分栏在通道侧无载体。本批复核现状后逐条对齐。

## 二、复核与落地

### 2.1 现状复核（代码 vs 备忘）

`buildDispatchAudit` 顶层字段：`taskId / contextId / channel / sessionPath / locateLayer / attempt / result / reason / classification / baseline{legacyDebt,changeIntroduced} / attempts[] / timestamp`。

| D-11 缺口                            | 代码层                                                       | 备忘现状                                                                       | 处置                                                 |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 失败原因 `reason` 未进 §3.5 字段清单 | 顶层 `reason`（`dispatch-channel.mjs` `buildDispatchAudit`） | §3.5 行 84 基础清单原列「通道、会话路径、尝试次数、结果、时间戳」，缺 `reason` | **本批补入**：行 84 清单增加「失败原因（`reason`）」 |
| 既有债 / 本次改动分栏                | `baseline.legacyDebt` / `baseline.changeIntroduced`          | §3.5 行 87 已列基线分栏（AF-015 落地）                                         | 已自洽，无需改                                       |
| 失败定性三分法载体                   | `classification` 枚举                                        | §3.5 行 87 已列（确定性缺陷 / 偶发波动 / 既有债）                              | 已自洽，无需改                                       |
| 逐次留痕原因                         | `attempts[]` 条目 `reason`                                   | §3.5 行 88 已列「原因」                                                        | 已自洽，无需改                                       |

### 2.2 实际改动

仅备忘 §3.5 行 84 一句：基础审计字段清单由「通道、会话路径、尝试次数、结果、时间戳」补为「通道、会话路径、尝试次数、结果、失败原因（`reason`）、时间戳」。字段名与代码顶层 `reason` 逐字一致，不新增代码逻辑、不新增枚举。

## 三、台账变更

| 台账   | 流转                                   | 说明                                                                                                                                                            |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IM-021 | `candidate → queued → accepted → done` | resolutionNote 记录：§3.5 清单补顶层 `reason` 对齐 `buildDispatchAudit`；baseline 分栏 AF-015 已落地；纯文档、零代码改动。无关联 AF 任务单，`linkedTaskId=null` |

台账终态：total 28 = done 11、accepted 1、candidate 16。

## 四、闸门证据

| 命令 / 校验                                                                   | 结果                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 1 file passed；**116 passed**；Duration 1.67s               |
| `node scripts/orchestration/cli.mjs validate`                                 | **5/5 PASS**（状态索引、工具契约、三角色 Agent Card）       |
| `improvement-log.json` / `orchestration-snapshot.json`                        | `Test-Json` **OK**；total 28                                |
| 备忘编码                                                                      | BOM=False、CR=False                                         |
| 业务源码隔离                                                                  | 本批无规则代码改动；`git diff --stat HEAD -- src test` 为空 |

> 本批无 `scripts/*.mjs` 规则改动，未重跑 `pnpm lint:fast`（沿用 AF-017 0 warning / 0 error 基线）；未跑全量 typecheck（备忘 md / 台账 JSON / 双写产物不进入 `src/test` 运行时，同 AF-015~017、IM-022 口径）。

## 五、遗留条目与保留理由（本批未闭环，维持 backlog）

| 台账   | 类型 / 层                             | 保留理由                                                                                                                                                                                                                                   |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IM-002 | review / tech-debt / adapter          | typeorm-model-generator 废弃链与传递依赖漏洞；业务开发期工具债，移除前须确认无 DB→装饰器反向生成需求并附全量绿跑墙钟，非本批纯函数 / 文档范围                                                                                              |
| IM-003 | review / tech-debt / adapter          | uuid / glob / minimatch 传递依赖告警；随 typeorm / sentry / rimraf / ts-morph 主依赖升级带动，版本变动须附全量绿跑与墙钟数字                                                                                                               |
| IM-005 | implementation / tech-debt / adapter  | 交接枚举与 taskId 模式与框架 ajv schema 双源镜像；复用框架 schema 属跨仓契约治理 P1，待框架枚举 / 模式同步封装                                                                                                                             |
| IM-006 | implementation / standard / framework | review 交接件结构上提框架仓 schema 与模板；framework 层跨仓演进，本仓不代固化                                                                                                                                                              |
| IM-007 | implementation / tech-debt / adapter  | 回执幂等次键补工件版本号；框架 reliability.md §2 要求 taskId 主键 + 工件版本次键，但工件版本字段名 / 生成规则框架 task-contract 未固化（框架仅有契约版本 `schemaVersion`）；本仓不自立版本口径以避免新双源镜像，待框架契约固化后落 adapter |
| IM-011 | implementation / tech-debt / adapter  | scope 通配真实 glob 展开；纯函数无 fs 列目录能力，P2 文件锁升级时在采集层引入只读路径匹配器                                                                                                                                                |
| IM-012 | implementation / tech-debt / adapter  | squash 合并提交动作与分支清理自动化；真实 commit 属编排闸门动作，L1 半自动阶段留 P1，通道规则层不代执行 git 写操作                                                                                                                         |
| IM-017 | review / guardrail / framework        | 熔断阈值参数化与通道独立计数；framework P2，复用通用熔断扩展位，不另立通道独立熔断                                                                                                                                                         |
| IM-018 | review / gap / adapter                | L3 远端 CI 门禁；本机无 gh CLI 与 GITHUB_TOKEN，CI 状态本机不可读，过渡口径以本地等价闸门替代，接入 token / gh 后再改                                                                                                                      |
| IM-019 | review / gap / adapter                | development 分支退役；不可逆高风险动作，须人工拍板并复核 `integrate..development` 为空后执行                                                                                                                                               |
| IM-020 | acceptance / gap / adapter            | 12 条差异 / 缺口两仓文档修订消化；跨仓大项（备忘 §3 + framework reliability.md §4），outOfScope，需拆单分别消化                                                                                                                            |
| IM-023 | acceptance / gap / adapter            | 开放问题：通道失败权威终态出口以 ready 还是 failed 为准；待框架 reliability.md §4.1 定调                                                                                                                                                   |
| IM-024 | acceptance / gap / adapter            | 开放问题：通道级重试预算归属（备忘 §3 自定义 vs framework §4 任务级）；降级路径切换是否计一次重试；待框架定调                                                                                                                              |
| IM-025 | acceptance / gap / adapter            | 开放问题：熔断阈值通道侧复用通用熔断还是独立计数；与 IM-017 近义，评审时评估合并；待框架定调                                                                                                                                               |
| IM-026 | acceptance / gap / adapter            | 开放问题：框架 §4.2 失败定性三分法是否正式豁免通道层失败；待框架定调                                                                                                                                                                       |
| IM-027 | acceptance / gap / adapter            | 开放问题：通道演练可复核基线取值（稳定路径清单 / 当日成功率快照 / 两者）；备忘 §3.5 行 91 当前取「两者」，框架口径确认后回填                                                                                                               |
| IM-028 | implementation / gap / adapter        | 派发决策链运行时接线；依赖真实桌面通道激活（P2），规则层函数已备，CLI/scheduler 接线、审计结果映射回任务状态机、退避等待交 relay 层                                                                                                        |

## 六、审计链

- 台账 `improvement-log.json`：IM-021 done（resolution.note 见 §3）；快照 `orchestration-snapshot.json` 与看板 `web/orchestration/data.js` 由 CLI 双写刷新。
- 本记录为台账治理类单份交付记录（无 AF 任务单），未进 `task-state-index.json`（索引归档段只放 AF 任务单，同 IM-004 / IM-022 先例）。
