# WP44 · 成长档案体系（对练数据入雷达 + 总览接口）

> 状态: ✅ 已交付（2026-11-06）→ [engine-wp44-growth-archive-basic-implementation-2026-11-06.md](engine-wp44-growth-archive-basic-implementation-2026-11-06.md)
> 日期：2026-11-06
> 范围：把对练（咨询模拟）的评分数据喂进已有的 26 子指标能力雷达；提供成长档案总览 + 趋势接口
> 边界：engine-core **零改动**（纯读聚合 + 写 ability_scores 既有表）

---

## 〇、先读这两个文档

开工前先读：
- `docs/README.md`（项目总入口）
- `docs/worklog/README.md`（后端工作记录入口）

---

## 一、背景

### 1.1 现状

现在咨询师训练完，能看到的数据是分散的：
- **单场快评**（WP43 `session_evaluations`）：技术 9 维 + BDI 4 维 + 伦理分，毫秒级
- **深度督导**（`supervision_reports`）：LLM 六维评分 + 标注 + 建议，30-120s
- **能力雷达**（`ability_scores` + `ability_dimensions`）：26 子指标，但**只有 MCQ 刷题喂进去了 8 个**，对练数据完全没接进来

问题：
- **雷达图是半成品**——用户练了几十场对练，雷达图纹丝不动，只有刷题那几个点有数据
- **没有总览视图**——用户想看"我练得怎么样了"，要自己翻 N 场会话自己算

### 1.2 目标

做两件事：
1. **写入侧**：把对练评分映射到 ability_scores 的对应子指标，让雷达图真正完整
2. **读取侧**：提供成长档案总览 + 趋势接口，用户打开就能看到训练全貌

---

## 一·五、开工前核实清单（必须先 grep 确认，再写代码）

**动手前先扫一遍代码，确认下面这些边界，别造双胞胎：**

1. **核实 ability_scores 表的写入路径**
   - 现在只有 `practice-ability-sync.service.ts` 从 MCQ 练习写入
   - 确认：没有其他地方从对练写入 ability_scores（grep `upsertScore` 的所有调用点）

2. **核实 session_evaluations 的数据结构**
   - WP43 刚交付，technicalScores 是 9 维 + 平均分
   - 确认：empathy / openProbe / boundaryCross 这三个字段确实存在

3. **核实 supervision_reports 的 dimensions 结构**
   - 六维：empathy / activeListening / questioning / boundary / response / professionalism
   - 确认：都在 `SupervisionDimensions` 接口里，0-100 分

4. **核实 ability_dimensions 的子指标 code**
   - 确认：`skill_empathy_precision` / `skill_listening_accuracy` / `skill_questioning_openness` / `skill_boundary_awareness` / `knowledge_ethics_mastery` 这 5 个 code 确实存在

5. **核实 engine-core 零改动**
   - WP44 纯消费既有数据，不碰内核
   - 确认：`git diff --stat HEAD -- src/engine-core` 应该是 0 文件

---

## 二、要做的事

### 2.1 写入侧：对练评分 → ability_scores 映射

**新增文件：**
- `src/counselor/config/session-ability-mapping.ts` —— 映射表（常量）
- `src/counselor/providers/session-ability-sync.service.ts` —— 同步服务

**映射表设计（5 个核心子指标）：**

| 子指标 code | 子指标名 | 快速评分来源 | LLM 督导来源 |
|---|---|---|---|
| `skill_empathy_precision` | 共情精准度 | technicalScores.empathy | dimensions.empathy |
| `skill_listening_accuracy` | 倾听准确率 | — | dimensions.activeListening + response |
| `skill_questioning_openness` | 提问开放度 | technicalScores.openProbe | dimensions.questioning |
| `skill_boundary_awareness` | 边界意识 | technicalScores.boundaryCross | dimensions.boundary |
| `knowledge_ethics_mastery` | 伦理规范掌握度 | ethicsScores.score | dimensions.professionalism |

**同步逻辑：**
- 用户打开成长档案页时触发一次（读侧聚合时算，幂等可重算）
- 从该用户所有 `session_evaluations` 提取快速评分信号
- 从该用户所有 `supervision_reports` 提取督导评分信号
- 按子指标分组，全部信号取算术平均 → upsert 到 ability_scores
- **不新增列**：信号直接从已有 JSON 字段读取
- **失败不抛错**：同步失败只记 warn，不影响主流程

**与 practice-ability-sync 的关系：**
- 两者都写同一张 ability_scores 表
- practice 喂 8 个（MCQ 刷题），session 喂 5 个（对练）
- 重叠的子指标（如 skill_empathy_precision）取全部信号的均值——刷题和对练练的都是共情，合并算合理

### 2.2 读取侧：成长档案总览接口

**新增接口：**

#### `GET /counselor/profile/overview` — 总览卡片

响应体：
```json
{
  "totalSessions": 42,
  "avgOverallScore": 67.5,
  "latestScore": 72,
  "highestScore": 85,
  "averageByCategory": {
    "technical": 70.2,
    "bdiDelta": 62.1,
    "ethics": 88.5
  },
  "crisisCount": 3
}
```

数据源：session_evaluations（快速评分全覆盖）+ training_sessions（总场次）

#### `GET /counselor/profile/trend?days=30` — 趋势曲线

响应体：
```json
{
  "points": [
    { "date": "2026-10-20", "overall": 58, "technical": 60, "bdiDelta": 55, "ethics": 80 },
    { "date": "2026-10-22", "overall": 62, "technical": 65, "bdiDelta": 58, "ethics": 85 }
  ]
}
```

数据源：session_evaluations，按 created_at 日期分组取平均

---

## 三、设计决策

**Q：为什么不做增量同步（会话结束时触发）？**
A：单人产品阶段数据量小（几十场对练），读侧聚合时全量算完全够快。增量同步要加钩子、要处理失败重试，复杂度高收益低。跟 `practice-ability-sync.service.ts` 同款模式——读侧聚合时写，幂等可重算。

**Q：为什么只喂 5 个子指标？**
A：26 个子指标里，只有这 5 个能从对练数据里提取出明确的分数信号。语音 4 个 / 习惯 4 个 / 错误 3 个 / 备考 4 个 / 游戏化 3 个——对练数据里没有对应信号，硬映射就是造噪声。留后续 WP。

**Q：为什么重叠子指标要合并算？**
A：刷题练的是"共情技巧"，对练练的也是"共情技巧"，两者练的是同一件事。合并取均值符合"能力雷达反映长期水平"的设计（跟 practice-ability-sync 的注释一致）。

**Q：为什么不落快照表？**
A：纯读聚合直接查三张表实时算，单人产品阶段数据量小，没必要加一张缓存表。真到了数据量大的阶段再加。

**Q：engine-core 要改吗？**
A：零改动。纯消费既有出参（session_evaluations + supervision_reports 都是适配层的表，不是内核的）。

---

## 四、闸门数字

```powershell
npx eslint "src/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit  # → 0 error
npx vitest run                    # → 全绿
git diff --stat HEAD -- src/engine-core   # → 0 文件（零改动）
```

---

## 五、待确认问题

1. **趋势曲线粒度**：按天聚合 vs 按周聚合？建议按天（30 天 = 30 个点，足够看趋势）。
2. **同步触发时机**：用户打开页面时触发 vs 后台定时任务？建议用户打开时触发（被动、幂等、零额外成本）。
3. **前端展示**：归前端 AI，后端只出接口。

---

_任务单已交付（2026-11-06）。交付记录：[engine-wp44-growth-archive-basic-implementation-2026-11-06.md](engine-wp44-growth-archive-basic-implementation-2026-11-06.md)。_

_⚠️ 三处落地偏差（已在交付记录写明理由）：① 端点最终路径是 `GET /counselor/growth/archive-overview` + `GET /counselor/growth/trend`（任务单写的 `/counselor/profile/overview` **已被"我的 Tab"占用** —— 同名不同义）；② 重叠子指标改为**统一聚合器**（刷题 + 对练合并均值），否则两路写同一行会互相覆盖、雷达分会漂；③ 快评的 `technicalScores.boundaryCross` **不需要翻转方向**（它的值已是"越高越好"的得分，字段名带"越界"是误导）。_
