# AI 模拟来访池 · 后端开发规格（公共模板 + 克隆实例化）

> 文档版本：v1.0（2026-10-23）
> 状态：开发稿，前端契约见 `xin_su_app/docs/product/visitor-pool-design.md`
> 关系：本 spec 是 v1.2 §M1 分层人设（`visitor_full_personas` + 视图 A/B）的**公共供给层扩展**，0 破坏现有 6 个 visitor-persona 端点与会话链路。
> 零压红线：人物池不下发分数/对错/评级/通过率/排名；收藏仅本人可见，不返回全站计数。

---

## 1. 范围与两层模型

终态把"人物"与"临场参数"分开，后端只负责前者的公共供给与克隆；后者是会话启动参数，不落人物表。

| 层 | 落点 | 说明 |
|---|---|---|
| ① 人物内容层 | 新表 `visitor_pool_templates`（全局只读公共模板）+ 实例化后私有副本 `visitor_full_personas` | 模板存表层卡片字段 + 7 大块全量剧本快照；启动时克隆为当前用户私有副本 |
| ② 临场参数层 | 不新增表，随 `training_session` 启动参数传递 | 情绪基线/防御水平覆盖/难度/模式/种子，仅本场有效，不回写人物 |

**关键隔离**：公共模板全局只读，任何用户的会谈进展、信任度变化、档案解锁都**绝不回写模板**；所有人启动同一官方人物拿到各自独立副本。

## 2. 数据模型

### 2.1 新表 `visitor_pool_templates`（公共只读，system 级，无个人 userId）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | char(36) PK uuid | 模板 id |
| `codename` | varchar(100) | 匿名称呼，无真实姓名 |
| `age_range` | varchar(20) | 年龄区间，如 `28-35`，不存精确生日 |
| `presenting_complaint` | varchar(300) | 初次见面主动呈现的一句话主诉（卡片用） |
| `defense_type` | varchar(20) | 主导防御类型：`intellectualization/avoidance/idealization/projection/regression`（主一种，锁定不可临场改） |
| `issue_domain` | varchar(20) | `intimate/parenting/workplace/grief/self_worth/social_anxiety`（可扩展） |
| `training_goal` | varchar(200) | 推荐训练目标，如"练开放式提问" |
| `difficulty` | varchar(4) | `L1/L2/L3` 配合度梯度 |
| `source` | varchar(20) | `official/expert/contributed`，本期恒为 `official` |
| `style_hint` | varchar(20) | 映射现有 VisitorStyle：`cooperative/defensive/resistant/avoidant/mixed`，实例化默认值 |
| `emotion_baseline_default` | float | 人物默认情绪基线 0-1（微调起点） |
| `defense_level_default` | float | 人物默认防御水平 0-1（微调起点） |
| `script` | json | 7 大块全量剧本快照（复用 `VisitorFullPersonaScript` 结构：basics/developmentalTimeline/innerWorkingModel/socialMap/coping/therapyExpectation/presentingIssue），**不下发前端列表/详情** |
| `enabled` | tinyint(1) | 上下架开关，默认 1 |
| `sort_order` | int | 图鉴排序，默认 0 |
| `created_at` / `updated_at` / `deleted_at` | datetime | 软删，查询手写 `deletedAt: IsNull()`（沿用仓库约定，非 `@DeleteDateColumn`） |

索引：`(enabled, issue_domain)`、`(enabled, difficulty)`；`defense_type` 后置筛选，本期可不建索引。

### 2.2 复用 `visitor_full_personas` 存私有副本（不新建副本表）

实例化时把模板 `script` 7 大块整体快照复制进 `visitor_full_personas`，并新增**可选**列：

| 新增列 | 类型 | 说明 |
|---|---|---|
| `source_template_id` | char(36) nullable | 来源公共模板 id；自建/随机生成时为 null |

- 副本 `tenantId = userId`、`userId = 当前用户`，`trust_level` 重置为默认 0.2，`caseId` 初始 null。
- 现有 6 端点（generate/list/getSurface/getFull/updateSurface/attach）对副本继续生效，0 改动。
- 模板表本身**不挂** trustLevel、不挂会话演进状态。

### 2.3 临场参数（不建表）
随会话启动请求透传：`emotionBaseline / defenseLevel / difficulty / mode(useMySettings|fullyReal) / randomSeed`，缺省取模板 `*_default`。后端只在本场会话上下文使用，不写回 `visitor_pool_templates`，也不强制写入 `visitor_full_personas`。

## 3. API 契约（JWT 鉴权，前缀 `/counselor`）

### 3.1 公共图鉴列表
`GET /counselor/visitor-pool?issueDomain=&difficulty=&defenseType=&trainingGoal=&source=&cursor=&limit=20`

- 只返回表层卡片字段，**绝不返回 `script` 全量剧本**。
- 筛选全部可选；`cursor` 为上一页最后一条 `id`，不做总页数。
- 仅返回 `enabled=1` 且未软删。

响应：
```json
{
  "items": [
    {
      "templateId": "tpl_01",
      "codename": "来访者 · 林",
      "ageRange": "28-35",
      "presentingComplaint": "总在关系里先讨好，事后又委屈",
      "defenseType": "avoidance",
      "issueDomain": "intimate",
      "trainingGoal": "练开放式提问与情绪反射",
      "difficulty": "L1",
      "source": "official",
      "favorited": false
    }
  ],
  "nextCursor": "tpl_xx"
}
```

### 3.2 单模板表层详情
`GET /counselor/visitor-pool/:templateId`
- 返回同 3.1 单条表层；`script` 不下发。
- 模板不存在/已下架/软删 → 404。

### 3.3 实例化（克隆为我的私有副本）
`POST /counselor/visitor-pool/:templateId/instantiate`

请求体（全部可选，缺省用模板默认）：
```json
{
  "emotionBaseline": 0.4,
  "defenseLevel": 0.3,
  "difficulty": "L1",
  "mode": "useMySettings"
}
```

行为：
1. 校验模板存在且 `enabled`；不存在 → 404。
2. 把 `script` 7 大块快照复制为一条新的 `visitor_full_personas` 私有副本，写 `source_template_id`，`trust_level=0.2`。
3. 幂等：重复调用生成**新副本**，不覆盖旧副本、不改模板。

响应：`personaId` 为新建私有副本 id；`card` 返回池模板表层卡片字段（同 3.1），副本完整视图 A 仍走现有 `GET /counselor/visitor-personas/:id`，不在此重复；`defaultPreset` 为微调起点。
```json
{
  "personaId": "uuid-副本",
  "card": { "templateId": "tpl_01", "codename": "...", "ageRange": "28-35", "presentingComplaint": "...", "defenseType": "avoidance", "issueDomain": "intimate", "trainingGoal": "...", "difficulty": "L1", "source": "official" },
  "defaultPreset": {
    "styleHint": "cooperative",
    "emotionBaseline": 0.35,
    "defenseLevel": 0.2,
    "difficulty": "L1",
    "mode": "useMySettings"
  }
}
```

### 3.4 收藏（终态，可紧随本期）
- `POST /counselor/visitor-pool/:templateId/favorite`（幂等）
- `DELETE /counselor/visitor-pool/:templateId/favorite`（幂等，未收藏也返回 200）
- `GET /counselor/visitor-pool/favorites` 我的收藏表层列表
- 收藏关系独立小表 `visitor_pool_favorites(template_id, user_id, created_at)`，唯一键 `(template_id, user_id)`；**不返回、不统计全站收藏数**。

### 3.5 AI 生成模板（库更新能力，内部/管理侧）

用于持续扩充官方库，**不面向普通练习用户**。结构化产出只走 `CounselorLlmJsonClient`，复用现有的结构化 LLM 调用与 schema 校验范式；这是内部工具，失败直接报错给调用方，不做面向用户的软降级。

`POST /counselor/admin/visitor-pool/generate`（内部角色，鉴权见 §4）

请求体（全部可选，给方向即可，缺省由 LLM 补全）：
```json
{
  "issueDomain": "intimate",
  "defenseType": "avoidance",
  "difficulty": "L1",
  "trainingGoal": "练开放式提问",
  "codenameHint": "",
  "count": 1
}
```

行为：
1. LLM 一次产出表层卡片字段 + 7 大块 `script` 剧本，结构校验通过后落 `visitor_pool_templates`。
2. 生成结果默认 `enabled=0`（草稿），由管理侧审核/微调后再上架；也可按内部开关直接 `enabled=1`。
3. LLM 失败/超时/开关关：返回明确错误给内部调用方（这是内部工具，不做面向用户的软降级），不落半成品。
4. 不占用普通用户配额；生成条数上限由内部 env 控制。

#### 3.5.1 LLM 输出 JSON schema（对齐 `CounselorLlmJsonClient.requestJson<T>`）

新增 `visitor-pool-prompts.ts`（system/user/schemaDescription），走与现有 `visitor-persona.service.generate()` 同一条结构化链；7 大块校验直接复用 `validateFullPersona`，新增 card 元字段校验。顶层输出为 `{ card, script }`，`source` 由后端固定写 `official`，不让 LLM 填。

**card 元字段（落模板表表层列）**

| 字段 | 类型 | 约束 / 枚举 | 说明 |
|---|---|---|---|
| `codename` | string | 1–20 字，无真实姓名、无医院/机构名 | 匿名称呼，如「来访者 · 林」 |
| `ageRange` | string | 形如 `28-35`，两个整数区间 | 不给精确生日，避免可识别 |
| `presentingComplaint` | string | 10–60 字，初次见面愿主动说的一句话困扰 | 卡片副标题 |
| `defenseType` | enum | `intellectualization/avoidance/idealization/projection/regression` | 主导防御机制，主一种 |
| `issueDomain` | enum | `intimate/parenting/workplace/grief/self_worth/social_anxiety` | 须与请求体一致（传了就对齐） |
| `trainingGoal` | string | 5–30 字，一个可练的技术目标，如「练开放式提问」 | 不写诊断/治疗目标 |
| `difficulty` | enum | `L1/L2/L3`，与请求体一致 | L1 配合度最高 |
| `styleHint` | enum | 现有 `VisitorStyle`：`cooperative/defensive/resistant/avoidant/mixed` | 配合风格，区别于 defenseType |
| `emotionBaselineDefault` | number | 0–1；L1 建议 0.25–0.45 | 微调起点 |
| `defenseLevelDefault` | number | 0–1；L1 建议 0.15–0.35 | 微调起点，非防御类型 |

**script（复用 `VisitorFullPersonaScript` 7 大块，结构照 `visitor-persona.types.ts`，不新增字段）**：`basics / developmentalTimeline[5段] / innerWorkingModel / socialMap[] / coping / therapyExpectation / presentingIssue`。

完整输出示例（L1 / intimate / avoidance）：
```json
{
  "card": {
    "codename": "来访者 · 林",
    "ageRange": "28-35",
    "presentingComplaint": "总在关系里先讨好，事后又一个人觉得委屈",
    "defenseType": "avoidance",
    "issueDomain": "intimate",
    "trainingGoal": "练开放式提问与情绪反射",
    "difficulty": "L1",
    "styleHint": "cooperative",
    "emotionBaselineDefault": 0.35,
    "defenseLevelDefault": 0.2
  },
  "script": {
    "basics": {
      "age": 31, "gender": "女", "occupation": "互联网运营",
      "education": "本科", "livingStatus": "独居",
      "somaticHistory": "无重大躯体疾病，偶发入睡困难",
      "psychHistory": "无正式咨询史"
    },
    "developmentalTimeline": [
      { "stage": "0-6", "parentingStyle": "父母忙于工作，情感回应少", "keyEvents": ["哭闹常被安抚住而非被理解"], "tabooTopics": ["抱怨父母"] },
      { "stage": "7-12", "parentingStyle": "被要求懂事", "keyEvents": ["习惯先照顾他人情绪"], "tabooTopics": [] },
      { "stage": "13-18", "parentingStyle": "成绩导向，情绪话题被略过", "keyEvents": ["学会压下不满"], "tabooTopics": [] },
      { "stage": "19-25", "parentingStyle": "离家独立", "keyEvents": ["几段关系都以迁就开始"], "tabooTopics": [] },
      { "stage": "26+", "parentingStyle": "—", "keyEvents": ["近期在亲密关系中反复压抑后爆发"], "tabooTopics": ["直接表达不满"] }
    ],
    "innerWorkingModel": {
      "attachmentType": "anxious",
      "coreBeliefs": ["我必须先满足别人才值得被留下", "表达不满会被抛弃"],
      "hiddenTrauma": ["童年需求常被忽略"],
      "unfinishedBusiness": ["渴望被看见却不敢说出口"],
      "defenseMechanisms": ["回避冲突", "自我合理化", "讨好"]
    },
    "socialMap": [
      { "relationType": "intimate", "currentStatus": "和伴侣同居，习惯迁就对方", "conflictPattern": "有不满先咽下，累积后冷战", "resourceOrDrain": "drain" }
    ],
    "coping": {
      "adaptiveResources": ["善于倾听", "内省力尚可"],
      "maladaptiveStrategies": ["回避冲突", "事后反刍", "讨好让步"],
      "emotionTriggers": ["被忽视", "感到自己不重要"]
    },
    "therapyExpectation": {
      "biases": ["怕说多了被评判"],
      "expectations": ["希望被理解", "不知道具体能改变什么"],
      "transferenceTrend": "易把咨询师当成需要讨好的对象",
      "resistancePattern": "谈到真实不满时绕开、转为自我谅解"
    },
    "presentingIssue": {
      "selfReport": "最近总想在关系里让着对方，可心里又堵得慌",
      "duration": "约 1 年",
      "sleepAppetite": "偶发入睡困难，食欲正常",
      "selfReportedRisk": "low"
    }
  }
}
```

**校验清单（validate，任一不过则不落库、报错给内部调用方）**：
1. card 枚举值合法、数值在 0–1、字符串长度达标；`issueDomain/difficulty` 与请求体一致。
2. script 通过 `validateFullPersona`：7 块齐全、`developmentalTimeline` 含 5 段、`innerWorkingModel.coreBeliefs` 非空、`presentingIssue.selfReportedRisk` 合法。
3. 一致性：`card.defenseType` 与 `script.innerWorkingModel.defenseMechanisms` 不矛盾；`card.issueDomain` 与 `socialMap`/主诉对得上。
4. 排除清单（prompt 内置硬约束，命中即拒收重生成）：不写性创伤、重度抑郁/自杀、人格障碍、精神病性症状；grief 只写普通丧失，不写危机干预；不出现可识别真实姓名/地名/单位。

### 3.6 管理端点（预留，管理页面后置）

后期管理页面所需的读写位先在本节定契约，前端管理 UI 后置，本期可不实现：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/counselor/admin/visitor-pool?status=draft|enabled|off&` | 管理列表（含草稿/下架，不分页口径同 3.1） |
| GET | `/counselor/admin/visitor-pool/:id` | 含 `script` 全量（仅内部） |
| PATCH | `/counselor/admin/visitor-pool/:id` | 编辑表层字段/上下架 `enabled`/调整 `sort_order` |
| POST | `/counselor/admin/visitor-pool/:id/restore` | 软删恢复 |
| DELETE | `/counselor/admin/visitor-pool/:id` | 软删（`deleted_at`），不物理删除 |

> 管理/生成端点的角色鉴权复用仓库现有内部/admin 角色体系（具体守卫由后端按现状对接），普通用户访问一律 403。

## 4. 隔离与权限

- 普通练习用户对公共模板只读；生成/编辑/上下架/删除只走 §3.5/§3.6 内部管理端点，普通用户访问 → 403，不对外开放写入口。
- 私有副本按 `userId` 隔离，`listByUser` / `getSurface` / `getFull` / `updateSurface` 全部校验归属，越权访问 → 403/404。
- `script` 全量剧本任何公共接口都不下发；仅实例化时服务端内部读取。
- 危机识别类人物**不进**普通池（本期只做前端隔离壳，后端不在此表放危机内容）。

## 5. 迁移与硬约束（沿用仓库 16 条）

1. migration **手写 DDL**，在 `bin/ormconfig.ts` 的 `migrations[]` 真注册，否则静默不建表。
2. 软删查询手写 `deletedAt: IsNull()`，不用 `@DeleteDateColumn`。
3. AI 生成模板的结构化产出只走 `CounselorLlmJsonClient`（§3.5）；批量初始入库可走 seed 脚本，二者落同一张表。
4. 不破坏现有 DTO 字段；新增一律可选/新增端点，旧响应结构保持兼容。
5. 不新增分数、对错、评级、通过率字段；人物不可被打分。
6. `noUnusedLocals`/`strict`/`noPropertyAccessFromIndexSignature` 必须 0 错。

## 6. 首批官方人物（本期 AI 生成入库，可再生成更新库）

本期先用 §3.5 生成能力产出 6 个议题各 1 个 L1 平静配合人物并入库，作为初始官方库；后续通过同一生成端点反复补充/替换，实现"更新库"。生成后可在管理侧（§3.6）微调或下架。

| issueDomain | defenseType(示例) | difficulty | 备注 |
|---|---|---|---|
| intimate 亲密关系 | avoidance | L1 | 平静配合起步 |
| workplace 职场压力 | intellectualization | L1 | |
| parenting 亲子冲突 | resistant | L1 | |
| grief 哀伤丧失 | avoidance | L1 | 只做普通哀伤，不触碰重度抑郁/自杀危机 |
| self_worth 自我价值 | intellectualization | L1 | |
| social_anxiety 社交焦虑 | avoidance | L1 | |

初始入库可走 `seeds/visitor-pool-templates.seed.ts`（与 `training-exercises.seed.ts` / `practice-scenarios.seed.ts` 同范式），运行期增补走 §3.5 生成端点，二者落同一张表。

> 内容边界（硬约束）：普通池排除性创伤、重度精神障碍、人格障碍；grief 只写普通丧失，不写危机干预；生成 prompt 需内置这条排除清单。

## 7. 验收（行为）

- **成功**：`GET /visitor-pool` 按 issueDomain/difficulty 过滤返回表层；`POST /:id/instantiate` 生成一条归属当前用户的私有副本，模板 `script` 未被改动；再次实例化得到第二条独立副本。
- **隔离**：用户 A 的副本编辑/信任度变化不影响模板与用户 B；公共响应体无 `script`、无任何计数字段。
- **边界**：404 模板 instantiate → 404；越权访问他人副本 → 403/404；重复收藏幂等。
- **生成/管理**：§3.5 生成产出表层 + 7 大块并落表，草稿/上架口径正确；普通用户调生成/管理端点 → 403，拿不到 `script`。
- **兼容**：现有 6 个 visitor-persona 端点与会话启动回归无破坏。

## 8. 非目标（本期不做）

- 不做公共投稿/专家共建审核流、不允许普通用户上传/生成模板（生成仅内部 §3.5）。
- 管理可视化页面后置：本期只预留 §3.6 管理端点，不做管理 UI。
- 不做弱项智能推荐、本周训练清单（依赖五维画像）。
- 不在公共表放危机/重度精神障碍/人格障碍内容。
- 不把自由练习 B 碎片场景接入本池。
