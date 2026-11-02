# WP19-R · 留痕链接通修订（traceRecorder 接线 + AdminDebug 收口）

> 日期：2026-10-30 ｜ 仓库：`E:\Work\Project\backend\mofang-nestjs`
> 性质：WP19 修订单——把"已声明交付但实际没接线"的留痕链真正接通
> 状态：📋 待开工 ｜ 前置：无（WP18/WP19 已在，本单是收口，不重开设计）
> 🔴 **本单不加任何新功能**：快照结构、端点清单、存储位置全部沿用 WP19 原单（`engine-wp19-admin-debug-module-trace-2026-10-29.md` §1.1/§1.2）。唯一目标是让 `traceRecorder` 真的落库 + admin/api 收口 6 个审计点。**验收以实跑 DB 行为为准，不接受通读代码后声明完成。**

---

## 0. 为什么有这条

WP19 已于 2026-10-29 登记"已交付"，但 2026-10-30 代码级对账（`code-vs-blueprint-audit-2026-10-30.md` §4.1）证明交付声明不成立——调试工具是内测期的眼睛，现在这双眼睛是瞎的：

| 审计点 | 现状（实锤） |
|---|---|
| D1/D2 | `traceRecorder` 恒 `undefined`，从未注入 EngineStreamBackend；`recordTrace()` 首行守卫直接 return → `turn_debug_trace` 恒空，"每轮 BDI 快照落库"没发生过一次 |
| D3 | `GET /admin/api/characters` 查的是 `visitor_pool_templates`（速查卡表），不是引擎角色池 `character_profiles` → 调试器看到的角色与引擎实际注入的基线不是同一份 |
| §4.1 | `/admin/api/*` 整条路由零鉴权（`ADMIN_BASIC_AUTH_*` env 零命中） |
| §4.1 | sessions 列表不按请求用户过滤 → 任何访问者能看到全部学员会话 |
| D27 | 会话不存在时 `not_found` 返 200，不是 404 |
| D17 | `docs/README.md` 索引里 WP19/WP20 没有行 |

---

## 1. 范围

### 1.1 traceRecorder 真正接线（本单核心）

**现状**：EngineStreamBackend 的 DI 装配处没有注入 traceRecorder，`recordTrace()` 被首行守卫跳过，turn 结束后什么都没落库。

**要做**：
- 在 EngineStreamBackend 的 DI 装配处把 `traceRecorder` 实例注入进去，每轮 turn 结束后 `recordTrace()` 真正执行落库。
- 落库 JSON 契约**逐字沿用 WP19 原单 §1.1**：`turnIndex / characterSlug / bdiSnapshot{trust,valence,arousal,resistance,anxiousSecure} / renderSpec{taskKind,promptPreview 截断 500 字,maxCompletionTokens,reasoningEffort} / llmUsage{promptTokens,completionTokens,reasoningTokens,ttftMs,finishReason} / crisis{detected,category} / ts`。
- `ENGINE_DEBUG_TRACE_ENABLED` env 开关沿用原单（dev 缺省开、prod 缺省关）。
- **留痕失败不炸链**：写库异常只打 error 日志，不抛给 WS 会话、不阻断 turn——调试器不能反过来把对练搞挂。
- 若原单设想的存储位置实际未建表/未加列，在适配层用现有 turn-analysis 存储承接，并在交付记录里写明最终落点（不新增表）。

### 1.2 `/admin/api/characters` 改查角色池

**现状**：端点查 `visitor_pool_templates`。

**要做**：
- 改查 `character_profiles`，返回 slug、codename、baseline 参数（trust/resist/valence/arousal）、上下架状态。
- 与引擎 openSession 实际解析注入的角色同源：挑一个真实 `vpt_*` slug，端点返回的 baseline 与引擎注入的 `characterProfile` 一致。

### 1.3 `/admin/api/*` 补 basic auth

**现状**：整条路由零鉴权。

**要做**：
- 加 basic auth middleware，读 env `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASS`。
- 两个 env 都配置时生效：无凭据或凭据错误 → 401；未配置时 dev 环境裸奔放行（沿用原单口径）。

### 1.4 sessions 列表按用户隔离

**现状**：不按请求用户过滤，谁都能看全部会话。

**要做**：
- 学员身份请求时，列表只返回该学员自己的会话。
- 凭管理员 basic auth 凭据访问时不过滤。不引入新权限系统。

### 1.5 not_found 改 404

**现状**：会话不存在返 200。

**要做**：`GET /admin/api/sessions/:id` 会话不存在 → 404。会话存在时返回内容沿用原单 §1.2（元信息 + trace 数组 + 逐字稿 + 报告，报告四态对齐 WP18）。

### 1.6 文档索引

**要做**：`docs/README.md` 索引补 WP19、WP20 两行（任务单 + 交付记录链接）。

---

## 2. 不做（红线）

| 不做 | 理由 |
|---|---|
| 不改 `src/engine-core/**` | 留痕在 wiring/adapter 层取数，内核零改动 |
| 不加新表/新列 | 沿用原单存储位置；缺存储就在适配层承接 |
| 不做角色 CRUD / 用户管理 / 实时大盘 / WS 推送 | 沿用 WP19 原单边界，Phase2 |
| 不做 admin-dashboard 切真 API | 那是 WP20 后续轮，本单只保证后端端点出真数据 |
| 不动旧 visitor 链路（`ENGINE_VOICE_ENABLED=false`） | 行为必须与本单前逐字一致 |
| 不改 WP19 原单快照 JSON 契约 | 已被 WP24/报告页依赖，不动 |

---

## 3. 验收

| # | 验收条 | 通过标准 |
|---|---|---|
| 1 | 留痕真落地 | 调试端点或 voice 链路真跑 ≥2 轮对练后，DB 里有 ≥2 行 trace 记录，每行 bdiSnapshot 四值非空、llmUsage.completionTokens > 0；交付记录贴脱敏查询结果 |
| 2 | 守卫消除 | `recordTrace()` 不再因 traceRecorder undefined 早退；DI 装配处可指明注入关系 |
| 3 | characters 同源 | 端点返回 slug 列表与 `character_profiles` 表一致；挑 `vpt_*` slug 与 openSession 注入的 characterSlug 相同 |
| 4 | 鉴权 | 配好 env 后无凭据 → 401，正确凭据 → 200 |
| 5 | 用户隔离 | 学员 A 的请求看不到学员 B 的 sessionId（管理员 basic auth 除外） |
| 6 | 404 口径 | 不存在的 `sessions/:id` → 404 |
| 7 | 留痕失败不炸链 | 人为让写库失败，turn 仍正常返回 reply，仅 error 日志 |
| 8 | 旧链路零变化 | `ENGINE_VOICE_ENABLED=false` 会话行为与本单前一致 |
| 9 | 新增单测 | 覆盖：trace 成功落库 / 写库失败不炸链 / 401 与 200 / characters 返回 character_profiles / not_found 404 |
| 10 | 文档 | `docs/README.md` grep 得到 WP19/WP20 行 |

**复跑闸门**（与全仓 WP 一致，交付时贴实测数字）：
- `npx eslint "src/**/*.ts"` → 0 error（0 warning 更好）
- `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- 新增测试套件全绿，engine-adapters + engine-core + voice 既有套件零回归
- `git diff --stat HEAD -- src/engine-core` 为空（内核整树零改动）

---

## 4. commit 文案

```
fix(engine): WP19-R 留痕链真正接线——traceRecorder 注入 EngineStreamBackend 落 turn_debug_trace，admin/api 补 basic auth + 用户隔离 + characters 改查 character_profiles + 404 口径
```

---

## 5. 一句话给后端

> EngineStreamBackend 的 traceRecorder 从来没被注入，recordTrace 首行就 return，turn_debug_trace 是空表。把 DI 接上让每轮真落库（契约照抄 WP19 原单 §1.1），顺手把 admin/api 的 characters 改查 character_profiles、加 basic auth、sessions 按用户隔离、not_found 改 404。半天的活，真跑两场贴 DB 查询结果当验收，别通读代码就算完。

---

## 6. 交付摘要（2026-10-30 收口）

**状态**：✅ 代码已交付 · 实跑取证通过 · **未 commit**（按任务单要求不自动提交）

**交付记录**：[engine-wp19r-trace-wiring-revision-backend-implementation-2026-10-30.md](engine-wp19r-trace-wiring-revision-backend-implementation-2026-10-30.md)

**6 件事逐条**：

| # | 事项 | 状态 |
|---|---|---|
| 1 | `traceRecorder` 真正注入 EngineStreamBackend 的 DI 装配，每轮 turn 结束真落库 | ✅ 工厂第 6 位不再恒 `undefined`；`useFactory` 注入 `TraceRecorder`；每轮**即刻**落库（同场多次写串行化防乱序）；写库失败只 error 日志不炸链 |
| 2 | `GET /admin/api/characters` 改查 `character_profiles` | ✅ 返回 slug / codename / baseline 四值 / resistance 三项 / 上下架 + 审核态；与引擎注入基线**逐值一致**（实测） |
| 3 | `/admin/api/*` basic auth middleware | ✅ env `ADMIN_BASIC_AUTH_USER`/`PASS`，**两个都配才生效**，无凭据 401；学员身份复用既有 `JwtAuthGuard`；只配一个按"未开启"处理并 warn |
| 4 | sessions 列表按请求用户隔离 | ✅ 学员只看自己的；basic auth 管理员不过滤；详情端点同口径（越权返 **404**，不返 403 以免泄露 id 存在性） |
| 5 | `GET /admin/api/sessions/:id` 不存在 → 404 | ✅ `BizException(BizCode.ResourceNotFound)` → HTTP 404 |
| 6 | `docs/README.md` 索引补 WP19/WP20 行 | ✅ 补 WP19 / WP19-R / WP20 三行（各带任务单 + 交付记录链接） |

**验收实测**：

- eslint `0 error 0 warning` / tsc `0 错` / 新增套件 **18 例全绿** / 全量 **61 套件 954 例全通过**（零回归）/ `git diff --stat HEAD -- src/engine-core` **为空**
- **真跑取证**：真实 DI 装配 + 真实 MySQL + 真实上游模型，2 场对练 × 2 轮 → 两场 `turn_debug_trace` **各 2 行（= 轮次数）**；`bdiSnapshot` 四值非空（trust 0.2 / valence -0.55 / arousal 0.18 / resistance 0.62）；`llmUsage.completionTokens` **556 / 588 / 585（> 0）**；`characterSlug = vpt_grief_avoidance_l1`；`promptPreview` 长 500（截断生效）；`maxCompletionTokens=1500` / `reasoningEffort=low`

**顺手治本的真病（超出任务单字面，必要）**：TypeORM `Repository.save(整行)` 对 JSON 列**按引用**比较 → 逐字稿 / tech_stats / 知情同意 / 报告链接的写手会把**加载时的旧 `turn_debug_trace` 副本写回**，覆盖并发落库的留痕（接上 DI 后第一轮实跑仍丢轮次：2 轮只剩 1 轮）→ 6 处写手全改成**只写自己管的列**的定向 `update`。详见交付记录 §2。

**遗留（已在交付记录 §9 登记）**：① 前端 `admin-dashboard/src/api/types.ts` 的旧 `TurnTrace` 类型（`bdi`/`usage`）与 §1.1 新契约（`bdiSnapshot`/`llmUsage`）**失配**，WP20 切真接口时须对齐（本单按红线不动前端）；② `llmUsage.promptTokens` 恒 0 = "输入侧不可得"，**不代表没花钱**（与 WP24 `costBasis: output_only` 同款纪律）；③ 生产部署务必把两个 basic auth env **配齐**，否则 `/admin/api/*` 按 dev 裸奔口径放行（会打 warn）。
