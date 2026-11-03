# 心塑 App · 微技能自由练习引擎 — 开发者规格说明书 (v1.3)

> **文档版本**：v1.3
> **撰写日期**：2026-10-22
> **文档状态**：内部评审稿（后端设计稿，前端已按本文 mock 兜底先行）
> **上游产品决策**：大炮 2026-10-22「三引擎答题 + P0-P3 一次做 + 防练完流失」讨论拍板
> **关系定位**：本文是 `counselor-mode-v1.2-full-situ-simulation.md` §9 M6 的**增量扩展**，
> **0 破坏** v1.2 已落地的 MCQ 体系（`training_exercises` / `training_exercise_attempts` 不动）。
> v1.2 §9 把 10 个基本功当「选择题」用；本文把它们升级成「自由作答三引擎练习场」。
>
> **一句话**：10 个基本功 × 每个 6 个 AI 场景变体，用户不是答 10 道选择题，
> 而是进 10 个练习间反复打磨；MCQ 保留给备考频道做模拟测验。

---

## 0. 元信息

| 项 | 值 |
|----|----|
| version | v1.3（2026-10-22） |
| author | 大炮（产品）+ agent（spec 转换） |
| scope | 专项技能训练从 MCQ 单选 → 自由作答三引擎（接话演练 / 改写工坊 / 语音微训练）+ 场景变体库 + AI 零压评判 + 随机抽练/弱项推荐 |
| 不做什么 | 不改 `training_exercises` MCQ 字段、不改 MCQ 评分链路、不碰 v1.2 M1-M5 任何表 |
| 前端现状 | `xin_su_app` 已按本文契约写好 Dart model + Repository 接口 + mock 本地源兜底（60 变体），remote 实现等后端 |

---

## 1. 产品模型（为什么这样设计）

### 1.1 三引擎与现有 `TrainingExerciseType` 的映射（不新增 enum）

前端三引擎 UI body 由现有 `type` 字段直接推导，**后端不加 practiceMode 列**：

| 现有 `type` | 引擎 | UI body | 评判输入 |
|---|---|---|---|
| `listening` | 接话演练 aiResponse | 来访者气泡 + 自由文本输入 | 用户文本回应 |
| `questioning` | 改写工坊 rewrite | 砸了的原话卡 + 改写输入 | 用户改写文本 |
| `voiceMicro` | 语音微训练 voiceMetric | 朗读文本 + 录音按钮 | 录音时长 / ASR 文本（v0.3 语音链路） |

### 1.2 场景变体（解决「练完就没了」）

1 个基本功（mode）= 6 个场景变体，按难度梯 L1/L2/L3 分布（2/2/2）。
变体由「主诉槽位 × 防御风格槽位」组合而来，每个变体是一个**独立来访者**：不同的人、不同的开场、不同的参考回应。

- L1（入门）：情绪平静、配合、议题清晰。
- L2（进阶）：情绪有波动 / 有防御 / 混合矛盾。
- L3（困难）：情绪负荷高或阻抗明显，前端弹「高情绪负荷场景，可随时退出」轻提示（知情同意式铺垫，不阻挡）。

### 1.3 零压反馈红线（写进 LLM prompt 强约束）

- **不返回分数、不返回对错、不返回「你错了」**。
- 反馈固定为清单批注三态：✅（动作达成）/ ⚠️（可以留意）/ ℹ️（技术提示），3-5 条。
- 每条批注锚定一个 rubric 维度，附「可以参考这样回应」+「留意避免」。
- 文案只做技术描述，禁止评价人（禁止「你还不行」「很差」）。

### 1.4 留存机制（飞轮）

- **再练一次**：同一场景清空输入重来，次数 +1。
- **换个场景**：同基本功内顺序解锁变体（不硬锁，L3 仅提示）。
- **随机一题**：跨全部场景随机，零决策负担。
- **弱项置顶**：按每 mode 累计练习次数升序，最少的排前并提示「最近没怎么练」。
- **我遇到了真实情况**（V2）：用户描述真实卡住的个案 → AI 生成 1:1 还原场景（§6）。

---

## 2. 新增表（全部 migration，软删，不加 DB FK，跟 ADR-0003 一致）

### 2.1 `practice_scenarios` — 场景变体库

```typescript
@Entity('practice_scenarios')
export class PracticeScenario {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'tenant_id' }) tenantId!: string;
  // 内容库全局共享（seed 注入），userId 可空；V2 用户自建场景时填 userId
  @Column({ type: 'char', length: 36, name: 'user_id', nullable: true })
  userId!: string | null;

  // 所属基本功 (1:1 wire TrainingExerciseMode 10 档, 不新增 enum)
  @Column({ type: 'varchar', length: 50, name: 'exercise_mode' })
  exerciseMode!: TrainingExerciseMode;

  // 稳定 slug (seed 幂等 upsert 键, e.g. emotion_reflection_l1_01; 改名等同换场景, 会丢历史)
  @Column({ type: 'varchar', length: 80, name: 'scenario_key', unique: true })
  scenarioKey!: string;

  // 难度梯 1/2/3
  @Column({ type: 'int' }) difficulty!: 1 | 2 | 3;

  // 是否 AI 生成 (seed=0 手工题库; 用户自建/AI 生成=1, 内容审核责任在生成方)
  @Column({ type: 'tinyint', name: 'is_ai_generated', default: 0 })
  isAiGenerated!: boolean;

  // ── 来访者画像 (表层, 跟 v1.2 M1 浅表层一致口径) ──
  @Column({ type: 'json' }) persona!: {
    name: string;
    age: number;
    gender: string;
    occupation: string;
    // 防御风格: cooperative配合 / intellectualizing理智化 / stoic强装没事 /
    //           silent沉默回避 / angry愤怒指责 / crying哭泣
    defenseStyle: 'cooperative' | 'intellectualizing' | 'stoic'
      | 'silent' | 'angry' | 'crying';
    emotionIntensity: 'calm' | 'elevated' | 'acute';
    background: string;          // 一两句背景
  };

  // 来访者开场白 (来访者第一句话, 气泡直接展示)
  @Column({ type: 'text', name: 'opening_line' }) openingLine!: string;

  // 训练任务说明 (给用户看的一句话: 如「用你自己的话, 把他此刻的情绪反射回去」)
  @Column({ type: 'text', name: 'task_prompt' }) taskPrompt!: string;

  // rewrite 引擎专用: 被砸了的原话 (AI 来访刚说了这句糟糕回应, 用户改写)
  @Column({ type: 'text', name: 'botched_utterance', nullable: true })
  botchedUtterance!: string | null;

  // voiceMetric 引擎专用: 要求用户朗读的文本
  @Column({ type: 'text', name: 'voice_script', nullable: true })
  voiceScript!: string | null;

  // 参考回应 (批注卡「可以参考这样回应」)
  @Column({ type: 'text', name: 'reference_response' }) referenceResponse!: string;

  // 常见偏差 (批注卡「留意避免」)
  @Column({ type: 'json', name: 'common_pitfalls' }) commonPitfalls!: string[];

  // 评判 rubric (AI 评判 prompt 的结构化锚点; 前端 mock 期做关键词匹配兜底)
  @Column({ type: 'json' }) rubric!: {
    dimensions: {
      key: string;              // e.g. namesEmotion
      label: string;            // e.g. 说出了对方的情绪
      positiveKeywords: string[];   // 命中即 ✅
      antiKeywords: string[];       // 命中即 ⚠️
      // 文本类引擎判定方式; voiceMetric 时后端从 ASR 结果做同样检查
      check: 'contains_any' | 'contains_none' | 'custom_llm';
    }[];
  };

  @Column({ type: 'tinyint', default: 1 }) enabled!: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true }) deletedAt!: Date | null;
}
```

**索引**：PRIMARY + `idx_ps_mode_enabled(exercise_mode, enabled)` + `idx_ps_user(userId)` + unique(scenario_key)。

**seed 规模**：10 mode × 6 变体 = 60 行，独立幂等 seed 脚本（跟 `training-exercises.seed.ts` 同 pattern，按 `scenario_key` upsert，**不进 migration 灌内容**）。

### 2.2 `practice_attempts` — 自由作答练习记录

> **反双胞胎**：不复用 `training_exercise_attempts`（那是 MCQ 计分表，有 selectedOptionIndex/score）。
> 自由作答零压无分，schema 完全不同，独立建表。

```typescript
@Entity('practice_attempts')
export class PracticeAttempt {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'tenant_id' }) tenantId!: string;
  @Column({ type: 'char', length: 36, name: 'user_id' }) userId!: string;
  @Column({ type: 'char', length: 36, name: 'scenario_id' }) scenarioId!: string;

  // 用户提交内容 (text 引擎=回应文本; rewrite=改写后文本; voiceMetric=ASR 转写文本)
  @Column({ type: 'text', name: 'submitted_text' }) submittedText!: string;

  // voiceMetric 专用: 录音时长秒 / 语速(字/分, ASR 后算)
  @Column({ type: 'int', name: 'record_seconds', nullable: true })
  recordSeconds!: number | null;
  @Column({ type: 'float', name: 'speech_rate_wpm', nullable: true })
  speechRateWpm!: number | null;

  // AI 评判产出 (零压批注, 无分数)
  @Column({ type: 'json' }) feedback!: {
    items: {
      tone: 'positive' | 'warning' | 'info';
      dimensionKey: string;
      text: string;
    }[];
    referenceResponse: string;
    commonPitfalls: string[];
    // 第几轮反馈 (同一场景第 N 次答, 批注侧重点轮换: 第1次看动作, 第2次看语气/长度, 第3次给稳定确认)
    attemptOrdinal: number;
  };

  @Column({ type: 'int', name: 'duration_seconds' }) durationSeconds!: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true }) deletedAt!: Date | null;
}
```

**索引**：PRIMARY + `idx_pa_user_scenario(userId, scenarioId)` + `idx_pa_user_mode` 不需要（JOIN scenarios 取 mode）。

---

## 3. API 契约（REST，Bearer 鉴权，跟现有 counselor 前缀一致）

### 3.1 列表与进度

```
GET /counselor/practice/progress
→ {
    summary: { totalScenarios, completedScenarios, totalAttempts, activeDaysLast7d },
    modes: [
      {
        mode: 'emotionReflection',
        modeLabel: '情绪反射',
        type: 'listening',
        variants: [
          { scenarioId, scenarioKey, difficulty, personaName, openingLine,
            completed: boolean, attemptCount: number, lastPracticedAt: string | null }
        ]
      }
    ],
    // 弱项推荐: 全 mode 中 attemptCount 最少的 3 个 (含从未练的), 供列表置顶
    weakModes: ['noAdviceChallenge', 'closedToOpen', 'speechRate'],
    // 随机入口可用的下一个场景 id (服务端混洗, 前端不重复上一场景)
    nextRandomScenarioId: string
  }
```

- 一次返回全量（60 场景元数据，无 openingLine/参考回应，载荷可控）。
- `completed` = 存在 graded 状态的 attempt；**无分数字段**。
- 不做硬锁定：L3 也直接返回，前端只展示提示文案。

### 3.2 取场景开练

```
GET /counselor/practice/scenarios/:scenarioId
→ {
    scenarioId, exerciseMode, difficulty,
    persona: { name, age, gender, occupation, defenseStyle, emotionIntensity, background },
    openingLine, taskPrompt, botchedUtterance?, voiceScript?,
    attemptOrdinal: number   // 该用户在本场景已练次数 +1
  }
```

### 3.3 提交作答 + AI 评判

```
POST /counselor/practice/scenarios/:scenarioId/evaluate
body: {
  submittedText: string,        // voiceMetric 时传 ASR 文本 (空字符串 = 未识别)
  recordSeconds?: number,
  durationSeconds: number
}
→ {
  attemptId,
  feedback: { items: [...], referenceResponse, commonPitfalls, attemptOrdinal }
}
```

**评判实现（P1 上线后）**：复用现有结构化 LLM client（v1.2 VS-A 的 llm-json.client），temperature=0，prompt 输入 = 场景 rubric + 用户回应 + attemptOrdinal。
**降级（P0 未接 LLM 前）**：服务端先按 `rubric.dimensions[].positiveKeywords/antiKeywords` 做确定性关键词匹配产出批注（跟 MCQ submitAttempt 同思路，零随机），LLM 就绪后无缝替换，**接口形状不变**。

### 3.4 随机 / 弱项

```
POST /counselor/practice/random
body: { exceptMode?: string }   // 可选: 避开当前 mode
→ { scenarioId }               // 直接交给前端 3.2
```

### 3.5 用户真实场景生成（V2，预留）

```
POST /counselor/practice/custom-scenarios
body: {
  mode: TrainingExerciseMode,
  situation: string   // 用户描述: "我今天遇到一个回避型来访, 谈20分钟就沉默"
}
→ { scenarioId }      // AI 生成场景落 practice_scenarios(userId=本人, isAiGenerated=1)
```

---

## 4. 跟现有代码关系（反双胞胎对账）

| 现有 | 本文处理 |
|---|---|
| `training_exercises`（MCQ 10 行） | **一行不改**。它继续服务备考频道 MCQ 模拟答题 |
| `training_exercise_attempts` | 不动；自由作答写新表 `practice_attempts` |
| `GET /counselor/training-exercises/progress` | 不动；前端列表页改调新的 `GET /counselor/practice/progress` |
| v1.2 §9 M6「五维画像」 | 正交：画像仍从 supervision_feedback 聚合；本文 attempts 后续可回灌 errorCategories（V2） |
| v1.2 M1 全量人设 | 不复用：微练习场景是轻量全局题库，不需要成长时间线；只有完整会谈（training_sessions）才接深人设 |
| v0.3 语音链路 ASR | voiceMetric 提交前先走 ASR 得到文本，再走同一评判接口（后端不做语音直达评判） |
| 配额 `quota_usage` | AI 评判调用走现有配额体系，不新建 |

---

## 5. 分期落地

| 期 | 范围 |
|---|---|
| **P0** | `practice_scenarios` 表 + 60 行 seed + `practice_attempts` 表 + 3.1/3.2/3.3（关键词降级评判） |
| **P1** | 3.3 评判切真 LLM（复用 llm-json.client）+ attemptOrdinal 批注轮换 prompt |
| **P2** | 接话引擎多轮：3.2 响应加 `expectedTurns`，3.3 支持 turn 2..N（来访者对用户回应给情绪反应，再判） |
| **P3** | 3.5 custom-scenarios + practice_attempts 回灌五维画像弱项推荐 |

---

## 6. 硬约束（写进后端 checklist）

1. 所有 LLM 产出的场景/批注上线前须持证咨询师审核（延续 v1.2 §11.1）。
2. `practice_attempts` 不下发分数；任何「评级」文案不进响应。
3. 内容库 seed 走独立脚本按 `scenario_key` upsert，不进 migration。
4. 新表全部 `tenant_id` + `user_id` + `deletedAt`（跟 v1.2 D13 一致）。
5. 不加 DB FK，跨表引用应用层校验。

---

## 7. 自定义真实场景生成（「我遇到了真实情况」P3）

> 2026-10-22 追加。产品定位：新手咨询师今天现场卡住，当晚 1:1 还原重练——这是本产品
> 区别于所有题库类竞品的护城河功能。前端本轮（v1.3 同步）先上入口 + 描述表单 + 本地
> mock 生成；本节定义后端真实实现契约。

### 7.1 产品动线

```
Hub 页双卡（随机练一题 / 遇到真实情况当场重练）
 → bottom sheet 三问表单：
   1. visitor_quote    来访者当时说了什么/什么反应
   2. counselor_reply   你当时是怎么回应的
   3. stuck_point       你觉得卡在哪（枚举 + 自由补充）
 → POST /counselor/practice/scenarios:generate  （LLM 调用，3-5s）
 → 返回 scenario，直接进入练习页（就是上面三引擎 UI，0 新页面）
 → 练完自动落 practice_attempts（attempt_type=custom）
 → 我的真实场景列表可随时回来重练
```

### 7.2 接口

#### POST /counselor/practice/scenarios:generate

请求体：

```json
{
  "visitorQuote": "他说我妈就是重男轻女，这么多年我怎么讨好都没用。",
  "counselorReply": "我说你已经做得很好了，他就不说话了。",
  "stuckPoint": "接不住，说完就冷场了。",
  "hintExerciseId": "33333333-3333-3333-3333-333333333331"
}
```

- `visitorQuote` 必填；`counselorReply` / `stuckPoint` 可选（用户可能只记得来访者说了啥）。
- `hintExerciseId` 可选：前端让用户选「这主要在练哪项基本功」，帮 LLM 对齐 rubric；
  不传则由 LLM 自己判断最匹配的 exerciseId。

响应体（与 `practice_scenarios` 行 1:1，带一个 `isCustom=true` 标记）：

```json
{
  "id": "scn_01HXYZ...",
  "exerciseId": "33333333-3333-3333-3333-333333333331",
  "difficulty": 2,
  "personaName": "他",
  "personaNote": "28 岁男性，与母亲长期关系紧张",
  "type": "aiResponse",
  "content": {
    "visitorLine": "我妈就是重男轻女，这么多年我怎么讨好都没用。",
    "taskPrompt": "重新接一次这句话，这次不急着评价。",
    "dimensions": [ ...rubric... ],
    "referenceResponses": [ ... ],
    "commonErrors": [ ... ]
  },
  "isCustom": true,
  "source": "user_generated"
}
```

#### GET /counselor/practice/scenarios/mine

返回当前用户 `attempt_type=custom` 的场景列表（按最近练过倒序），供「我的真实场景」
列表页。字段同响应行，不带 `content` 全文，点进去再用
`GET /counselor/practice/scenarios/:id` 拉详情（复用 §3.1）。

### 7.3 LLM 生成约束（写进 prompt）

1. **脱敏**：输入原文里若出现人名/地名/单位名，输出 personaName 一律用代称（他/她/TA），
   `personaNote` 只保留年龄/性别/议题类信息，禁止复制可识别细节。
2. **零压**：与 §1.3 同约束，生成的 commonErrors 只描述技术动作，不评价用户当时的回应。
3. **贴近真实**：`visitorLine` 必须尽量忠实于 `visitorQuote` 原意，允许口语化润色，
   不得美化成教科书式来访者。
4. **stuckPoint 对齐 rubric**：用户说「冷场」→ dimensions 里必须有一条「是否给出了继续
   展开的邀请」；用户说「说教」→ 必须有一条「是否在给建议」。
5. **重试**：用户点「换一个」= 带同一个请求体再调一次，后端做无状态生成（同输入两次
   结果允许不同）。

### 7.4 配额与成本

- 该接口是唯一每次都调 LLM 的练习接口（随机/标准场景 seed 已静态化）。
- 沿用现有 `quota_usage` 配额体系统计，默认每用户每天 5 次；超额时前端不弹「今日已用完」
  红条，而是软降级回标准题库（零压红线）。
- 生成失败 / 超时 8s → 前端降级为本地模板场景，不阻塞用户。

### 7.5 数据落点

- 新表 `practice_custom_scenarios`（`tenant_id` / `user_id` / `source_payload` JSONB
  存用户三问原文 / `generated_scenario` JSONB 存 LLM 输出 / `exercise_id` / `created_at`）。
- 不落 `practice_scenarios` 主表（那是公共 seed 库）；练习时通过 §3.3 评判时按
  `scenarioSource=custom` 路由到本表取 content。
- `practice_attempts` 增加 `scenario_source` 枚举列（`seed` / `custom`），默认 `seed`，
  不迁移旧数据。

### 7.6 分期

| 期 | 范围 |
|---|---|
| P3-a（前端本轮已做） | 入口双卡 + 三问表单 sheet + 本地模板 mock 生成，Repository 接口已留 `generateCustomScenario` |
| P3-b（后端） | §7.2 两个接口 + `practice_custom_scenarios` 表 + LLM 生成 prompt（复用 llm-json.client） |
| P3-c | 「我的真实场景」列表页 + attempt 回写五维画像 |

---

## 8. 附：旧 MCQ 备考频道既有接口（前端当前仍依赖，待后端核对/对齐）

> 本节记录前端正在调用的旧 MCQ 频道只读端点现状（非 §3 自由练习），供后端核对契约、
> 补齐或修正。**本节不改 §3 自由练习语义，MCQ 仍走自己的计分判定**；自由练习保持零压无分。
> 来源：前端 `training_exercise_remote_data_source.dart` / `training_exercise_repository_impl.dart`。

### 8.1 `GET /counselor/training-exercises`（题目列表）

Query（全部可选，缺省=不过滤）：

| 参数 | 取值 | 说明 |
|---|---|---|
| `type` | `listening` / `questioning` / `voiceMicro` | 按大类过滤 |
| `mode` | 10 个 camelCase 基本功名（`emotionReflection` 等，与 §3.1 `modes[].mode` 同枚举） | 按基本功过滤 |
| `difficulty` | `L1` / `L2` / `L3`（后端枚举大写；前端现发小写，见 8.4#3 待统一） | 按难度过滤 |

响应（前端兼容两种形态：优先 `{ items: [...], total: N }`，也兼容裸数组 `[...]`）：

```jsonc
{
  "items": [
    {
      "id": "string",
      "type": "listening",
      "mode": "emotionReflection",
      "difficulty": "l1",
      "scenarioContext": "string",
      "options": ["选项1", "选项2", "选项3", "选项4"],
      "durationMinutes": 5,
      "personaName": "string",
      "personaBackground": "string",
      "realTimeCorrectionEnabled": false
    }
  ],
  "total": 10
}
```

- **答案防护**：列表**不下发** `correctOptionIndex`，判定只在服务端 `POST .../attempts` 完成。
- 前端要求单条 `options` 非空，否则该条被丢弃（不拖垮整页）。

### 8.2 `GET /counselor/training-exercises/progress`（MCQ 进度聚合）

无 query，一次返回全量 10 项，前端按 type 分组。

```jsonc
{
  "summary": {
    "totalItems": 10,
    "completedItems": 0,
    "averageScore": null,        // MCQ 口径分数；自由练习 §3.1 不复用此字段
    "activeDaysLast7d": 0
  },
  "items": [
    {
      "exerciseId": "string",
      "type": "listening",
      "mode": "emotionReflection",
      "completed": false,
      "inProgress": false,
      "lastScore": null,         // num | null
      "lastPracticedAt": null,   // ISO8601 string | null
      "attemptCount": 0,
      "durationMinutes": 5
    }
  ]
}
```

- 服务端不可达时前端降级为「全部未开始」空态，**不编造分数/进度**。

### 8.3 `GET /counselor/training-exercises/:exerciseId`（单题详情）

- 路径 `exerciseId` 为题目主键；响应为 8.1 列表项同款单对象。
- 前端 `_parseExercise` 复用列表解析：`type`/`mode` 必须能命中枚举，`options` 非空，否则丢弃。

### 8.4 后端核对清单（2026-10-22 复核）

1. ✅ **未知 id 的错误码**：`GET /:id` 对不存在/已停用 exerciseId 返回标准 `404 NotFoundException`（service `findOneExercise`）。
2. ✅ **列表响应形态统一**：稳定为 `{ items, total }`，不再切换裸数组。
3. ✅ **`difficulty` 字面量**：query 经 `@Transform` 统一转大写后 `@IsIn` 校验（兼容 l1/L1），响应体固定大写 `L1/L2/L3`；前端解析时也会 `toUpperCase()` 容错。
4. **枚举一致性（持续约束）**：`type`/`mode` 字面量与 §3.1 `modes[].mode` 保持同一套 camelCase，避免两套枚举 drift。
5. **答案字段隔离（持续约束）**：列表与详情都不下发 `correctOptionIndex`，仅服务端判定。
6. **分数口径隔离（持续约束）**：`averageScore`/`lastScore` 仅限 MCQ；自由练习 §3.1 无分数字段，二者勿混。

> 前端已消费列表/详情下发的 `modeLabel`/`modeSummary`（服务端优先，缺失回退本地文案）。

### 8.5 跨频道隔离红线 + 本轮审计补充问题（一次给后端）

> 来源：前端对接时通读 `training-exercise.*`（MCQ 计分频道）与 `practice.*`（自由练习
> 零压频道）源码后整理。**A 组是「两套频道不许混」的边界约定；B/C/D 组是待修缺陷。**

#### A. 两套频道边界（隔离，禁止互相串数据）

| # | 边界 | 现状 | 要求 |
|---|---|---|---|
| A1 | **难度两套口径** | MCQ `training_exercises.difficulty` = varchar `'L1'/'L2'/'L3'`（大写）；自由练习 `practice_scenarios.difficulty` = int `1/2/3` | 禁止跨表 join/比较难度；不要在同一响应里混用。`practice-difficulty.enum.ts` 注释称「跨口径转换集中在 practice-display-meta 一处」，但该文件并无转换函数——要么补函数，要么删这句注释，避免误导 |
| A2 | **两套进度端点 / 两张 attempt 表** | `training_exercise_attempts`（带 score/isCorrect/dimensionScores）；`practice_attempts`（无任何分数列） | 统计、画像、首页聚合时禁止把 MCQ 的 `score/averageScore/lastScore/isCorrect` 并入 `/practice/progress`；反之自由练习记录也不要回写 MCQ 表 |
| A3 | **`/practice/progress` 永远无分** | 契约已无分数字段（结构级保证） | 后续迭代也不得在 §3.1 加 score/grade/正确率字段，零压红线 |
| A4 | **mode/type 枚举已复用（好）** | 两套频道共用 `TrainingExerciseMode`(10 档)/`TrainingExerciseType`(3 档) | 这是单一事实源，新增第 11 档时两处同时生效；**不要**在 practice 侧另建一份 mode 枚举 |
| A5 | **引擎只属自由练习** | `engine=aiResponse/rewrite/voiceMetric` 由 mode 派生，仅 §3.1/§3.2 下发 | MCQ 频道无引擎概念，不要把 `engine` 回灌 MCQ 表或 MCQ 响应 |

#### B. 契约/校验缺陷（待修）

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| B1 | §3.3 `SubmitPracticeAttemptDto.turn` | 只校验 `1..5`，未校验 `≤ 场景.expectedTurns`；单轮场景（expectedTurns=1）收到 `turn=2` 语义不一致 | service 层比对 `turn ≤ expectedTurns`，越界 400 |
| B2 | §3.5 `CreateCustomPracticeScenarioDto.situation` | 仅 `MinLength(10)/MaxLength(1000)`，无 `trim`，纯空白凑 10 字可通过；且无私有场景数量上限 | 入参 `trim()` 后再校验；按用户加私有场景条数上限 |
| B3 | §3.3 `durationSeconds`/`recordSeconds` | `Min(0)` 允许 0，0 语义未定义 | 明确 0 是否合法，否则改 `Min(1)` |
| B4 | MCQ `selectedOptionIndex` | DTO `@Max(10)` 硬编码，与实际 `options.length` 脱钩（service 另有越界检查兜底） | 去掉硬编码 Max 或与 options 长度联动 |

#### C. LLM 开关口径不一

| # | 问题 | 建议 |
|---|---|---|
| C1 | `PRACTICE_LLM_EVALUATION=off` 只关闭 §3.3 评判 LLM（`evaluateWithLlm`）；`generateVisitorReaction`（P2 来访者反应）与 `generateScenario`（§3.5 场景生成）**不读开关**，仍直接调 LLM | 要么让开关覆盖全部练习 LLM 调用，要么拆成「评判开关 / 生成开关」并在文档写清各自范围，避免运维以为 off 就断了全部练习 LLM 成本 |

#### D. 零压守门范围

| # | 问题 | 建议 |
|---|---|---|
| D1 | `violatesZeroPressure` 把 `referenceResponse`、`commonPitfalls` 也一起扫禁用词；这两段是种子/参考内容而非用户反馈，参考句里出现「等级/优秀」等词会误杀整份 LLM 产出、静默降级 | 禁用词只扫 `items[].text`，参考回应/常见偏差不参与判废 |

#### E. 并发与语义（顺带）

| # | 问题 | 建议 |
|---|---|---|
| E1 | `attemptOrdinal = count() 再 insert`，并发双击同场景会拿到相同 ordinal | 事务内 count+insert，或加 (userId, scenarioId, turn) 唯一约束兜底 |
| E2 | §3.4 内容库为空抛 `404`，前端无法区分「空库」与「无权限」 | 空库用明确空态语义（如 200 空池或专用错误码），与无权访问分开 |

---

**END OF SPEC counselor-practice-engine-v1.3-freeform**
