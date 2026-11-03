# 后端 AI 开工自检（先读这个文件，再开工）

> 你是 `mofang-nestjs`（NestJS）仓库的后端 AI。
> 这个文件是你的入口：**先读完，再决定做什么活、遵守什么红线、交付什么格式。**

---

## 0. 你在哪（项目一句话）

心塑 App 的后端引擎：咨询师用 Flutter 客户端跟 AI 心理咨询来访做语音对练。
- 内核纯层在 `src/engine-core/`（BDI 决策、记忆、轨迹、伦理、渲染契约）—— **纯函数、零网络、零 prompt、零 @nestjs/**
- 适配/装配层在 `src/engine-adapters/`（把纯层接成真实可用的对练：LLM 调用、WS 流式、DB 角色池、PsyGUARD 探测）
- 业务层在 `src/voice/` `src/counselor/` 等（WS 会话、语音网关、报告）

> **Phase1 已封版（2026-11-03）**：WP0–WP26 全交付，8 个 P1 + 34 个 P2 全修，1252 例测试全绿。Phase1 backlog 已归档到 `completed/phase1/phase1-backlog-archived-2026-11-03.md`。
>
> **Phase2 总览已出**：[`pending/phase2-overview-2026-11-03.md`](pending/phase2-overview-2026-11-03.md)（商业化准备，21 条工作包，P0/P1/P2 三层）。
> **WP 清单**：[`pending/phase2-wp-list-2026-11-03.md`](pending/phase2-wp-list-2026-11-03.md)（WP27–WP47，分三批并行）。具体任务单开工时再单独写。

---

## 1. 当前有什么活（自己扫目录）

**第一步：`ls pending/` 看里面有几个 .md 文件。**

- 有文件 = 每个文件就是一个完整任务，从文件名排第一的开始做
- 没有文件 = 没有新活，不要自己找事做，等用户派新任务单

每个任务单文件里写了完整的：目标、改动点、验收标准、不做什么。**读全文再开工。**

---

## 2. 红线与交付格式

> 完整规范在 [`../team/conventions.md`](../team/conventions.md)，这里只列最关键的三条：

1. **engine-core 纯层一行不动**（用户例外批准除外）—— `git diff --stat HEAD -- src/engine-core` 交付时必须为空
2. **不写前端代码**（不碰 admin-dashboard / Flutter）
3. **不跑前端命令**（flutter / dart / pub 一律不跑）

交付格式详见 [`../team/conventions.md`](../team/conventions.md) §二。

---

## 3. 已交付速查（避免重复做）

**Phase1 全部交付在 `completed/phase1/` 下，共 26 个 WP + 2 轮封版审查。** 需要参考 Phase1 的某个设计决策时，直接翻对应目录的交付记录：

| 你要查什么 | 去哪找 |
|---|---|
| 引擎核心逻辑（BDI / 记忆 / 轨迹 / 伦理） | `completed/phase1/wp0-wp5-core/` |
| LLM 渲染 / WS 流式 / 角色池 / PsyGUARD / resume 接线 | `completed/phase1/wp6-wp12-wiring/` |
| 风险处置 / delta cap / 幂等 / 报告 / 限流 / 重连 / P2 全修 | `completed/phase1/wp14-wp24-augment/` |
| 认证密码 | `completed/phase1/auth-and-password/` |
| 早期杂项（历史列表 / 来访者池） | `completed/phase1/early-misc/` |
| Phase1 整体状态 / WP 清单 / 依赖关系 | `completed/phase1/phase1-backlog-archived-2026-11-03.md` |
| 封版审查发现了哪些问题、怎么修的 | `audits/wp25-phase1-audit-report-2026-11-03.md` |

**什么时候该翻 Phase1 文档：**
- 任务单里提到某个 WP 的编号（如"WP15 的 cap 逻辑要扩展"）→ 翻对应目录的交付记录
- 拿不准某个设计决策的原因 → 翻对应交付记录的 §4「关键设计决策」
- 改 engine-core 前 → 先翻 `completed/phase1/wp0-wp5-core/` 确认边界
- 改 WS 协议前 → 翻 `wp23` 交付记录（断连重连追平逻辑）

**Phase1 关键红线（已由机器断言守住）：**
- `src/engine-core/**` 零 `process.env`、零 `globalThis`、零 NestJS（`boundary.spec.ts` 11 条断言）
- delta cap 参数走注入（`DeltaCapConfig` 端口），不由内核读 env
- 轨迹 delta 也走 cap（本轮总 delta = 事件 + 剧本，统一过一次）
- WS 握手 JWT 走 `handshake.auth.token`（Socket.IO 标准），不走 URL query

---

## 4. 目录结构

```
docs/worklog/
├── README.md          ← 你现在读的这个文件
├── pending/          ← 待开工任务单（当前为空）
├── completed/         ← 已交付（按阶段分）
│   ├── phase1/       ← Phase1 全部交付（26 WP + 2 轮审查）
│   │   ├── wp0-wp5-core/
│   │   ├── wp6-wp12-wiring/
│   │   ├── wp14-wp24-augment/
│   │   ├── auth-and-password/
│   │   ├── early-misc/
│   │   └── phase1-backlog-archived-2026-11-03.md
│   └── phase2/       ← 空，等 Phase2 开工
├── audits/           ← 审查报告（WP25 等）
└── archive/          ← 老文档
```

---

## 5. 参考资料（按需查，不要一上来全读）

**不要开工前把这些全读了——context 会爆。** 遇到口径歧义、拿不准边界时，再翻对应文档。

| 文档 | 什么时候读 |
|---|---|
| `docs/architecture/ai-engine-roadmap-v1.1.md` | 任务单里没写清楚"为什么这么做"、或者你拿不准某个设计决策的上游依据时 |
| `docs/reference/ai-simulation-blueprint-v1.1.md` | 蓝图原始愿景，roadmap 冲突时以 roadmap 为准 |
| `docs/reference/bdi-cognitive-engine-principles-v1.0.md` | 改 BDI 算子/记忆/轨迹相关逻辑时，确认设计原则 |
| `docs/reference/architecture-blindspot-fill-v1.0.md` | 改伦理/安全/兜底相关逻辑时，确认盲区补全口径 |
| `docs/architecture/microservices-evolution-plan.md` | 写新功能前看一眼 §2 的 5 条边界规则——现在不拆微服务，但代码要保持将来好拆 |

**原则：README + 当前任务单 = 99% 够用。** 上面这些是"字典"，遇到生字才翻。

---

## 6. 开工前自检清单

```
□ 我读完了 pending/ 里的任务单全文
□ 我确认 engine-core 一行不动（或任务单有明确例外批准）
□ 我知道交付记录要写什么格式（见 team/conventions.md）
□ 我知道交付后要移文件
```
全勾了再动手。
