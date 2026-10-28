# 心塑 App · 全真心理咨询模拟实训系统 — 开发者规格说明书 (v1.2)

> **文档版本**：v1.2
> **撰写日期**：2026-10-21
> **文档状态**：内部评审稿（后端设计稿，待前端对齐）
> **产品代号**：XinSu Full-Situ Clinical Simulation
> **上游产品方案**：《心塑APP · 全真心理咨询模拟实训系统 完整版方案》（大炮 2026-10-21 评审稿）
> **上游 PRD**：`心塑App·咨询师学习者模式-产品设计文档v1.0.md`（2026-10-15，53KB）
> **基线 spec**：`docs/specs/counselor-mode-v1.1.md`（2026-10-19，V0.5 client 实装同步）+ `docs/specs/ai-voice-training-v0.3.md`（整体基线）
> **本 spec 关系**：v1.1 是「单次 9 场景 + 长程骨架 + 4 流派督导 + 7 维画像 + 商业化」的骨架，v1.2 是在该骨架上补「临床会谈拟真度」所需的 6 大新模块，**0 破坏 v1.1 已落地 entity，纯增量**。
> **v1.2 变更摘要**：分层人设引擎（§4）+ 知情同意前置（§5）+ 会谈核心增强（§6）+ 长程卷宗四 Tab 与作业/概念化/目标/假设（§7）+ 督导三场景（§8）+ 10 项基本功与五维能力画像收敛（§9）+ V1.0/V2.0/V3.0 排期（§10）。

---

## 0. 元信息

| 项 | 值 |
|----|----|
| **version** | v1.2（2026-10-21） |
| **author** | 大炮（产品）+ agent（dev spec 转换 + 代码现状对账） |
| **status** | 内部评审稿 |
| **scope** | counselor-mode v1.1 之上的「临床拟真度」增量（分层人设 / 知情同意 / 卷宗 / 作业 / 概念化 / 移情标记 / 技术统计 / 阶段性与脱落督导） |
| **integration** | 跟 v1.1 1:1 wire，0 破坏性改动；所有新表走 migration 新增，不动 v1.1 已上线字段 |
| **代码对账基线** | 2026-10-21 扫描 `src/counselor/`（11 controllers / 10 providers / 11 entities / 18 enums），详见 `docs/progress/v1.2-full-situ-gap-scan-2026-10-21.md` |

---

## 1. 范围 (In Scope / Out of Scope)

### 1.1 In Scope（v1.2 新增，v1.1 未覆盖）

| 模块 | 内容 | 落地版本 |
|------|------|----------|
| **M1 分层人设引擎** | AI 底层全量人生剧本（成长时间线 / 内在工作模型 / 依恋 / 防御 / 社会关系 / 应对模式 / 咨询预设）+ 用户两层视图（表层配置 / 动态解锁档案）+ 信息暴露节奏规则 | V1.0 |
| **M2 初访前置知情同意** | 内置知情同意环节（默认开启）+ 双重授权（模拟层练习 + 产品层用户授权）+ 跟现有 `src/consent` 模块边界划分 | V1.0 |
| **M3 会谈核心增强** | 实时督导轻提示（两档默认关闭）+ 录音逐字稿打点标记 + 技术统计仪表盘 + 双向移情/阻抗标记 | V1.0（轻提示 + 打点）/ V2.0（技术统计深度版） |
| **M4 长程卷宗系统** | 卷宗主页四 Tab（动态档案 / 会谈时序 / 作业反馈 / 咨询师笔记）+ 家庭作业（立即/异步）+ 多流派个案概念化编辑器 + 咨询目标共建（短/中/长）+ 个案假设追踪 | V1.0 基础四 Tab / V2.0 概念化 + 目标 + 假设 |
| **M5 全场景督导复盘** | 单节督导（v1.1 已有，补风险线索专项点评）+ 阶段性督导（每 3-5 节）+ 脱落专项复盘 | V1.0 单节+脱落 / V2.0 阶段性 |
| **M6 专项技能与成长** | 10 项核心基本功清单 + 五维能力画像收敛（倾听/共情/评估/干预/伦理）+ 薄弱项自动归集 | V1.0 清单 / V2.0 五维画像 |

### 1.2 Out of Scope（v1.1 / v0.3 已覆盖，本 spec 不重写）

- 单次 9 场景训练会话 5 状态机（v1.1 §4.2 + §6.5 已落地 `training_sessions` 表）
- VisitorPreset 9 字段契约（v1.1 §4.2.3）
- 5 场景 persona 5 字段（v1.1 §4.2.1）
- 4 流派督导视角（v1.1 §4.6 + `supervision_schools` / `supervision_feedback` 表已落地）
- 长程 5 预设个案类型（v1.1 §4.3 + `long_term_cases` / `long_term_case_sessions` 表已落地）
- 商业化配额 5 档会员（v1.1 §7）
- 整体 AI 引擎 / 鉴权 / 多租户 / 语音链路（v0.3 §8/§11/§13/§14）
- 7 维 28 子指标 raw 采集（v1.1 §5.1 + `ability_dimensions` / `ability_scores` 已落地）—— v1.2 §9.2 只在其上做**收敛视图**，不改表

---

## 2. 产品设计总原则（5 条新增，跟 v1.1 §2.2 的 8 条正交）

> 这 5 条是「临床沙盘」定位下的硬约束，优先级高于 v1.1 的通用设计原则。

1. **拟真性优先**：所有流程、AI 反应、文书完全贴合真实咨询工作场景；凡是真实咨询里不会出现的便利（如「一键查看来访者全部内心戏」），产品层面就不允许出现。
2. **信息分层**：AI 持全量人设剧本，用户按需逐步获取，**默认关闭上帝视角**；高级设置里允许主动开启「完整个案剧本查看」，开启后明确标注「已跳过信息探索环节」。
3. **功能可选**：所有辅助功能（实时提示 / 督导视角 / 概念化模板 / 作业反馈）默认关闭，用户主动开启，不干扰基础训练。
4. **防依赖设计**：辅助工具只给线索不给答案——轻提示只提示「连续使用封闭式提问」这种方向，不直接给替代话术；督导报告重点标注「无提示下的表现」，引导用户逐步关闭辅助。
5. **界面轻量化**：说明性文字全部收纳进 ⓘ 气泡，主页面只保留核心操作；新用户不读长文也能开练。

---

## 3. 核心业务全链路（完整闭环）

```
训练 Tab 入口
├─ 完整咨询流程（主入口：初访接待）
│   └─ [前置] 知情同意环节（默认开启, M2）
│       └─ 来访个案配置页（表层信息可编辑, AI 底层生成全量人设, M1）
│           └─ 进入初访会谈（会谈核心系统：对话/语音/快捷工具, M3）
│               └─ 初访结束 → 单节督导复盘（M5.1）
│                   ├─ 分支 1：单次训练结束 → 存入成长记录
│                   ├─ 分支 2：暂存记录，稍后决定是否转长程
│                   └─ 分支 3：商定建立长程关系 → 导入长程个案卷宗（M4）
├─ 长程个案卷宗入口（我的卷宗列表）
│   └─ 卷宗主页（四 Tab）
│       ├─ ① 个案档案（动态解锁 + 咨询师观察 + 概念化编辑器）
│       ├─ ② 会谈时序（手动开启下一节，不自动连开）
│       ├─ ③ 作业与反馈（立即/异步）
│       └─ ④ 咨询师笔记（仅用户可见）
│           └─ 循环「会谈 → 复盘 → 作业 → 准备下一节」
├─ 专项技能训练（M6.1，10 项基本功）
└─ 快捷工具
```

---

## 4. M1 来访个案体系（分层信息人设引擎）

> **核心矛盾**：人设要足够完整真实，又不能让用户提前知道全部信息失去探索感。
> **架构**：一套底层全量人生剧本（AI 独享）+ 两层用户视图（表层配置页 / 动态解锁档案）。

### 4.1 AI 底层全量人设库（AI 独享，用户默认不可见）

作为 AI 来访的行为基准，保证所有反应、情绪、阻抗逻辑自洽。**这是一张新表 `visitor_full_persona`**，跟现有 `long_term_cases.visitor_persona`（8 字段浅层）是「深 / 浅」关系，不是替代。

```typescript
@Entity('visitor_full_personas')
export class VisitorFullPersona {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'tenant_id' }) tenantId!: string;
  @Column({ type: 'char', length: 36, name: 'user_id' }) userId!: string;

  // ── 1. 基础信息 ──
  @Column({ type: 'json' }) basics!: {
    age: number;
    gender: string;             // 自报性别
    occupation: string;
    education: string;
    livingStatus: string;       // 独居/合租/与家人
    somaticHistory: string;     // 躯体健康史
    psychHistory: string;       // 既往精神科就诊/咨询史
  };

  // ── 2. 成长时间线（5 段）──
  @Column({ type: 'json' }) developmentalTimeline!: {
    stage: '0-6' | '7-12' | '13-18' | '19-25' | '26+';
    parentingStyle: string;     // 养育模式
    keyEvents: string[];        // 重大事件
    tabooTopics: string[];     // 家庭禁忌话题（触发阻抗的钩子）
  }[];

  // ── 3. 内在工作模型 ──
  @Column({ type: 'json' }) innerWorkingModel!: {
    attachmentType: 'secure' | 'anxious' | 'avoidant' | 'disorganized';
    coreBeliefs: string[];      // 核心信念（"我不值得被爱" 等）
    hiddenTrauma: string[];     // 隐性创伤
    unfinishedBusiness: string[]; // 未完成情结
    defenseMechanisms: string[]; // 压抑/否认/合理化/投射/升华...
  };

  // ── 4. 社会关系图谱 ──
  @Column({ type: 'json' }) socialMap!: {
    relationType: 'parent' | 'intimate' | 'workplace' | 'peer';
    currentStatus: string;
    conflictPattern: string;
    resourceOrDrain: 'resource' | 'drain' | 'neutral';
  }[];

  // ── 5. 应对模式 ──
  @Column({ type: 'json' }) coping!: {
    adaptiveResources: string[];
    maladaptiveStrategies: string[];
    emotionTriggers: string[];  // 情绪触发点
  };

  // ── 6. 咨询预设 ──
  @Column({ type: 'json' }) therapyExpectation!: {
    biases: string[];           // 对咨询的偏见
    expectations: string[];     // 期待
    transferenceTrend: string;  // 潜在移情倾向
    resistancePattern: string;   // 阻抗模式
  };

  // ── 7. 当前主诉（跟表层视图同步）──
  @Column({ type: 'json' }) presentingIssue!: {
    selfReport: string;         // 来访自述症状
    duration: string;
    sleepAppetite: string;
    selfReportedRisk: 'low' | 'medium' | 'high' | 'concealed'; // 可隐瞒真实风险
  };

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true }) deletedAt!: Date | null;
}
```

**AI 行为规则（写进 LLM system prompt，不落库）**：

| 规则 | 实现 |
|------|------|
| 信息暴露节奏 | 按咨访信任度（0.0-1.0）分级：0.0-0.3 只答表层、0.3-0.6 谈关系、0.6-0.8 谈情绪、0.8+ 才允许碰禁忌话题 |
| 禁忌话题阻抗 | 命中 `tabooTopics` 时触发阻抗：转移话题 / 否认 / 沉默 3-5s / 合理化，**不直接回答** |
| 可出现隐瞒、美化、前后矛盾 | 来访自己不知道的事（如童年被忽视但自己解释为"父母忙"）允许出现矛盾，符合真实防御 |
| 锚定底层人设 | 所有情绪、反应、用词必须从 `innerWorkingModel.coreBeliefs` 派生，不出现逻辑冲突 |

### 4.2 用户两层视图

**视图 A：个案配置页 · 表层信息（新建个案时可见可编辑）**

只展示「来访初次见面愿意主动呈现的内容」，对应真实咨询的初始主诉：

| 字段 | 来源 |
|------|------|
| 代号 / 年龄 / 性别 / 职业 | `basics.{age,gender,occupation}` |
| 主诉与当下状态 | `presentingIssue.{selfReport,duration,sleepAppetite}` |
| 表层关系简述 | `socialMap` 只取 `relationType=intimate/parent` 的 `currentStatus` 一句话 |
| 自述风险水平 | `presentingIssue.selfReportedRisk` |

交互：
- 「随机生成个案」→ 后端调 LLM 生成 `VisitorFullPersona` 全量剧本，**同时**抽取表层字段返回前端。
- 用户编辑表层字段 → PATCH 接口同步更新 `VisitorFullPersona` 对应字段锚点，**不改**未暴露字段。
- 高级开关「完整个案剧本查看」默认关闭；开启后返回完整 `VisitorFullPersona`，并在 session 元数据打 `godViewEnabled=true` 标记，督导报告单独标注。

**视图 B：卷宗 · 动态解锁档案（会谈中逐步收集）**

新表 `case_profile_entries`：

```typescript
@Entity('case_profile_entries')
export class CaseProfileEntry {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'case_id' }) caseId!: string;       // long_term_cases.id
  @Column({ type: 'char', length: 36, name: 'session_id', nullable: true })
  sessionId!: string | null;                                                   // 在第几次会谈中披露
  @Column({ type: 'varchar', length: 50, name: 'layer' })
  layer!: 'self_disclosed' | 'therapist_note';                                 // 来访自述 / 咨询师观察
  @Column({ type: 'varchar', length: 100, name: 'anchor_key' })
  anchorKey!: string;                                                          // 对应 VisitorFullPersona 的 JSON path，如 "innerWorkingModel.attachmentType"
  @Column({ type: 'text' }) content!: string;
  @Column({ type: 'datetime', name: 'created_at' }) createdAt!: Date;
}
```

规则：
- AI 每轮回复后，后端跑一个轻量抽取（可复用督导 LLM，prompt 里要求「本轮来访主动披露了哪些底层人设信息」），命中就写一条 `layer=self_disclosed`。
- **未提及的信息保持空白**，绝不提前显示；前端按时间线渲染，空白条目不占位。
- 咨询师可以在任何时候加 `layer=therapist_note` 的观察/假设，跟 `self_disclosed` 分区展示。

### 4.3 跟现有代码关系

| 现有 | v1.2 关系 |
|------|-----------|
| `long_term_cases.visitorPersona`（8 字段浅层） | **保留不动**，作为 L1 快速冷启动 persona；新建 `VisitorFullPersona` 后在创建长程个案时同步生成一份，两者通过 `long_term_cases.id ↔ visitor_full_personas.id` 1:1 关联（应用层） |
| `training_sessions.persona*`（5 字段） | 单次训练保留浅层，**不强制**接全量人设（单次 10-20 分钟不需要成长时间线）；长程才接 |
| LLM system prompt | 单次：注入 `persona*` 5 字段；长程：注入 `VisitorFullPersona` 全量 + 当前信任度 + 已解锁 `CaseProfileEntry` 列表 |

---

## 5. M2 初访前置流程（知情同意与设置说明）

### 5.1 内置流程（默认开启）

放在初访会谈正式开始前，训练用户主动说明设置、征得同意的专业能力。

```
1. 系统轻提示（前端 banner）：
   「接下来进入知情同意环节，请向来访者说明咨询相关设置」
2. 用户通过对话向来访说明 4 件事：
   ① 咨询性质与局限性
   ② 保密原则与保密例外（自伤/伤人/未成年人保护）
   ③ 会谈时长、频率、设置边界
   ④ 本次会谈是否录音（仅用于训练复盘）
3. AI 模拟来访真实反应：接受 / 有疑问 / 担心保密 / 犹豫 / 拒绝录音
4. 双方达成一致后，才正式进入初访会谈
```

### 5.2 产品层面双重授权

| 层 | 实现 |
|----|------|
| **模拟层** | 用户必须在对话中跟 AI 来访完成知情同意 4 要素，缺失任意 1 项 AI 来访会主动追问（"那……这个会保密吗？"），督导报告记为「知情同意缺失」 |
| **产品层** | 首次开启录音功能前弹用户授权：「本次会谈录音仅用于个人复盘，本地存储不上传」，同意后才开录音权限 |

### 5.3 跟现有 `src/consent` 模块的边界

> **关键区分，避免双写**：

| 模块 | 位置 | 语义 | 主体 |
|------|------|------|------|
| 现有 `src/consent` / `src/profile/consent-signature` | 产品合规层 | 「用户作为 App 用户」同意隐私协议 / 用户协议 / 录音数据条款 | 真人用户 ↔ 产品 |
| v1.2 M2 新增 | 训练业务层 | 「咨询师角色」在模拟会谈中向「AI 来访」做知情同意训练 | 受训用户（扮演咨询师）↔ AI 来访 |

**结论**：两者**完全正交**，不复用表。M2 知情同意训练结果写在 `training_sessions` 上的新字段，不写进 `user_consent`。

### 5.4 entity 增量

在 `training_sessions` 表加 3 个字段（ALTER TABLE，不加新表）：

```typescript
// v1.2 新增字段（ALTER TABLE training_sessions ADD COLUMN ...）
@Column({ type: 'tinyint', name: 'informed_consent_required', default: 1 })
informedConsentRequired!: number;   // 默认开启，用户可在高级设置关闭

@Column({ type: 'tinyint', name: 'informed_consent_passed', default: 0 })
informedConsentPassed!: number;     // AI 判断 4 要素是否讲全，0/1

@Column({ type: 'json', name: 'informed_consent_transcript', nullable: true })
informedConsentTranscript!: {
  element: 'nature' | 'confidentiality' | 'logistics' | 'recording';
  covered: boolean;
  visitorResponse: string;          // AI 来访当时的反应
  coveredAtTurn: number;            // 在 transcript 第几轮讲的
}[] | null;
```

API 增量：

| Method | Path | 用途 |
|--------|------|------|
| PATCH | `/counselor/training-sessions/:id/consent/mark` | 督导 LLM 判定 4 要素覆盖情况，写入 `informed_consent_transcript` |
| GET | `/counselor/training-sessions/:id/consent` | 前端知情同意阶段查询当前进度（哪几要素已讲） |

---

## 6. M3 会谈核心训练系统增强（单次/长程通用）

### 6.1 实时督导提示（防依赖设计）

**默认关闭**，用户主动开启，两档：

| 档位 | 行为 | 触发示例 |
|------|------|----------|
| `light`（推荐新手） | 侧边浮窗静默提示，不打断对话 | 连续 3 次封闭式提问 → 「可尝试开放式提问」；来访提自伤线索 → 「建议进行风险评估」 |
| `off`（推荐进阶） | 完全无提示，结束后统一出报告 | — |

**防依赖硬约束（写进后端 prompt + 业务逻辑）**：
1. 提示只给方向，**禁止**输出替代话术原文。
2. 提示折叠在侧边浮窗，不主动弹窗。
3. 督导报告独立一栏「无辅助下的表现」，引导用户逐步切到 `off`。
4. 同一类提示 5 分钟内不重复推送（防抖）。

**实现**：后端在每轮 counselor 发言后，异步跑一个轻量 classifier（可复用督导 LLM，temperature=0），命中规则写 `live_hint` 表，前端通过 SSE / WebSocket 拉取。

```typescript
@Entity('live_supervision_hints')
export class LiveSupervisionHint {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'session_id' }) sessionId!: string;
  @Column({ type: 'int', name: 'turn_index' }) turnIndex!: number;
  @Column({ type: 'varchar', length: 50 }) category!: string;  // closed_question_run / suicide_cue / premature_advice ...
  @Column({ type: 'text' }) hintText!: string;                 // 方向提示，不含话术
  @Column({ type: 'varchar', length: 20, default: 'light' }) tier!: 'light' | 'off';
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
```

### 6.2 会谈录音与逐字稿打点标记

复用 v0.3 §11 语音链路产出的逐字稿（带时间戳），新增用户打点：

```typescript
@Entity('transcript_bookmarks')
export class TranscriptBookmark {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'session_id' }) sessionId!: string;
  @Column({ type: 'int', name: 'turn_index' }) turnIndex!: number;
  @Column({ type: 'float', name: 'offset_ms' }) offsetMs!: number;
  @Column({ type: 'varchar', length: 20 })
  markType!: 'good' | 'improve' | 'key_node';
  @Column({ type: 'text', nullable: true }) note!: string | null;
}
```

- 督导报告可锚定到 bookmark 位置，前端点击跳转逐字稿对应时间戳。
- 录音数据仅本地存储（延续 v1.0 §10.1 隐私承诺），后端不落音频二进制，只落 transcript + bookmark。

### 6.3 会谈技术统计仪表盘

会谈结束后自动生成，量化呈现：

| 指标分类 | 具体指标 |
|----------|----------|
| 提问类型 | 开放式 / 封闭式 / 半开放式 占比 |
| 干预技术 | 共情 / 释义 / 总结 / 面质 / 解释 / 建议 次数 |
| 行为指标 | 打断来访次数 / 沉默时长 / 议题跳转频率 |

**实现**：督导 LLM 在生成 `supervision_feedback` 时，额外输出一个 `techStats` JSON（复用同一次 LLM 调用，不额外花钱），写在 `long_term_case_sessions.supervisionFeedback` 或 `training_sessions` 的新字段上。

```typescript
// 加在 training_sessions 与 long_term_case_sessions 上的新 JSON 字段
techStats?: {
  questionTypes: { open: number; closed: number; semi: number };
  interventions: {
    reflection: number;      // 共情
    paraphrase: number;      // 释义
    summary: number;         // 总结
    confrontation: number;   // 面质
    interpretation: number;  // 解释
    advice: number;          // 建议
  };
  behavior: { interruptions: number; silenceMs: number; topicJumps: number };
  // 督导点评（一段话）
  commentary: string;
};
```

### 6.4 双向移情 / 阻抗标记系统

| 方向 | 触发 | 落地 |
|------|------|------|
| AI 自动标记（来访侧） | 来访出现阻抗 / 回避 / 正移情 / 负移情 / 解离 | 后端在 transcript turn 上打 tag，新表 `transference_resistance_marks` |
| 咨询师手动标记（反移情侧） | 会谈中用户点按钮「反移情觉察」+ 简短备注 | 同一张表，`markedBy=counselor` |

```typescript
@Entity('transference_resistance_marks')
export class TransferenceResistanceMark {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'session_id' }) sessionId!: string;
  @Column({ type: 'int', name: 'turn_index' }) turnIndex!: number;
  @Column({ type: 'varchar', length: 20 })
  direction!: 'visitor_auto' | 'counselor_manual';
  @Column({ type: 'varchar', length: 30 })
  markType!: 'resistance' | 'avoidance' | 'positive_transference'
            | 'negative_transference' | 'dissociation' | 'counter_transference';
  @Column({ type: 'text', nullable: true }) note!: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
```

长程卷宗按 sessionNumber 聚合，生成移情/阻抗变化趋势图。

---

## 7. M4 长程个案卷宗系统

### 7.1 卷宗主页四 Tab（在现有 `long-term-case.controller.ts` 扩展）

| Tab | 数据源 | 现状 |
|-----|--------|------|
| ① 个案档案 | `case_profile_entries`（M1 §4.2）+ 个案概念化编辑器（§7.3） | 🆕 |
| ② 会谈时序 | `long_term_case_sessions`（v1.1 已有） | ✅ 已有，需补督导报告 / 逐字稿入口 |
| ③ 作业与反馈 | `homework_assignments`（§7.2） | 🆕 |
| ④ 咨询师笔记 | `counselor_notes`（§7.6） | 🆕 |

> **仅支持手动开启下一节会谈**，不自动连续开启，避免训练疲劳；后端在 `POST /long-term-cases/:id/sessions` 前校验：距上一次 `endedAt` 必须 ≥ 24h（可配置），否则返回 409 `TOO_EARLY_FOR_NEXT_SESSION`。

### 7.2 家庭作业（立即 / 异步）

```typescript
@Entity('homework_assignments')
export class HomeworkAssignment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'case_id' }) caseId!: string;
  @Column({ type: 'char', length: 36, name: 'assigned_session_id' })
  assignedSessionId!: string;                                  // 在哪一节布置的
  @Column({ type: 'text' }) content!: string;
  @Column({ type: 'text', nullable: true }) goal!: string | null;
  @Column({ type: 'text', nullable: true }) precautions!: string | null;
  @Column({ type: 'varchar', length: 20, name: 'feedback_mode' })
  feedbackMode!: 'immediate' | 'async';                       // 立即生成 / 异步推送
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: 'pending' | 'feedback_ready' | 'brought_to_next_session';
  @Column({ type: 'text', name: 'visitor_feedback', nullable: true })
  visitorFeedback!: string | null;                             // AI 模拟来访完成作业后的反馈
  @Column({ type: 'datetime', name: 'feedback_ready_at', nullable: true })
  feedbackReadyAt!: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
```

**异步反馈**走 BullMQ（跟 ADR-0002 一致）：会话结束后入队，延迟 N 分钟（模拟真实咨询间隔，默认 30min，可配），worker 调 LLM 生成 `visitorFeedback`，写库 + 标 `feedback_ready`；下次会谈 system prompt 自动注入「本周作业来访反馈」。

### 7.3 个案概念化编辑器（V2.0）

多流派模板 + AI 批注 + 版本管理：

```typescript
@Entity('case_conceptualizations')
export class CaseConceptualization {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'case_id' }) caseId!: string;
  @Column({ type: 'varchar', length: 30, name: 'school_code' })
  schoolCode!: 'cbt' | 'psychodynamic' | 'person-centered' | 'family';
  @Column({ type: 'json' }) sections!: Record<string, string>;  // 各流派模板字段
  @Column({ type: 'int', name: 'version', default: 1 }) version!: number;
  @Column({ type: 'json', name: 'ai_annotations', nullable: true })
  aiAnnotations!: { section: string; note: string; severity: 'logic' | 'fit' | 'missing_info' }[] | null;
  @Column({ type: 'tinyint', name: 'is_reference_version', default: 0 })
  isReferenceVersion!: number;                                 // AI 参考版 vs 用户手写版
  @Column({ type: 'datetime', name: 'created_at' }) createdAt!: Date;
}
```

硬约束（写进 LLM prompt）：AI 参考版**严格基于已收集的 `case_profile_entries`**，不允许编造未披露的成长史；缺信息时输出「此处需通过会谈收集：xxx」。

### 7.4 咨询目标共建面板（V2.0，长程专属）

```typescript
@Entity('counseling_goals')
export class CounselingGoal {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'case_id' }) caseId!: string;
  @Column({ type: 'varchar', length: 10 }) horizon!: 'short' | 'mid' | 'long';
  @Column({ type: 'text' }) content!: string;
  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status!: 'draft' | 'agreed' | 'adjusted' | 'reached';
  @Column({ type: 'int', name: 'reached_session', nullable: true })
  reachedSession!: number | null;
}
```

阶段性督导自动对照目标进展，给出「是否需要调整方向」建议。

### 7.5 个案假设追踪（V2.0）

```typescript
@Entity('case_hypotheses')
export class CaseHypothesis {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'case_id' }) caseId!: string;
  @Column({ type: 'text' }) content!: string;                  // 如「亲密冲突源于童年情感忽视」
  @Column({ type: 'json', name: 'tracking' })
  tracking!: { sessionNumber: number; verdict: 'support' | 'refute' | 'pending' }[];
  @Column({ type: 'varchar', length: 20, default: 'open' })
  status!: 'open' | 'supported' | 'refuted';
}
```

结案时生成假设验证汇总，训练「保持假设、不过早下结论」的临床思维。

### 7.6 咨询师笔记

```typescript
@Entity('counselor_notes')
export class CounselorNote {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'case_id' }) caseId!: string;
  @Column({ type: 'char', length: 36, name: 'session_id', nullable: true })
  sessionId!: string | null;
  @Column({ type: 'text' }) content!: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
```

仅用户可见，AI system prompt **只读不修改**（在 LLM prompt 里显式声明「这些是咨询师私人笔记，不要在来访对话中提及或引用」）。

---

## 8. M5 全场景督导复盘体系

| 场景 | 触发 | 产出表 | 版本 |
|------|------|--------|------|
| 单节会谈督导 | 每次 session 结束 | `supervision_feedback`（v1.1 已有），补「风险线索专项点评」字段 | V1.0 |
| 阶段性督导 | 每 3-5 节自动触发 | `periodic_supervision_reports` | V2.0 |
| 脱落专项复盘 | 来访中途提出结束 / 无故缺席 / `dropout_risk_score > 0.7` | `dropout_review_reports` | V1.0 |

### 8.1 单节督导（在 v1.1 基础上补）

在 `SupervisionFeedbackPayload` 加 2 个字段（向后兼容，nullable）：

```typescript
// v1.2 扩展（不破坏 v1.1 4 字段）
export interface SupervisionFeedbackPayload {
  // ... v1.1 已有: overallScore / perSentence / errorCategories / growthSuggestion
  highlights?: string[];         // 亮点肯定（1-3 条）
  alternatives?: { turnIndex: number; suggestedResponse: string }[];  // 替代回应示范
  riskReview?: {                  // 风险线索专项点评
    detected: boolean;
    cues: string[];
    handlingQuality: 'adequate' | 'partial' | 'missed';
    suggestion: string;
  };
  techStats?: import('./long-term-case-session.entity').NextSessionContext['usedTechniques'] extends never ? never : object;  // 占位, 实际复用 §6.3 techStats
}
```

### 8.2 阶段性督导（V2.0）

```typescript
@Entity('periodic_supervision_reports')
export class PeriodicSupervisionReport {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'case_id' }) caseId!: string;
  @Column({ type: 'int', name: 'from_session' }) fromSession!: number;
  @Column({ type: 'int', name: 'to_session' }) toSession!: number;
  @Column({ type: 'json' }) content!: {
    allianceRating: number;          // 咨访关系评估 0-100
    topicProgress: string;            // 议题进展
    goalAttainment: object;           // 对照 counseling_goals
    directionSuggestion: string;
    transferenceNotes: string;
  };
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
```

每完成 N 节（默认 3，可在偏好里改 3/4/5）由 BullMQ 自动生成。

### 8.3 脱落专项复盘（V1.0）

```typescript
@Entity('dropout_review_reports')
export class DropoutReviewReport {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'case_id' }) caseId!: string;
  @Column({ type: 'json' }) content!: {
    warningTimeline: { sessionNumber: number; signal: string }[];  // 预警信号时间线
    reason: 'alliance' | 'mismatch' | 'external';                   // 同盟/干预不匹配/外部
    reasonDetail: string;
    improvements: string[];
  };
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
```

---

## 9. M6 专项技能与成长体系

### 9.1 10 项核心基本功（对齐现有 `training_exercises` 表）

| # | 基本功 | 对应现有 seed id | 状态 |
|---|--------|------------------|------|
| 1 | 积极倾听 | `ts_emotion_reflection` 等 | ✅ 已 seed（10 题 DB 化，2026-10-20 落地） |
| 2 | 共情回应 | `ts_fact_feeling_separation` 等 | ✅ |
| 3 | 开放式提问 | （待补 seed） | ⏳ |
| 4 | 澄清与释义 | （待补） | ⏳ |
| 5 | 风险评估与自杀访谈 | （待补，需专业审核） | ⏳ V2.0 |
| 6 | 知情同意与设置 | （待补，跟 M2 联动） | ⏳ V1.0 |
| 7 | 阻抗识别与处理 | （待补） | ⏳ V2.0 |
| 8 | 伦理边界应对 | `case_ethics` 占位场景 | ⏳ |
| 9 | 结案与分离 | （待补） | ⏳ V2.0 |
| 10 | 家庭作业布置 | （待补，跟 M4.2 联动） | ⏳ V2.0 |

> 现有 `training-exercise-seeds.ts` 已 seed 10 题（2026-10-20），跟本清单 10 项是「训练题粒度」vs「基本功粒度」的关系：1 项基本功对应 1-N 道训练题，后续 seed 扩展时按本表归类。

### 9.2 五维能力画像（在 v1.1 7 维 28 子指标上的收敛视图）

> **跟 v1.1 §5.1 关系**：v1.1 的 `ability_dimensions` 表（7 维 28 子指标）**保留不动**作为 raw 采集层；v1.2 在其上做一个**收敛视图**，把 7 维映射到产品对外展示的 5 维：

| 对外五维 | 由 v1.1 哪些 raw 维度聚合 |
|----------|----------------------------|
| 倾听 | 基础技能.倾听准确率 + 语音表现.沉默应对 |
| 共情 | 基础技能.共情精准度 |
| 评估 | 专业知识.症状识别 + 基础技能.边界意识 |
| 干预 | 基础技能.提问开放度 + 专业知识.个案概念化 |
| 伦理 | 专业知识.伦理规范掌握度 |

**实现**：不加新表，在 `counselor-growth.controller.ts` 加一个 `GET /counselor/growth/pentagon` 聚合接口，实时算 5 维分数。raw 7 维仍可在「详细分析」页查看，**不丢弃**。

薄弱项自动归集：从 `supervision_feedback.errorCategories` 聚合高频错误，推荐对应专项训练（复用现有 `training-exercise` 路由）。

---

## 10. MVP 落地优先级（V1.0 / V2.0 / V3.0）

### 10.1 V1.0 核心闭环版（优先落地）

| # | 模块 | 交付 |
|---|------|------|
| 1 | 分层来访人设体系 | `visitor_full_personas` 表 + 表层配置 API + 动态解锁 `case_profile_entries` |
| 2 | 初访前置知情同意 | `training_sessions` 加 3 字段 + 4 要素判定 |
| 3 | 会谈核心 | `live_supervision_hints`（轻提示档）+ `transcript_bookmarks` 打点 + `transference_resistance_marks` 双向标记 |
| 4 | 初访分流 | 单次结束 / 暂存 / 转长程（v1.1 已有骨架，补分流 API） |
| 5 | 长程卷宗基础版 | 四 Tab 壳 + `homework_assignments`（异步）+ `counselor_notes` |
| 6 | 督导 | 单节督导补风险点评 + `dropout_review_reports` 脱落专项 |
| 7 | 实时督导提示 | `live_supervision_hints` 两档开关 |

### 10.2 V2.0 能力强化版

1. 个案概念化编辑器（多流派模板 + AI 批注 + 版本）
2. 咨询目标共建 `counseling_goals` + 假设追踪 `case_hypotheses`
3. 阶段性督导 `periodic_supervision_reports`
4. 五维能力画像收敛视图 + 薄弱点自动归集
5. 长程随机扰动：外部应激事件、设置违规（迟到/爽约）
6. 伦理情景植入引擎

### 10.3 V3.0 高阶特色版

1. 模拟同辈督导小组
2. 双人协同训练模式
3. 鉴别诊断练习（强免责）
4. 经典个案库（标准化训练案例）

---

## 11. 产品兜底与体验设计

### 11.1 合规与免责

- 全局固定轻提示：「本产品仅用于心理咨询师实训模拟，不构成任何临床建议，不能替代真实督导与临床服务」（v1.0 §10.2 已有，保留）。
- 所有练习数据本地存储，不上传、不共享（v1.0 §10.1 已有，保留）。
- 高危议题延续 v1.1 §1.1 排除清单（自杀自伤 / 性创伤 / 重度精神障碍 / 人格障碍）。

### 11.2 防依赖与学习保护

- 所有辅助功能默认关闭，用户主动开启（§6.1 硬约束）。
- 督导只给方向与思路，不直接给标准答案（写进 LLM prompt 强约束）。
- 引导用户从「开提示」逐步过渡到「无提示」训练：督导报告独立一栏「无辅助下表现」。

### 11.3 情绪与疲劳保护

- 长程不自动连开下一节，强制间隔 ≥ 24h（§7.1）。
- 作业异步机制，匹配真实咨询节奏（§7.2）。
- 会谈中内置「暂停休息」按钮，可随时暂停退出（前端实现，后端在 `PATCH /training-sessions/:id/status` 已支持 paused 状态）。
- 督导反馈以鼓励 + 建设性建议为主，避免挫败式评价（写进督导 LLM prompt）。

---

## 12. 跟 v1.1 / v0.3 的关系

| 项 | 处理 |
|----|------|
| v1.1 已落地 entity（`training_sessions` / `long_term_cases` / `long_term_case_sessions` / `supervision_feedback` / `ability_*` / `quota_usage`） | **0 破坏**。新增字段走 ALTER TABLE（`informed_consent_*` / `techStats`），nullable 向后兼容 |
| v0.3 语音链路 / 鉴权 / 多租户 / AI 引擎 | 完全复用，不动 |
| `src/consent` 产品合规模块 | 跟 M2 正交，不动 |
| `training_exercises` 10 题 seed | 不动，M6.1 10 项基本功是对其的归类视图 |
| 新增表 | 全部走 migration（跟 ADR-0003 一致，禁止 `synchronize: true`） |

### 12.1 新增表清单（v1.2 新增，需 migration）

| 表 | 用途 | 落地版本 |
|----|------|----------|
| `visitor_full_personas` | AI 底层全量人设 | V1.0 |
| `case_profile_entries` | 卷宗动态解锁档案 | V1.0 |
| `live_supervision_hints` | 实时督导轻提示 | V1.0 |
| `transcript_bookmarks` | 逐字稿打点标记 | V1.0 |
| `transference_resistance_marks` | 双向移情/阻抗标记 | V1.0 |
| `homework_assignments` | 家庭作业 | V1.0 |
| `counselor_notes` | 咨询师笔记 | V1.0 |
| `dropout_review_reports` | 脱落专项复盘 | V1.0 |
| `case_conceptualizations` | 个案概念化编辑器 | V2.0 |
| `counseling_goals` | 咨询目标共建 | V2.0 |
| `case_hypotheses` | 个案假设追踪 | V2.0 |
| `periodic_supervision_reports` | 阶段性督导 | V2.0 |

### 12.2 ALTER TABLE 清单（v1.2 增量列，nullable 向后兼容）

| 表 | 新增列 |
|----|--------|
| `training_sessions` | `informed_consent_required` / `informed_consent_passed` / `informed_consent_transcript` / `tech_stats` (json) |
| `long_term_case_sessions` | `tech_stats` (json) |
| `supervision_feedback.feedback` | json 内加 `highlights` / `alternatives` / `riskReview`（不加列，json 扩展） |

---

## 13. Changelog

| 版本 | 日期 | 变更 |
|------|------|------|
| **v1.2** | 2026-10-21 | 整合《全真心理咨询模拟实训系统 完整版方案》→ 后端增量 spec<br>- §2 新增 5 条临床拟真设计原则（拟真/分层/可选/防依赖/轻量化）<br>- §4 新增 M1 分层人设引擎：`visitor_full_personas` 7 大块 schema + `case_profile_entries` 动态解锁 + 信任度暴露节奏<br>- §5 新增 M2 知情同意前置：`training_sessions` 加 3 字段，跟现有 `src/consent` 模块边界明确划分<br>- §6 新增 M3 会谈核心增强：`live_supervision_hints` / `transcript_bookmarks` / `transference_resistance_marks` + `techStats` 仪表盘<br>- §7 新增 M4 长程卷宗四 Tab：`homework_assignments` / `counselor_notes`（V1.0）+ `case_conceptualizations` / `counseling_goals` / `case_hypotheses`（V2.0）<br>- §8 新增 M5 督导三场景：单节补风险点评 + `periodic_supervision_reports`（V2.0）+ `dropout_review_reports`（V1.0）<br>- §9 新增 M6：10 项基本功对照现有 seed + 五维能力画像收敛视图（不改 `ability_*` 表，加聚合接口）<br>- §10 V1.0/V2.0/V3.0 排期<br>- §12 新增 12 张表 + 3 个 ALTER TABLE 清单，全部走 migration<br>- **跟 v1.1 关系**：0 破坏，纯增量；v1.1 已落地 entity 不动 |

---

## 14. 落地状态与实现决策（2026-10-21 补）

> **用途**：本节登记 v1.2 spec 与**已落地代码**之间的差异与澄清。spec 是拍板时的契约，代码是落地后的现实；
> 两者不一致时**以本节为准**（每条都记了原因），避免下一个切片按旧 spec 写代码。
> **配套**：`docs/progress/v1.2-progress-snapshot-2026-10-21.md`（最新总快照）
> / `docs/progress/v1.2-vs-a-session-foundation-2026-10-21.md`
> / `docs/progress/v1.2-vs-b1-layered-persona-2026-10-21.md`

### 14.1 落地状态

| 切片 | 状态 | 交付 |
|------|------|------|
| **VS-A** 会话底座 | ✅ 已落地（commit `f332e07`） | `training_sessions` 生命周期 API 6 endpoint + 5 态状态机守卫 + 督导反馈 mock → 真接 LLM + 唯一会话上下文装配器 + 唯一结构化输出 client |
| **VS-B1** M1 分层人设数据层 | ✅ 已落地（commit `2b009be`） | `visitor_full_personas` + `case_profile_entries` 2 表（migration `1714900000013`）+ 9 endpoint + 上帝视角偏好 key |
| **VS-B2** 人设接进 AI 来访者 prompt | ✅ 已落地（commit `6454904`，与 VS-C 同 commit） | 依赖倒置接线（@Global 上下文注册表）+ sessionId 绑定契约 + 每轮 3 段分析（hint + mark + disclosures）+ 信任度推进 |
| **VS-C** M2 知情同意 + M3 会谈核心 | ✅ 已落地（commit `6454904`，与 VS-B2 同 commit） | 3 张新表（migration `1714900000014`）+ 5 处 ALTER + 9 endpoint + **counselor 端第一个实时通道（SSE）** + 每轮 LLM 分析器 |
| **VS-C** M2+M3 会谈核心 | ✅ 已落地（commit `6454904`，与 VS-B2 同 commit） | 知情同意 3 列 ALTER + 4 要素判定 + 轻提示 + 打点 + 移情标记 + techStats |
| **VS-D** M4 长程卷宗 | ⏳ 待做 | 四 Tab 壳 + 作业队列 + 咨询师笔记 + 24h 间隔 |
| **VS-E** M5 督导闭环 | ⏳ 待做 | `highlights`/`alternatives`/`riskReview` + 脱落复盘 |

### 14.2 实现决策（spec ↔ 代码差异登记）

| # | spec 原文 | 落地做法 | 原因 |
|---|---------|---------|------|
| **D1** | §4.1 `visitor_full_personas` 的 `basics` 含 7 字段（age/gender/occupation/education/livingStatus/somaticHistory/psychHistory）；§4.2 视图 A 写「代号 / 年龄 / 性别 / 职业」映射到 `basics.{age,gender,occupation}` | **新增独立列 `display_name`（varchar 100）**，不进 `basics` | spec 的「代号」在 7 大块里**没有落点**，但它是必需项（visitor prompt 渲染成"你叫 XXX"，且视图 A 要求可编辑）。`basics` 严格保持 spec 契约，将来与上游对齐时只改 1 处 json 映射 |
| **D2** | §4.3「新建 VisitorFullPersona 后在创建长程个案时同步生成一份，两者通过 `long_term_cases.id` ↔ `visitor_full_personas.id` 1:1 关联（应用层）」 | `visitor_full_personas.case_id`（**可空** char36 + `uniq_vfp_case` 唯一索引），非 id 相等 | 全量人设在**个案配置页**阶段就生成（§3 链路：配置页 → 初访 → 分流），那时还不知道最终会不会转长程 → `case_id` 可空，转长程时回填。UNIQUE 索引在 DB 层保证 1:1（MySQL 视多个 NULL 互不相同，所以未归属草稿可有任意多份）。id 相等的隐式关联无法用索引查询，故不采用 |
| **D3** | §4.1「信息暴露节奏：按咨访信任度（0.0-1.0）分级」 | 信任度落 `visitor_full_personas.trust_level`（float, 默认 0.2），**长程级**存当前值 | 信任度随咨访关系加深而**累积**上升 → 下一场会谈的暴露节奏取决于"到目前为止建立了多少信任" → 存当前值，每场会谈结束回写；历史轨迹由 `case_profile_entries.session_id` 承载，不另建时间序列表 |
| **D4** | §4.2「AI 每轮回复后抽取披露信息写入 `layer=self_disclosed`」 | 层级由**调用入口**决定：`create()` = 咨询师手写（`therapist_note`）、`appendDisclosed()` = AI 抽取（`self_disclosed`）。**前端只能写手写层** | 前端若能传 `layer=self_disclosed`，就等于用户能伪造"来访者说过的话"，破坏信息分层的可信度（§2.2 原则 2） |
| **D5** | §4.2「高级开关『完整个案剧本查看』默认关闭；开启后返回完整 VisitorFullPersona，并在 session 元数据打 `godViewEnabled=true` 标记」 | 开关落**既有** `counselor_ui_preferences` 表（新增 key `godViewEnabled`，默认 `false`）；`GET /:id/full` 未开启直接 403 | 那是 counselor 端唯一的"用户可控界面偏好"单一事实源（一人一行 + key 白名单 + 跨设备同步）。「session 元数据打标记」留到 VS-C（`training_sessions` 的 ALTER 里一并加），VS-B1 先把**读取端**的开关做实 |
| **D6** | §4.2 视图 B「卷宗 · 动态解锁档案」 | 督导上下文**只装已解锁档案**（`layer=self_disclosed`）+ 信任度，**不装未解锁的深层人设** | 督导报告是给**用户**看的，塞 `innerWorkingModel` 等未解锁内容等于变相泄露"来访者还没说出口的内心戏"，摧毁信息探索价值（§2.2 原则 1/2）。深层的完整剧本只在上帝视角开启时经 `GET /:id/full` 返回 |
| **D7** | §4.1「7 大块」 | domain 类型命名 `VisitorFullPersonaScript`（剧本内容），entity 类保持 `VisitorFullPersona`（表行） | 两者曾同名 → tsc 报 TS2300 并级联炸出 27 个错。entity 是主公民（跟仓库 11 个 entity 不带 `Entity` 后缀的风格一致），domain 那个让位 |
| **D8** | §10.1 第 4 项「初访分流：单次结束 / 暂存 / 转长程」 | 状态机迁移合法性放**领域层纯函数** `src/counselor/domain/session-status.guard.ts`（5 态迁移表） | 分流 / 暂停休息 / BullMQ 收尾是 3 个消费方，共用单一真值源；写在 controller 的 if 里必然漂移 |
| **D9** | §6.4「AI 自动标记（来访侧）：后端在 transcript turn 上打 tag」 | ⚠️ **已被 D19 修订**（原: 采集时机绑在轻提示档位上，off 时不采集）→ 现: 分析**始终跑**，档位只控「hint 是否落库 + 推送」，mark 与披露照常产出 | 原判定的致命处: 档案永远不填 → 信任度永远不涨 → 信息暴露节奏永远停在第一档 → 整个 M1 机制失效; 而关掉提示的恰恰是做长程个案的进阶用户. 详见 D19 |
| **D10** | §6.1「前端通过 SSE / WebSocket 拉取」 | **选 SSE**（`@Sse`），不选 WebSocket | ① 轻提示是单向推送，SSE 正是该语义 ② 复用 REST 鉴权（Bearer header），不必再写一遍 WS 握手鉴权 ③ 前端已有现成解析范式（`xin_su_app` `ai_engine/data/llm/llm_client.dart` 用 `http.Request` + `text/event-stream` 手动解析）→ 0 新依赖 ④ 走 WS 要么塞进 voice WS（voice → counselor 反向依赖，违反 `voice.module.ts` 既有原则），要么新开网关 + 前端再连第 2 条连接 |
| **D11** | §6.1 轻提示（classifier）+ §6.4 移情标记（打 tag）是两段需求 | **合并成 1 次 LLM 调用**，一次输出 `hint` + `mark` 两段 | ① 两者读的是同一段对话、发生在同一时刻 ② 每轮都跑，成本线性累加 ③ 更重要：两次独立判定可能自相矛盾（同一条回复，判提示说"没接住情绪"、判标记说"来访很平静"） |
| **D12** | §6.1 两档开关（用户可控） | 落既有 `counselor_ui_preferences`，`prefs` 值类型**放宽为 `boolean \| string`** + 加**值白名单** | 档位是字符串（`'light' \| 'off'`），与已有布尔偏好共存于同一 JSON 列。键白名单只能拦"未知键"，拦不住"已知键 + 非法值" → 必须加值白名单。放宽**不需要 migration**（列本身是 JSON） |
| **D13** | §6.1 / §6.2 / §6.4 三张表的 entity 草图（均无 `tenant_id` / `user_id` / `deleted_at`） | 3 张表**补齐** `tenant_id` + `user_id` + `deleted_at` | 跟 counselor 既有 12 个 entity 同一模板。多租户库里少一列租户字段 = 潜在越权口子（哪次查询忘了校验会话归属就跨用户泄露） |
| **D14** | §6.1 硬约束 4「同一类提示 5 分钟内不重复推送」 | 防抖 key = **(sessionId + category)**，查 **DB** 不查内存 | 不同类别的提示互不干扰（连续封闭式提问 + 自伤线索，两类都要出）。查 DB 是因为多实例下内存态会失效 |
| **D15** | §6.3「督导 LLM 在生成 supervision_feedback 时，额外输出一个 techStats JSON（复用同一次 LLM 调用，不额外花钱），写在 long_term_case_sessions.supervisionFeedback 或 training_sessions 的新字段上」 | techStats 落 **session 表的 `tech_stats` 列**（不塞 `supervision_feedback.feedback` json）；**techStats 畸形不阻断督导反馈**（降级为 null，报告照常出） | 塞进 feedback json 会污染 4 字段的 1:1 wire（前端 DTO 读不到但数据在，以后排查踩坑），spec 本身也写的是"新字段"。主产物（督导反馈）不该被副产物（统计）拖垮 |
| **D16** | §5.4「`informed_consent_transcript` 存 4 要素覆盖明细」 | 判定结果**补齐缺失要素**（模型漏判 → 补 `covered=false`），不写半份 | 前端按数组长度算"已讲 N/4"，漏一个元素计数就错位；且"模型没提到某要素"在业务上就等于"没讲全" |
| **D17** | §4.3「长程：注入 VisitorFullPersona 全量 + 当前信任度 + 已解锁 CaseProfileEntry 列表」 | **依赖倒置 + @Global 注册表**（agent 只提供插槽，不认识业务） | 方案 A（agent 直连 counselor 数据）破坏单向依赖；**方案 B 的 provider token 直注也会循环依赖**（counselor→agent 取 LlmModule，agent→counselor 就成环）。@Global 注册表是唯一能双向可见又不循环的做法 |
| **D18** | §4.3 未说明「AI 来访者怎么知道这是哪个来访者」 | **sessionId 绑定契约**：训练/长程会谈的 voice WS sid = counselor 的 sessionId，贡献者按 id 反查 | 语音链路（ASR/TTS/visitor）保持通用不重造；业务设定由业务侧注入。前端只改 1 处（连 WS 用 counselor 的 sessionId） |
| **D19** | §6.1「off：完全无提示，结束后统一出报告」 | **修订 D9**：分析**始终跑**，档位只控「hint 是否落库 + 推送」 | 原 D9 的「off 时不采集」会致命: 档案永远不填 → 信任度永远不涨 → 信息暴露节奏永远停在第一档 → **整个 M1 机制失效**。而关掉提示的恰恰是做长程个案的进阶用户 |
| **D20** | §6.1 轻提示 + §6.4 移情标记 + §4.2 档案抽取是三段需求 | **1 次 LLM 出 3 段**（hint + mark + disclosures） | 三者读同一段对话、发生在同一时刻。分开判定会自相矛盾（同一条回复，判提示说"没接住情绪"、判标记说"来访很平静"、判披露说"来访讲了自己的名字"——第三种解读必然跟第二种冲突） |
| **D21** | §4.1「按咨访信任度 (0.0-1.0) 分级」但没说「披露了什么加多少信任」 | 按**锚点所在人设块分档加权**（浅层事实 +0.03 / 关系与内在 +0.06 / 深层 +0.08），**服务端规则**可复算可解释；重复披露同一锚点**不重复加**（只更新内容） | 一刀切 +0.05 会让"披露童年被打"跟"说了自己叫张伟"一样重，跟临床现实不符。权重若由 LLM 给 → 不可校准 + 两次判定不同 + UI 无法解释 |
| **D22** | §4.2「AI 每轮回复后抽取披露信息」 | 披露的 `anchorKey` **白名单**（7 大块前缀） | 锚点要能定位到人设图谱的真实节点，否则档案条目无法关联回人设、信任度权重也算不准。非法锚点整份判非法（宁可报错也不要写脏档案） |
| **D23** | §4.1「AI 底层全量人设（AI 独享）」+「信息暴露节奏按信任度分级」 | **AI 全量知情 + 规则约束它说不说**（不按信任度裁剪喂给 AI 的人设内容） | 若按信任度裁剪人设内容再给 AI，它就"不知道自己有什么"，被问到童年时只能编。真实咨询里来访者**知道**自己的创伤，只是还没准备好说 |
| **D24** | §4.1 信任度阈值 0.3 / 0.6 / 0.8 | 暴露规则写成**4 条人话 + 当前档位**（不让模型自己换算区间） | 模型对"0.3 ≤ 信任度 < 0.6"这种区间判断不稳定；写成"可以谈关系/可以谈情绪"这种可执行描述才稳 |

### 14.3 仍未拍板 / 未做的事

1. **VS-B2 接线方案**（A / B / C）+ 「长程会话的 AI 来访者走哪条链」→ 见 `docs/progress/v1.2-landing-plan-2026-10-21.md`
2. **每轮「档案抽取器」**（AI 抽取 → `appendDisclosed`）依赖 VS-B2 的对话链路
3. **长程个案创建时自动生成全量人设**（VS-B2 或 VS-D 接）
4. **信任度回写**（每场会谈结束按披露情况提升）依赖 VS-C 的会话结束事件
5. **`live_supervision_hints` 推送通道**选 SSE 还是 WebSocket —— counselor 端**目前无现成通道**
   （现成只有 `src/voice/voice.gateway.ts` 的 WS `/voice/training` 与 `src/ai-engine` 的 `@Sse('completions')`）
6. **专业内容审核**（§11.1 硬约束）：所有新 LLM prompt 产出的督导意见 / AI 来访剧本，上线前必须经持证咨询师审核

---

**END OF SPEC counselor-mode-v1.2-full-situ-simulation**
