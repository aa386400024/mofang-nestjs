# 心塑 App · 咨询师学习者模式 — 开发者规格说明书 (v1.1)

> **文档版本**：v1.1
> **撰写日期**：2026-10-15 (v1.0) + 2026-10-19 (v1.1 V0.5 client actual 增量同步)
> **文档状态**：内部评审稿
> **作者**：大炮 (产品) + agent (dev spec 转换 + V1.1 增量同步)
> **产品代号**：XinSu Counselor Mode
> **上游文档**：`E:\study\心理咨询师水平评价\心塑App·咨询师学习者模式-产品设计文档v1.0.md` (53KB, 14 章)
> **前端实装基线**：xin_su_app V0.5 stage 2 + V2026-10-16 治本续 V5 (start with visitor preset race fix + dim 矛盾软警告 + 防误触 back), commit 验证于 2026-10-19
> **基线 spec**：`docs/specs/ai-voice-training-v0.3.md` (V0.3, 22 章) — 本 spec 是 V0.3 + counselor-mode 增量
> **本 spec 关系**：V0.3 spec 维持「心塑 App 整体 + V0.x 训练」基线，本 spec 仅覆盖 counselor-mode 增量部分（4-12 次长程个案 + 4 流派督导 + 7 维度子指标 + 商业化 + 排期）
> **V0.3 已 superseded 本 spec?** ❌ **不 supersede**, 两者是 **基线 + 增量** 关系，V0.3 spec 继续维护整体架构 / AI 引擎 / 鉴权 / 数据库 等基础部分
> **v1.1 变更摘要**：§4.2 全流程模拟接诊 + §6.5 training_session entity 新增 + §10 Changelog (跟 V0.5 client 1:1 wire, 0 破坏 V0.3 spec)

---

## 0. 元信息

| 项 | 值 |
|----|----|
| **version** | v1.0 (2026-10-15) |
| **author** | 大炮 (产品) + agent (dev spec) |
| **status** | 内部评审稿 |
| **scope** | counselor-mode 增量（V0.3 spec 之外的"咨询师学习者模式"专属） |
| **integration** | 跟 V0.3 spec 1:1 wire, 0 破坏性改动, 数据模型增量 (不删旧) |

---

## 1. 范围 (In Scope / Out of Scope)

### 1.1 In Scope (counselor-mode 增量, V0.3 不覆盖)

| 模块 | 内容 | 状态 |
|------|------|------|
| **单次训练 session** (V1.1 增) | 9 场景单次训练 session 持久化 + 5 状态机 API + VisitorPreset 9 字段持久化 + 3 档训练 mode 路由 | 🆕 V1.1 增量 |
| **长程个案模拟** | 4-12 次连续咨询 + 跨会话 agent memory + 脱落风险 | 🆕 核心增量 |
| **多流派督导系统** | CBT/精神动力学/人本/家庭治疗 4 流派 + 同一对话不同视角 | 🆕 核心增量 |
| **7 维度能力画像子指标** | V0.3 §8 只有 7 维度名字, 本 spec 补 28 子指标 | 🆕 扩展 |
| **商业化增量** | 5 档会员 (月/季/年/学生/公益) + 配额设计 + 单场成本测算 + 超配额按次付费 | 🆕 增补 V0.3 §10 |
| **内容边界** | 禁止高危议题 (自杀自伤/性创伤/重度精神障碍/人格障碍) + 实时风控 | 🆕 细化 V0.3 §11 |
| **降级策略** | text fallback / 语音限次 / 模型降级 / 高峰限流 | 🆕 V0.3 缺 |
| **排期 (V1.x 12 周)** | 长程个案 (W1-2) + 多流派督导 (W3-4) + 7 维度子指标 (W5-6) + 商业化配额 (W7-8) + 备考/B 端 (W9-12) | 🆕 刷新 V0.3 §17 |

### 1.2 Out of Scope (V0.3 spec 已覆盖, 本 spec 不重写)

- 整体架构 (V0.3 §3)
- AI 引擎 4 件套基础 (V0.3 §8) — 本 spec 只在 §5 增量
- 鉴权 / JWT / 多租户 (V0.3 §14)
- 数据模型基础 (V0.3 §13) — 本 spec 只在 §6 增量
- 鉴权 / observability / 性能预算 (V0.3 §14-16)
- 5 Tab 整体结构 (V0.3 §7) — counselor 5 Tab 在 V0.3 已写, 本 spec 不重复
- 模块清单 (V0.3 §4) — 本 spec 新增模块 (long-term-case / supervision / ability-dimension) 单独列

---

## 2. 产品定位 + 设计原则

### 2.1 产品定位

**「掌上咨询师训练室」** —— 让咨询师在没有真实个案的时候, 也能保持练习、积累手感、加速成长。

> 真实世界里, 从「考完证」到「第一次坐在督导对面接个案」之间, 没有任何低成本、高频率、随叫随到的练习方案。**我们填补这个空白**。

### 2.2 设计原则 (8 条, 跟产品设计 v1.0 §2.4 1:1)

1. **AI 优先, 趣味叠加**: AI 个性化训练为核心, 游戏化承担反馈层
2. **成长优先, 零压零罚**: 无失败评级 / 无对错批判 / 无红点强制
3. **纯私体验, 无社对比**: 全量训练数据本地加密, 无排行 / 无晒分
4. **低刺激弱反馈**: 动效 200-300ms, 避免高饱和色彩
5. **渐进解锁, 动态适配**: AI 判断解锁时机, 替代固定关卡门槛
6. **横向架构, 单手友好**: 核心组件复用横向卡片组
7. **千人千面, 用户可控**: 所有 AI 个性化模块可关闭 / 重置 / 锁定
8. **温和盈利, 基础免费**: 基础训练永久免费, 付费仅提供深度与效率增值

---

## 3. 用户分层 (5 阶段)

### 3.1 用户成长阶段模型

```
入门新手           进阶练习者           执业初期            成熟咨询师
(考证备考期)  →  (0-100 小时模拟)  →  (督导下接个案)  →  (独立执业)
   │                │                  │                  │
  需要: 理论+      需要: 基本功打磨+   需要: 预演+复盘+   需要: 新技术演练+
  初步模拟对话     不怯场             不擅长类型练习      困难对话演练
```

### 3.2 各阶段需求与产品匹配

| 用户阶段 | 核心痛点 | 产品对应功能 | 价值优先级 |
|----------|----------|--------------|----------|
| **考证备考期** | 案例分析题不会答、理论记不住 | 备考题库、考点背诵、模拟考试 | ★★★★★ |
| **入门新手 (0-50h)** | 第一次接真人会怯场、基本功不扎实 | 专项技能训练 L1-L2、全流程模拟 L1、基础督导 | ★★★★★ |
| **进阶练习者 (50-200h)** | 需要面对更复杂的来访者、长程场景 | **长程个案模拟** (本 spec §4.3) + L3 难度、**多流派督导** (本 spec §4.6) | ★★★★☆ |
| **执业初期 (督导下接个案)** | 需要预演下次咨询、复盘卡住的环节 | 困难场景库、逐句精析、预演模式 | ★★★★☆ |
| **成熟咨询师** | 新学流派需要练手、特殊对话需要演练 | 新流派场景包、对质/转介/结束咨询演练 | ★★★☆☆ |

### 3.3 冷启动策略 (V0.3 §17.1 拍板)

新用户通过「3 题基础问卷 + 1 次入门训练」快速判断所处阶段, **72 小时内基于训练行为数据完成画像迭代**。

---

## 4. 核心功能模块 (counselor-mode 增量, 跟 V0.3 §5-7 互补)

### 4.1 专项技能训练 (V0.3 §5 已写基础, 本 spec 增 L3)

- **倾听共情训练**: 3 模式 (情绪反射 / 事实-评判分离 / 无建议挑战) × 3 难度 (L1/L2/L3) × 2 模式 (文字/语音)
- **提问技术专项**: 封闭式转开放式 / 一次一问 / 聚焦话题 / 避免偏离
- **语音专项微训练**: 语速控制 120-140 字/分 + 语气平稳 + 开口破冰

> V0.3 §5 已有 Stage 1 placeholder; 本 spec **增量** L3 难度 (V0.3 只 L1/L2)

### 4.2 全流程模拟接诊 (V1.1 V0.5 client actual 重写, 2026-10-19)

> **跟 §4.1/§4.4/§4.5 关系**: §4.1 专项技能 / §4.2 全流程 / §4.4 话术 / §4.5 个案 4 大训练分类**全部进入同一个训练对话页**, 仅数据驱动差异。本节以「全流程模拟」为锚点, 描述 V0.5 client 已实装的 9 场景 + VisitorPreset 9 字段 + 5 状态机契约, 这些契约是 V1.x server 持久化的 ground truth。

#### 4.2.1 4 大训练分类 + 9 场景 (V0.5 client 已实装 5 场景, 4 场景待 V1.x server 接入)

| 分类 | 场景 id | 标题 | 难度 | 时长 | V0.5 client 状态 | V1.x server 状态 |
|---|---|---|---|---|---|---|
| 专项技能 | skill_listening | 倾听共情 · 情绪反射 | L1 | 10 min | 占位入口 | ⏳ V1.x W9-10 |
| 专项技能 | skill_questioning | 提问技术 · 封闭转开放 | L1 | 10 min | 占位入口 | ⏳ V1.x W9-10 |
| 专项技能 | skill_voice | 语音微训练 · 语速控制 | L1 | 10 min | 占位入口 | ⏳ V1.x W9-10 |
| **全流程** | **workplace** | 职场压力 · 初始访谈 | **L1** | **10 min** | ✅ V0.5 实装 | ⏳ V1.x W7-8 |
| **全流程** | **anxiety** | 焦虑发作 · 半夜惊醒 | **L1** | **10 min** | ✅ V0.5 实装 | ⏳ V1.x W7-8 |
| **全流程** | **grief** | 丧亲哀伤 | **L3** | **20 min** | ✅ V0.5 实装 | ⏳ V1.x W7-8 |
| **全流程** | **parenting** | 亲子沟通困难 | **L2** | **15 min** | ✅ V0.5 实装 | ⏳ V1.x W7-8 |
| **全流程** | **relationship** | 亲密关系冲突 | **L2** | **15 min** | ✅ V0.5 实装 | ⏳ V1.x W7-8 |
| 话术工坊 | script_polish | 一句话多版表达 | — | — | ✅ V0.5 P0-2 (单页, 不进对话页) | ⏳ V1.x W7-8 |
| 个案训练 | case_concept | 个案概念化 | L1 | 10 min | 占位入口 | ⏳ V1.x W9-10 |
| 个案训练 | case_ethics | 伦理边界 · 知情同意 | L1 | 10 min | 占位入口 | ⏳ V1.x W9-10 |

**5 场景 persona 详情 (V0.5 mock 池写死, V1.x server LLM 生成)**:

| scenarioId | persona 5 字段 (name/age/occupation/complaint/background) |
|---|---|
| **workplace** | 小林 / 28 / 程序员 / 新入职压力大 / 周末睡不好 |
| **anxiety** | 心跳快半夜醒 / 28 / 互联网 / 担心母亲身体 / 试过深呼吸但越想放松越紧张 |
| **grief** | 沉默防御 / — / — / 父亲去世没赶回去 (沉默多 3-5s) / 防御层级高 |
| **parenting** | 儿子青春期不沟通 / 45 / 母亲 / 跟儿子说话他不理 / 心里难受 |
| **relationship** | 亲密关系冲突 / 30 / — / 总是想翻他手机 / 觉得自己小心眼 |

#### 4.2.2 训练时长 (V1.1 修正, 跟原 v1.0 §4.2 不同)

**L1=10min / L2=15min / L3=20min** (单次短训练, 跟原 v1.0「标准 50 分钟初始咨询」不同)。

> **跟 V0.3 §5 / v1.0 §4.2 关系**: 原 v1.0 描述「标准 50 分钟初始咨询模拟」是产品 PRD 早期版本的设计, V0.5 client 落地时拆为 L1/L2/L3 三个时长档, 单次训练短 + 多次训练累计, 跟长程个案 4-12 次形成层次 (短训打基础 / 长训练进程)。
>
> **影响 §7.1 配额表**: 1 次全流程语音场 = 1 个语音场次配额 (跟 v1.0 一致, 不变)。单次时长缩短意味着用户更愿意高频训练, 月配额 12 场 → 实际训练时长 120-240 分钟, 跟 v1.0 50 min × 12 场 = 600 min 相比, 训练频率密度翻倍。

#### 4.2.3 VisitorPreset 9 字段 (V0.5 client API 契约, V1.x server 端持久化)

训练前置 `VisitorPresetPage` 全屏配置页 (iOS large title 风格), **9 字段**:

| 字段 | 类型 | 默认值 | API 契约 |
|---|---|---|---|
| 来访者风格 `visitorStyle` | enum 5 档: defensive / cooperative / resistant / avoidant / mixed | mixed | string enum, 跟 server 1:1 wire |
| 情绪基线 `emotionBaseline` | float 0.0-1.0 | 0.5 | float, 跟 server 1:1 wire |
| 防御层级 `defenseLevel` | float 0.0-1.0 | 0.5 | float, server 端 `_scenarioDefenseRange` validate |
| 训练模式 `mode` (V0.5 stage 2 新增, V2026-10-19 closeToReal 删除) | enum 2 档: useMySettings / fullyReal | useMySettings | string enum, **V1.x server 端 LLM 路由 key** |
| 风格变化度 `styleVariance` | enum 3 档: low / medium / high | medium | string enum, V1.x server 端 variance 算法 key |
| 情绪变化度 `emotionVariance` | enum 3 档: low / medium / high | medium | 同上 |
| 防御变化度 `defenseVariance` | enum 3 档: low / medium / high | medium | 同上 |
| 难度 `difficulty` | enum 3 档: l1 / l2 / l3 | 跟 scenario default | string enum, 跟 server 1:1 wire |
| 随机种子 `randomSeed` | string (YYYY-MM-DD-HH-mm-ss-{0-99}) | 自动生成 | string, V1.x server 持久化用于 reproducibility |

> **跟原 v1.0 §4.2 关系**: 原 v1.0 §4.2 没说 VisitorPreset 字段, V0.5 client 落地时新增, V1.1 spec 收口。`mode` + 3 `variance` + `randomSeed` 是 V0.5 stage 2 (大炮 2026-10-16 反馈「除了场景, 还可以设置来访者风格之类的」+「一定有个随机」+「完全真实模式不该让用户配下面的选项」1:1 落地) 的增量, 跟 server LLM 路由深度耦合。

#### 4.2.4 3 档训练 mode (V0.5 stage 2 A1 大炮 17:10 拍板, V1.x server LLM 路由)

| mode | 行为 (V0.5 client mock) | V1.x server LLM 路由 |
|---|---|---|
| `useMySettings` (按我设置) | 100% 按 3 维度设置, per-dim variance = 0 | server: 走 scripted 模板 + 严格按 preset 路由, 不调 LLM (适合专项训练 / 培训师演示) |
| ~~`closeToReal` (贴近真实, 默认)~~ | ~~80% 跟用户设置 + 20% Gaussian 随机 (σ=0.15)~~ | ~~server: 调 LLM, system prompt 含 preset 7 字段 + variance 标记~~ (V2026-10-19 删除, 大炮 "感觉是充数" 1:1 落地) |
| `fullyReal` (完全真实) | 100% AI 随机, 3 维度控件**全部隐藏** | server: 调 LLM, system prompt 仅含 persona 5 字段, 不传 preset |

> **跟原 v1.0 §4.2 关系**: 原 v1.0 描述「3 模式 (纯语音 / 语音+字幕 / 文字)」是产品 PRD 的 UI 输出通道, V0.5 client 落地时改名为 3 档**训练模式** (语义从「输出通道」 变成「AI 行为模式」), 跟语音/文字通道解耦。语音/文字通道属于 V0.3 voice 能力 (V0.3 §11 完整链路), 跟训练 mode 是正交概念。

#### 4.2.5 per-dim variance 算法 (V0.5 stage 2 B1 大炮 17:10 拍板, V1.x server 端实现)

3 档变化度 (low/medium/high) 决定 effective 值生成策略, **server 端持久化 preset 时不存 effective, 存 preset + randomSeed, runtime 算 effective**:

| variance | 连续维度 (emotionBaseline / defenseLevel) | 类别维度 (visitorStyle) |
|---|---|---|
| `low` | 0% 随机, 100% 跟用户 | 0% 切其它, 100% 保留 |
| `medium` (默认) | 20% 完全随机 (Uniform 0-1) + 80% Gaussian σ=0.15 围绕用户 | 20% 切到其它 4 类之一 |
| `high` | 50% 完全随机 + 50% Gaussian σ=0.3 | 50% 切到其它 |

**5 场景 defense 范围 clamp** (server 端 validate, V0.5 V2026-10-16 V4 治本续, 大炮「切合咨询场景」1:1 落地):

| scenarioId | defenseLevel 范围 |
|---|---|
| workplace | 0.2 - 0.8 |
| anxiety | 0.2 - 0.8 |
| grief | 0.4 - 0.9 |
| parenting | 0.3 - 0.9 |
| relationship | 0.3 - 0.9 |

#### 4.2.6 5 场景默认预设 (scenarioDefaultPresets, V0.5 写死, V1.x server 端 seed)

| scenarioId | visitorStyle | emotionBaseline | defenseLevel | difficulty |
|---|---|---|---|---|
| workplace | cooperative | 0.35 | 0.20 | L1 |
| anxiety | cooperative | 0.30 | 0.20 | L1 |
| grief | defensive | 0.20 | 0.50 | L3 |
| parenting | resistant | 0.25 | 0.40 | L2 |
| relationship | avoidant | 0.20 | 0.40 | L2 |

> server 启动时初始化, client 调 `GET /training/scenarios/:id/default-preset` 拿 (V0.5 client 用本地表, V1.x server 接管)。注意 V0.5 client 7 字段 preset + 9 字段 (含 randomSeed) — randomSeed 由 client 生成, server 不强校验, 仅作为 reproducibility 元数据。

#### 4.2.7 5 状态机 (TrainingSessionStatus, V0.5 client UI + V1.x server API 1:1 wire)

| 状态 | label | UI 表现 (V0.5) | server 端语义 (V1.x) |
|---|---|---|---|
| `idle` | 待开始 | 中央 VoiceOrb 静态呼吸 | session 创建后, 等待 client 调 start |
| `listening` | 正在倾听 | VoiceOrb 红色脉动 + ASR partial 显示 | client 调 voice.start, server 返 ASR token stream |
| `thinking` | 来访者思考中 | VoiceOrb 暗色 + 3 圆点跳动 | client 调 send_text, server 调 LLM 思考中 |
| `speaking` | 来访者说话中 | VoiceOrb 彩虹 + TTS 播放 | server TTS stream, client 播放 |
| `finished` | 已结束 | 跳转督导列表 | session 关闭, 异步派发 BullMQ 督导生成 |

> **V0.3 §13 baseline status 区别**: V0.3 §13 TrainingSession status (active/paused/completed/abandoned) 是 server 端**会话生命周期**语义, V0.5 stage 2 5 状态机是 client 端**对话 UI 状态**, 两个正交概念。V1.x server 端需要在 PATCH /training/sessions/:id API 支持 5 状态机流转, 同时保留 V0.3 §13 的 server-side 4 态。

#### 4.2.8 V0.5 stage 简化清单 (10 项 mock 占位, V1.x server 续做)

> V0.5 client 5 状态机 + 5 widget + 17 event + Repository mock 池完整, 但 11 项是 mock 占位, V1.x server 端接通后 client 解除:

| # | mock 占位 | V0.5 client 状态 | V1.x server 接管点 |
|---|---|---|---|
| 1 | voice/voice_session_bloc 未联通 | `VoiceStart` event 只 emit status, 不调录音/ASR API | W1-2 接 NestJS `/voice/asr-token` + WebSocket |
| 2 | LLMClient 未接 | 5 场景 pre-scripted 3 句 + 3 句 fallback | W3-4 接 LLM 路由 (4 厂 DeepSeek/Doubao/Qwen/Custom) |
| 3 | TtsProxyClient 未接 | 1500ms delay 模拟 TTS 播放 | W1-2 接 NestJS `/voice/tts-proxy` WSS |
| 4 | crisis_detector 未接 | 训练页无高危语义检测 | W3-4 接 crisis_pipeline (跟 V0.3 §10 危机三级响应串联) |
| 5 | bubble 列表 UI 未实装 | ChatMessage transcript 数组在 state, UI 仅 VoiceOrb 全屏沉浸 | W7-8 UI 补气泡列表 + typing indicator 200ms 滑入 |
| 6 | ASR partial 未显示 | state.voicePartial 字段在, top bar 没渲染 | W7-8 UI 补 partial 显示 |
| 7 | InterruptVisitor task_cancel 未发 | emit status=idle, 不调 TtsProxyClient.cancel() | W1-2 TTS proxy 通路接通时补 |
| 8 | 计时到时 TimeUp 未自动触发 | Timer.periodic 在, 但不派发 TimeUp | W7-8 接通 time_up 事件链 |
| 9 | 顶部「非真实咨询」提示 | 未实装 (跟 V0.3 §10 合规 1:1 wire) | W11-12 体验打磨 |
| 10 | 督导报告 sessionId 关联 | 退出跳督导列表是固定 3 条 mock, 不关联 sessionId | W3-4 多流派督导 (本 spec §4.6) 接通时联调 |
| 11 | 督导流派切换器 | 督导详情页**无**流派切换器 (4 流派 CBT/精神动力学/人本/家庭治疗) | **W3-4 多流派督导核心** (本 spec §4.6 核心增量) |

> **影响 §8 排期**: V0.5 client 已实装 §4.2 的 UI 框架 (5 状态机 + 5 widget + Repository mock), V1.x server 主要补 backend 数据层 (1/2/3/4/11 项), 不重复 UI 工作。

#### 4.2.9 跟原 v1.0 §4.2 差异摘要

| 项 | v1.0 设计 | V0.5 client actual (V1.1 更新) |
|---|---|---|
| 训练时长 | 标准 50 分钟初始咨询 | **L1=10 / L2=15 / L3=20 min** (单次短训, 多次累计) |
| 训练模式 | 纯语音 / 语音+字幕 / 文字 (3 输出通道) | **按我设置 / 贴近真实 / 完全真实** (3 档 AI 行为, 跟语音/文字通道正交) |
| 场景库 | 5 类 (职场压力/适应障碍/人际冲突/亲子沟通/伦理边界) | **9 场景 4 大分类**, 5 场景实装 + 4 场景占位 |
| 难度差异 | L1 配合度高 / L2 有回避 / L3 防御/质疑/沉默 | L1=10 / L2=15 / L3=20 min + per-dim variance 算法 |
| 新手辅助 | 阶段提示 / 暂停查资料 | 未实装 (V0.5 简化, V1.x W11-12 体验打磨) |
| 状态机 | (v1.0 §4.2 没说, 跟 §5 / §16 互补) | **5 状态机** (idle/listening/thinking/speaking/finished), 跟 server 1:1 wire |
| VisitorPreset | (v1.0 §4.2 没说) | **9 字段** (3 维度 + 3 mode + 3 variance + difficulty + randomSeed) |
| 5 场景 persona | (v1.0 §4.2 没说) | 5 场景 persona 详情 (workplace/小林/28/程序员/...) |
| 防御范围约束 | (v1.0 §4.2 没说) | 5 场景 _scenarioDefenseRange (workplace 0.2-0.8 / grief 0.4-0.9) |
| per-dim variance | (v1.0 §4.2 没说) | 3 档 variance 算法 (low/medium/high, 连续+类别维度) |

### 4.3 长程个案模拟 (🆕 核心增量, V0.3 不覆盖)

**设计目标**: 模拟 4-12 次连续咨询, 来访者随咨询进展产生真实变化。

**来访者 Agent 长程一致性要求**:

| 一致性 | 实现 | 备注 |
|--------|------|------|
| 跨会话记忆 | session_id → 上一次 context (情绪/话题/技术使用) | 数据模型 `long_term_case_session` |
| 变化曲线 | 好转 → 反复 → 突破 → 稳定, 符合真实咨询进程 | AI prompt engineering |
| 移情反应 | 对咨询师产生正面/负面情绪, 不只是「工具人」 | LLM 生成 |
| 阻抗表现 | 沉默、迟到 (突然回避话题)、话题岔开 | 行为模式模板 |
| 脱落风险 | 咨询师表现不佳, 来访者可能「结束咨询」 | 概率触发 |

**预设长程个案类型** (V0.x 5 类, 后面可扩展):

| 个案类型 | 次数 | 核心议题 |
|----------|------|----------|
| 职场适应障碍 | 6 次 | 工作压力 / 职业倦怠 / 自我怀疑 |
| 亲密关系冲突 | 8 次 | 沟通模式 / 依恋创伤 / 信任问题 |
| 亲子沟通困难 | 8 次 | 青春期对抗 / 教养方式 / 边界 |
| 丧亲哀伤 | 6 次 | 哀伤过程 / 情绪接纳 / 意义重建 |
| 焦虑发作 | 10 次 | 认知重构 / 暴露练习 / 复发预防 |

### 4.4 话术工坊 (V0.3 §5 partial)

- 一句话多版优化 (基础共情 / 深度共情 / 简洁 / 探索, 附逻辑讲解)
- 场景化话术库 (按咨询阶段 + 问题类型分类, 支持搜索)
- 话术变形训练 (安慰转共情 / 质问转中立 / 封闭转开放)
- 语音示范 (每条话术配专业咨询师语音示范, 支持跟读)

### 4.5 个案概念化训练 (V0.3 §5 partial)

- 逐步披露式玩法 (从主诉开始, 通过提问收集信息, 最终完成分析)
- 标准化表单 (主诉 / 现病史 / 成长史 / 评估 / 干预思路)
- AI 评分 (对比标准分析, 给出得分、遗漏点提醒、过度解读警示)
- 个案通关树 (从简单到复杂案例逐层解锁)

### 4.6 多流派督导系统 (🆕 核心增量, V0.3 §8 单流派 supervisor 不覆盖)

> **这是产品从「新手玩具」升级为「全职业周期工具」的关键**。

**问题背景**: 新手阶段 AI 督导只需要识别「打断了」「给建议了」这类初级错误。但练到 200 小时后, 用户需要更微妙的反馈——而不同流派的督导, 关注的东西完全不同。

**多流派督导设计**:

| 督导流派 | 关注重点 | 典型反馈示例 |
|----------|----------|--------------|
| **CBT 督导** | 认知扭曲 / 自动思维 / 行为激活 / 家庭作业 | 「你在这里没有追踪来访者的自动化思维, 来访者说『我什么都做不好』时, 你应该追问支持这个想法的证据」 |
| **精神动力学督导** | 移情 / 反移情 / 防御机制 / 早期关系模式 | 「来访者这次突然夸你, 这可能是正向移情, 你需要识别而不是接受赞美」 |
| **人本督导** | 共情一致性 / 无条件积极关注 / 真诚 | 「你的回应看起来在共情, 但来访者可能感受到你在使用技术而不是真的在听」 |
| **家庭治疗督导** | 家庭结构 / 边界 / 三角关系 / 代际模式 | 「你只听了妈妈说, 没有邀请爸爸发言, 可能错过了家庭系统的关键信息」 |

**实现方式**:
- 用户可选择本次训练使用哪个流派的督导视角
- 同一对话, 不同流派督导给出**完全不同**的反馈
- 高级会员可解锁**多流派对比模式** (一次训练收到 2-3 个流派的不同视角)

**督导反馈精度演进路线**:
```
初级 (0-50h):  识别 20+ 类新手典型错误
  ↓
中级 (50-200h): 识别微妙过程问题 (时机 / 深度 / 节奏)
  ↓
高级 (200h+): 个案概念化层面反馈 + 流派特异性指导
```

### 4.7 备考专项训练 (V0.3 §5 partial)

- 历年真题案例库 (按考试年份分类, 限时答题, AI 按官方标准评分)
- 考点背诵 (高频考点碎片化打卡, 支持语音听题)
- 模拟考试 (按考试题型 / 题量 / 时长生成模拟卷, 自动判分 + 解析)
- 冲刺包 (考前押题卷 / 高频考点汇总 / 案例分析答题模板)

---

## 5. AI 智能引擎 (counselor-mode 增量, V0.3 §8 基础 + 7 维度子指标)

### 5.1 7 维度能力画像 (28 子指标, V0.3 §8 只有 7 维度名字)

| 维度 | 子指标 (V0.3 缺, 本 spec 补) |
|------|------------------------------|
| **基础技能** | 倾听准确率、共情精准度、提问开放度、边界意识、打断频次 (5) |
| **专业知识** | 个案概念化能力、症状识别准确度、伦理规范掌握度 (3) |
| **语音表现** | 平均语速、语气平稳度、情绪匹配度、沉默应对能力 (4) |
| **备考需求** | 目标考试等级、备考周期、薄弱考点、刷题进度 (4) |
| **练习习惯** | 使用时段、单次练习时长、偏好训练类型、完成率 (4) |
| **错误类型** | 高频踩坑类型、错误重复率、薄弱技能项 (3) |
| **游戏化偏好** | 趣味元素接受度、动效强度偏好、解锁节奏偏好 (3) |
| **共 7 维度 28 子指标** | |

### 5.2 双 Agent 对话体系 (V0.3 §8 单 Agent 升级)

#### 来访者模拟 Agent (V0.3 §8 supervisor 升级, 跟 LLM 链路 1 共用)

- 能力分层: 固定脚本版 (入门) → 动态生成版 (进阶) → 人格化长程版 (挑战) — V0.3 只有第 1 层
- 核心约束: 不自我分析 / 不主动吐露全部信息 / 会防御回避 / 情绪反应符合人设
- 语音控制: 输出语速、语调、情绪标签, 驱动 TTS 生成对应语气语音
- 非语言表现: 自动插入停顿、叹气、哽咽、沉默等真实对话表现
- 打断反应: 被打断时根据人设做出不同反应 (停顿 / 继续 / 不悦)
- **长程记忆** (🆕 §4.3): 跨会话保持角色一致性

#### 督导评估 Agent (V0.3 §8 supervisor 升级 → 4 流派)

- 评估维度 (V0.3 §8 6 维度): 倾听 / 共情 / 提问 / 边界 / 语音专业度 / 个案概念化
- 错误识别: 内置错误库, 逐句精准识别
- 反馈原则: 只评价回应技术, 不评判个人; 先肯定亮点, 再提改进建议
- 输出结构: 整体评分 + 逐句标注 + 错误分类汇总 + 成长建议
- **多流派视角** (🆕 §4.6): CBT/精神动力学/人本/家庭治疗 4 流派

### 5.3 智能推荐 + 动态解锁 (V0.3 §8 增量)

- 推荐架构: 召回 → 粗排 → 精排 → 重排 (协同过滤 + 专业匹配 + 强化学习 + 游戏化匹配)
- 动态解锁: AI 综合判断需求强度 (40%) / 训练深度 (25%) / 提升效果 (20%) / 能力准备度 (15%)
- 所有推荐标注「智能推荐」, 可查看推荐理由, 可「不感兴趣」

---

## 6. 数据模型增量 (V0.3 §13 加新表, 不删旧表)

### 6.1 long_term_case + long_term_case_session (🆕 4-12 次长程)

```typescript
// V0.3 §13 + 本 spec §6.1 增量
@Entity('long_term_cases')
export class LongTermCase {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'tenant_id' }) tenantId!: string;
  @Column({ type: 'char', length: 36, name: 'user_id' }) userId!: string;
  @Column({ type: 'varchar', length: 100 }) caseType!: string; // 5 预设: workplace/relationship/parenting/grief/anxiety
  @Column({ type: 'varchar', length: 200 }) title!: string;
  @Column({ type: 'json' }) config!: {
    totalSessions: number;       // 4-12
    currentSession: number;      // 1-based
    visitorPersona: object;      // 来访者人设
    progressCurve: string;       // 好转/反复/突破/稳定
  };
  @Column({ type: 'enum', enum: LongTermCaseStatus, default: LongTermCaseStatus.Active })
  status!: LongTermCaseStatus;  // Active/Completed/Abandoned
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}

@Entity('long_term_case_sessions')
export class LongTermCaseSession {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'case_id' }) caseId!: string;
  @Column({ type: 'int' }) sessionNumber!: number;  // 1-based
  @Column({ type: 'json' }) transcript!: Array<{ role: 'counselor' | 'visitor'; content: string; ts: number }>;
  @Column({ type: 'json', nullable: true }) supervisionFeedback!: object;
  @Column({ type: 'int', nullable: true, name: 'overall_score' }) overallScore!: number | null;
  @Column({ type: 'json', nullable: true, name: 'next_session_context' }) nextSessionContext!: object | null;  // 🆕 跨会话 memory
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
```

### 6.2 supervision_school + supervision_feedback (🆕 4 流派)

```typescript
@Entity('supervision_schools')
export class SupervisionSchool {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 50, unique: true }) code!: string;
  // 4 值: 'cbt' / 'psychoanalytic' / 'person-centered' / 'family-therapy'
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'json' }) focusAreas!: string[];  // 关注重点
  @Column({ type: 'json' }) exampleFeedback!: string[];  // 典型反馈示例
  @Column({ type: 'varchar', length: 20, default: 'active' }) status!: string;
}

@Entity('supervision_feedback')
export class SupervisionFeedback {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'session_id' }) sessionId!: string;  // 长程/全流程 session
  @Column({ type: 'char', length: 36, name: 'school_id' }) schoolId!: string;  // 哪个流派
  @Column({ type: 'json' }) feedback!: {
    overallScore: number;
    perSentence: Array<{ sentence: string; score: number; comment: string }>;
    errorCategories: string[];
    growthSuggestion: string;
  };
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
```

### 6.3 ability_dimension + ability_score (🆕 7 维度 28 子指标)

```typescript
@Entity('ability_dimensions')
export class AbilityDimension {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'tenant_id' }) tenantId!: string;
  @Column({ type: 'varchar', length: 50 }) parentDimension!: string;  // 7 维度名
  @Column({ type: 'varchar', length: 100, unique: true }) subIndicatorCode!: string;  // 28 子指标 code
  @Column({ type: 'varchar', length: 200 }) subIndicatorName!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
}

@Entity('ability_scores')
export class AbilityScore {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'user_id' }) userId!: string;
  @Column({ type: 'char', length: 36, name: 'dimension_id' }) dimensionId!: string;
  @Column({ type: 'int' }) score!: number;  // 0-100
  @Column({ type: 'json' }) evidence!: object;  // 来源 session_id 列表
  @Column({ type: 'varchar', length: 20, default: 'cloud' }) source!: string;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
```

### 6.4 quota_usage (🆕 商业化配额追踪)

```typescript
@Entity('quota_usage')
export class QuotaUsage {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'user_id' }) userId!: string;
  @Column({ type: 'varchar', length: 20 }) quotaType!: string;  // 'voice_session' / 'long_term_case' / 'voice_analysis'
  @Column({ type: 'int' }) used!: number;
  @Column({ type: 'int' }) limit!: number;
  @Column({ type: 'varchar', length: 7 }) periodStart!: string;  // YYYY-MM
  @Column({ type: 'varchar', length: 7 }) periodEnd!: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
```

---

### 6.5 training_session (V1.1 新增, 9 场景单次训练 session 持久化)

> V0.5 client 用 `MockTrainingSessionRepository` 在客户端内存模拟 session, V1.x server 端持久化。跟 §6.1 long_term_case_session 1:1 wire (transcript ChatMessage shape 复用), 跟 V0.3 §13 TrainingSession baseline 0 破坏。

```typescript
// V1.x server 端 entity, 跟 V0.5 client `TrainingSession` 1:1 wire
@Entity('training_sessions')
export class TrainingSession {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'char', length: 36, name: 'tenant_id' }) tenantId!: string;
  @Column({ type: 'char', length: 36, name: 'user_id' }) userId!: string;

  // 场景元数据 (跟 V0.5 client 1:1 wire)
  @Column({ type: 'varchar', length: 50, name: 'scenario_id' }) scenarioId!: string;
  // 11 值: skill_listening / skill_questioning / skill_voice / workplace / anxiety /
  //        grief / parenting / relationship / script_polish / case_concept / case_ethics
  @Column({ type: 'varchar', length: 20 }) difficulty!: string;  // L1/L2/L3
  @Column({ type: 'int', name: 'duration_minutes' }) durationMinutes!: number;

  // 5 状态机 (跟 V0.5 client TrainingSessionStatus enum 1:1 wire)
  @Column({ type: 'enum', enum: TrainingSessionStatus, default: TrainingSessionStatus.Idle })
  status!: TrainingSessionStatus;
  // 5 值: Idle/Listening/Thinking/Speaking/Finished

  // 来访者 persona 5 字段 (跟 V0.5 client 1:1 wire)
  @Column({ type: 'varchar', length: 100, name: 'persona_name' }) personaName!: string;
  @Column({ type: 'int', name: 'persona_age' }) personaAge!: number;
  @Column({ type: 'varchar', length: 200, name: 'persona_occupation' }) personaOccupation!: string;
  @Column({ type: 'text', name: 'persona_complaint' }) personaComplaint!: string;
  @Column({ type: 'text', name: 'persona_background' }) personaBackground!: string;

  // VisitorPreset 6 字段 (V0.5 client 1:1 wire, V1.x 持久化)
  @Column({ type: 'enum', enum: VisitorStyle, name: 'visitor_style' })
  visitorStyle!: VisitorStyle;
  // 5 值: Defensive/Cooperative/Resistant/Avoidant/Mixed
  @Column({ type: 'float', name: 'emotion_baseline' }) emotionBaseline!: number;  // 0-1
  @Column({ type: 'float', name: 'defense_level' }) defenseLevel!: number;  // 0-1, clamp 到 _scenarioDefenseRange
  @Column({ type: 'varchar', length: 50, name: 'random_seed' }) randomSeed!: string;  // YYYY-MM-DD-HH-mm-ss-{0-99}

  // 训练模式 + 3 档 variance (V0.5 stage 2 新增, V1.1 spec 收口)
  @Column({ type: 'enum', enum: VisitorMode }) mode!: VisitorMode;
  // 2 值: UseMySettings/FullyReal (V2026-10-19 closeToReal 删除, 大炮 14:08 1:1 落地)
  @Column({ type: 'enum', enum: DimensionVariance, name: 'style_variance' }) styleVariance!: DimensionVariance;
  @Column({ type: 'enum', enum: DimensionVariance, name: 'emotion_variance' }) emotionVariance!: DimensionVariance;
  @Column({ type: 'enum', enum: DimensionVariance, name: 'defense_variance' }) defenseVariance!: DimensionVariance;
  // 3 值 × 3 = Low/Medium/High

  // 对话 transcript (跟 §6.1 long_term_case_session.transcript 1:1 wire)
  @Column({ type: 'json' }) transcript!: Array<{
    id: string;
    role: 'counselor' | 'visitor' | 'system';
    text: string;
    timestamp: number;  // ms
  }>;

  // 督导报告关联 (V0.5 mock 跳固定 3 条, V1.x 真接)
  @Column({ type: 'char', length: 36, name: 'supervision_report_id', nullable: true })
  supervisionReportId!: string | null;

  // 时间戳
  @Column({ type: 'datetime', name: 'started_at', nullable: true }) startedAt!: Date | null;
  @Column({ type: 'datetime', name: 'ended_at', nullable: true }) endedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
```

**6 个 enum 类型 (跟 V0.5 client 1:1 wire)**:

```typescript
// V1.x server 端 enum, 跟 V0.5 client 1:1 wire
export enum TrainingSessionStatus { Idle, Listening, Thinking, Speaking, Finished }
export enum VisitorStyle { Defensive, Cooperative, Resistant, Avoidant, Mixed }
export enum VisitorMode { UseMySettings, FullyReal }
export enum DimensionVariance { Low, Medium, High }
export enum TrainingDifficulty { L1, L2, L3 }
```

**Repository 关键 API (V1.x server 端)**:

| API | 用途 | 跟 V0.5 client 1:1 wire |
|---|---|---|
| `POST /training/sessions` | 创建 session (从 scenario + preset) | 跟 `MockTrainingSessionRepository.createMock` 1:1 wire |
| `GET /training/sessions/:id` | 拉取 session 详情 |  |
| `PATCH /training/sessions/:id` | 更新 status / transcript (5 状态机流转) | 跟 `TrainingSessionBloc` 17 event 1:1 wire |
| `POST /training/sessions/:id/finish` | 关闭 session + 异步派发 BullMQ 督导生成 | 跟 `FinishSession` event 1:1 wire |
| `GET /training/scenarios/:id/default-preset` | 拉取 5 场景默认 preset | 跟 `scenarioDefaultPresets` 1:1 wire |
| `GET /training/scenarios` | 拉取 9 场景元数据 (含 defense 范围 / persona 5 字段) |  |

**跟 V0.5 client 1:1 wire 验证 (V2026-10-19)**:
- V0.5 `MockTrainingSessionRepository.createMock` 返 `TrainingSession` 字段已 1:1 wire 上表
- V0.5 `VisitorPreset` 9 字段 (3 维度 + 3 mode + 3 variance + difficulty + randomSeed) 1:1 wire 上表
- V0.5 `ChatMessage` 5 字段 (id/role/text/timestamp/isTyping) 1:1 wire transcript
- V0.5 `TrainingSessionStatus` 5 态 enum 1:1 wire
- V0.5 `VisitorStyle` 5 档 1:1 wire
- V0.5 `VisitorMode` 3 档 1:1 wire
- V0.5 `DimensionVariance` 3 档 1:1 wire

---

## 7. 商业化 (V0.3 §10 增补, 跟 V0.3 5 档 + 4 SKU 兼容)

### 7.1 5 档会员 (V0.3 §10.2 5 档 + 本 spec 加价格 + 配额)

| 档位 | 价格 | 配额 (V0.3 缺, 本 spec 补) |
|------|------|----------------------------|
| **none** | 免费 | 文字训练不限 / 语音每日 1 场 / 模拟全流程每日 1 次 / 长程个案不可用 / 难度 L1-L2 / 备考每日 5 题 |
| **monthly (月卡)** | 29 元/月 | 文字不限 / 语音 12 场/月 / 长程 2 个/月 / 全流派 + 逐句精析 / L1-L3 / 备考全量 + 无限模考 |
| **quarterly (季卡)** | 69 元/季 | 同 monthly |
| **yearly (年卡, 推荐)** | 198 元/年 | 同 monthly + 语音专项分析 4 次/月 + 高阶游戏化模块 + 限定皮肤 |
| **lifetime** | 999 元 (V0.3 已写) | 无限 |
| **学生认证** | 月卡/年卡半价 | 同档位 |
| **公益名额** | 0 元 (限量) | 同 yearly |

### 7.2 配额设计原则

- **文字模式放开**: 成本可控, 作为免费用户核心留存手段
- **语音模式限量**: 按月度配额发放, 超出后按次付费
- **新手引导保护**: 注册初期赠送体验额度, 确保新用户感受产品核心价值
- **不搞无限次**: 即使会员也有限制, 控制边际成本 + 制造稀缺感

### 7.3 配额消耗规则

- 全流程语音 1 场 = 1 个语音场次配额
- 长程个案 1 次会话 = 0.5 个语音场次 (单次 20-25 分钟)
- 长程个案完整 6 次 = 3 个语音场次
- 文字模式不消耗配额
- 月底清零, 不累积

### 7.4 超配额后按次付费

| 项目 | 会员价 | 非会员价 |
|------|--------|----------|
| 全流程语音加场 | 3 元/场 | 8 元/场 |
| 长程个案加购包 (5 次会话) | 10 元 | 20 元 |
| 语音专项分析加购 | 2 元/次 | 5 元/次 |
| 1v1 深度督导报告解读 | 15.9 元/次 | 29.9 元/次 |
| 备考冲刺包 | 29.9 元/套 | 39.9 元/套 |
| 个案模板大全 | 6.9 元/份 | 9.9 元/份 |

### 7.5 成本测算 (单场语音全流程, 跟 V0.3 §0 mock 区分)

| 成本项 | 估算 |
|--------|------|
| ASR (用户语音输入 20 分钟) | ~0.8 元 |
| TTS (来访者语音输出 30 分钟) | ~1 元 |
| LLM 双 Agent 对话 + 督导分析 | ~1-3 元 |
| **合计单场** | **~3-5 元** |

> 会员月均 12 场全流程 + 长程个案折算 ~8 场 = ~20 场语音/月, **月成本约 60-100 元, 年成本约 720-1200 元**。
> 通过缓存优化 / 模型降级 / 高峰期限流可进一步压低。
> 198 元年卡定位为「获客入口」而非利润中心, 主要盈利靠超配额按次付费 + B 端合作。

### 7.6 新手保护

| 赠送项 | 数量 | 目的 |
|--------|------|------|
| 全流程语音体验 | 前 7 天内 5 次 | 让新手第一周摸到核心价值 |
| 长程个案试读 | 1 个个案的前 2 次会话 | 体验长程后决定是否开通会员 |
| L1 新手强制 | 前 5 次训练 | 配合度高的来访者, 避免第一次被打击 |

---

## 8. 排期 (V1.x 12 周, 4 阶段, 跟 V0.3 §17.2 W9-12 对齐 + 扩展)

### 8.1 V1.x 4 阶段 10 周 MVP+

| 阶段 | 周 | 内容 | 关键交付 |
|------|-----|------|----------|
| **W1-2 长程个案** | 2 周 | 4-12 次长程 sessions + 跨会话 agent memory + 来访者人设 | `long_term_case` + `long_term_case_session` entity + 5 预设个案类型上线 |
| **W3-4 多流派督导** | 2 周 | CBT/精神动力学/人本/家庭治疗 4 流派 + 反馈 prompt 工程 | `supervision_school` + `supervision_feedback` entity + LLM prompt 模板 |
| **W5-6 7 维度子指标** | 2 周 | 28 子指标采集 + 雷达图渲染 + 动态推荐 | `ability_dimension` + `ability_score` entity + 7 维度画像 API |
| **W7-8 商业化 + 降级** | 2 周 | 5 档会员 (29/69/198) + 配额设计 + ASR/TTS 降级 + 文字 fallback | `quota_usage` entity + 支付集成 (VS-5 待大炮申请) + text fallback |
| **W9-10 备考 + B 端** | 2 周 | 历年真题 + 模拟考试 + B 端 (机构/高校/协会) 探索 | 真题库 + 模考引擎 + B 端 SKU 设计 (Q9 V1.x) |
| **W11-12 调优 + 验收** | 2 周 | 12 维 KPI (体验/AI/业务/合规) 验收 + 等保备案 + 性能压测 | 4 类 12 指标 dashboard + 等保二级备案 |

### 8.2 V2.x 远期 (post MVP+, 不在本 spec)

- B 端服务体系 (机构/高校/协会) — V0.3 §17.3 Q9 拍板
- 多租户管理后台
- AI 教练角色 (虚拟督导)
- 5 类循证训练全部接入 (倾听共情/提问/语音微/全流程/个案概念化/备考)
- 游戏化 4 增强 (通关树/徽章墙/错题闯关/晋级赛)
- 全平台 native (iOS/Android/Web/小程序)

---

## 9. ADR 引用 (V0.3 §0 + 本 spec 新增)

| ADR | 状态 | 跟本 spec 关系 |
|-----|------|----------------|
| [0001-jwt-vs-cookie-session.md](../adr/0001-jwt-vs-cookie-session.md) | ✅ Accepted | 鉴权基础, counselor-mode 走相同 JWT |
| [0002-async-audit-log-via-bullmq.md](../adr/0002-async-audit-log-via-bullmq.md) | ✅ Accepted | 训练会话审计, 长程 session 审计走相同 queue |
| [0003-typeorm-migration-replace-synchronize.md](../adr/0003-typeorm-migration-replace-synchronize.md) | ✅ Accepted | 新增 5 entity (long_term_case / supervision / ability / quota) 走 migration |
| **ADR-0004-multi-school-supervision** (待写) | ⏳ V1.x W3-4 | 4 流派督导架构决策 (prompt 模板 vs fine-tune) |
| **ADR-0005-long-term-case-memory** (待写) | ⏳ V1.x W1-2 | 长程 agent memory 存储策略 (DB vs vector store) |

---

## 10. Changelog (v1.1)

| 版本 | 日期 | 变更 |
|------|------|------|
| **v1.1** | 2026-10-19 | 整合 xin_su_app V0.5 client actual (V0.5 stage 2 + V2026-10-16 治本续 V5 race fix) → §4.2 全流程模拟接诊 + §6.5 training_session 数据模型 + §1.1 In Scope 重写<br>- **§1.1**: 新增「单次训练 session」模块行 (9 场景单次训练 session 持久化 + 5 状态机 API + VisitorPreset 9 字段持久化 + 3 档训练 mode 路由)<br>- **§4.2.1**: 4 大训练分类 + 9 场景分类表 (5 场景实装 + 4 场景占位), 5 场景 persona 5 字段详情<br>- **§4.2.2**: 训练时长 **L1=10 / L2=15 / L3=20 min** (修正 v1.0「50 分钟」, 单次短训 + 多次累计)<br>- **§4.2.3**: **VisitorPreset 9 字段契约** (3 维度 + 3 mode + 3 variance + difficulty + randomSeed), V0.5 client API 1:1 wire<br>- **§4.2.4**: **3 档训练 mode** (useMySettings/closeToReal/fullyReal) → **V2026-10-19 closeToReal 删除 → 2 档** (useMySettings/fullyReal), 大炮 "感觉是充数" 1:1 反馈 + "删干净一点" 1:1 落地, V0.5 client enum 1:1 wire 同步删除<br>- **§4.2.5**: **per-dim variance 算法** + 5 场景 _scenarioDefenseRange (workplace 0.2-0.8 / grief 0.4-0.9)<br>- **§4.2.6**: 5 场景默认预设 `scenarioDefaultPresets` (V0.5 写死, V1.x server 端 seed)<br>- **§4.2.7**: **5 状态机 TrainingSessionStatus** (idle/listening/thinking/speaking/finished, 跟 V0.5 client 1:1 wire, 跟 V0.3 §13 baseline 4 态正交)<br>- **§4.2.8**: **V0.5 stage 简化清单 11 项** mock 占位 (未接 voice/LLM/TTS/crisis_detector/bubble 列表/ASR partial/task_cancel/TimeUp/顶部提示/sessionId 关联/督导流派切换器), 标注 V1.x server 接管点 + 排期映射<br>- **§4.2.9**: 跟原 v1.0 §4.2 差异摘要表 (10 项)<br>- **§6.5**: **training_session entity 新增** (9 场景单次训练 session 持久化, 跟 §6.1 long_term_case_session.transcript 1:1 wire, 跟 V0.3 §13 baseline 0 破坏), 5 个 enum (TrainingSessionStatus/VisitorStyle/**VisitorMode 2 档**/DimensionVariance/TrainingDifficulty) 跟 V0.5 client 1:1 wire, 6 个 Repository API 契约<br>- **跟 V0.3 spec 关系**: V0.3 spec 维持不变, 本 spec v1.1 仅覆盖 counselor-mode §4.2 全流程 + §6.5 数据增量, 0 破坏 V0.3 基础; V0.3 §13 TrainingSession baseline status 跟 V0.5 5 状态机正交, V1.x server API 双轨支持 |
| **v1.0** | 2026-10-15 | 整合产品设计文档 v1.0 (53KB, 14 章) → dev spec 转换<br>- §4 核心功能模块: 7 块 (含 2 块核心增量: 长程个案 §4.3 + 多流派督导 §4.6)<br>- §5 AI 智能引擎: 7 维度 28 子指标 + 双 Agent + 多流派督导<br>- §6 数据模型增量: 4 块新 entity (long_term_case + supervision_school + ability_dimension + quota_usage)<br>- §7 商业化: 5 档会员 (29/69/198) + 配额设计 + 单场成本测算 3-5 元<br>- §8 排期: V1.x 4 阶段 10 周 (W1-12)<br>- §9 ADR: 引用 0001-0003 + 2 待写 (0004 多流派 / 0005 长程 memory)<br>**跟 V0.3 spec 关系**: V0.3 spec 维持「心塑 App 整体 + V0.x 训练」基线, 本 spec 覆盖 counselor-mode 增量 (V0.3 §21 Changelog 加 v0.3.1 行交叉引用) |

---

**END OF SPEC counselor-mode-v1.0**
