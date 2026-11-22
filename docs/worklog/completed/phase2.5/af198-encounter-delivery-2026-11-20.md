# AF-198 · 自动对练交付与记录包最终交付

- 任务：AF-198（`phase2.5-orchestration-closed-loop`）
- 类型：fix
- 基线：`4ca4dbe5c772bccc9bf1a3c73ad0dbc4a0e49866`
- 分支：`task/AF-198-encounter-delivery`
- 日期：2026-11-20
- 前序：AF-187（租约过期 `rejected`）、AF-188（records 进执行侧提交被判 scope 外 `rejected`）
- 结论：技术交付 `passed`；AF-187/AF-188 的 rejected 历史原样保留，不回写

## 交付内容

### 场景一级配置

- `src/shared/encounter/encounter-scene.ts`：注册表内置 `in_person`（默认）与 `online`（video / voice / text），新场景只扩注册表；
- 来访者与咨询师共用同一份场景契约；面对面禁止线上媒介词，线上按子通道放开对应媒介词；
- 来访者“说话方式”按场景切换（咨询室里面对面 / 远程咨询里），不再被硬编码文案带偏；
- `detectEncounterDrift()` 拦截不符合当前媒介的台词；
- 无场景参数（legacy debug）不注入任何场景块，旧 prompt 逐字不变。

### 输出完整性闸门

`src/shared/text/output-integrity.ts` 在写入逐字稿前统一判定：

- 合法文本中已闭合的 `<think>` 只剥离推理块，正文照常落库；
- prompt 复述标记、无标签推理开头、角色标签泄漏；
- 韩文/日文/西里尔/阿拉伯文字，异常拉丁词（白名单含 CBT/PHQ/GAD 等量表缩写），全大写问答缩写；
- 场景漂移；
- 命中先重试一次，仍非法则安全短句兜底并标 `degraded`，坏文本不进 history。

覆盖 runner 两侧落历史前、来访者候选重生成、咨询师生成三条入口。

### 风险收束与危机结论

- `riskGroupsCoveredByHistory(history, crisisFirstTurn)` 只统计危机披露之后的咨询师台词，披露轮本身的咨询师前台词也排除；
- `completeRiskClosingText(text, coveredBefore)` 只补历史未覆盖组，整场至少补一次且不重复整套模板；
- 新增 `crisisOutcome`：`none / safety_plan_completed / escalated / incomplete`，落库、进 `session_end`、列表返回；旧 `crisisEnded` 语义保留。

### 接线

- 单场/批量接口新增 `encounterMode` / `encounterChannel`，缺省 `in_person`，`online` 缺省 `video`，非法值报错；
- 批量任务透传 encounter；管理后台场景选择器、批量场景控件、场次行场景与危机结论标签；
- 导出 JSON 补 `encounterMode / encounterChannel / encounterLabel / exitReasonLabel / crisisOutcome / crisisOutcomeLabel`；
- 迁移 `1714900000048-AddEncounterAndCrisisOutcome` 已注册 `bin/ormconfig.ts` 并执行成功。

## 改动文件

新增：`src/shared/encounter/encounter-scene.ts`、`src/shared/text/output-integrity.ts`、`src/migration/1714900000048-AddEncounterAndCrisisOutcome.ts`、`test/auto-practice/af187-encounter-output-integrity.spec.ts`。

修改：渲染适配层 4 个文件、wiring 1 个、auto-practice 12 个、admin-debug 2 个、`bin/ormconfig.ts`、前端 3 个、`practice-runner-decide-turn.spec.ts`。

`src/engine-core/` 零 diff。

## gateResults

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm exec vitest run test/auto-practice/af187-encounter-output-integrity.spec.ts` | exit 0，22 tests passed |
| `pnpm test` | exit 0，223 files passed + 1 skipped；3949 tests passed + 4 skipped |
| `cd admin-dashboard && pnpm type-check` | exit 0，`vue-tsc --build` 无输出 |
| `pnpm migration:run` | `AddEncounterAndCrisisOutcome1714900000048 has been executed successfully` |
| `git diff --stat HEAD -- src/engine-core` | 空 |
| `pnpm orchestration:preflight` | PASS |

## scopeCheck

`in-scope`。执行侧提交只含 task scope 内的代码、测试、交付记录与编排状态面；`docs/worklog/records/**` 属运行态，不在本提交，由归档阶段单独提交。

## contractChecks

- `taskId`：AF-198 贯穿任务单、回执、交付记录、状态索引与事件日志。
- `state-write`：登记/提级/领取均经 CLI；回执由 `run-once` 摄入。
- `index-schema`：任务单 frontmatter 与回执六组齐全。
- `event-chain`：AF-187/AF-188 的 rejected 事件原样保留，不手改 journal/index。
- `engine-boundary`：`src/engine-core` 零 diff。

## backlogItems

- `BL-AF189-01`：线上默认子通道固定 `video`，待灰度按真实使用分布拍板。
- `BL-AF189-02`：第三场景（home_visit/phone 等）只留注册表扩展位，未开放条目。
- `BL-AF189-03`：已吐出的流式 token 无法撤回，前端展示侧过滤未做。
- `BL-AF189-04`：迁移列级 SQL 未复验（本地 `.env` 直连 `DB_DATABASE`/`DB_USERNAME` 读空）。

## deviationTable

| 项 | 任务单 | 实际 | 理由 |
| --- | --- | --- | --- |
| 前序任务 | AF-187 完成 | AF-187 租约过期 rejected；AF-188 records 越界 rejected | AF-198 以干净提交重新入账，历史不改 |
| 线上默认子通道 | 三通道可配 | 缺省 `video` | 用户未单独拍板，集中到注册表 |
| 第三场景 | 预留 | 注册表扩展位，未开放条目 | 无真实使用方 |
| 前端验证 | 可配置场景 | 只跑 `vue-tsc`，未浏览器点选 | 前端非主链路，留灰度验收 |
| 流式拦截 | 坏输出不进逐字稿 | 落历史前与候选重生成拦截 | 流式 token 无法撤回 |

## reviewVerdict

`passed`

技术交付通过：场景由系统显式控制、坏输出不进逐字稿、风险收束不机械重复、危机收尾有可读结论，22 例定向回归与 3949 例全量全绿。AF-187/AF-188 的 rejected 是流程状态，不是代码失败。AI 结果仍只作 `ai_proxy_candidate`，不构成临床达标或真人督导结论。





