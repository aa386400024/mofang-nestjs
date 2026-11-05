# WP32 任务单 — BDI 状态持久化（内存 → Redis）

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp32-bdi-state-persistence-implementation-2026-11-05.md`](engine-wp32-bdi-state-persistence-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp32-bdi-state-persistence-2026-11-04.md`
> **优先级**：🟡 P1
> **引擎内核**：✅ 零改动（端口已就位，只做适配层实现）
> **前置依赖**：无
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §② 决策层

---

## 1. 任务概述

### 1.1 一句话目标

现在 BDI 状态存在内存里（`InMemoryBdiStateRepository`），**进程重启就全丢** —— 内测时每次重启都要从头开始。

本期提供一个 Redis 实现，让 BDI 状态持久化到 Redis，进程重启后也能恢复。

### 1.2 为什么现在做

- 内测刚需 —— 每次重启都丢状态，没法连续内测
- 内核端口已经就位 —— `BdiStateRepository` 端口早就定义好了，只是适配层只有内存实现
- 范围可控 —— 内核零改动，只做适配层的 Redis 实现 + 装配层切换

---

## 2. 现状盘查结论（已 grep 全渲染层核实）

### 2.1 内核端口已经就位

```ts
// src/engine-core/domain/ports/bdi-state.repository.ts
export interface BdiStateRepository {
  load(tenantId: string, sessionId: string): Promise<BdiStateRecord | null>;
  save(record: BdiStateRecord): Promise<BdiStateRecord>;
}
```

**记录结构**（`BdiStateRecord`）：
- `tenantId` / `sessionId` —— 双键隔离
- `revision` —— 乐观锁（单调递增）
- `updatedAt` —— 时间戳
- `snapshot` —— BDI 状态快照

### 2.2 内存实现已经有了

```ts
// src/engine-core/in-memory/in-memory-bdi-state.repository.ts
export class InMemoryBdiStateRepository implements BdiStateRepository { ... }
```

**问题**：进程重启就丢了。

### 2.3 装配层现在用的是内存实现

```ts
// src/engine-adapters/wiring/engine.providers.ts:174
bdiStates: new InMemoryBdiStateRepository(),
```

### 2.4 跨会话恢复已经在用

`InMemoryEngineSession` 的 `resumeFromSessionId` 已经在调 `this.bdiStates.load()` —— 只要换个实现，跨会话恢复自动生效。

---

## 3. 本期做什么

### 3.1 新增 Redis 实现

新增 `RedisBdiStateRepository`，实现 `BdiStateRepository` 端口：

```ts
// src/engine-adapters/persistence/redis-bdi-state.repository.ts
export class RedisBdiStateRepository implements BdiStateRepository {
  // load: 从 Redis 读 tenantId:sessionId 对应的记录
  // save: 写进 Redis，带乐观锁（revision 校验）
}
```

**Redis key 设计**：
- key: `bdi:{tenantId}:{sessionId}`
- value: JSON 序列化的 `BdiStateRecord`
- TTL: 7 天（自动清理过期会话）

### 3.2 装配层切换

根据 env 配置选择用内存还是 Redis：

```ts
// engine.providers.ts
const bdiStates = useRedis
  ? new RedisBdiStateRepository(redisClient)
  : new InMemoryBdiStateRepository();
```

### 3.3 配置项

新增 env 键：
- `ENGINE_BDI_STATE_STORE` —— `memory` / `redis`，默认 `memory`（零回归）
- `ENGINE_BDI_STATE_REDIS_TTL_SECONDS` —— TTL 秒数，默认 604800（7 天）

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么不改内核？

**因为端口早就就位了。**

- 内核的 `BdiStateRepository` 端口是 WP0 就定义好的
- 现在只是适配层只有内存实现
- 本期加一个 Redis 实现，内核一行不用改

### 4.2 ⚠️ 为什么选 Redis 不选 MySQL？

**BDI 状态是高频读写的。**

- 每轮对话都要 save 一次
- Redis 读写快，适合高频场景
- MySQL 做兜底（持久化到 DB）留到后面 WP

### 4.3 ⚠️ 本期不做什么？

1. **不做 DB 兜底** —— 本期只做 Redis，MySQL 持久化留到后面
2. **不做多实例同步** —— 本期还是单实例，Redis 只是持久化
3. **不做状态版本迁移** —— 本期不考虑 BDI schema 升级后的旧数据兼容
4. **不做状态压缩** —— 本期直接 JSON 序列化，不做压缩

---

## 5. 边界约束

### 5.1 内核改动

**零改动。** 端口早就就位了。

### 5.2 适配层改动（2 个文件）

1. `src/engine-adapters/persistence/redis-bdi-state.repository.ts` —— **新增** Redis 实现
2. `src/engine-adapters/wiring/engine.providers.ts` —— 根据 env 选择用内存还是 Redis

### 5.3 配置文件改动

1. `.env.example` —— 加 `ENGINE_BDI_STATE_STORE` / `ENGINE_BDI_STATE_REDIS_TTL_SECONDS` 两个键

### 5.4 不碰的地方

- ❌ 不改内核任何文件
- ❌ 不改 `InMemoryBdiStateRepository`
- ❌ 不改 `InMemoryEngineSession`
- ❌ 不做 DB 兜底
- ❌ 不做多实例同步

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `RedisBdiStateRepository` 实现了 `BdiStateRepository` 端口
- [ ] env 配 `memory` 时行为与现在逐字一致（零回归）
- [ ] env 配 `redis` 时状态持久化到 Redis
- [ ] 进程重启后能从 Redis 恢复 BDI 状态
- [ ] 乐观锁（revision 校验）正常工作

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → **空**（本期不改内核）

### 6.3 测试用例要求

至少补充：
1. Redis 实现的 save / load 正常路径
2. Redis 实现的乐观锁冲突路径
3. 装配层切换：env=memory 时用内存实现
4. 零回归：默认配置（memory）行为与现在逐字一致

---

## 7. 本期没做的（明确留给后续）

1. **MySQL 兜底持久化** —— 本期只做 Redis，DB 留到后面
2. **多实例同步** —— 本期还是单实例
3. **状态版本迁移** —— BDI schema 升级后的旧数据兼容
4. **状态压缩** —— 本期直接 JSON，不做压缩
5. **状态查询 API** —— Admin Dashboard 查看历史 BDI 状态

---

## 8. 转述给后端的话术

> WP32：BDI 状态持久化（内存 → Redis）。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp32-bdi-state-persistence-2026-11-04.md`。
>
> **内核零改动** —— 端口早就就位了，只做适配层：
> - `redis-bdi-state.repository.ts` —— **新增** Redis 实现
> - `engine.providers.ts` —— 根据 env 选择用内存还是 Redis
>
> 关键口径：
> - 端口 `BdiStateRepository` 早就定义好了，本期只是加一个 Redis 实现
> - env 默认 `memory` → 行为与现在逐字一致（零回归）
> - Redis key: `bdi:{tenantId}:{sessionId}`，TTL 7 天
> - 乐观锁（revision 校验）与内存实现同一口径
> - 本期不做 DB 兜底，不做多实例同步
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

## 9. 交付后补记（2026-11-05）

> 交付记录：[`engine-wp32-bdi-state-persistence-implementation-2026-11-05.md`](engine-wp32-bdi-state-persistence-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**，每条都能自圆其说。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §5.2「适配层改动（2 个文件）」 | 改了 **4 个适配层文件**（`redis-bdi-state.repository.ts` 新增 / `bdi-state-store.config.ts` 新增 / `engine.providers.ts` / `engine.module.ts`），另加 `.env.example` + `typings/global.d.ts` + 1 个测试文件 | ① `bdi-state-store.config.ts`：`engine.providers.ts` 文件头明令「不在工厂里读 env」，所以 env 归一必须单独成纯模块（与 `session-decay.config.ts` / `personality-modulator.config.ts` / `alliance-config.ts` 同款治本）；② `typings/global.d.ts`：仓库 env 治理约定要求 env 键**显式声明到 `ProcessEnv`**（`ENGINE_CAP_*` / `ENGINE_MOD_*` / `ENGINE_DECAY_*` 五族全部照办）；③ `engine.module.ts`：`ENGINE_SESSION_PORT` 的 `useFactory` 是唯一能同时拿到 `RedisService` 与 `ConfigService` 的地方，且它**只读 env + 调工厂**，没有 `new`（构造逻辑归工厂是 `engine.module.ts` 自己的文件头铁律） |
| 2 | §3.1「key: `bdi:{tenantId}:{sessionId}`」 | `bdi:{tenantId.length}:{tenantId}:{sessionId.length}:{sessionId}`（**加长度前缀**） | 任务单那版用 `:` 直接拼 → `(租户="a:b", 会话="c")` 与 `(租户="a", 会话="b:c")` **撞键** → 跨租户串状态（静默隐私事故）。内存版 `InMemoryBdiStateRepository.buildKey` 早就用长度前缀解决同一问题（注释原文：「这类键拼接事故在多租户下是数据串号」），本单沿用同一套复合键纪律 → 两个实现对「什么算同一场会话」的判断**逐字一致**（§3.2 要求的同一口径）。另加一层保险：load 侧校验「值里的 tenantId/sessionId 与请求一致」，撞键/被改写时**响**而不是静默当成"没状态" |
| 3 | §3.1「save: 写进 Redis，带乐观锁（revision 校验）」（未指定实现方式） | 用 **Lua 原子 CAS**（`BDI_STATE_CAS_SCRIPT`）在 Redis 侧完成「读已存 revision → 比较 → 写 → 续 TTL」 | 内存版的「检查 revision」与「写入」之间**没有 `await`**（单线程天然原子）；Redis 版若用「先 GET 再 SET」，两次调用之间隔着 `await`，**两个并发写者都读到 revision=1 时都会通过检查** → 后写者静默覆盖先写者且无法追溯（内核端口注释点名要防的事）。补充实测：内核 `InMemoryEngineSession.turn` **无 per-session 互斥**，同一 handle 的两个并发 turn 可以交错 → 这不是纯理论风险 |
| 4 | §3.3「默认 `memory`（零回归）」（未说非法值怎么办） | 空值 → `memory`；**非法值 → 启动期直接炸**（不静默回落） | 仓库里**调参类**配置一律「非法值回退种子值」，本单**故意不同**：调参值写错只影响某一维系数；**存储形态写错 = 整个持久化能力消失且不报错**（线上以为在持久化，实际一条都没存）。`engine.providers.ts` 文件头：「装配非法必须炸到启动期，静默回落成纯内存 = 线上以为在持久化，实际一条都没存」。TTL 则相反：**非法值回退默认不抛错**（TTL 只是清理节奏，风险等级不同） |
| 5 | §3.1「value: JSON 序列化的 `BdiStateRecord`」 | 照办（JSON 字符串），但 revision 判定在 Lua 里用 `cjson` 读 | 单 key = 一份状态，读写各一次往返；拆两个 key 会让「payload 与 revision 不一致」这种半截状态**变得可能**（多 key 原子写要靠 Lua 同时操作两个 key，复杂度不划算）。已存值损坏时：save 侧**允许覆盖**（否则一次坏数据把整场对练永久卡死 = 自我拒绝服务），load 侧**报错**（`STORAGE_FAILURE`，不当成"没状态"——那会让内核当成新会话开，状态静默丢失） |
| 6 | §5.2「`engine.providers.ts` —— 根据 env 选择用内存还是 Redis」 | `bdiStates` 走**第 4 位可选位置参数**，env 读取在 `engine.module.ts` | `EngineSessionTuningDeps` 装的是**调参端口**（cap / 人格 / 同盟 / 衰减），BDI 仓储是**依赖端口**（存哪儿），塞进去会搅浑 `tuning` 的语义。位置参数省略时 = `bdiStates ?? new InMemoryBdiStateRepository()` = **行为逐字不变** |
| 7 | 任务单未提 `RedisService` 怎么改 | `RedisService` **零改动**，用既有的 `getClient()` 逃生口跑 EVAL | `RedisService` 是**全仓共用**的基础设施，给它加 BDI 专用方法 = 层次倒置；`getClient()` 本就是为「multi / pipeline / SCAN MATCH 这类特殊场景」开的口子。**实测核实**：ioredis 5.11.1 对 `eval(script, 1, key, ...)` 的 key **自动拼 `keyPrefix`**（`mofang:bdi:...`）→ 多环境隔离口径与其它 Redis 键完全一致，不用手工拼前缀 |
| 8 | §6.3 用例清单（4 条） | **全部实现**，另加 **28 例**（租户隔离 / 撞键防护 / TTL / 存储故障 / 归属校验 / 与内存版逐字对拍 / Lua 脚本形状守卫 / 会话层注入接线） | 用例总数：wp32 spec 新增 **32 例**；全量 99 文件 1602 例 → **100 文件 1634 例** |
| 9 | ⚠️ 未提测试基础设施缺口 | **Lua 脚本本体没有真 Redis 验证**（本机 6379 未开、CI 不保证有 Redis） | 自动化测试用替身复刻 CAS 语义（`FakeRedisBdiStateClient`，注释写明它复刻的是 `BDI_STATE_CAS_SCRIPT` 的规则）+ 一条**脚本形状守卫**。但「替身语义 == Lua 语义」本身**没有真 Redis 兜底** —— 上生产前建议在有 Redis 的机器上跑一次真脚本验证。**已知缺口，不装作已覆盖** |

**闸门**：eslint 0 error / tsc 0 error / vitest **100 文件 1634 例全绿**（既有 99 文件 1602 例零回归 + 本轮新增 1 文件 32 例）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 12 例全绿 / `wp25-env-example-coverage.spec.ts` 9 例全绿。

---

_创建：2026-11-04_
_深度通知：`BdiStateRepository` / `BdiStateRecord` / `InMemoryBdiStateRepository` / `bdiStates` / `resumeFromSessionId` —— 全部 grep 核实_
