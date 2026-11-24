# AF-462 · 来访者语域指纹全链路落地

- 任务单：`docs/worklog/records/phase2.5-visitor-speech-register/AF-462/task-sheet.md`
- 基线：`dcb28dd13d09428286adc171fe9e55873d1e03aa`（AF-461 squash 合并后的 integrate）
- 类型：implementation
- 分支：`task/AF-462-visitor-speech-register`

## 1. 设计判断

语域是“怎么说”，不是“说什么”。BDI 决策核只回答想不想说、说多少、什么情绪，不回答具体措辞，因此本任务**不进 `src/engine-core`**，走既有角色资产 → 渲染规格 → 系统 prompt 通路：

`character_profiles.speech_register / visitor_pool_templates.script.speech / visitor_full_personas.speech` → `ResolvedCharacter` → `EngineTurnOpenOptions` → `TurnSessionContext` → `AdaptiveRenderSpec` → `buildVisitorSystemPrompt()`；旧链路走 `VisitorContextBlock.speechRegister` → `renderSystemPrompt()`。

不写“文化水平低 / 农村人 / 底层 / 外地人”这类评价标签：教育只影响抽象词与术语预算，地域只做词汇层不做口音，年龄只做代际参照。语域默认稳定，只允许句长、抽象词预算、直接度随 BDI 状态有限漂移；风险轮压制方言词、俚语、比喻与正例。

## 2. 改动

### 2.1 共享语域模块

新增 `src/shared/speech-register/`：

- `speech-register.types.ts`：`speech-register-v1` 契约、`off/audit/active` 模式、教育/地域/社会处境/姿态枚举、审计与指标类型。
- `speech-register.schema.ts`：版本、字段、数值范围、数组上限、台词长度校验；拦截评价性群体标签。
- `speech-register.render.ts`：`resolveCurrentRegister()` 有限漂移 + `renderSpeechRegisterBlock()` 自然语言块（≤460 字符，正例/反例各最多一句，不出现角色 key）。
- `speech-register.audit.ts`：配置审计告警码 + 字级确定性指标（句长、碎片率、抽象词/术语密度、标志词命中、生活锚点密度）。
- `speech-register.runtime.ts`：`VISITOR_REGISTER_MODE` / `VISITOR_REGISTER_PILOT_IDS` 解析与灰度选择；默认 off，非法值回落 off。
- `speech-register.calibration.ts`：10 个已标定角色的单一代码真相源；6 个公共模板 + 4 个 DB-only 角色。
- `index.ts`：统一导出。

### 2.2 资产落点与 migration

- `character_profiles.speech_register JSON NULL`：migration `1714900000052`，手写 DDL + 列存在幂等检查。
- `visitor_full_personas.speech JSON NULL`：migration `1714900000053`，长程人设语域，缺省不渲染。
- `visitor_pool_templates.script.speech`：JSON 内的键，不需要 migration；`visitor-pool-seed.ts` 从标定表派生并自检。
- `character-profile.entity.ts` / `character-profile-version.entity.ts` / `character-profile.admin.service.ts` / `.dto.ts` / `character-profile.seed.ts`：实体列、版本快照、管理端读写、seed 装配与漂移检测。
- `visitor-persona.types.ts` / `visitor-persona.service.ts` / `visitor-persona-prompts.ts`：生成端接受可选 `speech`，落 `visitor_full_personas.speech`；非法整份判 null。
- `visitor-full-persona.entity.ts`：新增 `speech` 列。
- `visitor-pool-prompts.ts`：生成 schema 增加完整 `script.speech` 块与“怎么说不是说什么”的硬性要求。

### 2.3 引擎链路

- `render-risk.ts`：`AdaptiveRenderSpec` 增加 `speechRegister` / `speechRegisterAudit`。
- `spec-assembler.ts`：`SpecAssemblyInput` 同字段，条件展开。
- `turn-render-orchestrator.ts`：`TurnSessionContext` 透传；`buildVisitorSystemPrompt()` 在 `verbalVoice` 之后插入“你说话的样子”；非生产日志只打印 `register=active|off`、渲染长度与告警码，不落台词。
- `engine-turn.service.ts`：`EngineTurnOpenOptions` 增加语域字段，并在 `buildRenderAttribution()` 条件登记（此前遗漏会导致 adapter 字段被静默丢弃，已补）。
- `engine-stream-backend.adapter.ts`：`openKernelSession` 从角色快照条件带入。
- `db-character-profile.resolver.ts`：active 命中试点才返回 `register`；audit/active 都返回审计摘要。
- `admin-debug/debug-session.service.ts`：新建与恢复两条开场路径在 `verbalVoice` 后登记语域。

### 2.4 旧链路与长程链路

- `visitor-context.ts`：`VisitorContextBlock.speechRegister` 可选。
- `visitor.prompts.ts`：有语域块时在人格画像之后、行为模式之前渲染，缺省 prompt 逐字不变。
- `counselor-visitor-context.contributor.ts`：
  - 公共模板从 `script.speech` 解析并经灰度选择；
  - 长程人设从 `visitor_full_personas.speech` 解析，角色 key 优先取 `sourceTemplateId`；
  - 只在 `register` 存在时注入，日志只打 active/reason。

### 2.5 评估协议

新增 `src/auto-practice/metrics/visitor-register-rating.ts`：

- `register-v1` 四维：`register_fit` / `stereotype_risk` / `cross_turn_stability` / `concreteness`；
- 1–5 全量锚点写进提示词，明确“5 = 最贴合、最安全”，避免评审方向颠倒；
- `parseRegisterRating` 对缺少 `items`、维度缺失、证据过短判失败，不抛异常；
- 状态固定 `ai_proxy_candidate`，不得当真人验收。

### 2.6 测试与文档

- 新增 `test/shared/speech-register/speech-register.spec.ts`（6 例）：10 条标定合法、评价标签拒收、三态选择、风险轮漂移、渲染边界、审计指标。
- 新增 `test/engine-adapters/af462-speech-register.spec.ts`（2 例）：缺省规格无字段、注入后 prompt 出现语域段且不泄露 key。
- 新增 `test/agent/af462-visitor-context-speech.spec.ts`（2 例）：旧链路缺省不出块、出块位置正确。
- 新增 `test/auto-practice/visitor-register-rating.spec.ts`（3 例）：全量锚点、残缺输出、成功解析。
- `docs/runbooks/visitor-speech-register.md`：开关灰度、三个资产落点、校验、渲染与漂移、指标与盲评、回滚、验证清单。

## 3. 验证

### 3.1 migration 与 seed

- `pnpm migration:show` 确认 `1714900000052`、`1714900000053` 待执行后，`pnpm migration:run` 成功：
  - `ALTER TABLE character_profiles ADD COLUMN speech_register JSON NULL AFTER verbal_voice;`
  - `ALTER TABLE visitor_full_personas ADD COLUMN speech NULL AFTER presenting_issue;`
  - 两条均 COMMIT。
- `pnpm seed:character-profiles` 连跑两次：
  - 第一次 A/B 类各更新 4；第二次各更新 0 / 未变 4；基线校准未变 4。语域写入幂等。
- `pnpm exec tsx bin/seed-visitor-pool-templates.ts` 连跑两次：新增 0 / 更新 6；数据库确认 6 条模板均落 `script.speech`。第二次仍显示“更新 6”是既有 seed 的 JSON canonical 比较问题，内容无重复、无字段丢失；该 seed 文件不在本任务 scope 内，未改。

### 3.2 闸门

- 定向：`pnpm exec vitest run test/shared/speech-register test/engine-adapters test/agent test/counselor test/auto-practice test/admin-debug`
  - **205 passed | 1 skipped (206 files)，2932 passed | 4 skipped (2936 tests)**
  - 新增 rating spec 后单跑 **3 passed**。
- `pnpm lint`：**0 error**。
- `pnpm typecheck`：**0 error**。
- `git diff --stat HEAD -- src/engine-core`：**空**。
- `pnpm test` 全量：**4913 passed / 1 failed / 4 skipped**。
  - 唯一失败为 `scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs`：本地 `data/debug-sessions` 语料把 empathy 轮次从 34 变 39，硬编码断言失配；该目录 gitignore，CI 会 skip。AF-461 亦遇同款，干净 worktree 复核。

## 4. 三角色真实小样本对比

方法：旧链路 `renderSystemPrompt()`，同角色、同两轮咨询师台词、同模型（豆包 visitor provider）、温度 0.8；`base` 不带语域块，`active` 带标定语域块。台词不落普通日志，只在本地临时 JSON 中计算指标。

| 角色            | base 均句长 | active 均句长 | base 标志词命中 | active 标志词命中 | base 锚点密度 | active 锚点密度 |
| --------------- | ----------- | ------------- | --------------- | ----------------- | ------------- | --------------- |
| 31 岁互联网运营 | 39.5        | 34            | 0               | 0.13              | 3.69          | 4.84            |
| 52 岁仓储主管   | 48          | 15            | 0.13            | 0.25              | 0             | 0               |
| 22 岁研究生在读 | 42          | 33.5          | 0.13            | 0.25              | 1.19          | 0               |

`register-v1` AI 代理盲评（2 轮、单一评审模型、一次运行）：31 岁 4.75 / 4.75，52 岁 3.25 / 3.25，22 岁 4.5 / 4.0。盲评噪声明显，不能作为 active 优于 base 的充分证据；确定性指标显示 52 岁句长与标志词改善最明显，31 岁锚点密度上升，22 岁锚点下降。

结论：本轮交付的是**可灰度、可审计、可回滚的链路**与确定性指标；真实盲评仍需扩大样本、多评审模型与人工复核。把这次 AI 代理结果写成“已验证 active 更好”是不诚实的。

## 5. 偏差与遗留

- 任务单原计划只加 `character_profiles.speech_register`；实现中发现长程人设 `visitor_full_personas` 逐列存字段，若不补 `speech` 列，生成端语域会在落库时丢失。因此补了 migration `1714900000053`，并在长程贡献者接入。
- `.env.example` / 部署配置未加 `VISITOR_REGISTER_MODE` 样例：该文件不在任务单 scope 内。运行时默认 off 已生效，开关说明写在 runbook §1。
- 公共模板 seed 第二次仍报“更新 6”：内容幂等已确认，canonical JSON 比较未修，文件不在 scope。
- 三角色真实盲评只完成小样本与 AI 代理，未做人工复核；上线前按 runbook §1 的 audit → active 顺序执行。
- 本轮未把子任务实际委派给 MiniMax Code；实现跨角色资产、引擎渲染、旧链路、migration 与测试，拆单会显著增加接口对齐成本。

## 6. 提交信息

`feat(af462): 来访者语域指纹接入角色资产与渲染链路`
