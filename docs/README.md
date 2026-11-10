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
│   ├── conventions.md  代码红线 + 交付格式
│   └── wp-task-template.md  后端任务单模板（派 MiniMax 前照此写）
│
├── reference/          ← 上游愿景原件（备查，冲突以 architecture 为准）
│
├── worklog/            ← 工作记录（动态）
│   ├── README.md       后端 AI 入口（总状态行）
│   ├── pending/        待开工任务单 + 阶段母版（Phase2.5 README / 总览 / 登记表）
│   ├── completed/       已交付（按阶段分）
│   │   ├── phase1/    Phase1 全部交付（26 WP + 2 轮审查）
│   │   ├── phase2/    Phase2 全部交付（38/43 WP + R9 灰度切换开关）
│   │   └── phase2.5/  Phase2.5 交付中（WP-A 已完成）
│   └── audits/         审查报告（代码对账审计等）
│
└── archive/            ← 历史留档（基本不翻）
```

---

## 当前阶段

```
Phase1（✅ 已封版） → Phase2（✅ 已封版） → Phase2.5（🚧 进行中） → Phase3（待开工）
```

| 阶段 | 状态 | 入口文档 |
|---|---|---|
| **Phase1** | ✅ 已封版（2026-11-03） | [交付索引](worklog/completed/phase1/phase1-backlog-archived-2026-11-03.md) |
| **Phase2** | ✅ 已封版（2026-11-08） | [封版记录](worklog/completed/phase2/phase2-freeze-2026-11-08.md) |
| **Phase2.5** | 🚧 灰度验证期（进行中） | [Phase2.5 README](worklog/pending/phase2.5-README.md) |
| **Phase3** | 📋 待开工 | —— |

---

## 快速导航（我要查什么）

| 我要查什么 | 去哪找 |
|---|---|
| **现在在做什么 / 下一个活是什么** | [`worklog/README.md`](worklog/README.md) → Phase2.5 README |
| **引擎终局形态是什么样** | [`architecture/engine-endstate-blueprint-v1.0.md`](architecture/engine-endstate-blueprint-v1.0.md) |
| **混合式 BDI 架构设计** | [`architecture/hybrid-bdi-agent-blueprint-v1.0.md`](architecture/hybrid-bdi-agent-blueprint-v1.0.md) |
| **分阶段路线图** | [`architecture/ai-engine-roadmap-v1.1.md`](architecture/ai-engine-roadmap-v1.1.md) |
| **技术契约（API / 协议）** | [`specs/active/`](specs/active/) |
| **代码红线 / 交付规范** | [`team/conventions.md`](team/conventions.md) |
| **给后端 / MiniMax 派任务单** | [`team/wp-task-template.md`](team/wp-task-template.md)（必读入口 + 固定结构 + 回写清单） |
| **本地环境怎么跑** | [`runbooks/local-setup.md`](runbooks/local-setup.md) |
| **部署 / 排障手册** | [`runbooks/`](runbooks/) |
| **历史交付记录** | [`worklog/completed/`](worklog/completed/) |
| **审计报告 / 对账报告** | [`worklog/audits/`](worklog/audits/) |
