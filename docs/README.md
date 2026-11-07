# mofang-nestjs 后端文档

> 心塑 App 后端引擎：咨询师用 Flutter 客户端跟 AI 心理咨询来访做语音对练。
> 本目录是所有技术文档的唯一入口。

---

## 你是谁，从哪进

| 角色 | 读什么 |
|---|---|
| **后端 AI**（接任务单干活） | [`worklog/README.md`](worklog/README.md) |
| **新开发者**（要跑起来） | [`runbooks/local-setup.md`](runbooks/local-setup.md) → [`architecture/`](architecture/) |
| **运维**（部署排障） | [`runbooks/`](runbooks/) |
| **产品/设计**（看契约） | [`specs/active/`](specs/active/) |

---

## 目录结构

```
docs/
├── README.md           ← 你现在读的这个文件
│
├── architecture/       ← 长期不变的设计真相
│   ├── engine-endstate-blueprint-v1.0.md   引擎终局形态白皮书（北极星）
│   ├── hybrid-bdi-agent-blueprint-v1.0.md  混合式 BDI 智能体引擎架构蓝图（2026-11-05 新增）
│   ├── ai-engine-roadmap-v1.1.md   引擎路线图（分阶段做什么）
│   ├── v6.0-ai-engine.md           V6.0 旧模块架构（src/ai-engine/，已标注）
│   ├── v2-user-module-architecture.md
│   ├── microservices-evolution-plan.md   微服务演进规划
│   └── adr/                       架构决策记录（3 条）
│
├── specs/              ← 技术契约
│   ├── active/          当前生效的 spec（6 份）
│   └── archived/       被取代的旧版
│
├── runbooks/           ← 运维操作手册
│   ├── local-setup.md  本地环境搭建
│   └── docker-deploy.md Docker 部署
│
├── team/               ← 团队规范
│   └── conventions.md  代码红线 + 交付格式
│
├── reference/          ← 上游愿景原件（备查，冲突以 architecture 为准）
│
├── worklog/            ← 工作记录（动态）
│   ├── README.md       后端 AI 入口
│   ├── pending/        待开工任务单（当前只有 Phase2 总览与 WP 清单，**无待办任务单**）
│   ├── completed/       已交付（按阶段分）
│   │   ├── phase1/    Phase1 全部交付（26 WP + 2 轮审查）
│   │   └── phase2/    Phase2 交付中（42 条 WP + 切灰度前置观测面独立单）
│   └── audits/         审查报告（WP25 等）
│
└── archive/            ← 历史留档（基本不翻）
```

---

## 当前阶段

**Phase1 已封版（2026-11-03）**：WP0–WP26 全交付，8 个 P1 + 34 个 P2 全修，1252 例测试全绿。
Phase2 总览：[`worklog/pending/phase2-overview-2026-11-03.md`](worklog/pending/phase2-overview-2026-11-03.md)（商业化准备）。
Phase2 WP 清单：[`worklog/pending/phase2-wp-list-2026-11-03.md`](worklog/pending/phase2-wp-list-2026-11-03.md)（WP27–WP68，分三批并行 + 技术债清理 + 混合式 BDI PoC 组）。
引擎终局形态：[`architecture/engine-endstate-blueprint-v1.0.md`](architecture/engine-endstate-blueprint-v1.0.md)（北极星参考，最终要做成什么样）。
混合式 BDI 架构蓝图：[`architecture/hybrid-bdi-agent-blueprint-v1.0.md`](architecture/hybrid-bdi-agent-blueprint-v1.0.md)（2026-11-05 新增，Coze 下线趋势校准，LLM 审议 + 状态骨架）。
Phase1 交付索引：[`worklog/completed/phase1/phase1-backlog-archived-2026-11-03.md`](worklog/completed/phase1/phase1-backlog-archived-2026-11-03.md)。
