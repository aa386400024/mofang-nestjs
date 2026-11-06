# WP69 · env 盲区扩面 + consent 路径修复 + 调试面板小改进

> **状态**：✅ 已交付（2026-11-06）→ [`engine-wp69-env-blindspot-expansion-and-debug-panel-fixes-implementation-2026-11-06.md`](engine-wp69-env-blindspot-expansion-and-debug-panel-fixes-implementation-2026-11-06.md)
> **路径**：`docs/worklog/completed/phase2/wp69-env-blindspot-expansion-and-debug-panel-fixes-2026-11-06.md`
> **一句话**：WP48 的 16 个 env 盲区键本单清掉 **14 个**（6 个挪进预留区 + 7 个死遗产删除 + 1 个修路径治本）；consent 路径错误 bug 修好（配了真生效）；调试面板会话列表加 `active` 字段（刷新后分得清「可继续聊 / 只读历史」）；**engine-core 零改动**。
> ⚠️ **§2.5（trace 加 `eventTags`）本单不做** —— 引擎把事件分类锁在 `turn()` 内部，「engine-core 零改动」前提下适配层取不到真值；要动内核 = 破红线，须大炮拍板。已登记后续单，见交付记录 §九。
> 开工前先读 `docs/worklog/README.md`。
> 优先级：🟡 P1（14 个键躺在生效区 = 运维配了不生效，趁现在没人用赶紧挪）。
> engine-core：**零改动**。

---

## 一、背景

WP48 做了 env 守卫盲区（用例⑤），全量扫描发现：

1. **16 个盲区键**：读进 config 命名空间但没人消费。其中 14 个躺在 `.env.example` 的**生效区**——运维照抄模板就会配上，配了不生效。
2. **consent 路径错误 bug**：`consent.service.ts:41` 读 `config.get('consentCurrentVersion')`（平铺键名），正确路径是 `consent.currentVersion`——配了不生效。
3. **调试面板两个小改进**：会话列表缺 active 字段（刷新后历史会话变只读）+ trace 缺 eventTags 字段（事件分类 tab 显示占位数据）。

本单一起修。

---

## 二、要做的事

### 2.1 后续单 A：env 盲区扩面（14 个键挪进预留区）

**WP48 §3.2 表里那 14 个键**，全部处理：

| env 键 | config 路径 | 现在在哪 | 处理方式 |
|---|---|---|---|
| `SMS_ACCESS_KEY` | `sms.accessKey` | 生效区 | 加 @unused-read 标记 + 挪进预留区 |
| `SMS_ACCESS_SECRET` | `sms.accessSecret` | 生效区 | 同上 |
| `SMS_SIGN_NAME` | `sms.signName` | 生效区 | 同上 |
| `SMS_TEMPLATE_CODE` | `sms.templateCode` | 生效区 | 同上 |
| `SMS_REGION` | `sms.region` | 生效区 | 同上 |
| `METRICS_PATH` | `metrics.path` | 生效区 | 同上（controller 硬编码 `/metrics`） |
| `EMBEDDING_PROVIDER_DEV` | `embedding.providerDev` | 生效区 | **直接删**（死遗产，见 §2.2） |
| `EMBEDDING_PROVIDER_PROD` | `embedding.providerProd` | 生效区 | **直接删** |
| `EMBEDDING_API_KEY` | `embedding.chatanywhereApiKey` | 生效区 | **直接删** |
| `EMBEDDING_API_KEY_MPLAN` | `embedding.chatanywhereMplanKey` | 生效区 | **直接删** |
| `EMBEDDING_BGE_URL` | `embedding.bgeUrl` | 生效区 | **直接删** |
| `EMBEDDING_MODEL` | `embedding.model` | 生效区 | **直接删** |
| `EMBEDDING_DIM` | `embedding.dim` | 生效区 | **直接删** |
| `CONSENT_CURRENT_VERSION` | `consent.currentVersion` | 生效区 | 加 @unused-read 标记 + 挪进预留区（路径错误 bug 见 §2.3） |

**做法：**
1. 给要保留的键（非 EMBEDDING_*）的 config 字段加 `// @unused-read` 标记（格式跟 WP48 一致）
2. 把这些键从 `.env.example` 生效区**挪进**底部预留区（不是删，是挪——将来接线时照旧）
3. EMBEDDING_* 7 个键**直接删**——既然后续走 OpenAI 兼容 4 provider（B 方案），这 7 个键是死遗产，连 `bge-embedding.internal:8080` 这种已下线架构的地址都在
4. WP48 的用例⑤ **自动**就会覆盖它们（断言 A/C 会逼着两处同步）——守卫不用改

### 2.2 EMBEDDING_* 死遗产清理

`src/config/envs/default.ts` 里整个 `embedding` 命名空间删掉：

```ts
// 删掉整个 embedding 段
embedding: {
  providerDev: process.env.EMBEDDING_PROVIDER_DEV ?? 'chatanywhere',
  // ... 全删
},
```

`.env.example` 里对应的 7 行也删掉。

**为什么直接删而不是挪进预留区**：既然后续走 OpenAI 兼容 4 provider（B 方案，`ai-engine.module.ts:36-37` 大炮拍板过），BGE 自托管方案已经废弃，这 7 个键是死遗产——留着只会让运维以为要自建 bge。

### 2.3 后续单 B：consent 路径错误 bug

**`src/consent/providers/consent.service.ts:41`**：

```ts
// 改前：
this.currentVersion = this.config.get<string>('consentCurrentVersion') ?? 'v1.0';

// 改后：
this.currentVersion = this.config.get<string>('consent').currentVersion ?? 'v1.0';
```

**`src/profile/providers/consent.service.ts:29`**：

```ts
// 改前：
private readonly currentVersion = 'v1.0';

// 改后：跟着上面一起读 config（注释说「V3 走 config.consentCurrentVersion」）
```

改完后 `CONSENT_CURRENT_VERSION` 就生效了——配了 `v2.0` 就真的弹重弹 dialog。

### 2.4 调试面板改进 1：会话列表加 active 字段

**后端 `listPersistedSessions()` 返回的每个会话加 `active: boolean`**：

对比内存 Map `this.sessions`——在里面就是 `true`，不在就是 `false`。

前端加载列表时，把 active 的都加进 `activeSessionIds` 集合。刷新页面后，该能继续聊的还是能继续聊，不用重新开。

### 2.5 调试面板改进 2：trace 加 eventTags 字段

**调试会话 trace 加 `eventTags: string[]`**：

BDI 引擎这一轮输出的事件标签（比如 `empathy` / `open_probe` / `emotion_reflection`），前端事件分类 tab 自动接进来。

---

## 三、验收标准

### 3.1 env 盲区扩面

- [ ] SMS_* 5 个键 + METRICS_PATH + CONSENT_CURRENT_VERSION 都有 `@unused-read` 标记
- [ ] 这些键都在 `.env.example` 预留区里（不在生效区）
- [ ] EMBEDDING_* 7 个键全删（default.ts + .env.example）
- [ ] `npx vitest run test/config/wp25-env-example-coverage.spec.ts` 全绿

### 3.2 consent 路径修复

- [ ] `consent.service.ts:41` 改成 `config.get('consent').currentVersion`
- [ ] `profile/providers/consent.service.ts:29` 跟着改
- [ ] 配 `CONSENT_CURRENT_VERSION=v2.0` 真的生效

### 3.3 调试面板改进

- [ ] `list()` 接口每个会话有 `active: boolean`
- [ ] trace 里有 `eventTags: string[]`
- [ ] 前端事件分类 tab 显示中文标签（共情回应、开放提问等）

### 3.4 闸门

- [ ] `npx tsc -p tsconfig.build.json --noEmit` 0 错
- [ ] `npx eslint "{src,test}/**/*.ts"` 0 error
- [ ] 全量单测全绿
- [ ] engine-core 零改动

---

## 四、不做什么

1. **不做全自动路径比对守卫**（WP48 后续单 C）——成本高脆弱，以后再说
2. **不删 SMS 相关代码**——只是标记 + 挪预留区，将来接入阿里云短信时照旧
3. **不改 engine-core**

---

## 五、交付记录位置

完成后移到：`docs/worklog/completed/phase2/engine-wp69-env-blindspot-expansion-and-debug-panel-fixes-2026-11-06.md`
