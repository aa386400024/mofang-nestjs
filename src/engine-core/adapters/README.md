# engine-core · 适配器层约定

> **本目录当前为空（只有约定，没有实现）** —— 这是 WP0 的刻意留白。
> WP0 只立内核边界，不接线；任何 NestJS / WS / TypeORM 适配器都从 **WP1 起**才在此落地。

---

## 1. 这一层是干什么的

`src/engine-core/` 是**纯 TS 内核**：领域模型、状态机、算子、端口接口。
内核不知道 HTTP、不知道 WebSocket、不知道 MySQL、不知道 Qdrant。

本目录（`adapters/`）是内核与外部世界之间的**唯一接缝**：

```
   外部世界                        adapters/                    engine-core/
  ┌────────────┐            ┌──────────────────┐          ┌──────────────────┐
  │ WS 帧      │  ────────▶ │ 帧 ⇄ DTO 翻译     │  ──────▶ │ 会话端口          │
  │ HTTP 请求  │            │ 鉴权 / 租户解析   │          │ 仓储端口          │
  │ MySQL 行   │            │ 错误码 → 表现层   │ ◀─────── │ 领域模型          │
  │ Qdrant 点  │            │ 日志 / 指标       │          │ 算子 (纯函数)     │
  └────────────┘            └──────────────────┘          └──────────────────┘
```

## 2. ⚠️ 关键约定：适配器**分两层**放

内核包 `src/engine-core/` 有一条不可让步的硬指标（任务单 §5 验收原文）：

```
grep -rE "@nestjs|typeorm" src/engine-core/   # 必须零命中
```

这条指标的口径是**整棵树**，不是"内核核心子集"。所以适配器不能一股脑塞进本目录：

| 层 | 放哪 | 能写什么 | 为什么 |
|---|---|---|---|
| **A. 翻译层**（纯 TS） | `src/engine-core/adapters/` | 帧 ⇄ DTO 映射函数、错误码映射表、契约校验 | 纯逻辑、无框架依赖，**可随内核整包搬走**，是最有复用价值的部分 |
| **B. 装配层**（触框架） | `src/engine-adapters/`（内核包之外） | `@Injectable` / `@Module` / TypeORM Repository / Qdrant Client | 这些代码**依赖宿主环境**，搬走时本来就该重写；留在内核包里会直接破掉上面的 grep 指标 |

> 换句话说：**接口与翻译跟着内核走，实现跟着环境走。**
> 将来把 `src/engine-core/` 整包搬到独立微服务时，A 层直接带走，B 层按目标环境重写 —— 这正是 roadmap 第 0 原则说的「整包搬走，只换适配器」。

## 3. 硬规则（违反即架构回退）

| # | 规则 | 为什么 |
|---|---|---|
| 1 | **内核不得 import 本目录（或任何 adapter）** | 依赖一旦反向，内核就与框架缠死，整包搬不动 —— 这是本工程第 0 原则 |
| 2 | **`src/engine-core/` 全树零 `@nestjs/*` / `typeorm` import** | 见 `test/engine-core/boundary.spec.ts`：该不变量有机器断言（AST 级扫描），不是口号 |
| 3 | **内核不得 import `src/agent/visitor` / `src/voice`** | 旧扮演链路与内核**并列**存在（任务单 §1），内核不认旧链路，反过来也一样 |
| 4 | **adapter 不得把框架类型漏进内核 DTO** | `OpenEngineSessionInput` 等必须是纯数据；`class-validator` 装饰器、`WsException`、TypeORM 实体都不许出现 |
| 5 | **adapter 不承载业务决策** | 决策属内核（WP1 的 BDI 算子）；adapter 只做翻译、鉴权、落库路由、错误映射 |

## 4. 翻译表（落地时照此填，别自创映射）

| 外部概念 | 内核概念 | 说明 |
|---|---|---|
| WS `sessionId` | `OpenEngineSessionInput.sessionId` | 业务会话主键，内核内唯一 |
| 鉴权上下文里的租户 | `OpenEngineSessionInput.tenantId` | adapter 从 token/上下文解析后注入；内核不鉴权 |
| 仓库里的 `personaId` | `OpenEngineSessionInput.visitorId` | 内核**不感知** persona 实体结构（5Ps / 情绪基线 / 阻抗基线）；adapter 负责把 persona 解析成内核认识的稳定 id |
| 角色内核的 5Ps / 阻抗基线 | WP1 注入内核 | 属"角色原生设定"域，adapter 注入，内核只消费 |
| ASR final 文本 | `EngineTurnInput.userText` | 空白视为非法入参（内核抛 `INVALID_INPUT`） |
| barge-in 的 `AbortSignal` | `EngineTurnInput.signal` | 内核在轮次入口检查 `aborted` → 抛 `ABORTED`，不产生状态变更 |
| 链路 trace id | `EngineTurnInput.traceId` | 仅观测用，不参与内核决策 |
| `EngineCoreError.code` | 表现层错误 | `SESSION_NOT_FOUND` → 404；`INVALID_INPUT` → 400；`STATE_CONFLICT` → 409 或重试；`ABORTED` → 静默丢弃。**映射表归 adapter 所有** |
| MySQL 行 / Qdrant point | `BdiStateRecord` / `MemoryEntry` | 持久化实现放 B 层，**实现 `domain/ports/` 下的接口，接口不变** |

## 5. WP1 起的落点建议

```
src/engine-core/adapters/                  # A 层: 纯 TS, 随内核搬走
├── frame-translation.ts                   # WS 帧 ⇄ 内核 DTO 的纯映射函数
└── error-mapping.ts                       # EngineErrorCode → 表现层错误码的纯映射表

src/engine-adapters/                       # B 层: 触框架, 留在宿主仓库
├── nestjs/
│   ├── engine-core.module.ts              # 装配: 选实现 (内存 / MySQL / Qdrant) 并注册 provider
│   └── engine-session.adapter.ts          # 调用 A 层翻译函数 + 调内核端口
└── persistence/
    ├── typeorm-bdi-state.repository.ts    # 实现 BdiStateRepository (MySQL)
    └── qdrant-memory.store.ts             # 实现 MemoryStore (WP2)
```

> **接口定义必须留在 `src/engine-core/domain/ports/`**，实现类按 A/B 两层分开放。
> 接口跟着内核走，实现跟着环境走 —— 内核整包搬到独立微服务时，接口一行不用改。

## 6. 当前状态（WP0）

- 内核已可运行：`InMemoryEngineSession` + 两个内存仓储，`new` 出来即可跑 open → turn → close；
- **没有任何 NestJS 接线**：内核尚未挂进 `app.module.ts`，线上行为零变化；
- 旧扮演链路（`src/agent/visitor/`）继续服务线上，与内核并列，互不引用；
- `src/engine-core/adapters/` 目前只有本文件（无 .ts），因此内核包当前满足「整树 grep 零框架命中」。
