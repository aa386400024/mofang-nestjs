---
taskId: AF-226
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 R6-C：线上 voice/text 场景补样本与切片基线
type: implementation
status: backlog
baselineRef: 2cbfd7a96244d114ddbe139ad20a98e4656c09a3
dependsOn: [AF-225]
priorTasks: [AF-207, AF-208, AF-209, AF-213, AF-214, AF-216, AF-225]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-21T13:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af226-realism-r6c-online-scenes-2026-11-21.md
    kind: report
  - name: 线上样本批次与切片报告
    path: data/phase25-exit/af226-online-scenes/report.json
    kind: report
  - name: 线上切片 AI 盲评报告
    path: data/phase25-exit/af226-online-scenes/blind/report.json
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af226-online-scene-loader.spec.ts test/auto-practice/af225-realism-stability.spec.ts test/auto-practice/af214-realism-blind-pack.spec.ts test/auto-practice/af214-realism-rating.spec.ts
    check: 线上场景归一化 + R5/R6-B 回归全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试 0 failed
    threshold: exit=0
  - command: POST /admin/api/auto-practice/batch（online/voice 与 online/text 各 48 场：8 角色 × 3 模式 × repeats=2，maxTurns=20）
    check: 两个批次各 48 场，单通道可用会话（status≠failed 且 visitor 轮次 ≥8）≥40
    threshold: voice_usable >= 40 且 text_usable >= 40
  - command: node --env-file=.env --import tsx bin/visitor-realism-blind.ts --source data/debug-sessions --packets 24 --out data/phase25-exit/af226-online-scenes/blind
    check: 24 packet 覆盖 in_person / online_voice / online_text 三场景，每场景 ≥8，全部完成五维评分
    threshold: exit=0 且 completed=24、failed=0、每场景 packet ≥8
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 线上样本必须由真实对练产生，不能用改字段、复制 in_person 会话或伪造 encounter 的方式凑数。
  - 每个线上批次 48 场，角色 × 模式 × repeats 组合固定为 8 × 3 × 2，maxTurns=20，批次之间只差 encounter channel。
  - 盲评加载器优先读取 debug JSON 里的显式 `encounter`，再回落到 prompt 场景层、最后缺省 in_person；老 360 场行为不变。
  - 生成 24 个盲评 packet，in_person / online_voice / online_text 每个场景至少 8 个；评分链路 24/24 完成，不允许 dimension_missing 整包失败。
  - 报告按场景给出五维均值、样本量、剔除计数与硬违约计数；线上切片不足或分数更低时如实登记，不改模型、不改 provider、不改 `.env` 去“调好”。
  - 不修改 R6-A 节奏、R6-B compact 重试、R5 评分协议；engine-core 零改动；临床达标标记保持 false。
  - 不修改 provider 选择、模型、`.env`、`scripts/orchestration/`；不触碰 admin-dashboard 与 Flutter。
---

# AF-226 · 来访者真人度 R6-C：线上 voice/text 场景补样本与切片基线

## 1. 背景

R5 的 360 场基线里 `in_person=343`、`online_voice=0`、`online_text=0`：旧批次没有场景字段，只能按产品默认面对面回落。R6-A 已验证口语事件的条件分布，R6-B 已修好评分截断，但线上语音/文字两种场景仍没有一场真实样本，任何“线上也自然”的结论都没有数据支撑。

现有 `data/debug-sessions/*.json` 里的老会话也没有显式 `encounter`；新对练会写入该字段。R5 的 `bin/visitor-realism-blind.ts` 和 `bin/visitor-realism-baseline.ts` 只认 `scene` / `realismScene` 或从 prompt 猜场景，直接跑新批次会把线上会话误判成 `in_person`。所以 R6-C 分两步：先让加载器认显式 `encounter`，再用真实对练补线上样本并出分场景基线。

## 2. 本单目标

1. 场景归一化：`bin/` 的两个真人度 CLI 优先读取 debug 记录的 `encounter`（`{mode:'online', channel:'voice'|'text'|'video'}`），`video` 与 `voice` 同归 `online_voice`；无 `encounter` 时保持现有 prompt 推断与 `in_person` 缺省，老 360 场结果不变。
2. 真实补样本：用 `POST /admin/api/auto-practice/batch` 起两个批次，各 48 场：
   - 8 个现有角色 × 3 个咨询师模式（`expert` / `intermediate` / `cold`）× repeats=2；
   - `maxTurns=20`，`sessionProfile` 不传；
   - 批次 A `encounterMode=online`、`encounterChannel=voice`；批次 B `encounterMode=online`、`encounterChannel=text`。
3. 切片基线：用 `bin/visitor-realism-blind.ts` 抽 24 个 packet（按场景分层轮转，三场景各 ≥8），跑两个 AI 评分员 + 仲裁，输出按场景的五维均值、样本量和剔除计数。
4. 合规审计：对线上 visitor 台词按 R4 场景审计器复核，`online_text` 不得出现“语音/电话/听见”等越界媒介词，`online_voice` 不得出现界面操作旁白。

## 3. 不做

- 不复制、改写或伪造既有 `in_person` 会话的 `encounter` 字段。
- 不改 R6-A 节奏与 prompt 条件分布；不改 R6-B compact 重试。
- 不换评分模型、不换 provider、不改 `.env`。
- 不为了线上分数好看放宽评分或审计口径。
- 不做真人督导师双标，`clinicalAcceptanceEligible` 保持 false。
- 不改 `scripts/orchestration/`、admin-dashboard、Flutter。

## 4. 闸门

见 frontmatter `gates`。定向测试至少覆盖：

- `encounter` 为 online/voice、online/text、online/video 时分别归一为 `online_voice`、`online_text`、`online_voice`；
- 无 `encounter` 时保持 prompt 推断与 `in_person` 缺省；
- 老 360 场输入在新旧加载路径下场景计数一致；
- 盲评包按场景分层，线上场景不会整体饿死。

## 5. 交付

- 交付记录：`docs/worklog/completed/phase2.5/af226-realism-r6c-online-scenes-2026-11-21.md`
- 批次与切片报告：`data/phase25-exit/af226-online-scenes/report.json`（gitignored）
- 盲评报告：`data/phase25-exit/af226-online-scenes/blind/report.json`（gitignored）
- 机读回执：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-226/receipt-RC-AF-226-1.json`
