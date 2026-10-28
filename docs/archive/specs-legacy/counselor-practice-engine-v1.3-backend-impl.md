# 微技能自由练习引擎 v1.3 · 后端落地说明 (mofang-nestjs)

> **对应规格**: `docs/specs/counselor-practice-engine-v1.3-freeform.md` (v1.3, 2026-10-22)
> **落地日期**: 2026-10-22
> **落地范围**: 后端 (spec §2 表结构 / §3 API 契约 / §5 分期 P0-P3 / §6 硬约束)
> **前端**: 本次**不涉及** `xin_su_app`; 客户端已有 Dart model + Repository 接口 + mock 兜底, 本文档的契约与客户端既有命名逐字段对齐

---

## 0. 一句话

把「10 道 MCQ」升级成「10 个练习间 × 6 个独立来访者场景」: 新增 2 张表、60 条场景内容库、5 个 REST 端点、1 套「LLM 主路径 + 确定性降级 + 零压红线守门」的评判引擎, **0 改动** v1.2 已落地的 MCQ 体系.

---

## 1. 交付物清单

### 1.1 枚举 (6 个新文件)

| 文件 | 内容 |
|---|---|
| `src/counselor/enums/practice-defense-style.enum.ts` | 防御风格 6 档 (cooperative / intellectualizing / stoic / silent / angry / crying) + 中文文案 |
| `src/counselor/enums/practice-emotion-intensity.enum.ts` | 情绪负荷 3 档 (calm / elevated / acute) + L3 高负荷提示文案 |
| `src/counselor/enums/practice-feedback-tone.enum.ts` | 批注语气三态 (positive / warning / info) + 图标映射 |
| `src/counselor/enums/practice-feedback-source.enum.ts` | 批注产出来源 (keyword / llm) |
| `src/counselor/enums/practice-rubric-check.enum.ts` | rubric 判定方式 3 档 (contains_any / contains_none / custom_llm) |
| `src/counselor/enums/practice-difficulty.enum.ts` | 难度梯 3 档 (数值 1/2/3, 与 spec §2.1 的 int 列一致) |
| `src/counselor/enums/practice-engine.enum.ts` | 三引擎 (aiResponse / rewrite / voiceMetric) + 名称与引导文案 |

### 1.2 领域类型

- `src/counselor/domain/practice/practice.types.ts` —— 人设 / rubric / 反馈 / 转写 4 段 JSON 的**唯一类型定义处** + 手写校验函数 (`validatePracticePersona` / `validatePracticeRubric` / `validatePracticeFeedbackPayload` / `validateGeneratedScenarioPayload`).
- `src/counselor/domain/practice/practice-seed.types.ts` —— `PracticeScenarioSeed` (内容记录的强类型契约).

### 1.3 持久化

- `src/counselor/entities/practice-scenario.entity.ts` —— `practice_scenarios` (20 列 + 4 索引)
- `src/counselor/entities/practice-attempt.entity.ts` —— `practice_attempts` (12 列 + 3 索引)
- `src/migration/1714900000015-AddPracticeScenarios.ts` —— 2 表 migration (注册于 `src/migration/index.ts` + `bin/ormconfig.ts`, 两处严格 1:1)

### 1.4 配置与内容库

- `src/counselor/config/practice-display-meta.ts` —— 基本功 → 三引擎映射 + 系统租户哨兵值
- `src/counselor/config/practice-evaluation.config.ts` —— 评判 LLM 开关 (`PRACTICE_LLM_EVALUATION`)
- `src/counselor/config/practice-evaluation-prompts.ts` —— 3 组 prompt + 3 份 JSON 契约 + 批注侧重点轮换
- `src/counselor/config/practice-scenario-seeds.listening.ts` (18 条) / `.questioning.ts` (24 条) / `.voice.ts` (18 条)
- `src/counselor/config/practice-scenario-seeds.ts` —— 汇总 + **灌库前自检** (条数 / 唯一性 / 难度分布 / 引擎字段匹配)

### 1.5 服务与接口

- `src/counselor/providers/practice-scenario.service.ts` —— 读侧 (§3.1 / §3.2 / §3.4) + **唯一可见性谓词**
- `src/counselor/providers/practice-evaluator.service.ts` —— 评判引擎 (LLM 主路径 + 关键词降级 + 零压红线守门) + P2 来访者反应 + P3 场景生成
- `src/counselor/providers/practice-attempt.service.ts` —— 写侧编排 (§3.3 / §3.5)
- `src/counselor/controllers/practice.controller.ts` —— 5 端点 (`/counselor/practice/*`)

### 1.6 Seed 与运维

- `src/counselor/seeds/practice-scenarios.seed.ts` —— 按 `scenario_key` 幂等 upsert (带漂移检测)
- `bin/seed-practice-scenarios.ts` + `npm run seed:practice`

---

## 2. API 契约 (与 spec §3 逐字段对齐)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/counselor/practice/progress` | 进度聚合: summary + 10 基本功 × 全部变体 + 弱项 + 随机入口 |
| GET | `/counselor/practice/scenarios/:scenarioId` | 取场景开练 (含 `attemptOrdinal` = 已练次数 + 1) |
| POST | `/counselor/practice/scenarios/:scenarioId/evaluate` | 提交作答 + 零压批注 |
| POST | `/counselor/practice/random` | 随机抽场景 (可 `exceptMode`) |
| POST | `/counselor/practice/custom-scenarios` | 真实情况 → 私有场景 (P3) |

**请求体**

```jsonc
// POST /counselor/practice/scenarios/:id/evaluate
{
  "submittedText": "听起来你这阵子是真的很累，脑子一直转停不下来。", // 语音引擎传 ASR 文本, 可为 ""
  "recordSeconds": 42,        // 可选, 语音引擎专用
  "durationSeconds": 68,      // 必填
  "turn": 1                   // 可选, P2 多轮, 缺省 1
}
```

**响应体 (evaluate)** —— 注意**没有任何分数字段**:

```jsonc
{
  "attemptId": "…uuid…",
  "feedback": {
    "items": [
      { "tone": "positive", "icon": "✅", "dimensionKey": "namesEmotion", "text": "「撑不住」这个动作出现了 —— 说出了对方的情绪." }
    ],
    "referenceResponse": "听着像是有很多事同时压着你……",
    "commonPitfalls": ["一上来就问睡眠细节，把话题带成问卷"],
    "attemptOrdinal": 2,
    "source": "llm",
    "visitorReaction": null
  }
}
```

> 批注图标 (`icon`) 在**出参层**由 server 按 `tone` 补, 不落库 —— 展示元数据不进存储,
> 客户端也不必自己维护一份"语气 → 图标"映射 (双份映射必然漂移).
> 同样地, `modeLabel` / `engineLabel` / `engineIntro` / `difficultyLabel` 等中文文案
> 全部由 server 下发, 保持"server 为文案单一事实源".

**进度聚合响应要点**

- `summary`: `{ totalScenarios, completedScenarios, totalAttempts, activeDaysLast7d }` —— 全部**无分数字段**.
- `modes[]`: 固定 10 个基本功 (`mode` / `modeLabel` / `type` / `engine` / `variants[]`), 未练过的基本功也返回 (`variants` 为空数组), 客户端不需要自己补齐缺失项.
- `variants[]`: `{ scenarioId, scenarioKey, difficulty, difficultyLabel, personaName, personaNote, openingLine, completed, attemptCount, lastPracticedAt }`.
- `weakModes`: 练习次数最少的 3 个基本功 (含从未练的); 次数相同时按固定顺序兜底, **同一份数据每次返回完全一致** (前端不会"每次刷新置顶项都变").
- `nextRandomScenarioId`: 服务端混洗, 优先未练过的场景; 内容库为空时返回空串 (前端走空态, 不 500).

---

## 3. 数据模型

### 3.1 `practice_scenarios` (spec §2.1)

- 20 列: `id` / `tenant_id` / `user_id` / `exercise_mode` / `scenario_key` / `difficulty` / `is_ai_generated` / `persona` / `opening_line` / `task_prompt` / `botched_utterance` / `voice_script` / `reference_response` / `common_pitfalls` / `rubric` / `expected_turns` / `enabled` / `created_at` / `updated_at` / `deleted_at`
- 4 索引: PRIMARY + `uniq_ps_scenario_key` (UNIQUE) + `idx_ps_mode_enabled` + `idx_ps_user`
- **无 DB-level FK** (跟 ADR-0003 一致), 跨表引用应用层校验

### 3.2 `practice_attempts` (spec §2.2)

- 12 列: `id` / `tenant_id` / `user_id` / `scenario_id` / `submitted_text` / `record_seconds` / `speech_rate_wpm` / `feedback` / `duration_seconds` / `turn` / `created_at` / `deleted_at`
- 3 索引: PRIMARY + `idx_pa_user_scenario` + `idx_pa_user_created`
- **没有 score / is_correct / grade 列** —— 零压红线的**结构性**保证 (表里不存在 = 物理上不可能下发分数)

---

## 4. 评判引擎 (spec §3.3)

```
提交作答
  ├─ LLM 主路径 (CounselorLlmJsonClient, temperature 不可用故靠 prompt 约束 + reasoning_effort=medium)
  │    ├─ 失败 / errorCode          → 降级
  │    ├─ 条数不在 3-5               → 降级
  │    └─ 产出含评分/评级/评价人措辞  → 降级 (整份判废, 不做局部清洗)
  └─ 确定性关键词降级 (零随机, 可复盘)
       ├─ CONTAINS_ANY  : 命中 positiveKeywords → ✅ / 未命中 → ⚠️
       ├─ CONTAINS_NONE : 命中 antiKeywords  → ⚠️ / 未命中 → ✅
       ├─ CUSTOM_LLM    : 只出 ℹ️ 技术提示 (不下判定)
       └─ 语音引擎且 ASR 为空: 只出 ℹ️ 提示, 不做"未达成"式判定
```

- 两条路径返回**结构完全一致**, 客户端无需感知切换 (spec §3.3「接口形状不变」)
- 批注条数固定 3-5 条 (spec §1.3)
- 批注侧重点按 `attemptOrdinal` 轮换: 第 1 次看**动作** → 第 2 次看**语气/长度** → 第 3 次起给**稳定确认**
- 线上开关: `PRACTICE_LLM_EVALUATION=off` → 直接走确定性路径, 不发起任何 LLM 调用 (上游抖动时不用发版)

### 4.1 零压红线 (spec §1.3 / §6.2) 三重保障

1. **结构性**: 表无分数列 → DTO 无分数字段 → 响应体里不存在分数
2. **prompt 约束**: system prompt 逐条写死禁令 (不返回分数/对错/等级; 不评价人; 固定三态语气)
3. **服务端守门**: 产出命中禁用词表 (分数/得分/评分/及格/评级/等级/优秀/太差/很差/你不行/加油/有进步 …) → **整份判废**并降级

---

## 5. 内容库与 Seed

```bash
# 1) 建表 (由你手动执行)
pnpm migration:run

# 2) 灌 60 条场景内容 (由你手动执行)
npm run seed:practice
#   首次: 新增 60 / 更新 0 / 未变 0
#   再跑: 新增 0  / 更新 0 / 未变 60   (幂等)
```

- 内容以**代码内基线**为单一事实源, 按 `scenario_key` 幂等 upsert, **不进 migration** (spec §6.3)
- 灌库**之前**先自检: 60 条 / `scenario_key` 唯一 / 每基本功 6 条且 L1L2L3 各 2 / 引擎字段匹配 (改写工坊必有 `botchedUtterance`、语音必有 `voiceScript`、接话演练两者皆无) / 每条 rubric ≥ 3 维度 —— 任一不通过直接报错且**不写库**
- 共享内容库的行: `user_id = NULL`, `tenant_id = 系统租户哨兵值`, `is_ai_generated = 0`
- `enabled` 兼作**审核闸门**: 共享内容库里的 AI 产出必须先置 0, 待持证咨询师审核后置 1 (延续 v1.2 §11.1)

---

## 6. 与 spec 的差异说明 (全部为「更严」或「补齐」, 无破坏)

| 项 | spec | 本实现 | 原因 |
|---|---|---|---|
| 三引擎推导口径 | §1.1 按 `type` 推导 (listening→接话 / questioning→改写) | 按 **mode** 推导 (服务端 `PRACTICE_MODE_ENGINE_META`) | 客户端 `practice_mode.dart` 已是 mode 级映射; 按 type 推导会让 `factFeelingSeparation` / `closedToOpen` / `avoidInterrogation` 三个 mode 的引擎前后端错位 |
| 引擎是否落列 | 明确"不加 practiceMode 列" | **不加** (运行时派生) | 落列 = 第二事实源, mode 改了引擎没改会静默错位 |
| `completed` 语义 | §3.1 "存在 graded 状态的 attempt" | 自由作答表**无状态机** (提交即评判完成) → `attemptCount > 0` | spec §2.2 的 attempt 表本身没有 status 列 |
| `variants[].openingLine` | §3.1 DTO 含该字段, 但同段注明"无 openingLine" | **保留** (按 DTO 逐字段对齐) | 同一段内部矛盾时以显式字段清单为准; 一句开场白的载荷成本可忽略 |
| 难度列类型 | §2.1 `int` | `int` (数值 enum `PracticeDifficulty`, 值 1/2/3) | 落库逐字节一致, 应用层拿到有名字的枚举 |
| `practice_attempts` 索引 | §2.2 列 2 个 | 列 3 个 (多 `idx_pa_user_created`) | 进度聚合要按"用户 + 时间"算 7 天活跃天数 |
| 多轮 (P2) | §5 只写"3.2 加 expectedTurns, 3.3 支持 turn 2..N" | 已实现: `expected_turns` 列 + `turn` 列 + `feedback.visitorReaction` | 用 attempt 行自身还原转写, **不另立 practice_session 表**; 单轮场景 `expected_turns = 1` 时行为与单轮完全一致 |
| 配额 | §4 "AI 评判调用走现有配额体系, 不新建" | 本轮**不扣配额** | 现有 `QuotaType` 只有 3 类且与客户端 1:1 wire; `BillingService.consumeQuota` 在当前 NONE 档 `limit = 0` 会直接抛错 —— 硬接会让练习端点 100% 不可用. 成本控制改用 `PRACTICE_LLM_EVALUATION` 开关, 配额待会员档位体系落地后接 |
| `custom-scenarios` (P3) | §3.5 + §5 P3 | 已实现 (AI 生成 → 私有场景) | `user_id = 本人` → 仅本人可见; 难度按入门档落库 (自建场景没有难度评审结论, 不假装是进阶素材) |

---

## 7. 手动验证清单 (由你执行)

1. `pnpm migration:run` → `SHOW TABLES LIKE 'practice_scenarios'` / `'practice_attempts'` 各 1 张; `practice_attempts` 无 `score` 列
2. `npm run seed:practice` → 新增 60; 再跑一次 → 未变 60
3. `GET /counselor/practice/progress` → `modes.length === 10`; `variants` 合计 60; `weakModes.length === 3`; 响应体 grep `score` = 0 命中
4. `GET /counselor/practice/scenarios/:id` → 含 `persona` / `openingLine` / `taskPrompt` / `attemptOrdinal = 1` / `engineLabel` / `difficultyLabel`; L3 场景含 `highLoadNotice`
5. `POST /counselor/practice/scenarios/:id/evaluate` → 返回 `feedback.items` 3-5 条, 语气三态, **无分数无对错**; 同一回应连评 2 次, 降级路径下批注逐字相同
6. `PRACTICE_LLM_EVALUATION=off` → 同一接口仍 200, `feedback.source = 'keyword'`
7. `POST /counselor/practice/random` → 返回的 id 能被第 4 步取到
8. `POST /counselor/practice/custom-scenarios` → 生成的场景只有本人可见 (换用户调 progress 看不到)
9. 语音场景: `recordSeconds = 60` + 60 字文本 → 落库 `speech_rate_wpm = 60`; ASR 文本为空 → 只出 ℹ️ 提示
