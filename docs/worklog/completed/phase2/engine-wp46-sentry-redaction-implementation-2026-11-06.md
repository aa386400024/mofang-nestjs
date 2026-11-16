# WP46 · Sentry 通道脱敏（心理数据合规闭环）· 交付记录

> 日期：2026-11-06
> 任务单：[\`wp46-sentry-redaction-2026-11-06.md\`](./wp46-sentry-redaction-2026-11-06.md)
> 范围：抽共享脱敏模块 → Sentry 事件级脱敏 → 两个 ExceptionFilter 对齐 → 顺手修 5 处 warn 日志 → 加单测 + e2e 出血测试
> 边界：engine-core 零改动 · 心理内容不进日志 / 不进 Sentry · 不自动 commit/push

---

## 一、一句话

把脱敏逻辑从 `biz-exception.filter.ts` 的私有副本抽成**唯一共享实现**（`pii-redactor.ts`），接到 Sentry 的 `beforeSend` 上做**事件级递归脱敏**，两个 ExceptionFilter 的 extra 换成脱敏口径，顺手修掉 7 处打原文的日志，并补了 1 个单测套件（49 例）+ 1 个 e2e 出血套件（5 例）。

**engine-core 零改动。**

**但本单最大的产出不是"加了一层防护"—— 是发现任务单的前提在实测的 SDK 版本上不成立，本单是在堵一个正在流血的洞。** 见 §二。

---

## 二、🔴 最重要的发现：任务单 §一 的前提不成立（这是本单的核心产出）

任务单 §一 写：

> `event.request.data`（请求体）| v11 默认 `sendDefaultPii: false` 不自动 attach，但**未做防御性处理**——一旦 `sendDefaultPii` 被误开、或业务代码手动把 body 塞进 extra，心理原文直接进 Sentry

**实测（`@sentry/node@11.10.0`，仓库当前安装版本）结论：这句话有三处与事实不符。**

### 2.1 `sendDefaultPii` 这个选项在 v11 **已经被删除**

`ClientOptions`（`node_modules/@sentry/core/build/types/types/options.d.ts`）里**没有** `sendDefaultPii` 字段；对 621 个 `.d.ts` 全量 grep 只在 `@sentry/conventions` 的 OpenTelemetry 属性文档注释里出现。v11 换成了 **`dataCollection`** 模型。

→ 照抄任务单的 `sendDefaultPii: false` 会**直接 TS 报错**（对象字面量多余属性），`pnpm build` 过不了。

### 2.2 请求体采集**默认就是开的**（这是真·问题所在）

v11 的 `dataCollection.httpBodies` 默认值：

```ts
/**
 * Which HTTP body types to collect. ...
 * @default ['incomingRequest', 'outgoingRequest', 'incomingResponse', 'outgoingResponse']
 */
httpBodies?: HttpBodyCollectionTarget[];
```

而 `@sentry/core` 的入站 HTTP 插桩（`integrations/http/server-subscription.js`）：

```js
const effectiveBodySize = configuredBodySize ?? (client.getDataCollectionOptions().httpBodies.includes("incomingRequest") ? "medium" : "none");
if (effectiveBodySize !== "none" && ...) {
  patchRequestToCaptureBody(request$1, isolationScope, effectiveBodySize, INTEGRATION_NAME);
}
```

→ **默认采集入站请求体**，且采集到的是**原始 body 字符串**（不是解析后的对象），挂在 `event.request.data` 上。

心塑的请求体里装的是什么？日记正文（`body`，5000 字）、危机备注（`notes`）、chat message（`messages[]`）、漂流瓶信件（`content`）……

**结论：在这条改动之前，每一次 5xx 都会把来访者的心理原文按原始字符串送进 Sentry。** 这不是"未来可能泄漏"，是**正在泄漏**。

### 2.3 任务单说的 "extraErrorDataIntegration 会自动提取 Error 自定义属性" 在 v11 **不是默认 integration**

v11 的默认 integration 列表里没有 `extraErrorDataIntegration`（有 `localVariablesIntegration` / `contextLinesIntegration`）。真正默认开着、且真会带内容的泄漏面是**栈帧局部变量**（`dataCollection.stackFrameVariables` 默认 `true`）——局部变量里常驻 `userInput` / `prompt` 这类心理内容。

### 2.4 本单的应对（两道防线，源头 + 兜底）

| 层 | 动作 | 效果 |
|---|---|---|
| **① 源头** | `dataCollection.httpBodies: []`（+ `cookies: false` / `userInfo: false` / `stackFrameVariables: false` / `databaseQueryData: false` / `genAI.inputs-outputs: false` / `graphQL: false`） | body / cookie / user.* / 栈帧局部变量 / DB 参数 / LLM 输入输出 **一律不采** |
| **② 兜底** | `beforeSend` 事件级递归脱敏 | 万一有人把采集口径改宽、或业务手动把 body 塞进 extra，**仍会被遮干净** |

第 ② 层不是冗余：e2e 套件的 ① 段就是**故意把采集口径改宽**（`httpBodies: ['incomingRequest']`）跑一遍真实 HTTP，验证心理原文依然一个字都出不去。

---

## 三、改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/shared/infra/observability/pii-redactor.ts` | **新建**（唯一脱敏实现）：搬入 WP26 的脱敏函数 + 正则；新增两层黑名单 / `redactRecord` / `redactString` / `redactIp` / `redactQueryString` / `collectMatchingKeys` / `redactEventForSentry` |
| `src/shared/infra/observability/sentry.service.ts` | 抽出 `buildSentryInitOptions()`（生产同款配置单一事实源，可测）；`dataCollection` 严格档；`serverName: 'unknown'` + `includeServerName: false`；`beforeSend` / `beforeSendTransaction` 接事件级脱敏；`captureException` / `captureMessage` 手动层脱敏 + dev 提示 |
| `src/shared/infra/observability/index.ts` | barrel 导出 `pii-redactor.js` |
| `src/common/filters/biz-exception.filter.ts` | **删掉底部私有脱敏副本**（约 110 行），改为 import；Sentry extra 换成脱敏口径 |
| `src/counselor/providers/practice-asr-upload.filter.ts` | Sentry extra 换成脱敏口径（与全局 filter 同口径） |
| `src/agent/llm/llm.service.ts` | `payload.slice(0, 100)` → `payload_len=${payload.length}` |
| `src/engine-adapters/rendering/llm-render.adapter.ts` | 截断尾句原文 → `dropped_chars`；安全信号片段 → prod 只打长度 / dev 保留片段 |
| `src/voice/tts/tts-bidi-client.ts` | 3 处：帧原文 → `frame_len`；未知事件 JSON → 只打键名；关闭原因 → `reason_len` |
| `src/knowledge-base/providers/preview.service.ts` | `userInput.slice(0, 30)` → `userInput_idx=${idx}`（循环改 `entries()`） |
| `test/shared/sentry-redaction.spec.ts` | **新建** 49 例单测 |
| `test/e2e/sentry-redaction.spec.ts` | **新建** 5 例 e2e 出血测试 |

---

## 四、与任务单的偏差（逐条说明理由）

| # | 任务单原文 | 实际做法 | 理由 |
|---|---|---|---|
| **B1** | `sendDefaultPii: false` | `dataCollection` 严格档（含 `httpBodies: []`） | v11.10.0 已删除该选项，照抄 TS 报错；见 §二 |
| **B2** | `serverName: 'unknown'` | 保留，**另加** `includeServerName: false` | v11 默认 `includeServerName: true` 会自动探测主机名；显式锁死才不留 hostname |
| **B3** | §2.2a：`request.data` 用 `SENSITIVE_CONTENT_NAMES` | 请求体用**并集** `REQUEST_BODY_SENSITIVE_NAMES`（KEY ∪ CONTENT） | §2.2a 只说内容类，但 §4.2 验收要求 `password` 也被遮；两处必须同时满足 |
| **B4** | §3.2.B 代码块里含 `input` / `output` | **剔除** | 同一节的 ⚠️ 框明确写"不列入黑名单"，且给了理由（太宽泛）——⚠️ 框是最终裁定 |
| **B5** | §2.2b：query 要删 `code`；§4.2：extra 里 `code` 要留 | **按位置分层**：`QUERY_SENSITIVE_NAMES`（额外含 phone / code / 验证码类）只用于 query；`SENSITIVE_KEY_NAMES` 不含 code，用于 extra / breadcrumbs | 同一字段名在不同位置语义不同（query 里是验证码，extra 里是业务错误码），全局一刀切会误伤 |
| **B6** | §2.4：`truncateForLog(ua, 200)` | `truncateForLog` 加**可选** `maxLength` 参数（默认 2000 不变） | 原函数只有一个参数；WP26 的既有行为一字未改 |
| **B7** | §2.1："Buffer/string 整体替换" | Buffer 在**任意层级**整体替换；字符串只在**顶层**整体替换，**嵌套字符串保留** | 嵌套字符串若也整体替换，`userId='u123'` 会被抹掉，与 §4.2 验收直接冲突（实现时踩到并修掉的真 bug） |
| **B8** | §2.6 列 5 处 | 改了 **7** 处（多 `tts-bidi-client.ts` 的 2 处 `slice(0, 120)`） | §4.3 验收要求 `grep "slice(0, 120)" src/voice/tts/tts-bidi-client.ts` **0 命中**；那 2 处也是真泄漏面（未知事件 JSON / 上游关闭原因）。只改日志内容，不改级别与触发条件 |
| **B9** | §2.3："dev 模式加 `console.warn`" | 用 `this.logger.warn` | 本文件既有机制（NestJS Logger），等价且更贴合项目风格 |
| **B10** | §2.5：e2e 放 `test/shared/sentry-redaction.e2e-spec.ts` | 放 `test/e2e/sentry-redaction.spec.ts` | 实测：`*.e2e-spec.ts` 这个命名**两套 vitest config 都收集不到**（默认 include 是 `*.spec.ts`，e2e config 的 include 是 `**/e2e/**/*.{spec,test}.ts`，都要 `.spec.ts` 结尾）→ 放任务单那个位置就是**死文件，测试永远不跑** |
| **B11** | §4.2：`event.request.data.body === '[REDACTED]'`（对象形态） | 拆成两段：真实链路断言 `request.data === '[REDACTED body]'`（字符串形态）+ 单独用**真实 beforeSend** 覆盖对象形态断言 | v11 真实链路里 `request.data` 是**原始 body 字符串**（`requestDataIntegration` 挂的是 `normalizedRequest.data`），不是解析后的对象；对象形态（如 Express 手工 attach）走同一套 `redactRecord` 逻辑 |
| **B12** | （任务单未提） | `beforeSendTransaction` 加 `eslint-disable sonarjs/deprecation` + 注释 | v11 已标 deprecated，且默认 `traceLifecycle='stream'` 下**不生效**（SDK 明确 warn）。保留它是因为切回 `'static'` 时它就是最后一道防线 |

### 4.1 顺带发现的仓库技术债（**不在本单范围**，登记建议）

1. **`*.e2e-spec.ts` 是死文件名**：`test/e2e/privacy-guard.e2e-spec.ts`、`test/e2e/knowledge-search.e2e-spec.ts`、`test/good-state-diary.e2e-spec.ts` **三个文件从未被任何 vitest config 收集**（实测 `npx vitest list` 两个 config 都不列它们）→ 建议另开单统一改名或调 include。
2. **v11 的 `beforeSendTransaction` 默认不生效**（见 B12）：若将来要 transaction 级脱敏，需要改用 `beforeSendSpan`（本次未做，见 §五）。
3. **console.* 输出会变成 Sentry breadcrumb**（v11 的 Console integration 默认开）：生产代码若用 `console.log` 打心理内容，会进 breadcrumb。本单按 §五.1 不做 NLP 级识别，只做了模式级脱敏 → 登记建议。

---

## 五、本单**不做**的（与任务单 §五 一致，另有两条实证补充）

1. 不做 NLP 级心理内容识别（Error.message / breadcrumb 自由文本里的心理原文不识别）。
2. 不改 pino 日志层的其他业务调用点（本单只修 §2.6 列的 5 处 + §4.3 验收连带要求的 2 处）。
3. 不做 Sentry 平台侧 Web UI 配置（大炮手动配，见任务单 §3.5）。
4. 不处理 Flutter 客户端 / admin-dashboard 前端的 Sentry 脱敏。
5. 不重写 WP26 P2-39 的本地日志脱敏逻辑（**只搬位置，不改行为**——`test/shared/wp26-biz-exception-log.spec.ts` 一行没改且全绿）。
6. 不在 extra 里遮业务内容类字段（dev 模式 `logger.warn` 提示即可）。
7. 不动 BullMQ Worker 的业务逻辑。
8. **（新增）不做 span 级脱敏**：v11 默认 `traceLifecycle='stream'`，span 里带的是 `url.full` / `url.query` / header 属性，**不带 body**；query 参数由 SDK 自己过滤敏感 key（`dataCollection.urlQueryParams: true`）。要做 span 级 `url` 脱敏需要接 `beforeSendSpan`，本单未做，登记建议。
9. **（新增）不改 `beforeSend` 收到的 `sdkProcessingMetadata`**：里面有原始 body，但 SDK 造 envelope 时会 `delete event.sdkProcessingMetadata`（`@sentry/core/build/cjs/envelope.js:40`）→ **不会发出去**。e2e 的断言落在 envelope 上，就是为了验证这一点。

---

## 六、闸门数字（2026-11-06 实跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| lint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error** ✅ |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| 单测（全量） | `npx vitest run --exclude '**/e2e/**/*.ts'` | **114 文件 / 1955 例 全绿** ✅ |
| 新增单测 | `npx vitest run test/shared/sentry-redaction.spec.ts` | **49 例 全绿** ✅ |
| e2e（全量） | `npx vitest run --config ./test/vitest.e2e.mts` | **2 passed \| 4 skipped（6 文件）/ 22 passed \| 15 skipped** ✅（跳过的 4 个是需要真 DB 的既有 e2e，与本单无关） |
| 新增 e2e | `npx vitest run --config ./test/vitest.e2e.mts test/e2e/sentry-redaction.spec.ts` | **5 例 全绿** ✅ |
| **engine-core 红线** | `git diff --stat HEAD -- src/engine-core` | **空** ✅（永久红线未破） |
| 边界断言 | `npx vitest run test/engine-core/boundary.spec.ts` | **12 例 全绿** ✅（零 NestJS / 零网络 / 零 prompt） |
| 反双胞胎 | `grep PHONE_PATTERN\|ID_CARD_PATTERN\|EMAIL_PATTERN`（全仓 `*.ts`） | **只在 `pii-redactor.ts` 一处** ✅ |
| `pii-redactor.ts` 不 import Sentry | 人工核对 | 零 `@sentry/*` import ✅ |

---

## 七、验收口径逐条对照

### §4.2 脱敏口径验收

- [x] POST `/__test__/throw5xx` body 含 `{ body, title, password, userId }` → 真正发出去的 envelope 里 `body`/`title`/`password` 全无，`userId` 不在黑名单里不误伤（对象形态断言见 e2e ③）
- [x] `redactIp('1.2.3.4') === '1.2.3.0'`；`redactIp('::ffff:1.2.3.4') === '1.2.3.0'`
- [x] Sentry init 里显式有 `serverName: 'unknown'`（+`includeServerName: false`）与 v11 等价的"不采 PII"配置
- [x] event.user 里 email/username 被删，id 保留，ip 走 /24 截断
- [x] extra 里 `userId`/`sessionId`/`code` 保留，`password`/`token` 被遮

### §4.3 warn 修复验收

- [x] `grep "slice(0, 100)" src/agent/llm/llm.service.ts` → 0
- [x] `grep "slice(kept.length" src/engine-adapters/rendering/llm-render.adapter.ts` → 0
- [x] `片段=` 在 `llm-render.adapter.ts` 只存在于 dev 分支（prod 分支打 `text_len`）
- [x] `grep "slice(0, 120)" src/voice/tts/tts-bidi-client.ts` → 0
- [x] `grep "userInput.slice" src/knowledge-base/providers/preview.service.ts` → 0

### §4.4 反双胞胎验收

- [x] `biz-exception.filter.ts` 底部不再有私有脱敏正则副本，全部从 `pii-redactor.js` import
- [x] 全仓 `PHONE_PATTERN`/`ID_CARD_PATTERN`/`EMAIL_PATTERN` 只在 `pii-redactor.ts` 一处定义
- [x] `pii-redactor.ts` 不 import `@sentry/node` 或任何 Sentry 类型

---

> ⚠️ **提交时注意**：`git status` 里另有 `admin-dashboard/src/views/DebugChat.vue` 与
> `admin-dashboard/src/views/debug/SessionList.vue` 两个**前端文件是改动状态** —— 那是**前端 AI 的 WP58 接线**，
> **不是本单的改动**（本单零前端代码）。手动提交时**别把这两个文件一起带进来**。

---

## 八、给大炮的两条手工动作

1. **Sentry 平台侧**（任务单 §3.5，代码侧已做，平台侧需手动确认）：Settings → Project Settings → Security → Data Scrubbing 默认 scrubber 全开；Privacy → Send Default PII 关闭；可选加一条自定义 scrubber 正则 `(我想自杀|不想活|结束生命|自残)`。
2. **建议升级一次 Sentry SDK**：`@sentry/node@11.10.0` 的 `beforeSendTransaction` 已 deprecated 且默认不生效；升到 v12 前后要重新核对 `dataCollection` 的默认值有没有再变（**本单所有默认值结论都是对 11.10.0 实测的**，升版必须重测）。

---

## 九、留给下一单的登记建议

1. `*.e2e-spec.ts` 死文件名清理（3 个文件从未运行）。
2. `beforeSendSpan` 级脱敏（span 的 `url.full` / `url.query`）。
3. console.* 输出进 breadcrumb 的收口（业务侧禁打心理原文，或加 lint 规则）。
4. 全仓其余日志调用点的"打原文"普查（任务单 §五.2 明确留给后续单）。
