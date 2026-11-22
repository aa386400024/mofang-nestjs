# WP48 · env 守卫盲区：分不出「读进 config」与「真被消费」

> **状态**：✅ 已交付（2026-11-06）→ [`engine-wp48-env-guard-blind-spot-implementation-2026-11-06.md`](engine-wp48-env-guard-blind-spot-implementation-2026-11-06.md)
> **路径**：`docs/worklog/completed/phase2/wp48-env-guard-blind-spot-2026-11-06.md`
> **一句话**：现有守卫只守"代码读没读 env 键"，分不出"读进 config 命名空间后有没有人消费"——`QDRANT_COLLECTION` / `VOICE_SESSION_IDLE_TIMEOUT_MS` 配了不生效但测试全绿。本单加第三层断言，把"读得到但无人消费"单列成一类，机器守住。
> ⚠️ **重要**：全量扫描发现这个盲区比任务单预估的大 7 倍 —— **实际 16 个键**，其中 **14 个躺在 `.env.example` 的【生效区】里**（运维照抄模板就会配上，配了不生效），已登记给后续单（见交付记录 §八）。
> 开工前先读 `docs/worklog/README.md`。
> 优先级：🟢 P2（技术债，但"配了不生效"是最费时间的排障陷阱）。
> engine-core：**零改动**（本单全在测试 + config 装配层）。

---

## 一、背景（为什么必须现在做）

### 1.1 现有守卫守了什么

`test/config/wp25-env-example-coverage.spec.ts` 有两层断言：

| 断言 | 方向 | 守什么 |
|---|---|---|
| ① | 代码 → 模板 | 代码里读的每个 env 键，.env.example 都有生效行（漏了 = 运维配不上） |
| ② | 模板 → 代码 | .env.example 的每个生效行，代码里都真的读它（多了 = 骗人的配置项） |

AST 检查的是 `process.env.FOO` / `process.env['FOO']` / `config.get('FOO')` 三种读取形态。

### 1.2 盲区在哪

AST 只看"有没有读"，分不出**读进 config 命名空间后有没有人消费**。

**真实案例（已在 .env.example 底部预留区登记）：**

| env 键 | default.ts 里读进哪 | 有没有人消费 | 后果 |
|---|---|---|---|
| `QDRANT_COLLECTION` | `qdrant.collection` | ❌ 知识库用 `QDRANT_KB_COLLECTION`（直键读取），记忆仓储用硬编码 `visitor_long_memory` | 配了不生效，运维以为改了集合名 |
| `VOICE_SESSION_IDLE_TIMEOUT_MS` | `voice.sessionIdleTimeoutMs` | ❌ 真正生效的是 `voice.sessionIdleTimeoutMinutes`（分钟版） | 配了不生效，单位还打架 |

这两个键在断言①里**一路绿灯**——代码确实读了它们（`process.env.QDRANT_COLLECTION` 在 default.ts L268），所以测试不红。但配了等于白配。

### 1.2.1 审核时额外挖出的隐藏 bug（范围外，登记给后续单）

审核本单时顺手扫了一圈其他键，发现一个**路径错误型盲区**（不是"没人消费"，是"消费点读错了路径"）：

| env 键 | default.ts 里读进哪 | 消费点读的什么 | 后果 |
|---|---|---|---|
| `CONSENT_CURRENT_VERSION` | `consent.currentVersion` | `consent.service.ts:41` 读的是 `config.get('consentCurrentVersion')`（平铺键名），不是 `config.get('consent').currentVersion` | 配了 `CONSENT_CURRENT_VERSION=v2.0` 也不生效，永远返回默认值 `v1.0` |

**为什么登记给后续单而不是本单修**：
- WP48 的定位是"读了但没人消费"的守卫，不是"消费点读错路径"的 bug 修复
- 这个 bug 的修法很简单（把 `config.get('consentCurrentVersion')` 改成 `config.get('consent').currentVersion`），但它是另一个类型的问题，混进来会模糊本单的边界
- 守卫用例⑤ 检测不到这种 bug——因为消费点读的是错误路径，正确路径确实没人用，测试会通过

**后续单建议**：单独开一个"config 路径拼写错误排查"任务单，全仓扫一遍 `config.get('camelCaseKey')`（平铺键名）和 `config.get('namespace.field')`（嵌套路径）的对应关系，把读错路径的全部揪出来。

### 1.3 为什么这是"最费时间的排障陷阱"

- 运维在 `.env` 里改了 `QDRANT_COLLECTION=my_custom_collection`，重启服务，发现数据还是写进 `knowledge_chunks`
- 翻代码、翻日志、翻 Sentry，查了半天发现 default.ts 里读了但没人用
- 这种问题**不报错、不告警、静默失效**——只能靠机器守住

---

## 二、要做的事

### 2.1 在 default.ts 里给"读了但没人消费"的字段加机器可读标记

在 `src/config/envs/default.ts` 里，给已知的 2 个"读了但没人消费"的 config 字段加注释标记：

```ts
qdrant: {
  url: process.env.QDRANT_URL ?? 'http://qdrant:6333',
  apiKey: process.env.QDRANT_API_KEY,
  // @unused-read — 读进 config.qdrant.collection 但无人消费：
  //   知识库用 QDRANT_KB_COLLECTION（knowledge.service.ts 单独读），
  //   记忆仓储用硬编码 visitor_long_memory（qdrant-memory.store.ts）。
  //   配了不生效，见 .env.example 底部「预留键（读得到但未消费）」区。
  collection: process.env.QDRANT_COLLECTION ?? 'knowledge_chunks',
},
```

```ts
voice: {
  // @unused-read — 读进 config.voice.sessionIdleTimeoutMs 但无人消费：
  //   真正生效的是 sessionIdleTimeoutMinutes（分钟版，见下方）。
  //   两个键同时配会单位打架（ms vs min），所以这个毫秒版是遗留键。
  //   配了不生效，见 .env.example 底部「预留键（读得到但未消费）」区。
  sessionIdleTimeoutMs: Number(process.env.VOICE_SESSION_IDLE_TIMEOUT_MS ?? 600_000),
  sessionIdleTimeoutMinutes: readPositiveNumber(process.env.VOICE_SESSION_IDLE_TIMEOUT_MINUTES, 120),
  // ...
},
```

**标记格式约定**：`// @unused-read` 开头，后面跟一行说明（为什么没人消费、真正生效的是哪个键）。

### 2.2 守卫加用例 ⑤：「读得到但无人消费」的键必须登记且确实无人消费

在 `test/config/wp25-env-example-coverage.spec.ts` 里加一个新用例：

```ts
it('⑤ @unused-read 标记的键：确实无人消费，且在 .env.example 预留区登记', () => {
  // 1. 扫 default.ts，找出所有 @unused-read 标记的字段
  // 2. 提取它们对应的 env 键名（从同一行的 process.env.FOO 里抽）
  // 3. 断言 A：这些 env 键必须在 .env.example 的「预留键（读得到但未消费）」区里
  //    （不然就是"标记了但没告诉运维"，运维还是会踩坑）
  // 4. 断言 B：这些 env 键**确实**没人消费
  //    （全仓 grep config.get('xxx.yyy') 找不到对应路径；
  //     如果有人消费了，说明标记过时了 → 测试变红提醒清理）
});
```

**断言 B 的实现思路**：
- 从 default.ts 的 `@unused-read` 标记行提取 config 路径（如 `qdrant.collection`、`voice.sessionIdleTimeoutMs`）
- 全仓 grep 以下两种消费形态：
  1. 嵌套路径直读：`config.get('qdrant.collection')` / `config.get('voice.sessionIdleTimeoutMs')`
  2. 先取命名空间再点字段：`config.get('qdrant').collection` / `config.get('voice').sessionIdleTimeoutMs`
- 如果找到任何消费点 → 说明这个键已经被接线了，`@unused-read` 标记过时 → 测试变红

**注意**：断言 B 检测不到"消费点读错路径"的 bug（如 `config.get('consentCurrentVersion')` 读平铺键名而不是嵌套路径）——这是另一个类型的问题，见 §1.2.1。

### 2.3 .env.example 底部预留区加守卫注释

在 `.env.example` 底部「预留键（读得到但未消费）」区的开头注释里，加一句：

```
# ⚠️ 这一区的键由 test/config/wp25-env-example-coverage.spec.ts 用例⑤ 守住：
#    它们必须真的在 default.ts 里被读进 config 命名空间（@unused-read 标记），
#    且确实无人消费。如果将来接线了，要把它挪回生效区并去掉 @unused-read 标记。
```

---

## 三、设计决策

### 3.1 为什么不做全自动 config 消费追踪

全自动追踪要做的事：
1. 解析 default.ts 的嵌套对象结构，建立 `envKey → configPath` 映射
2. 全仓搜索所有 `config.get('xxx.yyy')` 和 `config.get('xxx').yyy` 的消费点
3. 把 camelCase configPath 映射回 UPPER_SNAKE_CASE envKey
4. 差集 = "读得到但无人消费"

**为什么不做**：
- 太复杂太脆弱——`config.get('verification').smsCodeTtlMin` 这种"先取命名空间再点字段"的模式，AST 追踪要做跨文件的数据流分析
- 现在只有 2 个已知的盲区键，做全自动分析的投入产出比极低
- 用 `@unused-read` 注释标记作为"机器可读的声明"，开发者自己负责标记，守卫守住"声明的键确实没人消费"——简单、可靠、够用

### 3.2 为什么用注释标记而不是配置文件

- 配置文件（如 `unused-env-keys.json`）要维护两份（default.ts 里读 + 配置文件里登记），容易漂移
- 注释标记就在代码旁边，改 default.ts 时一眼就能看到"这个字段没人用"
- 守卫只需要扫 default.ts 一个文件，不需要跨文件追踪

### 3.3 两类预留键的区别（已有，本单强化）

| 区 | 代码里查无读取点 | 代码读进 config 但无人消费 |
|---|---|---|
| 上面的预留区 | `# LLM_OPENAI_ENABLED=true`（注释行） | — |
| 下面的预留区 | — | `QDRANT_COLLECTION=`（生效行，但标记了） |
| 守卫断言 | ② 生效行必须被代码读（自动排除注释行） | ⑤ @unused-read 标记的键确实无人消费 |

---

## 四、验收标准

### 4.1 功能验收

- [ ] `npx tsc -p tsconfig.build.json --noEmit` 0 TS 错
- [ ] `npx eslint "{src,test}/**/*.ts"` 0 error
- [ ] `npx vitest run test/config/wp25-env-example-coverage.spec.ts` 全绿（含新用例⑤）
- [ ] 全量单测 `npx vitest run --exclude '**/e2e/**/*.ts'` 全绿

### 4.2 用例⑤ 验收

- [ ] default.ts 里 `qdrant.collection` 和 `voice.sessionIdleTimeoutMs` 都有 `@unused-read` 标记
- [ ] `QDRANT_COLLECTION` 在 .env.example 的「预留键（读得到但未消费）」区里
- [ ] `VOICE_SESSION_IDLE_TIMEOUT_MS` 在 .env.example 的「预留键（读得到但未消费）」区里
- [ ] 如果有人消费了 `config.get('qdrant.collection')`，测试变红（反向守卫生效）

### 4.3 反双胞胎

- [ ] `@unused-read` 标记格式统一（`// @unused-read — ` 开头）
- [ ] 不在两个地方维护"哪些键没人消费"的清单（default.ts 注释 + .env.example 预留区 = 唯一两处，守卫守一致性）

---

## 五、不做什么（范围外）

1. **不做全自动 config 消费追踪**——用 `@unused-read` 注释标记，够用就好（见 §3.1）
2. **不清理已接线的旧键**——如果将来 `QDRANT_COLLECTION` 真的被接线了，那是另一个任务单的事（把它从预留区挪回生效区 + 去掉标记）
3. **不动 .env.example 里已有的预留键列表**——只加守卫注释，不改键本身
4. **不做 env 键的"健康分"面板**——那是 admin dashboard 的事
5. **不扫其他仓库**——只守 mofang-nestjs 后端仓库
6. **不修 `consent.currentVersion` 的路径错误 bug**——这是"消费点读错路径"的问题，不是"读了但没人消费"的盲区，登记给后续单（见 §1.2.1）

---

## 六、决策记录

| # | 问题 | 决策 |
|---|---|---|
| 1 | 怎么标记"读了但没人消费"的键 | `// @unused-read` 注释标记，就在 default.ts 的字段旁边 |
| 2 | 守卫怎么守住 | 用例⑤：扫 @unused-read 标记 → 断言在 .env.example 预留区 + 确实无人消费 |
| 3 | 为什么不做全自动追踪 | 太复杂太脆弱，投入产出比低（见 §3.1） |
| 4 | `consent.currentVersion` 路径错误 bug 修不修 | 不修，登记给后续单（见 §1.2.1）——这是"消费点读错路径"，不是"读了但没人消费" |
| 5 | 断言 B 检测不到路径错误 bug 怎么办 | 明确说明守卫边界——守卫只守"读了但没人消费"，路径错误靠后续单人工排查 |

---

## 七、交付记录位置

完成后移到：`docs/worklog/completed/phase2/engine-wp48-env-guard-blind-spot-implementation-2026-11-06.md`

更新 `docs/worklog/README.md` 的 Phase2 已交付列表。
