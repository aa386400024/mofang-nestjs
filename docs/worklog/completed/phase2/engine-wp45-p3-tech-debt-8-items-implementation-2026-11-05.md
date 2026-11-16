# WP45 · P3 技术债 8 条清理 · 交付记录

> 日期：2026-11-05
> 任务单：[`wp45-p3-tech-debt-8-items-2026-11-05.md`](./wp45-p3-tech-debt-8-items-2026-11-05.md)
> 范围：核实 8 条技术债 → 该改的改 / 该删的删 / 该报告的报告
> 边界：engine-core 零改动 · 心理内容不进日志 · 不自动 commit/push

---

## 一、一句话

8 条技术债逐条核实（不是照单全收）：**4 条真存在且已修**（其中 ① 挖出一个**线上一直在犯的 Qdrant SDK 契约 bug**）、**2 条早已被 Phase2 消化**（⑤⑥ 的主体）、**2 条定性为"不是 bug"或"不是本单该做的"**（③ 整条、⑦ 的"默认值"那半），另加审计报告里没被列进任务单的 **4 条**（P3-7 / P3-9 / P3-10 / P3-11）。

**engine-core 零改动。**

---

## 二、逐条核实结论（这是本单最核心的产出）

| # | 技术债 | 核实结论 | 本单动作 |
|---|---|---|---|
| ① | Qdrant `client: any` | ✅ **真存在**，而且**比任务单描述的严重**：它藏着一个**线上一直在犯的 bug** | 换成真 SDK 类型 + **修 bug** + 删文件级 eslint-disable |
| ② | `TemplateParameter = any[]` | ✅ 真存在（`util.service.ts`） | 收窄成 `unknown[]` + 显式转换口径 |
| ③ | cancelled 只写不读 | ⚠️ **"只写不读"属实，但"删掉"是错的**（WP25 审查已定论） | **保留 + 补注释**（写明为什么不能删） |
| ④ | Prometheus 告警规则 vs 指标 | ⚠️ **指标都在**，但规则本身有**三类缺陷**（不是"没指标"） | 删 3 条永不触发的 + 修模板语法 + 修 rate/count 语义 |
| ⑤ | 死配置 | ✅ **WP28 已处理完**（两个死键进了"预留键"区）；本单全量扫描**未发现新的死键** | 只报告，不改 |
| ⑥ | 衰减 / 边际递减 / 饱和 | ⚠️ **三个里有两个早就做了**（衰减 WP36+WP54、饱和 clamp01）；**边际递减真没做**，但那是**临床建模决策**，不是技术债 | 只报告，**不动内核** |
| ⑦ | QdrantMemoryStore 默认值耦合 | ⚠️ 衰减/召回配置**早已 env 化**（WP12/WP59）；collection 名是**刻意的代码常量**；真耦合只有**一处**："实现内部选实现" | 改那一处（fallback 必填） |
| ⑧ | 其他 | 审计报告里还有 **P3-7 / P3-9 / P3-10** 三条没被列进任务单；本单另新盘出 **P3-11**（Grafana 面板同款死指标） | P3-9 已修；P3-11 登记建议（R5）；P3-7 需内核批准 → 登记建议；P3-10 早已修 |

---

## 三、① 挖出来的真 bug（本次最高价值产出）

### 3.1 病灶

`src/ai-engine/providers/qdrant.service.ts` 原来长这样：

```ts
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
...
private client: any;            // ← 整个文件对类型系统隐形
...
await this.client.setPayload(collection, id, payload);   // ← v0.x 的三参形状
```

### 3.2 真 SDK v1.19 的契约（`@qdrant/js-client-rest@^1.19.0`）

```ts
// node_modules/@qdrant/js-client-rest/dist/.../qdrant-client.js
async setPayload(t, {payload:e, points:o, filter:a, ...}) { ... }
//                                   ↑ 只接 2 参, 且解构第 2 参
```

**第 3 个参数被整个忽略**，第 2 参（那个**字符串 id**）被解构成 `{payload: undefined, points: undefined, ...}` → 请求体形如 `{}` → Qdrant 必拒。

### 3.3 影响链（一路到召回结果）

1. `QdrantService.setPayload` 对真 SDK **100% 失败**；
2. `QdrantMemoryStore.remember` 捕获异常 → 只记一条 warn（`[remember] 冲突标记失败 (旧点未被排除)`）→ **不阻断**；
3. 于是 WP12 的**冲突消解标记（`supersededBy`）从未真正落库**；
4. 内核 `recall-policy.ts:141` 的判定 —— "已被取代的记忆不参与召回"（`supersededBy` 非空就拒）—— **永远不生效**；
5. 后果：**同主题的新旧两条矛盾记忆会一起被召回**（正是 WP12 要解决的问题，也正是 WP59 任务单里写的"两条矛盾的记忆都被召回来 = 模型混乱"）。

### 3.4 为什么一直没被发现

| 层 | 形状 | 结果 |
|---|---|---|
| 实现 → 真 SDK | 三参 | ❌ 对不上 |
| 窄端口 `QdrantMemoryClient` | **三参** | 自洽 |
| 单测替身 `StubQdrant` | **三参** | 自洽 |

**两端自洽，只有真 SDK 不认** —— 而 `client: any` 让 TS 连"看一眼"的机会都没有。

### 3.5 本单怎么修的

- `private client: any` → `private client!: QdrantClient`（真 SDK 类型）；
- **删掉文件级 `eslint-disable`**（`no-explicit-any` + `no-unsafe-assignment` 整块豁免没了）；
- `setPayload` 改成 SDK 的两参形状：`this.client.setPayload(collection, { payload, points: [id] })`；
- 顺带把 `ensureCollection` / `search` / `scroll` 里那堆 `as any` / `as {...}` 全删，改成类型安全的读法（`readVectorSize` 辅助函数）。

### 3.6 回归测试（新增 4 例）

`test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts` —— **打到 HTTP 层**：用真 `QdrantClient` + 拦 `globalThis.fetch`，断言**真的发出去的 URL 与请求体**。

| 用例 | 钉住的契约 |
|---|---|
| `setPayload` | `POST /collections/{c}/points/payload`，body = `{ points: [id], payload: {...} }` ← **就是那个 bug 的守卫** |
| `upsert` | `PUT /collections/{c}/points`，body = `{ points: [{ id, vector, payload }] }` |
| `scroll` | `POST /collections/{c}/points/scroll`，body 带 `filter` + `limit` + `with_payload` |
| `delete` | `POST /collections/{c}/points/delete`，body = `{ points: [id] }` |

> ⚠️ **为什么不打"实现 vs 替身"那一层**：替身也是三参形状，两端自洽 —— 第一版就是这么漏掉的。
> 只有**真的把请求发出去**、看**真的请求体**，才钉得住 SDK 契约。

---

## 四、改了哪些文件

### 4.1 后端 · 修改（5 个）

| 文件 | 改了什么 |
|---|---|
| `src/ai-engine/providers/qdrant.service.ts` | **①** `client: any` → `client!: QdrantClient`；删文件级 eslint-disable；**修 `setPayload` 的 SDK 契约 bug**；`ensureCollection` / `search` / `scroll` 的 `as any` 全删（新增 `readVectorSize` 辅助函数） |
| `src/common/providers/util.service.ts` | **②** `TemplateParameter = any[]` → `unknown[]`（删 eslint-disable）；模板参数的字符串化收在 `stringifyTemplateValue` 一处（显式 `String(...)`，拆掉"模板插值遇到 symbol 会抛"的雷） |
| `src/voice/voice.service.ts` | **③** `bargeIn` 的 JSDoc 补上"为什么 `state.status = 'cancelled'` 只写不读、为什么不能删" |
| `src/voice/voice.types.ts` | **③** `VoiceSessionStatus` 类型定义处补同一段说明（读代码的人第一眼看到的就是它） |
| `src/engine-adapters/persistence/qdrant-memory.store.ts` | **⑦** `fallback?: MemoryStore` → **必填**；删掉实现内部的 `new InMemoryMemoryStore()` 与对 `engine-core/in-memory/` 的 import —— **"选实现"回到装配层** |

### 4.2 运维配置 · 修改（1 个）

| 文件 | 改了什么 |
|---|---|
| `docker/prometheus/alerts.yml` | **④** 删 3 条**永远不触发**的规则（node_exporter / redis_exporter 的指标，而 `prometheus.yml` 里这两个 scrape job 都是注释掉的）；修 4 处模板语法（`{{ ${ $value } }}` → `{{ $value }}`）；把 3 处拿 `rate()` 比"次数"阈值的表达式改成 `increase()`；文件头写明"本文件只放后端自己暴露的指标的规则" |

### 4.3 测试（4 个）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts`（新） | 4 | **SDK 契约**：4 个写操作的**真实 HTTP URL + 请求体**（含 `setPayload` 那个 bug 的守卫） |
| `test/config/wp45-prometheus-alert-metrics.spec.ts`（新） | 4 | **告警规则 ↔ 后端真实指标**：① 规则引用的指标必须在 `MetricsService` 里注册过；② 注解模板不许出现 `${`；③ 描述讲"次数"的规则必须用 `increase()` |
| `test/engine-adapters/wp12-memory-closeout.spec.ts`（改） | — | 9 处 `QdrantMemoryStore` 构造补 `fallback`（⑦ 的 fallout） |
| `test/engine-core/boundary.spec.ts`（改） | +0 | 断言⑦ 补**反向**检查（内核树里出现未登记的文件 → 红灯） |

> **两个新守卫都是"机械化"的** —— 因为这两类债**在代码里看不出来**：
> · SDK 契约 —— 窄端口替身两端自洽，只有真 SDK 不认 → 必须打到 HTTP 层；
> · 告警规则 —— YAML 合法、PromQL 合法，只有真去查 Prometheus 才发现它永远为空向量 → 用**静态对照**代替（仓库没有起 Prometheus 的测试环境）。
> ⚠️ Prometheus 守卫**故意不引 YAML 解析库**：`js-yaml` / `yaml` 在本仓都只是**传递依赖**（@nestjs/config 带进来的），拿传递依赖写测试 = 哪天依赖树一变就红 → 按行扫一遍 YAML 就够，不引依赖更稳。

---

## 五、④ Prometheus：三类缺陷逐条

### 5.1 永远不会触发的 3 条（已删）

| 规则 | 引用指标 | 为什么永不触发 |
|---|---|---|
| `HighMemoryUsage` | `node_memory_MemAvailable_bytes` / `node_memory_MemTotal_bytes` | 这是 **node_exporter** 的指标；`prometheus.yml` 里没有 node-exporter 的 scrape job（连"可选"注释块都没有） |
| `HighCPUUsage` | `node_cpu_seconds_total{mode="idle"}` | 同上 |
| `RedisDown` | `up{job="redis-exporter"}` | `prometheus.yml` 里的 redis job **是注释掉的**（标"可选"）→ 这个 job 根本不存在 → 表达式恒为空向量 |

> **为什么删而不是补**：这些指标**不是本服务能暴露的**（是 exporter 的职责），补它们等于往 compose 里加 node-exporter / redis-exporter 两个新组件 —— 那是"加可观测组件"，不是清技术债。
> 任务单 §2.1 ④ 明确给了两条路："要么补指标，要么删掉没用的告警规则" → 本单选删。
> 怎么加回来：`alerts.yml` 文件头写了说明（先在 `prometheus.yml` 启用对应 job，再把规则加回）。

### 5.2 模板语法错的 4 处（已修）

```
✗ description: "5 分钟内 {{ ${ $value } }} 次登录失败 (可能是撞库攻击)"
✓ description: "5 分钟内 {{ $value }} 次登录失败 (可能是撞库攻击)"
```

Prometheus 的模板语法是 `{{ $value }}`；`${ $value }` 不是合法写法 → 告警能发出去，但**描述里的值是空的**。

### 5.3 拿速率比次数的 3 处（已修）

```
✗ sum(rate(auth_login_attempts_total{result="failed"}[5m])) > 10
   → 真实含义: "每秒失败超过 10 次" (= 5 分钟内 3000 次), 但描述写的是"5 分钟内 10 次"
✓ sum(increase(auth_login_attempts_total{result="failed"}[5m])) > 10
   → increase() 是窗口内增量, 单位=次, 与描述一致
```

`SlowRequestCount` 顺带修了：`sum(rate(bucket{le="+Inf"})) > 0 and sum(rate(_count)) > 100` 里前半段**恒真**（只要有流量就 > 0），整个 `and` 等价于后半段 —— 改写成 `sum(increase(http_request_duration_seconds_count[5m])) by (route) > 100`。

---

## 六、③ cancelled：为什么"补消费逻辑"和"删掉"都不对

**核实结果**：`state.status` 的四个读点（`phaseOf` / `shouldIgnoreTurn` / `onUserSpeaking` / `resumeSession`）分支的是 `'paused'` 与 `'processing'`，**没有一处读 `'cancelled'`**。属实。

**但任务单给的两条路都不对**：

| 路 | 后果 |
|---|---|
| 补消费逻辑 | **没有东西要消费** —— `'cancelled'` 在读侧与 `'idle'` **同义**（都表示"这一轮不在跑"），读侧一律靠 `!== 'processing'` 判定"没有正在跑的流水线"。再分一档是**凭空加语义** |
| 删掉这个状态 | ❌ **会坏** —— 删掉后 `state.status` 停在 `'processing'`，而 `onUserSpeaking` 的守卫是 `if (state.status !== 'processing') return;` → **下一次 `user_speaking` 会对一条已经死掉的流水线再打断一次**（重复 abort / 重复 dispose） |

**权威结论**：WP25 审查报告 §1.5 早就定过 —— *"abort → cancelled 帧 —— 不是 bug，划掉"*，barge-in 是**正常交互**不是错误，客户端收 `cancelled` 帧才是对的语义。

**本单动作**：**保留 + 补注释**（`bargeIn` 的 JSDoc + `VoiceSessionStatus` 的类型定义处各一处），写明"它为什么长这样、为什么不能删" —— 免得下一个读代码的人把它当冗余清理掉。

---

## 七、⑤ 死配置：核实结论

**已被 WP28 处理完**（2026-11-03）：

- `QDRANT_COLLECTION` / `VOICE_SESSION_IDLE_TIMEOUT_MS` 两个键，代码**确实读得到**（`default.ts:268` / `default.ts:229`），但**无人消费** → WP28 把它们从各自的生效段**移到 `.env.example` 底部一个明确标注"配了不生效"的区**，并写明各自的理由。
- ⚠️ 不能直接注释掉：守卫断言①要求"代码里读的每个 env 键在模板里都要有**生效行**" —— 注释掉会让守卫变红，等于为了"看起来干净"削弱部署契约。所以形态是"**仍是生效行，但位置即语义**"。

**本单的扫描**（155 个 `config.get(...)` 命名空间键全量扫 + 机器守卫 9 例）：

- 机器守卫 `test/config/wp25-env-example-coverage.spec.ts` **9/9 绿**；
- 唯一疑似项 `KB_VECTOR_SEARCH_ENABLED` **是真被消费的**（`search.service.ts:47` 读进 `enableVectorSearch`，第 61 行分支使用）—— **不是死键**；
- **未发现新的死键**。

**剩余盲区不在本单**：守卫的 AST 只知道"代码里读没读这个键"，**分不出"读进 config 命名空间"与"真被消费"** —— 这正是 **WP48** 已经登记的盲区，**另开单**（本单不重复做）。

---

## 八、⑥ 衰减 / 边际递减 / 饱和：三个里两个早就做了

| 机制 | 状态 | 在哪 |
|---|---|---|
| **衰减** | ✅ 已做 | `src/engine-core/cognition/session-decay.ts`（WP36 跨会话三档半衰期 + WP54 破裂态阻抗衰减下限） |
| **饱和** | ✅ 已做 | 内核 `clamp01` / `clampValence`（`applyDeltaVector` 落快照时统一夹到 [0,1]） |
| **边际递减** | ❌ **没做** | 现在的 delta 是**线性叠加**：`snapshot.trust + delta.trust` 然后 clamp —— 信任 0.9 时再来 +0.1，和信任 0.1 时 +0.1 涨得一样多 |

**本单不动内核，也不实现边际递减**，理由：

1. 边际递减**不是"技术债"，是"没建的临床机制"** —— 任务单 D3 明说"清技术债不是加新功能"；
2. 它要**建模决策**（什么曲线？对数？平方根？信任/阻抗/移情各自的曲线一样吗？），这是**临床标定**范畴，不是技术选择；
3. 真做了会改内核状态迁移的**每一个**数值 → 100+ 内核测试全要重算 —— 这已经超出"清债"，属于改引擎行为，**必须先讨论后实现**（AGENTS.md §2.5）。

**登记为建议**（见 §十一 R1）。

---

## 九、⑦ QdrantMemoryStore 默认值耦合：只有一处是真耦合

| 默认值 | 状态 | 为什么不改 |
|---|---|---|
| `collection` = `'visitor_long_memory'` | ✅ **刻意的代码常量** | `.env.example` 底部「预留键」区已写明理由：引擎记忆仓储用**独立** collection，与知识库隔离（共用会**互相污染召回**且带来隐私面）。改成 env = 把这个判断下放给运维 |
| 衰减半衰期 / 召回阈值 | ✅ **早已 env 化** | WP12 的 `memory-config.ts`（`MEMORY_DECAY_HALF_LIFE_DAYS` / `MEMORY_RECALL_THRESHOLD`）→ WP59 再把判定口径收进内核一份 |
| `defaultTtlMs` = `null`（永不过期） | ✅ 刻意的 | M4 纪律："不物理删除被取代的记忆"，被取代的靠 `supersededBy` 标记（审计线索） |
| **`fallback` 默认 `new InMemoryMemoryStore()`** | ❌ **真耦合** | **"选实现"做在了实现里** —— 本单改掉 |

**改法**：`fallback` 改**必填**，删掉实现内部的默认与对 `engine-core/in-memory/` 的 import。

- 隐患原貌：同一个适配器，传不传 `fallback` 会得到**两种不同的回落仓**；哪天装配层漏传了**不会报错**，只会**静默换一个实现** → 降级路径的召回结果与正常路径不一致（最难查的那种漂移）。
- 副作用（好的那种）：适配层不再 import 内核的**实现类**，只依赖内核的**端口** —— 依赖方向更干净。

---

## 十、⑧ 其他：审计报告里没进任务单的三条 + 本单新盘出的一条

| # | 位置 | 结论 | 本单动作 |
|---|---|---|---|
| **P3-9** | `test/engine-core/boundary.spec.ts:339-386` | 断言⑦ 是**单向清单**（只查缺失，不查多余）→ **新增内核文件不会被拦** | ✅ **已修**：补反向检查（内核树里出现的每个 `.ts` 都必须在清单里登记过）。代价说清楚：**新增内核文件必须同步登记** —— 这正是这条断言想要的（内核"形状"的变更要显式） |
| **P3-10** | `state-transition.ts` 的 `readCap` | ✅ **早已修**（WP26 P2-14 注入改造） | 无需动作：内核树里现在**零 `process.env`**（边界断言⑩ 守着） |
| **P3-7** | `state-transition.ts:397-406` 的 `transitionStateDetailed` | ⚠️ 仍存在：**零生产调用方**（只有 `wp15` / `wp57` 两个 spec 用）+ 内部重复计算两遍 aggregate + cap | **不动** —— 它在 `src/engine-core/`（**红线**），删它要改内核 barrel + 边界断言⑥ 的白名单 = **动第三个内核文件**，超出授权。**登记建议**（见 §十一 R2） |
| **P3-11**（本单新盘出） | `docker/grafana/dashboards/mofang-overview.json` 的「系统资源 (CPU / 内存)」面板 | ⚠️ 同款死指标：查 `node_cpu_seconds_total` / `node_memory_MemAvailable_bytes`（node_exporter 的），而 node-exporter **没部署** → **那个面板永远 No data** | **不改**（理由见 §十一 R5：面板是有人设计过的 UI 单元，删掉=少一个视角；改指进程级指标则语义与单位都要改，属产品决策）。其余 6 个面板查的都是后端真暴露的指标 ✓ |

---

## 十一、遗留 / 建议

### 建议（可另开单）

- **R1**：**边际递减机制**（§八）—— 属临床建模决策，建议与"引擎状态迁移口径"一并讨论（改内核 = 100+ 测试重算）。
- **R2**：**`transitionStateDetailed` 的去留**（§十 P3-7）—— 零生产调用方。要么删（需内核批准 + 改 barrel 白名单），要么在 core 内部消掉"重复算两遍 aggregate + cap"（同样需内核批准）。
- **R3**：**告警规则的可执行性验证** —— 本单把 `alerts.yml` 修到"每条规则都对着一个真存在的指标"，但**没有真跑过 Prometheus**（仓库没有起 Prometheus 的测试环境）。建议在部署环境 `promtool check rules docker/prometheus/alerts.yml` 验一次语法。
- **R4**：**exporter 类告警**（§五 5.1）—— 要监控节点内存/CPU/Redis，得先在 compose 里加 node-exporter / redis-exporter 并在 `prometheus.yml` 启用 job，再把规则加回。
- **R5**：**Grafana 仪表盘的「系统资源 (CPU / 内存)」面板也是死的**（§十 P3-11）—— 同款"引用未部署的 node_exporter 指标" → 那个面板**永远显示 No data**（不是"没数据"，是"数据永远不会来"）。**本单没改它**，理由与 §五 5.1 的处理不同，说清楚：
  - `alerts.yml` 的每条规则是**自包含**的 —— 引用一个不存在的指标就是纯噪声，删掉零损失；
  - Grafana 面板是**有人设计过的 UI 单元**（标题 / 单位 / 轴配置都在），删掉 = 少一个运维视角；
  - 改指后端**已暴露**的 `process_resident_memory_bytes` / `process_cpu_seconds_total` 技术上可行（`collectDefaultMetrics` 已注册），但 **CPU% 换不出**（PromQL 拿不到"核数"，那个数只有 node_exporter 才有）→ 面板语义会从"节点 CPU%"变成"进程用了几个核" → **属产品/运维决策，不该在清技术债时顺手改**。
  - 想修：加 node-exporter（与 R4 一起做），或接受"面板改成进程级指标 + 改标题与单位"。

### 已登记在别的 WP（不在本单重复做）

- **WP48**（env 守卫盲区：分不出「读进 config」与「真被消费」）—— §七。
- **WP60**（delta 规则表配置化）—— 内核硬编码 delta 表，属"配置化"不是"技术债"。

---

## 十二、运维须知

| # | 事项 | 说明 |
|---|---|---|
| 1 | ⚠️ **召回结果会变（这是修复，不是回归）** | `setPayload` 修好后，WP12 的**冲突消解标记从"从未生效"变成"真正生效"** → 同主题的旧记忆开始被标 `supersededBy` → 内核召回开始**排除**它们。生产上的召回结果会因此变化（旧记忆不再被召回）。**这是本单想要的**，但上线后建议观察一轮召回日志 |
| 2 | ⚠️ **3 条告警不再发** | `HighMemoryUsage` / `HighCPUUsage` / `RedisDown` 已从 `alerts.yml` 删除（它们引用的是**未部署的 exporter** 的指标，本来就**永远不触发**）。若告警通道/看板订阅了这三个名字，现在**确定收不到**（以前也收不到）。要恢复见 §十一 R4 |
| 3 | **部署顺序无要求** | 本单无 migration、无 schema 变更、无新 env 键 → 随便发 |
| 4 | **`fallback` 改必填** | 只影响**编译期**（装配层 `engine.providers.ts` 一直都在显式传）→ 运行时行为逐字不变 |
| 5 | **`TemplateParameter` 收窄** | 只影响**编译期**（`template`/`pre`/`line` 全仓零调用）→ 运行时行为逐字不变 |
| 6 | **Prometheus 规则未真跑过** | 本单只做了**静态对照**（新守卫）→ 建议在部署环境跑一次 `promtool check rules docker/prometheus/alerts.yml`（见 §十一 R3） |

---

## 十三、闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "src/**/*.ts" "test/**/*.ts"` | ✅ **0 error / 0 warning** |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error** |
| 单测（仓库口径） | `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **113 文件 / 1906 例全绿**（本单新增 **8 例**：SDK 契约 4 + Prometheus 告警守卫 4） |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | ✅ **空**（零改动） |
| 文档链接 | 本单改动文档的 95 条本地链接 | ✅ **0 条断链** |
| Prometheus 规则 YAML | `js-yaml` 解析 + 逐条列出规则 | ✅ 3 组 6 条，**全部解析通过** |

> ⚠️ **本单的两条新守卫，各自有它的理由**：
> · **SDK 契约守卫**打到 HTTP 层 —— 窄端口替身两端自洽（替身也是三参形状），"实现 vs 替身"的测试**永远抓不到**那个 bug；只有真把请求发出去、看真请求体，才钉得住 SDK 契约。
> · **Prometheus 告警守卫**做静态对照 —— YAML 合法、PromQL 合法，只有真去查 Prometheus 才发现规则永远为空向量；仓库没有起 Prometheus 的测试环境，所以用"规则引用的指标必须在 `MetricsService` 里注册过"来代替。
> · 两条守卫**都是"机械化"的**：它们守的两种债**在代码里都看不出来**，靠人记着迟早再犯。

---

## 十四、commit message 草稿

```
fix(qdrant): Qdrant SDK 契约修复 + WP45 技术债 8 条清理（setPayload 参数形状 / client: any / Prometheus 告警规则 / cancelled 注释 / boundary 双向断言）
```
