# 咨询师端后端待办缺口清单（2026-10-22）

> 范围：只盘点当前前端已对接 / 即将上线的 MCQ、自由练习、金句、首页承接；不展开 v1.2 完整会谈、长程个案、督导等独立规格。
> 原则：已有响应结构不破坏，新增能力优先以可选字段补充；MCQ 计分频道与自由练习零压频道继续严格隔离。

## 0. 已完成，本单不重复做

### MCQ 备考频道（有分，独立）
- `GET /counselor/training-exercises`：题目列表，返回 `{ items, total }`，不下发答案。
- `GET /counselor/training-exercises/progress`：MCQ 进度聚合，含 `averageScore/lastScore/activeDaysLast7d`。
- `GET /counselor/training-exercises/:id`：单题详情；未知 UUID 返回 404。
- `POST /counselor/training-exercises/:id/attempts`：服务端判分。

### 自由练习零压频道（无分，独立）
- `GET /counselor/practice/progress`
- `GET /counselor/practice/scenarios/:scenarioId`
- `POST /counselor/practice/scenarios/:scenarioId/evaluate`
- `POST /counselor/practice/random`
- `POST /counselor/practice/custom-scenarios`
- `POST /counselor/practice/scenarios:generate`
- `GET /counselor/practice/scenarios/mine`

### 金句
- `GET /counselor/quotes/today`
- `GET /counselor/quotes?cursor=&limit=`
- `GET /counselor/quotes/favorites`
- `POST /counselor/quotes/:id/favorite`
- `DELETE /counselor/quotes/:id/favorite`

---

## P0 · 上线前需要处理

### G1. 金句背景图静态资源未托管

现状：接口已下发 `backgroundUrl`，但 `https://cdn.xinsu.app/quote/*` 当前不存在，浏览器直接 404。前端已做本地兜底，不会白屏，但生产环境无法显示远端沉浸图。

独立待办已写在：`docs/progress/quote-static-cdn-backlog-2026-10-22.md`。

后端三选一：
1. 推荐：开通 OSS/CDN，建 `quote/` 目录并上传 seed 对应图片；
2. 过渡期用 Nest 静态目录暴露 `public/quote/`；
3. CDN 就绪前 `backgroundUrl` 返回空串，前端统一走本地图。

验收：
- `GET /counselor/quotes/today` 的 `backgroundUrl` 可直接打开且返回 200；
- 首页圆形缩略图、沉浸页满版背景无 404；
- 不暴露 Bucket 私有路径，图片带长期缓存。

---

## P1 · 首页个性化从 mock 改为真实聚合

### G2. `GET /counselor/home/overview` 仍为内存 mock

现状证据：
- `buildAbility()` 写死 `listening=0.35 / empathy=0.2 / questioning=0.45 ...`；
- `buildWeeklyProgress()` 四项全 0；
- `buildRecommendation(emotionLevel)` 只按情绪档位返回静态文案，不读练习进度；
- `trainingCategories[category='skill'].progress.completedItems` 写死 0。

目标：首页承接状态由服务端聚合，前端不再自己拼三态。建议在现有 DTO 上新增可选 `personalization`，旧字段保留兼容。

建议响应：

```json
{
  "greeting": "今天可以开始哪一项训练？",
  "dateLabel": "10 月 22 日 · 周四",
  "personalization": {
    "stage": "newcomer | returning | inProgress | unknown",
    "practice": {
      "totalScenarios": 60,
      "completedScenarios": 0,
      "totalAttempts": 0,
      "activeDaysLast7d": 0,
      "weakModes": ["emotionReflection", "openQuestion", "speechRate"]
    },
    "mcq": {
      "totalItems": 10,
      "completedItems": 0,
      "averageScore": null,
      "activeDaysLast7d": 0
    },
    "continuePractice": null,
    "warmup": null
  }
}
```

状态判定口径：
- `newcomer`：自由练习 `totalAttempts=0`、MCQ `completedItems=0`，且没有未完成会话；
- `returning`：有练习历史，但没有可继续的未完成项；
- `inProgress`：存在未完成的 MCQ attempt 或未结束的 `training_session`；
- `unknown`：数据缺失 / 聚合失败时兜底，不要编造进度。

`continuePractice` 结构：

```json
{
  "kind": "mcq | practice | fullSession",
  "itemId": "真实 exerciseId 或 scenarioId 或 sessionId",
  "title": "继续上次的练习",
  "subtitle": "上次停在倾听练习",
  "updatedAt": "2026-10-22T10:00:00.000Z"
}
```

`warmup` 结构：

```json
{
  "kind": "practice | mcq",
  "mode": "emotionReflection",
  "itemId": "scenario-uuid 或 exercise-uuid",
  "title": "弱项热身",
  "subtitle": "最近没怎么练情绪反射"
}
```

硬约束：
- `practice` 块不得出现 `score/averageScore/lastScore/grade/isCorrect`；
- MCQ 分数只能放在 `mcq` 块；
- 聚合失败时返回 `stage=unknown` 和空计数，不要返回假的 0.35 雷达值。

### G3. 专项技能分类进度接 MCQ 真实进度

`trainingCategories[category='skill'].progress` 当前写死：

```json
{ "totalItems": 10, "completedItems": 0 }
```

改为读取 `GET /counselor/training-exercises/progress` 的 `summary.totalItems / completedItems`。

注意：这里统计的是 MCQ 完成项，不要把自由练习次数算进 `completedItems`。

### G4. `todayRecommendation` 返回真实可路由对象

当前 `scenarioId` 是旧 mock 值（`skill_listening` / `full_process`），建议新增可选路由字段，旧字段保留：

```json
{
  "todayRecommendation": {
    "kind": "resume | newcomer | weakWarmup | default",
    "target": "specializedSkills | visitorPreset | practiceScenario | mcqExercise",
    "mode": "emotionReflection",
    "itemId": "真实可跳转 id",
    "title": "今天，先从一次会谈开始",
    "subtitle": "零压力，按自己的节奏准备第一次会谈",
    "difficulty": "L1"
  }
}
```

推荐优先级：
1. `inProgress` → `continuePractice`；
2. `newcomer` → 完整会谈 / 首次承接；
3. `returning` → `practice.weakModes[0]` 弱项热身；
4. 无数据 → 默认中性推荐。

---

## P2 · 后续完善，不阻塞当前上线

### G5. 能力雷达与周 KPI 口径

- `buildAbility()` 应复用 `GET /counselor/ability/profile` 的聚合结果，不要在 home service 第二套计算；
- 当前 `fragmentsEarnedThisWeek / islandsUnlockedThisWeek` 偏主 App 游戏化资产，咨询师学员端暂无对应数据。后续二选一：
  - 前端隐藏旧字段；
  - 后端替换为 `practiceAttemptsThisWeek / completedScenariosThisWeek / mcqCompletedThisWeek / activeDaysLast7d`。

### G6. 私有场景管理

当前已有生成与列表，后续「我的真实场景」若支持删除，再补：
- `DELETE /counselor/practice/scenarios/:id`：软删除，仅本人；
- 可选 `PATCH` 修改备注，不改原始三问原文。

### G7. 语音微训练 ASR 口径

当前 `evaluate` 接收客户端 ASR 文本 `submittedText` 与 `recordSeconds`，后端不直接处理音频。若后续客户端无法做本地语音识别，再单独设计服务端 STT 接口；本期不要让后端直接接收音频文件判分。

### G8. 运营位 / 新手福利 / 会员推荐

首页未来可能放新手福利、会员推荐、活动 banner。当前不做；后续需要独立运营配置接口，不要把营销位硬编码进 `home/overview`。

---

## 上线前运维检查（不是代码缺口）

部署环境需执行 / 配置：

```bash
npm run migration:run
npm run seed:training
npm run seed:practice
npm run seed:quotes
```

环境变量核对：
- `PRACTICE_LLM_EVALUATION=on|off`：自由练习评判开关；
- `PRACTICE_LLM_GENERATION=on|off`：来访者反应 / 私有场景生成开关；
- `PRACTICE_CUSTOM_SCENARIO_DAILY_LIMIT=5`；
- `PRACTICE_CUSTOM_SCENARIO_MAX_COUNT=50`；
- `PRACTICE_CUSTOM_SCENARIO_GENERATION_TIMEOUT_MS=8000`；
- `QUOTE_CDN_BASE_URL` 指向可公开访问的图片前缀。

验收清单：
1. `GET /counselor/training-exercises` 返回 10 项，带 `modeLabel/modeSummary`；
2. `GET /counselor/training-exercises/progress` 冷启动 `averageScore=null`，不返回假 0 分；
3. `GET /counselor/practice/progress` 无任何分数字段；
4. `POST /counselor/practice/scenarios/:id/evaluate` 返回 3-5 条零压批注；
5. `GET /counselor/quotes/today` 文本、作者、分类正常，图片按 G1 处理；
6. 私有场景生成 / 降级 / 配额超限都返回 200 + 可练场景，不弹红条。

## 非目标

- 不在本单重做 v1.2 完整会谈、长程个案、知情同意、督导复盘；
- 不把 MCQ 分数混入自由练习；
- 不给自由练习增加分数、对错、评级、通过率；
- 不破坏已有 DTO 字段，新增能力优先走可选字段。
