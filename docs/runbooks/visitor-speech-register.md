# 来访者语域指纹（Speech Register）运行手册

> 任务：AF-462。语域属于“怎么说”，不是“说什么”，因此不进 BDI 决策核；
> 只走角色资产层（`character_profiles.speech_register` / `visitor_pool_templates.script.speech`）
> 与渲染层（`AdaptiveRenderSpec` → `buildVisitorSystemPrompt()`）。

## 1. 开关与灰度

| 环境变量                     | 取值                       | 默认  | 作用                                                    |
| ---------------------------- | -------------------------- | ----- | ------------------------------------------------------- |
| `VISITOR_REGISTER_MODE`      | `off` / `audit` / `active` | `off` | off 不注入；audit 只产出审计摘要；active 命中试点才注入 |
| `VISITOR_REGISTER_PILOT_IDS` | 逗号/空格分隔的角色 key    | 空    | 空 = 全部 active；非空 = 只对列表内角色生效             |

角色 key 统一为 `vpt_*`（公共模板 id / `character_profiles.template_id`）。

推荐上线顺序：

1. `audit` + 试点三角色，跑 24–48 小时，只看 `speechRegisterAudit` 告警码与指标。
2. `active` + 同一组试点，跑 A/B：同角色、同会话脚本、同温度，比较 `base` 与 `register` 两组台词。
3. 试点通过后再扩大 `VISITOR_REGISTER_PILOT_IDS`；不要在未看指标前直接全量 `active`。

## 2. 资产落点

- 公共模板：`visitor_pool_templates.script.speech`（JSON，内容源；seed 从 `src/shared/speech-register/speech-register.calibration.ts` 派生）。
- 引擎角色：`character_profiles.speech_register`（JSON NULL；migration `1714900000052`）。
- 长程人设：`visitor_full_personas.speech`（JSON NULL；migration `1714900000053`）。
- 三个落点使用同一份标定表，禁止运营端另写一套文案。
- `script.speech` 是 `script` JSON 内的键，不需要 migration；两个独立列需要 migration。

## 3. 结构校验

```bash
pnpm vitest run test/shared/speech-register/speech-register.spec.ts
```

校验会拦截：

- 版本不是 `speech-register-v1`；
- 角色 key / 身份 / 社会处境 / 词汇 / 句法 / 姿态缺失或越界；
- 数组超限、台词超长；
- 评价性标签：`文化水平低`、`没文化`、`农村人`、`底层`、`低端人口`、`外地人`、`素质低` 等。

教育只映射抽象词/术语预算；地域只做词汇层，不做口音拼读；年龄只做代际参照，不写“老人啰嗦/年轻人网感”。

## 4. 渲染与漂移

- 渲染块标题固定为“你说话的样子（只影响用词，不改内容和情绪）”。
- 位置：`verbalVoice` 之后、“这一轮怎么说”之前；不出现角色代号、原始枚举、舞台指令。
- 有限漂移只允许三项：句长、抽象词预算、直接度。
- 风险轮（`riskSignal.level != none`）：`jargonBudget=0`、清空标志词与正例、提高具体锚点与碎片容忍；教育、地域、生活锚点不漂移。

## 5. 评估

确定性指标（`measureSpeechRegisterFit`）：

- `abstractTermRate` / `jargonRate`：抽象词与临床术语密度；
- `averageSentenceLength` / `fragmentRate`：句法与碎片；
- `signatureHitRate` / `anchorDensity`：角色标志词与生活锚点命中。

盲评（`register-v1`，`src/auto-practice/metrics/visitor-register-rating.ts`）：

- `register_fit` 语域贴合；
- `stereotype_risk` 刻板风险（分越高越安全）；
- `cross_turn_stability` 跨轮稳定；
- `concreteness` 具体度。

盲评输入必须去掉姓名/代号，只给“应有的语域摘要 + 台词”；结果状态是 `ai_proxy_candidate`，不能写成真人验收。

## 6. 回滚

1. 把 `VISITOR_REGISTER_MODE` 改回 `off`（或从试点列表移除角色）——不需要回滚代码。
2. 若要彻底下线，删除两个 `speech` 列前先确认没有消费方；当前 migration 的 `down` 只删列，不删 `script.speech`。
3. 旧链路/长时人设没有 `speech` 时，prompt 逐字不变；这是零回归路径。长程人设生成的 `speech` 落 `visitor_full_personas.speech`，该列为空时同样不渲染。

## 7. 验证清单

```bash
pnpm lint
pnpm typecheck
pnpm vitest run test/shared/speech-register/speech-register.spec.ts
pnpm test   # 收尾一次；本地 data/debug-sessions 可能让 af427 语料断言失败，需在干净 worktree 复核
git diff --stat HEAD -- src/engine-core   # 必须为空
```

真实库执行 migration 前先备份；`pnpm seed:character-profiles` 会按幂等 upsert 写入语域快照。
