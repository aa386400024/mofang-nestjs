# WP48 · env 守卫盲区：分不出「读进 config」与「真被消费」· 交付记录

> 日期：2026-11-06
> 任务单：[`wp48-env-guard-blind-spot-2026-11-06.md`](./wp48-env-guard-blind-spot-2026-11-06.md)
> 范围：default.ts 加 `@unused-read` 标记 → 守卫加用例⑤ → .env.example 预留区加守卫注释
> 边界：engine-core 零改动 · 不改 .env.example 已有预留键列表 · 不做全自动追踪 · 不修路径错误 bug

---

## 一、一句话

给「读进 config 命名空间却没人消费」的字段加机器可读的 `// @unused-read` 标记，并给守卫加**第三层断言**（用例⑤）把这一类单列守住：标记的键必须在 `.env.example` 预留区登记、且**确实**无人消费、且预留区与标记两边不许漂移。

**engine-core 零改动。**

**但本单最重要的产出是：全量扫描发现这个盲区比任务单预估的「已知 2 个」大得多 —— 实际有 16 个键，其中 14 个就躺在 `.env.example` 的【生效区】里，运维照抄模板就会配上，配了不生效。** 见 §三。

---

## 二、做了什么

### 2.1 `src/config/envs/default.ts` —— 两个字段加标记

```ts
qdrant: {
  // @unused-read — 读进 config.qdrant.collection 但**无人消费**: ...
  collection: process.env.QDRANT_COLLECTION ?? 'knowledge_chunks',
},

voice: {
  // @unused-read — 读进 config.voice.sessionIdleTimeoutMs 但**无人消费**: ...
  sessionIdleTimeoutMs: Number(process.env.VOICE_SESSION_IDLE_TIMEOUT_MS ?? 600_000), // 10min
}
```

### 2.2 `test/config/wp25-env-example-coverage.spec.ts` —— 新增用例⑤

四段断言（比任务单 §2.2 多一段「正对照」）：

| 段 | 断言 | 守什么 |
|---|---|---|
| A | 标记的 env 键**必须**在 `.env.example` 预留区里 | 「标记了但没告诉运维」= 运维照抄生效区还是踩坑 |
| B | 标记的 env 键**确实**无人消费 | 有人消费了 = 标记过时 = 该接线了 → 变红提醒清理 |
| **B′** | **正对照**：检测器必须能看见仓库里**确实**有人消费的字段 | **守卫不能永远绿** —— 检测器坏了也要红（§四详述） |
| C | 预留区里的每个生效键**必须**有 `@unused-read` 标记 | 两处清单不许漂移（§4.3 反双胞胎） |

### 2.3 `.env.example` —— 预留区加守卫注释

把原来那段「这两个键暴露了一个守卫盲区 …… 已记进 Phase2 backlog (WP48), 下次审查处理」换成现在的守卫说明 —— 盲区已经补上，那段说明过期了；只加不删会留下自相矛盾的两段说明。

---

## 三、🔴 本单的核心发现：盲区比任务单预估的大 7 倍

任务单 §1.2 说「**真实案例**（已在 .env.example 底部预留区登记）」列了 2 个键。

**本单开工前做了一次全量扫描**（扫 `src/config/envs/default.ts` 的 101 处 env 读取，逐个追消费点），结论是：

### 3.1 盲区的准确定义

一个 env 键是「读得到但没人消费」，要同时满足两条：

1. **这个 env 键只在 `default.ts` 里被读**（在别处也被读 = 键本身生效，不是盲区 —— 比如 `MINIMAX_LLM_MODEL` 虽然 `config.minimax.llmModel` 没人用，但 `llm.config.ts` 直接读 `config.get('MINIMAX_LLM_MODEL')`，**配了照样生效**，不是盲区）；
2. **它读进去的那个 config 字段没有任何消费点**（没人写 `config.get('ns').field` / `config.get('ns.field')` / 解构它）。

### 3.2 扫描结果：16 个键

| env 键 | config 路径 | 现在在 .env.example 哪 | 后果 |
|---|---|---|---|
| `QDRANT_COLLECTION` | `qdrant.collection` | 预留区 ✅ | 配了不生效 |
| `VOICE_SESSION_IDLE_TIMEOUT_MS` | `voice.sessionIdleTimeoutMs` | 预留区 ✅ | 配了不生效 |
| `SMS_ACCESS_KEY` | `sms.accessKey` | **生效区** ⚠️ | 配了不生效 |
| `SMS_ACCESS_SECRET` | `sms.accessSecret` | **生效区** ⚠️ | 配了不生效 |
| `SMS_SIGN_NAME` | `sms.signName` | **生效区** ⚠️ | 配了不生效 |
| `SMS_TEMPLATE_CODE` | `sms.templateCode` | **生效区** ⚠️ | 配了不生效 |
| `SMS_REGION` | `sms.region` | **生效区** ⚠️ | 配了不生效 |
| `METRICS_PATH` | `metrics.path` | **生效区** ⚠️ | 配了不生效（controller 是 `@Controller()` 硬编码 `/metrics`） |
| `EMBEDDING_PROVIDER_DEV` | `embedding.providerDev` | **生效区** ⚠️ | 配了不生效 |
| `EMBEDDING_PROVIDER_PROD` | `embedding.providerProd` | **生效区** ⚠️ | 配了不生效 |
| `EMBEDDING_API_KEY` | `embedding.chatanywhereApiKey` | **生效区** ⚠️ | 配了不生效 |
| `EMBEDDING_API_KEY_MPLAN` | `embedding.chatanywhereMplanKey` | **生效区** ⚠️ | 配了不生效 |
| `EMBEDDING_BGE_URL` | `embedding.bgeUrl` | **生效区** ⚠️ | 配了不生效 |
| `EMBEDDING_MODEL` | `embedding.model` | **生效区** ⚠️ | 配了不生效 |
| `EMBEDDING_DIM` | `embedding.dim` | **生效区** ⚠️ | 配了不生效 |
| `CONSENT_CURRENT_VERSION` | `consent.currentVersion` | **生效区** ⚠️ | 配了不生效（**路径错误**，见 §3.4） |

### 3.3 为什么剩下的 14 个没在本单一起修

**这是任务单 §五.3 明确划出去的范围**（「不动 .env.example 里已有的预留键列表 —— 只加守卫注释，不改键本身」），加上 §六 决策记录 #3（大炮拍板「不做全自动 config 消费追踪」）。

把 14 个键挪进预留区 = **改部署契约**（等于告诉运维「这 14 个键别配」），这是产品决策，不是本单该替大炮做的。所以本单**只登记，不动**，并在 §八 留了可直接执行的后续单方案。

### 3.4 两个尤其刺眼的

- **`EMBEDDING_*` 7 个键**：`ai-engine.module.ts:36-37` 明写着「**大炮 14:57 拍板 'B 方案 — 删 BgeEmbeddingService, 复用 OpenAI 兼容 4 provider'**」—— 这 7 个键是**已被废弃的 B 方案**的遗产，却还以生效区的身份躺在 `.env.example` 里（连 `EMBEDDING_PROD=bge_large_zh`、`EMBEDDING_BGE_URL=http://bge-embedding.internal:8080` 这种**已下线架构的地址**都在），运维照抄就会以为要自建 bge。
- **`CONSENT_CURRENT_VERSION`**：任务单 §1.2.1 已登记的**路径错误型** bug —— `consent.service.ts:41` 读 `config.get('consentCurrentVersion')`（平铺键名），而 default.ts 里的路径是 `consent.currentVersion`。**核实无误**：`src/consent/providers/consent.service.ts:41` 与 `src/profile/providers/consent.service.ts`（硬编码 `'v1.0'`，注释说「V3 走 config.consentCurrentVersion」）。按 §五.6 **本单不修**。

---

## 四、守卫自己的可信度：为什么加了「正对照」

用例⑤ 的断言 B 是「**标记的键确实无人消费**」—— 这类「否定式断言」有个致命风险：**检测器坏了，它会永远绿**。所以本单额外做了两件事：

### 4.1 变异测试（手动做，不入库）

| 变异 | 期望 | 实测 |
|---|---|---|
| 加一个消费点 `config.get('qdrant').collection` | 断言 B 变红 | ✅ 红了，消息精确指出 `QDRANT_COLLECTION (config.qdrant.collection) 已被消费` |
| 摘掉 `@unused-read` 标记 | 断言 C 变红 | ✅ 红了（「预留区里有、default.ts 里没标记」） |
| 加一个解构消费点 `const { sessionIdleTimeoutMs } = config.get('voice') as {...}` | 断言 B 变红 | ❌ **第一版没红** → 修了检测器（§4.3） |

**第三个变异抓到了一个真 bug**：本仓库常见写法 `config.get('x') as T` 会在调用外面包一层 `AsExpression`，第一版检测器只看**直接父节点**，于是漏掉这一整类写法。修法：找 owner 前先剥一层 `as` / 非空断言。

### 4.2 正对照断言（入库）

用例⑤ 里加了 B′ 段 —— 拿仓库里**确实**有人消费的两个字段当对照：

```ts
const positiveControls = [
  ['voice.sessionIdleTimeoutMinutes', 'src/voice/voice.service.ts'],
  ['jwtSecret', 'src/auth/strategies/jwt.strategy.ts'],
];
```

检测器必须找到它们 —— 找不到就是检测器坏了，测试立刻红。**这让守卫不可能「永远绿」**。

（顺带：正对照第一次写的时候我自己就踩了 —— `jwtSecret` 是**顶层平铺键**（`config.get('jwtSecret')`），第一版检测器只记带点的键，漏了这一形态，同样靠正对照抓出来了。）

### 4.3 检测器覆盖的五种消费形态

```ts
① get('ns.field')                嵌套路径直读
② get('ns').field                 先取命名空间再点字段 (直接链)
③ const v = get('ns'); v.field    先取命名空间存变量再点字段
④ const { field } = get('ns') as T 解构 (含 as / 非空断言包装)
⑤ get('jwtSecret')                顶层平铺键名
```

缺任何一种 = 守卫会漏判「已经接线了」。

### 4.4 守卫的边界（明确写进代码注释）

**检测不到「消费点读错路径」的 bug** —— 如 `config.get('consentCurrentVersion')` 想读的是 `consent.currentVersion`。这是另一个类型的问题（任务单 §1.2.1），靠后续单人工排查。

---

## 五、与任务单的偏差

| # | 任务单原文 | 实际做法 | 理由 |
|---|---|---|---|
| **B1** | 只标记 2 个键 | 标记 2 个键（不变），但**全量扫描发现 16 个**，14 个登记给后续单 | §三；§五.3 明确不改编部署契约 |
| **B2** | 断言 B 只查两种消费形态 | 查**五种**（补变量 / 解构 / 平铺键 / as 包装） | 少一种 = 守卫漏判；变异测试实测抓到了漏判 |
| **B3** | （任务单未提） | 额外加**正对照断言**（检测器坏了要红） | 否定式断言「永远绿」比没有守卫更糟 |
| **B4** | 断言 A + B | 额外加**断言 C**（预留区 ↔ 标记双向一致） | §4.3 反双胞胎要求「守卫守一致性」 |
| **B5** | .env.example 预留区「加一句守卫注释」 | **换掉**原来那段「已记进 backlog, 下次审查处理」的说明 | 那段已过期；只加不删会留下自相矛盾的两段说明 |
| **B6** | （任务单未提） | 用 **AST**（`getLeadingCommentRanges`）取标记归属，不用正则 | 标记是注释，正则只能靠「标记行往下找第一个代码行」这种脆弱推断；仓库既有守卫也是「用 TS 编译器 API 而不是正则」同款思路 |

---

## 六、闸门数字（2026-11-06 实跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| lint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error** ✅ |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| 守卫 | `npx vitest run test/config/wp25-env-example-coverage.spec.ts` | **10 例全绿**（原 9 + 新用例⑤）✅ |
| 全量单测 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **114 文件 / 1956 例全绿** ✅ |
| **engine-core 红线** | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |
| 反向守卫生效 | 手动变异（加消费点 / 摘标记 / 加解构消费点） | **三种变异都变红** ✅ |
| 守卫不永远绿 | 正对照断言 | 两条真实消费点都能检出 ✅ |

---

## 七、验收口径逐条对照（任务单 §四）

### §4.1 功能验收

- [x] `npx tsc -p tsconfig.build.json --noEmit` 0 TS 错
- [x] `npx eslint "{src,test}/**/*.ts"` 0 error
- [x] `npx vitest run test/config/wp25-env-example-coverage.spec.ts` 全绿（含新用例⑤）
- [x] 全量单测 `npx vitest run --exclude '**/e2e/**/*.ts'` 全绿

### §4.2 用例⑤ 验收

- [x] default.ts 里 `qdrant.collection` 和 `voice.sessionIdleTimeoutMs` 都有 `@unused-read` 标记
- [x] `QDRANT_COLLECTION` 在 .env.example 的「预留键（读得到但未消费）」区里
- [x] `VOICE_SESSION_IDLE_TIMEOUT_MS` 在 .env.example 的「预留键（读得到但未消费）」区里
- [x] 如果有人消费了 `config.get('qdrant.collection')`，测试变红（**实测三种消费形态都变红**）

### §4.3 反双胞胎

- [x] `@unused-read` 标记格式统一（`// @unused-read —` 开头）
- [x] 「哪些键没人消费」的清单只在两处（default.ts 注释 + .env.example 预留区），**断言 C 守住两边一致**

---

## 八、留给后续单（可直接执行）

### 8.1 后续单 A：env 盲区扩面（**优先级高于本单** —— 14 个键躺在生效区）

1. 给 §3.2 表里那 14 个键的 config 字段加 `@unused-read` 标记；
2. 把它们从 `.env.example` 生效区**挪进**预留区（不是删，是挪 —— 保留位置与口径，将来接线时照旧）；
3. 本单的用例⑤ **自动**就会覆盖它们（断言 A/C 会逼着两处同步）—— **守卫不用改**；
4. `EMBEDDING_*` 7 个键建议**额外**做一次决策：既然后续走 OpenAI 兼容 4 provider（B 方案），这 7 个键是死遗产，是否直接删掉整个 `embedding` 命名空间 + `.env.example` 里的对应行（而不是挪进预留区）—— 这是产品决策。

### 8.2 后续单 B：config 路径拼写错误排查

全仓扫 `config.get('camelCaseKey')`（平铺键名）与 `config.get('namespace.field')`（嵌套路径）的对应关系，把**读错路径**的全部揪出来。已知至少 1 例：

| env 键 | 正确路径 | 消费点现在读的 | 位置 |
|---|---|---|---|
| `CONSENT_CURRENT_VERSION` | `consent.currentVersion` | `consentCurrentVersion`（平铺） | `src/consent/providers/consent.service.ts:41` |

另有一处相关但不同性质：`src/profile/providers/consent.service.ts:29` 把 `currentVersion` **硬编码成 'v1.0'**，注释写「V3 走 config.consentCurrentVersion」—— 将来接线时它也要跟着改。

### 8.3 后续单 C：守卫的剩余盲区

用例⑤ 检测不到「读错路径」型 bug（§4.4）。若要覆盖，需要另一类断言：**default.ts 里声明的 config 路径，与全仓实际读取的路径做集合比对**（读得少 = 没人用；读得对不上 = 路径拼错）。这比 §3.1 的「不做全自动追踪」更进一步，成本与脆弱性都要重新评估。

---

## 九、给大炮的两条手工动作

1. **决定 §八.1 的范围** —— 14 个键要不要本轮就挪进预留区（本单按任务单 §五.3 没动）；`EMBEDDING_*` 7 个键要不要直接删（死遗产）。
2. **§八.2 的 consent 路径 bug**：改一行就能修好（`config.get('consentCurrentVersion')` → `config.get('consent').currentVersion`），本单按 §五.6 没碰。