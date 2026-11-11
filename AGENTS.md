# AGENTS.md — 心塑项目 AI 指令（本仓库：mofang-nestjs / NestJS 主后端）

> 每次会话第一条消息前先读本文件。违反 engine-core 红线一次 = 会话终止。
> 本文件是豆包在本仓库的入口；深度规范按"路由表"去对应文档查，不要在这里复制粘贴。

---

## 0. 全局项目地图（你在哪、周围有什么）

心塑是**四个仓库协同**的项目，不是单仓库。先认清自己在哪个目录：

```
E:\Work\Project\
├── frontend\xin_su_app\        ← Flutter 客户端（用户端 + 咨询师端双端）
├── backend\mofang-nestjs\      ← 本仓库：NestJS 主后端（账号 + 业务 + AI 引擎）
│   └── admin-dashboard\        ← Vue3 管理后台（嵌在本仓库里，另一个 AI 管）
├── backend\mofang-psyguard\    ← Python PsyGUARD 模型服务（RoBERTa 风险探测）
├── ai\                          ← AI 相关素材/实验
└── reference-and-inspiration\  ← 参考资料
```

**本仓库（mofang-nestjs）只管 NestJS 后端代码 + admin-dashboard/ 里的 Vue3 管理后台（另一个 AI 负责）。** Flutter 客户端是独立仓库，不要在这里改它的代码。

---

## 1. 本仓库是干什么的

心塑 App 的后端引擎：**咨询师用 Flutter 客户端跟 AI 心理咨询来访做语音对练**（全真执业训练）。

分层结构（写代码前必须认清）：

```
src/
├── engine-core/          ⭐ 纯层：BDI 决策、记忆、轨迹、伦理、渲染契约
│                         纯函数、零网络、零 prompt、零 @nestjs、零 process.env
├── engine-adapters/      适配层：把纯层接成真实可用的对练（LLM 调用、WS 流式、DB 角色池、PsyGUARD 探测）
├── voice/ counselor/ ai-engine/ llm/ practice/ ...   业务层
├── user/                 账号系统（JWT + Redis blacklist + OAuth + 多端 session）
├── shared/infra/        基础设施：Redis / BullMQ / SMTP / SMS / Prometheus / Sentry
└── common/ config/ migration/ ...
```

技术栈：NestJS + TypeORM + MySQL + Redis + BullMQ + Socket.IO + Prometheus + Docker。

---

## 2. 协作边界（最容易踩的坑）

大炮（用户本人）是独立开发者，你是结对 AI。

1. **engine-core 纯层一行不动**：`git diff --stat HEAD -- src/engine-core` 交付时必须为空。例外必须由大炮在任务单里明确批准，改完要过 `boundary.spec.ts` 的 11 条断言。新逻辑放 `engine-adapters/` 或业务层。
2. **前端代码边界**：默认不碰 `admin-dashboard/` 与 Flutter；任务单明确授权时可在 `admin-dashboard/` 内实现与任务单不冲突的前端代码，Flutter 始终不碰。详见 `docs/team/conventions.md` §1.2。
3. **命令边界**：不跑 `flutter` / `dart` / `pub`；后端 `eslint` / `tsc` / `vitest` 由大炮在终端执行。授权前端任务可在 `admin-dashboard/` 目录跑其自带 `type-check` / `build-only` 脚本。
4. **禁止自动 `git commit` / `git push`**。写完给一行 commit message 草稿，大炮手动提交。
5. **先讨论后实现**：涉及 engine-core 改动、跨模块重构、协议变更，先给方案和取舍，等大炮确认。
6. **任务单与代码不符时**：先 grep 核实真实函数名/调用链/文件路径，找企业级最佳方案，在交付记录里写明偏差和理由。不要因为任务单写错就凑活做，也不要默默改了不提。

---

## 3. 开工必读路由表

**不要一上来把 docs/ 全读了——context 会爆。** README + 当前任务单 = 99% 够用。遇到生字再翻字典。

| 你要做什么                  | 去读                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **开工第一步（必做）**      | `docs/worklog/README.md` — 后端 AI 开工自检，看 pending/ 里有什么任务单                                    |
| **代码红线 + 交付格式**     | `docs/team/conventions.md` — engine-core 红线、16 条硬约束、零压红线、交付记录格式                         |
| 文档总入口                  | `docs/README.md`                                                                                           |
| 引擎路线图 / 为什么这么设计 | `docs/architecture/ai-engine-roadmap-v1.1.md`                                                              |
| V6.0 引擎架构               | `docs/architecture/v6.0-ai-engine.md`                                                                      |
| BDI 认知引擎设计原则        | `docs/reference/bdi-cognitive-engine-principles-v1.0.md`                                                   |
| AI 模拟来访蓝图             | `docs/reference/ai-simulation-blueprint-v1.1.md`                                                           |
| 伦理/安全/兜底              | `docs/reference/architecture-blindspot-fill-v1.0.md`                                                       |
| 微服务演进边界（5 条规则）  | `docs/architecture/microservices-evolution-plan.md`                                                        |
| 活跃技术契约（spec）        | `docs/specs/active/`（6 份：语音训练 v0.3 / 全真执业 v1.2 / 自由练习 v1.3 / 来访池 / ASR-LLM / 语音 BIDI） |
| 架构决策记录                | `docs/adr/`（JWT vs Cookie / 异步审计 / TypeORM Migration）                                                |
| 本地环境 / 部署             | `docs/runbooks/local-setup.md` / `docs/runbooks/docker-deploy.md`                                          |
| Phase1 已交付速查           | `docs/worklog/completed/phase1/`（按 wp0-wp5-core / wp6-wp12-wiring / wp14-wp24-augment 分目录）           |

---

## 4. 当前阶段（2026-11-04）

- **Phase1 已封版**：WP0-WP26 全交付，8 个 P1 + 34 个 P2 全修，1252 例测试全绿。backlog 已归档到 `docs/worklog/completed/phase1/phase1-backlog-archived-2026-11-03.md`。
- **Phase2 已开工**：商业化准备，WP27-WP54 分三批并行。总览见 `docs/worklog/pending/phase2-overview-2026-11-03.md`，WP 清单见 `docs/worklog/pending/phase2-wp-list-2026-11-03.md`。
- **当前待开工任务单**：pending/ 里暂无任务单，等大炮派新单。
- **已交付的 Phase2 WP**：WP28（PsyGUARD 正式值）、WP34（P1 人格调节算子）、WP36（跨会话间隔自然衰减）、WP42（咨询同盟三维 trust/safety/bond）、WP52（轨迹快照 Delta 接同盟三维）、WP53（人格调节算子接同盟）、WP54（破裂态阻抗衰减下限）、WP55（会话摘要两侧纪要）、WP57（BDI 信念层深度扩展）。

**接任务前先 `ls docs/worklog/pending/`**——有任务单就从文件名排第一的开始做，没有就等大炮派新单，不要自己找事做。

---

## 5. 核心红线速查（完整版见 docs/team/conventions.md）

### 5.1 engine-core 纯层

- ❌ 不改 `src/engine-core/**` 下任何文件（大炮例外批准除外）
- ❌ 不在 engine-core 里加 `@nestjs/`、网络调用、prompt、模型名、`process.env`、`globalThis`
- ✅ 新逻辑放 `src/engine-adapters/` 或业务层
- ✅ delta cap 参数走注入（`DeltaCapConfig` 端口），不由内核读 env

### 5.2 工程硬约束（16 条里最容易踩的）

1. migration 真注册点是 `bin/ormconfig.ts`（import + `migrations[]` 数组），漏登记会静默不建表
2. counselor 系 migration 一律手写 DDL，`migration:generate` 扫不到 counselor entity
3. 软删不是 `@DeleteDateColumn`——每处查询手写 `deletedAt: IsNull()`
4. 结构化输出只有一条链：走 `CounselorLlmJsonClient`
5. `.env` 的 `MINIMAX_LLM_MODEL` / `MINIMAX_BASE_URL` 是 ASR/TTS 共用值，不许动
6. M3.1-Flash 忽略 `temperature`/`top_p`；thinking token 计入生成长度上限
7. SSE 事件总线是进程内的——多实例部署需换 Redis Pub/Sub
8. jobId 要幂等
9. agent 与 business 之间只走 `@Global` 注册表
10. WS 握手 JWT 走 `handshake.auth.token`（Socket.IO 标准），不走 URL query

### 5.3 零压红线

- 自由练习（practice）**无分数 / 无对错 / 无评级**
- 分数只允许出现在 MCQ 备考频道（training-exercises）
- 两套 DTO 不得混算

### 5.4 隐私红线

心理内容（AI 对话原文、量表答案、心理画像、自伤输入）禁止进普通日志、crash report、网络日志。详细分级见前端仓库 `AGENTS.md` §5.1 和 `ARCHITECTURE.md` §6。

---

## 6. 交付格式（每个任务做完必做）

1. 在同目录写 `*-implementation-YYYY-MM-DD.md`：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字（`npx eslint` 0 error / `npx tsc --noEmit` 0 error / `npx vitest run` 全绿 / `git diff --stat HEAD -- src/engine-core` 为空）。
2. 任务单 + 交付记录从 `pending/` 移到 `completed/phase2/` 对应子目录。
3. 任务单顶部状态行从 `📋 待开工` 改成 `✅`，指向交付记录文件名。
4. 给一行 commit message：`feat(wpXX): 一句话说清做了什么`。
5. 回写 backlog 母版。

详细规范见 `docs/team/conventions.md` §二。

---

_最后更新：2026-11-03。本文件是入口路由表，深度规范在 docs/ 下。_
