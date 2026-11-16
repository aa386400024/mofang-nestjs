# WP32 交付记录 — BDI 状态持久化（内存 → Redis）

> 状态: ✅ 已交付
> 任务单: [`wp32-bdi-state-persistence-2026-11-04.md`](wp32-bdi-state-persistence-2026-11-04.md)
> 日期: 2026-11-05
> 红线: ✅ **未改 engine-core** —— `git diff --stat HEAD -- src/engine-core` **为空**（任务单 §6.2 明确要求；内核端口 WP0 就位，本期只加适配层实现）
> 边界断言: ✅ `boundary.spec.ts` 12 例全绿（11 条不变量 + 1 条扫描自检），barrel 公开出口面一字未动

---

## 1. 实际改了哪些文件

### 1.1 适配层：2 改 + 2 增（任务单 §5.2 只列 1 个 → **偏差登记**，见 §2.1）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/persistence/redis-bdi-state.repository.ts` | **新增**（任务单 §3.1 的落点）：`RedisBdiStateRepository`（实现内核 `BdiStateRepository` 端口）+ 窄面 `RedisBdiStateClient` + `RedisServiceBdiStateClient`（薄适配）+ `BDI_STATE_CAS_SCRIPT`（Lua 原子 CAS）+ `DEFAULT_BDI_STATE_REDIS_TTL_SECONDS` |
| `src/engine-adapters/wiring/bdi-state-store.config.ts` | **新增**：`resolveBdiStateStoreConfig` —— env 原始字符串 → `{ store, ttlSeconds }` 的**纯函数**归一（理由见 §2.1） |
| `src/engine-adapters/wiring/engine.providers.ts` | ① 新增纯工厂 `createBdiStateRepository`（按存储形态分流：memory / redis）；② `createEngineSessionPort` 加**第 4 位可选参** `bdiStates?: BdiStateRepository`（缺省 = 内存仓储 = 行为逐字不变） |
| `src/engine-adapters/wiring/engine.module.ts` | `ENGINE_SESSION_PORT` 的 `useFactory` 注入 `RedisService`，读 env → `resolveBdiStateStoreConfig` → `createBdiStateRepository` → 传给 `createEngineSessionPort` |

### 1.2 配置面：2 改

| 文件 | 改了什么 |
|---|---|
| `.env.example` | 新增生效行 `ENGINE_BDI_STATE_STORE` / `ENGINE_BDI_STATE_REDIS_TTL_SECONDS`（**留空** = 继承代码缺省，符合本文件「可选覆盖类键留空」的部署契约口径） |
| `typings/global.d.ts` | 新增两个 env 键的 `ProcessEnv` 显式声明（与 `ENGINE_CAP_*` / `ENGINE_MOD_*` / `ENGINE_DECAY_*` 同一治本思路：逐个字面量读，不用计算键绕过） |

### 1.3 测试：1 增

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp32-bdi-state-persistence.spec.ts` | **新增 32 例**：存取往返 / 乐观锁冲突 / 参数校验 / 存储故障 / TTL / 租户隔离 / 撞键防护 / **与内存版口径一致** / 装配分流 / 配置解析 / 零回归 / Lua 脚本形状守卫 |

### 1.4 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp32-bdi-state-persistence-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP32 行 ✅ + 交付记录链接；统计进度 18/41 → 19/41 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP32；进度回写 19/41；目录结构说明 +WP32 |

### 1.5 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- `InMemoryBdiStateRepository` —— **一行未动**（新 Redis 版与它**同口径**，不是新规则）
- `InMemoryEngineSession` —— **一行未动**（它早就在调 `bdiStates.load/save`，换实现即自动生效）
- 内核端口 `BdiStateRepository` / `BdiStateRecord` —— **一行未动**
- `src/shared/infra/redis/redis.service.ts` —— **一行未动**（理由见 §2.5）
- 无 migration / 无 entity / 无 DB 表（本期不做 DB 兜底，任务单 §4.3）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策：适配层改了 **4 个文件**，任务单 §5.2 只列 1 个（**偏差**）

任务单 §5.2 写的是「适配层改动（2 个文件）」，§5.3 写的是「`.env.example` 加两个键」。本单实际动了 4 个适配层文件 + `.env.example` + `typings/global.d.ts` + 1 个测试文件。多出来的逐条理由：

| 多改的文件 | 为什么必须改 |
|---|---|
| `bdi-state-store.config.ts`（新增） | **`engine.providers.ts` 的文件头明令「不在工厂里读 env：env 由调用方（useFactory）读好后传入，工厂保持纯」**。所以 env → 配置的归一**不能**塞进 `engine.providers.ts`，必须是**另一个纯模块** —— 这与仓库既有的 `session-decay.config.ts` / `personality-modulator.config.ts` / `alliance-config.ts` **完全同款**（同一个治本，三处已落地）。任务单没列它，是因为任务单写的是「怎么接」，不是「仓库既有的 env 归一分层长什么样」。 |
| `typings/global.d.ts` | 仓库 env 治理约定（该文件自身的注释写明）：env 键要**显式声明到 `ProcessEnv`**。`ENGINE_CAP_*` / `ENGINE_MOD_*` / `ENGINE_ALLIANCE_*` / `ENGINE_DECAY_*` / `SESSION_SUMMARY_*` 五族全部照此办理。漏声明 = 下一个读这个键的人拿到 TS4111 然后用 bracket 访问绕过。 |
| `engine.module.ts` | 任务单 §3.2 说「装配层切换」，但没说在哪个文件。`engine.module.ts` 是**唯一**能拿到 `RedisService` 实例与 `ConfigService` 的地方（`engine.providers.ts` 是纯工厂，不该认识 Nest）。且该文件自己的文件头写着「构造逻辑归工厂，`@Module` 只声明 token ↔ 工厂的映射」—— 所以本单在 `engine.module.ts` 里**只有 env 读取 + 调工厂**，没有 `new`。 |

### 2.2 决策：Redis key 加**长度前缀**，与任务单给的 `bdi:{tenantId}:{sessionId}` **刻意不同**（**偏差**）

任务单 §3.1 原文：「key: `bdi:{tenantId}:{sessionId}`」。本单实现为：

```
bdi:{tenantId.length}:{tenantId}:{sessionId.length}:{sessionId}
```

**为什么改**：任务单那版用 `:` 直接拼，`(租户="a:b", 会话="c")` 与 `(租户="a", 会话="b:c")` 会**撞键** —— 撞键的后果是**跨租户串状态**（静默的隐私事故）。内存版 `InMemoryBdiStateRepository.buildKey` 早就用长度前缀解决了同一问题，注释里写着「这类键拼接事故在多租户下是数据串号」。本单沿用**同一套复合键纪律**，让两个实现对「什么算同一场会话」的判断**逐字一致**（任务单 §3.2 要求的「与内存实现同一口径」）。

长度前缀不影响可读性（运维 `redis-cli --scan --pattern 'mofang:bdi:*'` 照常看得到租户与会话），且**多一层保险**：load 侧还会校验「值里的 tenantId/sessionId 与请求一致」，撞键或数据被改写时**响**（`STORAGE_FAILURE`），而不是静默当成「没有状态」。

### 2.3 决策：乐观锁用 **Lua 原子 CAS**，不是「先 GET 再 SET」（**偏差**）

任务单 §3.1 写的是「save: 写进 Redis，带乐观锁（revision 校验）」，未指定实现方式。本单用 Lua 脚本 `BDI_STATE_CAS_SCRIPT` 在 **Redis 侧原子完成**「读已存 revision → 比较 → 写 → 续 TTL」。

**为什么必须原子**：内存版的「检查 revision」与「写入」之间**没有 `await`**（单线程，天然原子）；Redis 版若用「先 GET 再 SET」，两次调用之间隔着 `await`，**两个并发写者都读到 revision=1 时都会通过检查**，后写者会**静默覆盖**先写者的状态且**无法追溯** —— 这正是内核端口注释里点名要防的事（「后写者会静默覆盖先写者的状态，且无法追溯」）。

补充一个实测事实：内核 `InMemoryEngineSession.turn` **没有 per-session 互斥**，同一 handle 的两个并发 `turn` 可以交错 —— 所以这不是纯理论风险。

**为什么 CAS 做成窄面的**语义方法**（`compareAndSetByRevision`）而不是「给调用方一段 Lua 自己拼」：乐观锁规则**只有一份**，调用方拿不到「忘了传 revision」这种用法；单测也能用极小替身覆盖（与 `QdrantMemoryClient` 同一治本）。

### 2.4 决策：存储形态**非法值启动期直接炸**，不静默回落成 `memory`（**偏差**）

任务单 §3.3 只说「默认 `memory`（零回归）」，没说非法值怎么办。仓库里**调参类**配置（cap 系数 / 人格系数 / 半衰期）一律「非法值回退种子值，不抛错」；但本单**故意不同**：

- 调参值写错 → 某一维系数回到默认，行为仍然确定；
- **存储形态写错 → 整个持久化能力消失，而且不报错** —— 线上以为在持久化，实际一条都没存（进程重启照样丢状态，只是没人知道为什么）。

`engine.providers.ts` 的文件头写着「不在工厂里吞异常：装配非法必须炸到启动期，静默回落成纯内存 = 线上以为在持久化，实际一条都没存」。本单照此办理：**空值 → `memory`（零回归）；非法值 → 启动期抛错**。

TTL 则相反：**非法值回退默认（604800），不抛错** —— TTL 只是「多久清理僵尸会话」的运维旋钮，填错不影响状态存不存在。两者的风险等级不同，处置就该不同。

### 2.5 决策：`RedisService` **零改动**，用既有的 `getClient()` 逃生口

`RedisService` 是**全仓共用**的基础设施。为了引擎的乐观锁给它加一个 `eval`（或更糟：加一个 BDI 专用方法），等于让基础设施认识「BDI 状态」这件事 —— 层次倒置。`getClient()` 本来就是为「multi / pipeline / SCAN MATCH 这类特殊场景」开的口子，EVAL 正是其中之一。

**实测核实**（本地 node 直跑 ioredis 5.11.1 的 `Command` 构造）：`eval(script, 1, key, ...)` 的 key **会被自动拼上 `keyPrefix`**（`mofang:bdi:...`）—— 所以多环境隔离口径与其它 Redis 键**完全一致**，不用手工拼前缀，也不用自己维护前缀字符串。

### 2.6 决策：`createEngineSessionPort` 的 `bdiStates` 放**第 4 位位置参数**，不塞进 `tuning`

任务单 §5.2 说「`engine.providers.ts` —— 根据 env 选择用内存还是 Redis」，用户的转述说「`createEngineSessionPort` 加 `bdiStates?` 参数」。

`EngineSessionTuningDeps` 装的是**调参端口**（cap 配置 / 观察者 / 人格调节 / 同盟三维 / 衰减半衰期）—— 全是「同一段行为里怎么算」的旋钮。BDI 状态仓储是**依赖端口**（存哪儿），塞进去会把「调参」这个接口的语义搅浑（下一个读代码的人会以为 `tuning` 里都是可调系数）。所以走**第 4 位可选位置参数**：语义清楚，且省略时行为与之前**逐字一致**（`bdiStates ?? new InMemoryBdiStateRepository()`）。

### 2.7 决策：已存值**损坏**时，save 侧允许覆盖、load 侧报错（不是两种情况都报错）

Lua 脚本里：已存值不是合法 JSON、或没有数值型 `revision` → 视为「没有可比的已存版本」，**允许覆盖**。
理由：那份数据本来就不可用，留着只会让这场会话**永远写不进去**（自我拒绝服务）—— 一次坏数据把整场对练卡死，比覆盖它更糟。

load 侧则相反：形状非法 → 抛 `STORAGE_FAILURE`（**响**，不当成「没有状态」）。因为 load 的调用方是内核会话，拿到一个假的「null」会让它**当成新会话开**（状态静默丢失）。

### 2.8 决策：TTL 语义澄清 —— 每次 save **续期**，「7 天」只是清理僵尸会话

任务单 §3.1 写「TTL: 7 天（自动清理过期会话）」。实现上**每次 save 都会重设 TTL**（`SET ... EX`），所以：
- 一场**还在进行**的对练，每轮都写 → TTL 一直续 → **不会中途丢状态**；
- 「开完就再没回来」的会话 → 7 天后自动清掉。

这不是缓存语义（内存版明确「不加 TTL —— 状态是会话级持久物」），是**僵尸会话回收**。两种存储形态的生命周期口径因此一致：内存版靠进程重启回收，Redis 版靠 TTL 回收。

### 2.9 决策：新增 `STORAGE_FAILURE` 错误路径（内存版没有的）

内核端口注释里已经写好了这条契约（WP26 · P2-18 补的）：「`@throws EngineCoreError code=STORAGE_FAILURE 底层存储不可达 / 查询失败`」。内存版永远不会触发（无外部依赖），Redis 版会。本单按契约实现：Redis 不可达 / 读写失败 → `STORAGE_FAILURE`；**不静默回落成内存版**（回落是**部署形态**的决定，由 env 显式选；运行期悄悄回落 = 线上以为在持久化，实际没存）。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error / 0 warning**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **100 个测试文件 / 1634 例全绿**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts' --exclude '**/wp32-bdi-state-persistence.spec.ts'` | **99 个测试文件 / 1602 例全绿**（exit 0）—— 既有测试**一条没改、没删、没跳过** |
| `npx vitest run test/engine-adapters/wp32-bdi-state-persistence.spec.ts` | **32 例全绿**（本轮新增） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（11 条不变量 + 1 条扫描自检） |
| `npx vitest run test/config/wp25-env-example-coverage.spec.ts` | **9 例全绿**（env 双向断言：两个新键**既**在 `.env.example` 有生效行，**又**在代码里被读到） |
| `git diff --stat HEAD -- src/engine-core` | **空** —— 本期**未改内核** ✓ |

**回归确认**：

- **内核零回归** —— `src/engine-core/**` 一行未动；边界断言 ①②③④⑤⑥⑦⑧⑨⑩⑪ 全绿（零 `@nestjs` / 零 typeorm / 零 process.env / 零 globalThis / barrel 公开出口面未动 / 适配层零深路径 import 内核内部模块）。
- **默认配置零回归** —— `ENGINE_BDI_STATE_STORE` 缺省 = `memory` = **同一个 `InMemoryBdiStateRepository` 类**（用例 `store=memory → 内存版` 直接 `toBeInstanceOf` 钉死），行为与本单之前**逐字一致**。
- **换实现不换行为** —— 新增用例把**同一串操作**分别喂给内存版与 Redis 版，断言出参 `toEqual` 一致、冲突判定（错误码）一致。
- **既有断言零改动** —— 既有测试文件**一条没改**，只新增 1 个文件 32 例。
- **env 契约零漂移** —— 两个新键都进了 `.env.example` 生效行（留空 = 继承代码缺省），且都被代码**逐个字面量**读到（AST 抽取看得见，漏一个键断言①立刻变红）。

> ℹ️ **基线口径说明**：WP61 交付记录里的「97 文件 / 1549 例」是**当时的**基线；此后 WP35 / WP41 / WP49 三单落地并各自带了自己的测试文件，所以本单开工时的真实基线是 **99 文件 / 1602 例**。上表两个数字都跑了，是为了让「零回归」这条有**本轮可对拍**的基准，而不是引用一个已经过期的数字。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **MySQL / DB 兜底持久化**（任务单 §4.3 第 1 条）—— 本期只做 Redis。backlog 母版里 WP32 那行写的是「Redis 为主，**DB 兜底**」，兜底部分留到后续独立 WP。
2. **多实例同步**（任务单 §4.3 第 2 条）—— 本期仍是单实例部署；Redis 版只是**持久化**，不是分布式一致性。
3. **状态版本迁移**（任务单 §4.3 第 3 条）—— BDI schema 升级后的旧数据兼容没做（当前 JSON 是自描述的，但**没有** schema 版本号，也没有迁移器）。
4. **状态压缩**（任务单 §4.3 第 4 条）—— 直接 JSON 序列化，不压缩。
5. **状态查询 API**（任务单 §7 第 5 条）—— Admin Dashboard 查看历史 BDI 状态，是前端的事。
6. ⚠️ **Lua 脚本本体的真 Redis 验证**（**本单已知的验证缺口**）—— 本机 6379 未开、CI 也不保证有 Redis，所以自动化测试用**替身**复刻了 CAS 语义（`FakeRedisBdiStateClient`，注释里写明它复刻的是 `BDI_STATE_CAS_SCRIPT` 的规则），并额外加了一条**脚本形状守卫**（断言脚本含 `GET` / `SET ... EX` / `decoded.revision >= tonumber(ARGV[1])` 三要素）。**但"替身语义 == Lua 语义"这件事本身没有真 Redis 兜底** —— 上生产前建议在有 Redis 的机器上跑一次真脚本验证（或补一条带 docker-redis 的 e2e）。这条是**已知缺口，不装作已覆盖**。
7. **Redis 不可达时的降级策略**（比如自动回落内存并告警）—— 本单按端口契约抛 `STORAGE_FAILURE`，**不静默回落**。要不要加"显式配置的降级开关"，留给后续独立 WP 拍板（涉及产品口径：持久化失败时对练要不要继续）。

---

_创建：2026-11-05_
_深度通知：`BdiStateRepository` 端口契约与其乐观锁语义（`src/engine-core/domain/ports/bdi-state.repository.ts`）/ `InMemoryBdiStateRepository.buildKey` 的长度前缀与"撞键 = 跨租户串号"注释 / `InMemoryEngineSession.loadState` 已在调 `bdiStates.load`（换实现即自动生效）/ `InMemoryEngineSession.turn` 无 per-session 互斥（并发写是真风险）/ `EngineCoreError` 的 `STATE_CONFLICT` / `INVALID_INPUT` / `STORAGE_FAILURE` 三码口径 / `RedisService.getClient()` 的逃生口定位与 ioredis 5.11.1 对 EVAL key 自动拼 `keyPrefix` 的实测 / `engine.providers.ts` 文件头的"不在工厂里读 env"与"装配非法必须炸在启动期"两条铁律 / `engine.module.ts` 文件头的"构造逻辑归工厂" / `.env.example` 的"生效行 = 部署契约"与"可选覆盖类键留空"口径 / `typings/global.d.ts` 的 env 键显式声明治本 / `wp25-env-example-coverage.spec.ts` 的 env 双向断言 / `wp8-wiring.spec.ts` §8-9 的"装配层不得直连 SDK"护栏（`ioredis` 不在禁用清单内，且本单未在 `wiring/*.ts` 直引 ioredis） —— 逐条 grep 核实_
