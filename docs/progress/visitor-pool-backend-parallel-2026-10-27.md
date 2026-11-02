# 来访池后端并行任务单（2026-10-27）

> **用途 / 性质**：前端本期只做「收藏视图 / 危机隔离壳 / 旧入口弱化」等纯前端改动，
> 本单把**不依赖前端改动、可独立交付、提前铺地基**的 4 项后端工作排给后端先行。
> 配套前端：`xin_su_app/docs/progress/`（本期前端任务，另行交付）。
>
> **执行约束（仓库硬约束，先读 `docs/README.md` §16 条）**：
> - schema 变更一律手写 DDL migration，并在 **`bin/ormconfig.ts`** 的 `migrations[]` 真注册
>   （`src/migration/index.ts` 无人 import，漏登记会静默不建表）；禁用 `synchronize: true`。
> - 软删查询手写 `deletedAt: IsNull()`，不用 `@DeleteDateColumn`。
> - `noUnusedLocals`（未用 import = 错）、`noPropertyAccessFromIndexSignature`（`obj['x']` 括号访问）、`strict`。
> - 结构化 LLM 输出只走 `CounselorLlmJsonClient`；jobId 幂等；不自动 commit/push，写完给 commit 文字。
> - 所有 `tsc / jest / migration:run / seed` 由大炮在 Windows 端自跑，后端不要求 AI 在本机执行。

---

## 0. 已就绪基线（已读代码确认，**勿重造**）

| 能力 | 现状落点 | 本单是否再动 |
|---|---|---|
| 4 督导流派播种 | migration `1714900000021-SeedSupervisionSchools.ts` 幂等 upsert，cbt 缺失已修 | ❌ |
| 来访池管理端点 | `visitor-pool-admin.controller.ts` 6 个（AI生成/列表/含剧本详情/PATCH/软删/恢复），class 级 AdminRoleGuard | ❌ |
| 收藏 favorites | `GET /counselor/visitor-pool/favorites` 已实现 | ❌ |
| 自定义人设 CRUD | `visitor-persona.controller.ts` generate/list/surface/full/updateSurface/attach | ❌ |
| 化名规则 | `config/visitor-pool-codename.ts`（词库/判据/去重尾号/LLM 拒收闸门） | 仅任务 D 巡检订正 |
| 督导报告主体 | 六维 / annotations / errorPatterns / techStats / marks / 4 流派 / 状态机已齐 | 仅任务 C 增补 alternatives |
| 系统音色目录代理 | `voices.service.ts`（缓存 + single-flight + catalog 插槽），`GET /counselor/voices?type=system` | 仅任务 A 消费 |
| 普通池危机排除闸门 | `visitor-pool.config.ts` `VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS` + `MAX_SELF_REPORTED_RISK=medium` | 任务 B 继续沿用 |

---

## 任务 A（P0）· 公共人物绑定系统音色

### 现状缺口
`visitor_pool_templates` 无 `voice_id` 列；WS 音色解析 `voice.gateway.ts#resolveVoiceId`
（~573）只认「握手 voiceId」> env `MINIMAX_TTS_VOICE_ID`，模板级恒为空 —— 6 位官方人物
 currently 共用 env 同一个音色，听不出人物差别。`voice.service.ts#resolveSessionVoice`
 注释里预留的「模板绑定音色」位一直没接通。

### A1 模板表加可空音色列（migration，手写 DDL）
- `visitor_pool_templates` 增 `voice_id VARCHAR(64) NULL`（可空 = 未绑定回退 env，旧行零影响）。
- 在 `bin/ormconfig.ts` 注册；回滚 down() 删列。
- `VisitorPoolTemplate` entity 同步加 `@Column({ nullable: true }) voiceId`。

### A2 跨模块摘要带音色
- `voice/voice-session.types.ts#VoiceTemplateSummary` 加**可选** `readonly voiceId?: string | null`。
- `counselor/providers/counselor-visitor-pool-template.resolver.ts#resolve`（~109 构造摘要处）
  把 `row.voiceId ?? null` 填入；7 大块剧本仍绝不进摘要。

### A3 gateway 音色优先级接通（第二优先级）
`verifyAndStart`（~230 `data.voiceId = await this.resolveVoiceId(handshake.voiceId)`）扩为：

```
握手 voiceId（catalog.check=available）
  → 模板绑定音色（channel.kind==='template' 时取 channel.summary.voiceId，同样过 catalog.check）
    → env 默认
```

- 模板音色 `check=unavailable`（上游目录里没有）→ warn + 回退 env，**不致命断连**；
  `check=unknown`（上游故障判不出）→ 沿用现有「透传交给 TTS 建连归一」逻辑，不误回退。
- 握手显式传了 voiceId 时，仍以握手为准（用户选择优先于模板默认）。

### A4 官方 seed 配音色 + upsert 带上
- `config/visitor-pool-seed.ts` 6 位人物各配一个**账号可用系统音色**（从 `GET /counselor/voices?type=system`
  的 `{voiceId,name,description}` 里挑，气质/性别与人物第一印象不打架即可，**不按性格给名字配气质**，
  与化名规则同理）。
- `seeds/visitor-pool-templates.seed.ts` 的 `toEntityPayload` 与 `hasDrift` 都带上 `voiceId`
  （否则改了 seed 音色不会触发 UPDATE）。
- 绑不上 / 目录无合适音色的人物留 `null`，回退 env，不硬塞。

### 验收（任务 A）
| 场景 | 期望 |
|---|---|
| 握手不传 voiceId + 模板已绑音色 | catalog available → 用模板音色，日志可见 |
| 模板绑了但目录里 unavailable | 回退 env，warn，不断连 |
| 握手显式传合法 voiceId | 覆盖模板默认，用握手音色 |
| 旧行 / 未绑定人物 | 走 env，行为与改前一致 |
| 公共列表 DTO | 不下发 voiceId（本期前端不选音色，自动绑定） |

---

## 任务 B（P0）· 危机识别专区「静态元数据骨架」（只读，**不做干预**）

> **硬边界（呼应 `docs/README.md` §13 / 前端整合版 §17）**：本期只给前端「隔离壳」备
> 元数据。**不开发危机干预治疗演练、不做转介流转、不接 LLM 生成危机人物剧本、不建危机
> 人物表、不写具体热线号码、不写任何方法/步骤细节。** 这是「识别与转介」教学场景的壳数据，
> 不是真实危机处置能力。

### B1 新增静态 config
新建 `counselor/config/crisis-practice.config.ts`（纯静态 TS，不落库、不调上游）：

- **风险分级教学枚举**：`low | medium | high | imminent`，每级只给**教学标签 + 识别信号类别**
  （教育性描述，非临床诊断标准，不写阈值判定公式）。
- **识别信号类别清单**：如「言语流露无助/无价值感」「社交退缩」「提及告别/安排后事」等类别词，
  只描述"咨询师可以留意什么"，不诱导、不展开。
- **转介练习话术模板**：开放式评估问句（如"你说的撑不住，具体是什么时候开始的"）+
  通用资源引导（"建议引导对方联系专业帮助 / 当地急救或心理援助资源"），**不含具体号码、
  不含诊断、不含干预技术动作**。
- **边界声明文案**（前端壳直接渲染）："本模块仅练习识别风险信号与转介沟通，非真实危机干预，
  不替代专业帮助。"

### B2 只读公开元数据端点
- `GET /counselor/crisis-practice/meta`（JWT，不匿名）回 B1 的分级 / 信号类别 / 话术模板 /
  边界声明；响应里**不含**任何人物剧本、不调上游、不落库、不计次。

### B3 物理隔离
- 危机元数据绝不进 `visitor_pool_templates`、绝不被公共图鉴列表/筛选带到。
- 普通池 `VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS` 闸门继续生效，危机 config 与普通池 seed 零交集。

### 验收（任务 B）
| 场景 | 期望 |
|---|---|
| 调 meta | 返分级/信号类别/话术模板/边界声明，无剧本、无号码、无方法细节 |
| 公共图鉴查询 | 查不到任何危机条目 |
| 普通池 seed 生成 | 命中危机关键词仍被拒收闸门拦下 |

---

## 任务 C（P1）· 督导反馈补「关键句替代回应 alternatives」

### 现状缺口
`SupervisionPerSentenceDto` 只有 `sentence / score / comment`，缺"这句当时换一种可以怎么说"
的示范；`comment` 是点评，不等于可照说的替代回应。

### C1 输出契约加可选 alternatives
`supervision.service.ts#SUPERVISION_SCHEMA_DESCRIPTION`（~133）在 perSentence 项内加：

```json
"alternatives": [
  { "original": "咨询师原句", "suggested": "一句更合适的替代回应", "why": "为什么这样更好(1句)" }
]
```

- 只对 **score 偏低 / 有改进空间** 的句给，1-2 条；好句子不给（空数组）。
- `suggested` 必须是可直接说出口的完整回应，不是技术名词。

### C2 校验容错（不得因 alternatives 丢整条反馈）
`validateSupervisionPayload`（~182）解析 alternatives：
- 缺失 / 非法 / 非数组 → **空数组容错**，不返回 null；
- 逐条 trim、限长（suggested ≤ 80 字、why ≤ 40 字），不合格的单条丢弃，其余保留；
- 继续遵守 `noPropertyAccessFromIndexSignature` 方括号取值。

### C3 类型与落库
- `SupervisionFeedbackPayload['perSentence']` 项类型 + `SupervisionPerSentenceDto`
  （`supervision.dto.ts:83`）加可选 `alternatives`（可空数组，前端本期不渲染，先落库）。
- 落 `supervision_feedback.feedback` json，**不加 DB 列**。

### C4 4 流派 prompt 模板补一句
`config/supervision-school-presets.ts` 4 个 `promptTemplate` 各补一条要求：
"对值得改进的关键句，给一条更合适的替代回应并说明理由。"

### 验收（任务 C）
| 场景 | 期望 |
|---|---|
| 模型正常给 alternatives | 落库并随反馈返回，结构合法 |
| 模型漏给 / 给非法 alternatives | 反馈其余字段照常返回，alternatives=[]，**不整体 parse_failed** |
| 好句子 | alternatives=[]，不硬造 |

---

## 任务 D（P1）· 代号合规巡检 + 历史脏数据订正

### D1 自检跑通
- 跑 `validateCodenameBank()` 词库自检；对 seed 6 代号做交叉自检：形态 1-3 字 / 首字非姓 /
  无强性别字 / 无性格评价字（强/倔/傲/烈等）/ 互不重复 / 都在词库。

### D2 历史脏数据一次性幂等订正
- 扫 DB 现有公共模板 `codename`，发现「来访者·X」旧前缀或违规字 → 一次性幂等订正
  （并入 seed upsert，或独立可重复执行的订正脚本；连跑两次不报错、不改写已合规行）。

### D3 补单测
- 旧前缀 / 姓氏首字 / 性格评价字 / 撞名尾号（「晚晴·02」形态）各一条用例。

### 验收（任务 D）
| 场景 | 期望 |
|---|---|
| 词库 + seed 自检 | 全绿，0 违规 |
| 含旧前缀的历史行 | 订正为合规代号，幂等可重跑 |
| 合规行 | 不被改动 |

---

## 明确不做（本期边界）

- ❌ instantiate 克隆 / 信任度推进 / 长程卷宗（VS-D，另立详设，与克隆启用绑定，不抢跑）。
- ❌ 危机干预治疗、转介流转、真人危机剧本（见任务 B 硬边界）。
- ❌ 前端音色选择器（本期自动绑定，选择器后期再说）。
- ❌ 五维画像 / 能力回灌（另立专项）。
- ❌ 改动普通池现有 6 人物的 7 大块剧本内容。

---

## 总验收与自检

| 任务 | 成功场景 | 边界场景 |
|---|---|---|
| A 音色 | 不传 voiceId 用模板音色 | 不可用回退 env、握手覆盖、旧行不变 |
| B 危机壳 | meta 返回合规元数据 | 公共池查不到、普通池闸门仍拦 |
| C alternatives | 正常落库 | 缺省/非法容错为空数组，不整条失败 |
| D 代号 | 自检全绿、脏数据订正 | 幂等、合规行不动 |

**自检（大炮本地跑）**：`tsc -p tsconfig.build.json --noEmit` 0 错；`npx jest` 新增用例全绿；
migration 在 `bin/ormconfig.ts` 已注册且可 up/down；公共列表 DTO 未泄露剧本/voiceId/计数字段。
