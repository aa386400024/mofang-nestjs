# 心理学资料库资产化 · 工作入口

> **路径**：`docs/worklog/pending/psych-corpus-README.md`
> **状态**：🚧 进行中（盘点完成，案例卡深转未开始）
> **创建日期**：2026-11-08
> **总入口**：[§worklog/README.md](../README.md)
> **inventory**：[§psych-cases/inventory.md](../../reference/psych-cases/inventory.md)

---

## 0. 这是什么阶段（先读这段）

**这不是写代码阶段，是「素材准备」阶段。**

| 阶段 | 干什么 | 类比 |
|---|---|---|
| Phase2.5 WP-D | 训练模拟咨询师 AI + 自动对练 | 需要「教材」 |
| **本阶段** | **把磁盘上 468 份心理学资料盘点、筛选、转成案例卡——给模拟咨询师 AI 编教材** | **编教材** |
| Phase2.5 WP-E | 用督导解析当 ground truth 自动评测 | 需要「标准答案」 |

**一句话：本阶段的目标不是写代码，是把散落在 PDF/Word 里的督导智慧，变成工程能直接吃的结构化数据。**

---

## 1. 出口条件（做完的标志）

| # | 出口条件 | 可判定标准 |
|---|---|---|
| ① **清单齐备** | 468 份资料全部进 inventory.md，每份有评级和可用 WP 标注 | inventory.md 行数 = 实际文件数 ✅（已达成） |
| ② **核心资产深转** | 双面镜 ⭐⭐⭐⭐⭐ + 逐字稿 ⭐⭐⭐⭐⭐ + 话术包 ≈ 60 份转成标准化案例卡 | `docs/reference/psych-cases/` 下有 60 份案例卡（除 inventory.md 外） |
| ③ **ground truth 可喂** | 每份案例卡有 `gold_turns` / `bad_turns` / `expected_deliberation_deltas`，格式对齐 engine-core 契约 | WP-E 评测脚本能直接读 JSON |
| ④ **合规过线** | 所有案例卡 `<pii_redacted: true>`；未成年人案例打 `<minor: true>` 不进训练集；对话原文片段不进审议 prompt | 抽查 5 份案例卡无真实姓名/单位 |
| ⑤ **筛选可用** | 按流派 / 议题 / 人群 / 风险等级能筛出素材子集 | WP-D 训练时能说「给我 10 份 CBT 社恐案例」 |

---

## 2. 资料清单与进度

| 大类 | 份数 | 评级 | 状态 | 用途 |
|---|---|---|---|---|
| 双面镜大咖督导 | 34 | ⭐⭐⭐⭐⭐ | 📋 待深转 | WP-D 训练 + WP-E ground truth（含刘丹/李松蔚/曾奇峰/王建平/林芳/申荷永/丛中/张沛超/杨发辉/付丽娟督导） |
| 逐字稿 | 38 | ⭐⭐⭐⭐⭐ | 📋 待深转 | WP-D 训练（含罗杰斯 10 经典个案 + 95 份督导合集） |
| 督导案例及话术 | 3 | ⭐⭐⭐⭐⭐ | 📋 待深转 | WP-D 话术库（常用话术 Word 版） |
| 电子书 | 21 | ⭐⭐⭐ | ✅ 只列清单 | 理论参考（罗杰斯/循环提问/经典案例第七版等） |
| 文档版案例 | 195 | ⭐⭐ | ✅ 只列清单 | 人工研读（中小学/大学生为主，未成年人不进训练集） |
| 案例期刊 | 177 | ⭐ | ✅ 只列清单 | 不深转（学校心理辅导为主，价值密度低） |

**依赖关系：**
```
inventory.md 全量盘点 ✅（2026-11-08）
  ↓
双面镜 15 份 ⭐⭐⭐⭐⭐ 深转（逐句解析 + 案例研讨，优先级最高）
  ↓
逐字稿 20 份 ⭐⭐⭐⭐⭐ 深转（罗杰斯 10 个案 + 95 份督导合集精选）
  ↓
话术包 1 份深转（WP-D 模拟咨询师风格参考）
```

---

## 3. 当前有什么活

**第一步：看上面的清单，找「📋 待深转」且评级最高的那个大类。**

现在下一个活是：**双面镜 15 份 ⭐⭐⭐⭐⭐ 案例卡深转**。

按 `psych-corpus-to-worklog` 技能的 case-card-template.md 逐份转，一次 1~3 份，转完回写 inventory.md 状态。

---

## 4. 红线

### 4.1 合规红线
- ❌ 案例卡里永远不写真实姓名 / 单位 / 可识别细节
- ❌ 未成年人案例（中小学 / 学生）不进训练集，只做人工研读
- ❌ 案例卡的对话原文片段不进 LLM 审议 prompt——审议侧只看结构化标签和 delta

### 4.2 工程红线
- ❌ 不自己发明 eventTags——严格用 `src/engine-core/domain/events/event-lexicon.ts` 的 9 类（empathy / acceptance / normalization / open_probe / affirmation / judgment / preaching / minimizing / boundary_cross）
- ❌ 不改 engine-core 任何代码——本阶段只产文档
- ❌ delta 只标方向（+0.0X / -0.0X），不编精确值

### 4.3 质量红线
- ❌ 不扭曲督导点评原意——摘要可以，篡改不行
- ❌ 不把期刊 177 篇和文档版 195 份硬转——价值密度低，只列清单

---

## 5. 交付格式

### 5.1 交付物放哪里

| 产物 | 路径 | 状态 |
|---|---|---|
| 本入口文档 | `docs/worklog/pending/psych-corpus-README.md` | ✅ 已创建 |
| 全量 inventory | `docs/reference/psych-cases/inventory.md` | ✅ 已生成（468 份） |
| 单份案例卡 | `docs/reference/psych-cases/<case-id>.md` | 📋 待深转 |

### 5.2 案例卡写什么

按 `psych-corpus-to-worklog/references/case-card-template.md` 的字段：
1. 元信息（case_id / source / supervisor / school / minor / risk_level）
2. 来访画像（脱敏后）
3. 逐轮技术标注（eventTags + 期待 delta + 督导点评）
4. Ground Truth（gold_turns / bad_turns / expected_delta / risk_turns）
5. 合规标记

### 5.3 深转节奏

- 一次只转 1~3 份，转完回写 inventory.md 状态
- 不要试图一次转完 60 份——context 会爆
- 遇到拿不准的 eventTags，宁可标 `open_probe` 兜底，不要硬编

---

## 6. 文档导航

| 文档 | 内容 |
|---|---|
| 本文件（心理学资料入口） | 定位 / 出口条件 / 资料清单 / 红线 / 交付格式 |
| [§inventory.md](../../reference/psych-cases/inventory.md) | 468 份资料的完整清单（评级 + 状态 + 可用 WP） |
| [§案例卡目录](../../reference/psych-cases/) | 已深转的标准化案例卡（当前为空，待深转） |
| [§worklog/README.md](../README.md) | 整个项目的工作入口 |
| [§Phase2.5 README](phase2.5-README.md) | Phase2.5 灰度验证期主入口（本阶段服务于 WP-D / WP-E） |

---

_本阶段是给模拟咨询师 AI 编教材：不是写代码，是把督导智慧变成工程能吃的结构化数据。_
