# WP46 · Sentry 通道脱敏（心理数据合规闭环）

> **状态**：✅ 已交付（2026-11-06）→ [`engine-wp46-sentry-redaction-implementation-2026-11-06.md`](engine-wp46-sentry-redaction-implementation-2026-11-06.md)
> **路径**：`docs/worklog/completed/phase2/wp46-sentry-redaction-2026-11-06.md`
> **一句话**：抽 `pii-redactor.ts` 共享脱敏模块 + `beforeSend` 事件级脱敏 + 两层黑名单 + 两个 filter 对齐 + 修 7 处打原文日志 + 49 例单测 + 5 例 e2e 出血测试；**engine-core 零改动**。
> ⚠️ **重要**：本单实测发现 `@sentry/node@11.10.0` **已删除 `sendDefaultPii` 选项**，且 `dataCollection.httpBodies` **默认采集入站请求体** —— 任务单 §一 的前提不成立，**本单是在堵一个正在流血的洞**（详见交付记录 §二 与偏差表 B1）。
> 开工前先读 `docs/worklog/README.md`。
> 优先级：🟢 P2（但本单是**合规红线**，不是普通技术债——心理内容进 crash report 直接踩《个保法》《精神卫生法》）。
> engine-core：**零改动**（本单全在适配层 / 基础设施层）。
> 版本：v1.3（2026-11-06 修正 engine-core 边界表述：本单不涉及内核，但不把"零改动"写成绝对红线）。

---

## 一、背景（为什么必须现在做）

心塑处理国民心理健康数据，受《精神卫生法》《个人信息保护法》《网络安全法》三重监管。
当前 Sentry 通道的脱敏现状（2026-11-06 实扫）：

| 面 | 现状 | 风险 |
|---|---|---|
| `beforeSend` / `beforeSendTransaction` | 只删 `cookies` / `authorization` / `cookie` header | 🔴 |
| `event.request.data`（请求体） | v11 默认 `sendDefaultPii: false` 不自动 attach，但**未做防御性处理**——一旦 `sendDefaultPii` 被误开、或业务代码手动把 body 塞进 extra，心理原文直接进 Sentry | 🔴 P0 |
| 异常 `message` / `stack` | 原样上报；Sentry 的 `extraErrorDataIntegration` 会自动提取 Error 对象上的自定义属性（如 `err.userInput = 'xxx'`）到 extra；多处 warn 日志里 `text.slice(0,N)` 打的是 LLM 输出/用户输入原文 | 🔴 P0 |
| `extra` 字段 | filter 手动传 `ip`（真实 IP）+ 完整 `url`（含 query）；`captureException(err, { extra: context })` 对 context **零递归脱敏** | 🟡 P1 |
| `event.user` | 当前代码未调 `Sentry.setUser`，但未在 beforeSend 做防御——未来一旦接入用户上下文，email/ip 会裸奔 | 🟡 P1 |
| pino → Sentry | logger.config.ts 只写 stdout/stderr，**无 Sentry transport** | 🟢 干净 |
| BullMQ Worker | 全部在主进程内 `new Worker()`，不是独立进程，Sentry 初始化天然覆盖 | 🟢 已覆盖 |
| admin-dashboard 前端 | grep 0 处 `@sentry` 引用 | 🟢 不涉及 |
| Sentry 平台侧 | `.env.example` 无 `SENTRY_SEND_DEFAULT_PII`，代码未显式设 `sendDefaultPii: false`（v11 默认 false 但应显式锁死）；Web UI 未配置任何 scrubber | 🟡 P1 |

### DTO 实扫结果（字段黑名单依据）

扫了 9 个高敏 DTO 文件，真实心理字段名（不是猜的）：

| DTO 文件 | 心理相关字段 |
|---|---|
| `good_state_diary/dto/good-state-diary.dto.ts` | **`body`**（正文 5000 字）、`title`、**`note`**（情绪快照备注 500 字）、`summary`、`localSummary`、`perspectiveQuestions[]`、`observedThemes[]`、`themes[]`、`tags[]`、`query`（搜索关键词） |
| `emergency/dto/emergency.dto.ts` | **`notes`**（thought_bubble 气泡备注）、**`context`**（`Record<string, unknown>` 透传，additionalProperties: true，内容不可控） |
| `ai-engine/dto/llm-chat.dto.ts` | `messages[]`、`content`、**`delta`**（流式增量文本）、`crisisSignal.keywords[]`、`crisisSignal.suggestedResource` |
| `genome-reshape/dto/genome-reshape.dto.ts` | `label`、**`rootCause`**（根源分析，示例"童年需求常被否定"）、**`creatureTrait`**（习性描述）、`summary`、**`steps[]`**、**`feedback`**（用户反馈）、`lockedReason` |
| `life-map/dto/post-drift-bottle.dto.ts` | `content`（信件 500 字）、**`authorAnonymousName`**（匿名化名） |
| `ai-companion/dto/ai-conversations.dto.ts` | `title`、`summary` |
| `counselor/dto/crisis-practice.dto.ts` | **`teachingNote`**、`description`、**`examples[]`**、**`openQuestions[]`**、**`resourceGuidance`**、**`boundaryNotice`** |
| `knowledge-base/dto/preview.dto.ts` | `userInput` |

### 已确认的真实 warn 日志泄漏点（本单顺手修，见 §2.6）

1. `src/agent/llm/llm.service.ts:326` — `payload=${payload.slice(0, 100)}`，SSE parse error 打上游返回前 100 字符
2. `src/engine-adapters/rendering/llm-render.adapter.ts:471` — `text.slice(kept.length, kept.length + 60)`，truncation guard 打丢弃尾句
3. `src/engine-adapters/rendering/llm-render.adapter.ts:938` — `片段=${text.slice(0, 120)}`，安全信号判定打 LLM 输出片段（注释写了"同 WP4 口径"，有意为之，但 prod 仍应脱敏）
4. `src/voice/tts/tts-bidi-client.ts:363` — `text.slice(0, 120)`，TTS WebSocket 帧 parse error 打原始帧
5. `src/knowledge-base/providers/preview.service.ts:76` — `userInput=${userInput.slice(0, 30)}`，KB 预览 LLM 失败打 mock 输入

---

## 二、要做的事

### 2.1 抽离 `pii-redactor.ts`（单一事实源，反双胞胎）

**现状**：`src/common/filters/biz-exception.filter.ts` 文件底部（L172–L277）已有一套成熟脱敏函数：
- `redactForLog` / `redactSql` / `redactStack` / `redactPath` / `truncateForLog`
- 正则：`SQL_STATEMENT_PATTERNS` / `CREDENTIAL_SCHEME_PATTERN` / `SENSITIVE_KEY_VALUE_PATTERN` / `PHONE_PATTERN` / `ID_CARD_PATTERN` / `EMAIL_PATTERN`

这套函数目前是 filter 文件私有（没 export），本地日志在用，Sentry 通道没用——**双胞胎风险**。

**动作**：
1. 新建 `src/shared/infra/observability/pii-redactor.ts`。
2. 把上面这套函数 + 正则原样搬过来并 export。
3. **pii-redactor.ts 是纯函数模块，不 import `@sentry/node` 或任何 Sentry 类型**——它接受 `unknown` / `Record<string, unknown>`，返回同类型，保持与 Sentry 解耦，本地日志和 Sentry 通道共用。
4. 新增以下 export：
   - `SENSITIVE_KEY_NAMES: ReadonlySet<string>` — **凭据类**字段名（任何位置都遮，见 §3.2.A）
   - `SENSITIVE_CONTENT_NAMES: ReadonlySet<string>` — **业务内容类**字段名（只在 `request.data` 递归遮，见 §3.2.B）
   - `redactRecord<T>(obj: T, sensitiveNames: ReadonlySet<string>): T` — 递归扫对象，命中字段名的 value 替换为 `'[REDACTED]'`；数组递归元素；Buffer/string 整体替换
   - `redactString(text: string): string` — 文本脱敏（复用现有 `redactForLog`：SQL/凭据/手机/身份证/邮箱正则）
   - `redactIp(ip: string | undefined): string | undefined` — IP 截断（见 §3.3）
   - `redactEventForSentry(event: Record<string, unknown>): Record<string, unknown>` — 编排函数，把上面几个组合起来处理 Sentry event

### 2.2 Sentry 初始化侧加事件级脱敏

改 `src/shared/infra/observability/sentry.service.ts` 的 `Sentry.init({...})`：

1. **显式设**：
   ```ts
   sendDefaultPii: false,  // 红线：心理数据合规，永不开启 PII 默认采集
   serverName: 'unknown',  // 不暴露服务器主机名
   ```

2. **`beforeSend(event)` 和 `beforeSendTransaction(event)`** 开头统一调 `redactEventForSentry(event as Record<string, unknown>)`。编排逻辑：

   a. **`event.request.data`**（请求体）：
      - 如果是 `Buffer` / `string`（multipart 上传）→ 整体替换为 `'[REDACTED body]'`
      - 如果是 object → 调 `redactRecord(event.request.data, SENSITIVE_CONTENT_NAMES)` 递归扫

   b. **`event.request.query_string`**：删其中 key 命中 `SENSITIVE_KEY_NAMES` 的参数（token/phone/code/password）

   c. **`event.request.url`**：走 `redactPath`（与本地日志口径一致，去 query）

   d. **`event.request.headers`**：保留现有删法（authorization/cookie），不动

   e. **`event.user`**（防御性，即使当前没调 setUser）：
      - 保留 `id`（业务 id，用于聚合）
      - 删 `email` / `username` / `ip_address`（或把 `ip_address` 走 `redactIp`）

   f. **`event.extra`**：
      - 只对 `SENSITIVE_KEY_NAMES`（凭据类）做递归遮
      - **不对 `SENSITIVE_CONTENT_NAMES` 遮**——因为 extra 是业务代码手动传的，业务 id（userId/sessionId/code）是调试必需的；如果业务代码把心理原文塞进 extra，那是业务代码的问题（见 §五.7）

   g. **`event.breadcrumbs[]`**：
      - 每个 breadcrumb 的 `data` 走 `redactRecord(data, SENSITIVE_KEY_NAMES)`
      - breadcrumb 的 `message` 走 `redactString`
      - breadcrumb 的 `url`（如果有）走 `redactPath`

   h. **`event.exception.values[]`**：
      - `value`（Error.message）走 `redactString`（遮 SQL/凭据/手机/邮箱）
      - `stacktrace.frames[]`：保留文件/行号；每帧的 `vars` / `pre_context` / `context_line` 走 `redactString`

3. **保留**现有 `ignoreErrors` 和 ECONNRESET 过滤逻辑，不动。

### 2.3 `SentryService.captureException / captureMessage` 手动层脱敏

改 `sentry.service.ts` L122–L137：

- `captureException(err, context?)`：`context` 先过 `redactRecord(context, SENSITIVE_KEY_NAMES)`（只遮凭据类），再传给 `Sentry.captureException(err, { extra: redacted })`。
- `captureMessage(message, level?, context?)`：`message` 走 `redactString`，`context` 同样过 `redactRecord(context, SENSITIVE_KEY_NAMES)`。
- dev 模式下加 `console.warn`：当 extra 里命中 `SENSITIVE_CONTENT_NAMES` 时，提示"你传了心理内容字段名进 extra，已被保留但请检查是否必要"——本地可见，不上报。
- 加注释：业务侧不要把 prompt / userInput / chat history 传进 context。

### 2.4 两个 ExceptionFilter 的 extra 对齐

改 `biz-exception.filter.ts` L59–L65 和 `practice-asr-upload.filter.ts` L48–L55：

当前传的 extra：
```ts
{
  url: request.url,
  method: request.method,
  ip: request.ip,
  userAgent: request.headers['user-agent'],
  code,
}
```

改成：
```ts
{
  url: redactPath(request.url),
  method: request.method,
  ip: redactIp(request.ip),
  userAgent: truncateForLog(request.headers['user-agent'] ?? '', 200),
  code,
}
```

> 反双胞胎：直接调 `pii-redactor.js` 的函数，不在 filter 里重写。

### 2.5 机械化守卫（防技术债再犯）

1. **单元测试** `test/shared/sentry-redaction.spec.ts`（新建），覆盖：
   - `redactRecord` 对 `SENSITIVE_CONTENT_NAMES` 的递归脱敏（含嵌套 object、数组元素）
   - `redactRecord` 对 `SENSITIVE_KEY_NAMES` 的递归脱敏
   - `redactRecord` 对 Buffer 类型整体替换
   - `redactIp('1.2.3.4') === '1.2.3.0'`
   - `redactIp('::ffff:1.2.3.4') === '1.2.3.0'`（IPv4-mapped IPv6）
   - `redactIp('2001:db8:85a3::8a2e:370:7334')` 保留前 48 位
   - `redactIp(undefined) === undefined`
   - `redactString` 对手机/身份证/邮箱/凭据/SQL 的遮蔽
   - `redactEventForSentry` 编排后：request.data 里 `body`/`messages` 被遮；extra 里 `userId` 保留；event.user 里 email 被删

2. **"出血"e2e 测试** `test/shared/sentry-redaction.e2e-spec.ts`（新建）：
   - 在 e2e 的 `TestingModule` setup 里动态注册临时 controller（生产代码零痕迹）：
     ```ts
     @Controller('__test__')
     class TestThrowController {
       @Post('throw5xx')
       throw5xx(@Body() body: Record<string, unknown>) {
         // 不把 body 拼进 Error.message —— Error.message 里的心理原文识别不归 Sentry 脱敏层
         // 本测试验证的是 beforeSend 对 event.request.data 的处理
         throw new Error('test 5xx internal error');
       }
     }
     ```
   - mock `Sentry.captureException`（参考 `test/shared/wp26-biz-exception-log.spec.ts`）。
   - POST `/__test__/throw5xx`，body 塞 `{ body: '我想自杀，日记原文', title: '求助', password: 'abc123', userId: 'u123' }`。
   - 断言：
     - `event.request.data.body` 为 `'[REDACTED]'`（不是原文）
     - `event.request.data.title` 为 `'[REDACTED]'`
     - `event.request.data.password` 为 `'[REDACTED]'`
     - `event.request.data.userId` 保留为 `'u123'`（不在两个黑名单里，调试需要）
   - 这是验收金标准——以后任何人改 beforeSend 逻辑，这个测试挂了就是漏了。

### 2.6 顺手修 5 处 warn 日志的原文泄漏（大炮拍板"顺手修"）

| 文件:行 | 当前代码 | 改成 | 理由 |
|---|---|---|---|
| `agent/llm/llm.service.ts:326` | `payload=${payload.slice(0, 100)}` | `payload_len=${payload.length}` | JSON.parse 失败知道长度够 debug；原文无排查价值 |
| `engine-adapters/rendering/llm-render.adapter.ts:471` | `text.slice(kept.length, kept.length + 60)` | `dropped_chars=${text.length - kept.length}` | truncation guard 知道丢了多长够了 |
| `engine-adapters/rendering/llm-render.adapter.ts:938` | `片段=${text.slice(0, 120)}` | `process.env.NODE_ENV === 'production' ? \`text_len=${text.length}\` : \`片段=${text.slice(0, 120)}\`` | 安全信号 debug 需要片段，但 prod 不能打心理原文 |
| `voice/tts/tts-bidi-client.ts:363` | `text.slice(0, 120)` | `frame_len=${text.length}` | TTS WS 帧 parse error 知道帧大小够了 |
| `knowledge-base/providers/preview.service.ts:76` | `userInput=${userInput.slice(0, 30)}` | 把 `for...of MOCK_USER_INPUTS` 改成 `for (const [idx, userInput] of MOCK_USER_INPUTS.entries())`，打 `userInput_idx=${idx}` | 用 entries() 拿索引，不用 indexOf |

> 修这 5 处时，**不改日志级别、不改触发条件、不改上下游逻辑**，只把"打原文"改成"打长度/索引/标签"。

---

## 三、设计决策

### 3.1 为什么在 `beforeSend` 做，而不是在 filter 层做？

| 方案 | 覆盖自动捕获 | 覆盖手动上报 | 覆盖 Worker 异常 | 覆盖 extraErrorDataIntegration |
|---|---|---|---|---|
| 只在 filter 层脱敏 | ❌ | ✅ | ❌ | ❌ |
| 只在 `captureException` 手动层 | ❌ | ✅ | ❌ | ❌ |
| **在 `beforeSend` 统一做** | ✅ | ✅ | ✅ | ✅（extra 被递归扫） |

`beforeSend` 是所有事件（自动/手动/Worker/Error 自定义属性）必经的最后一道防线。filter 层和 service 层的脱敏是**第二道**（让 extra 本身干净）。

### 3.2 字段黑名单分层（v1.2 自审修正：v1.1 把所有字段名混在一起递归扫，会误伤）

**A. `SENSITIVE_KEY_NAMES`（凭据类——任何位置都遮）**

这些字段名在 event 任何位置（request.data / extra / breadcrumbs）出现都遮：

```ts
export const SENSITIVE_KEY_NAMES: ReadonlySet<string> = new Set([
  'password', 'passwd', 'pwd',
  'token', 'accessToken', 'refreshToken',
  'secret', 'apiKey', 'api_key', 'access_key',
  'authorization', 'cookie',
]);
```

**B. `SENSITIVE_CONTENT_NAMES`（业务内容类——只在 `event.request.data` 递归遮）**

这些字段名只在请求体里遮。**不在 extra 里遮**——因为 extra 是业务代码手动传的，业务 id（userId/sessionId/code）是调试必需的；如果业务代码把心理原文塞进 extra，那是业务代码的问题（见 §五.7）。

```ts
export const SENSITIVE_CONTENT_NAMES: ReadonlySet<string> = new Set([
  // 自由文本字段（DTO 实扫确认）
  'body',              // 日记正文
  'content',           // 漂流瓶信件 / chat message 内容
  'text', 'message', 'prompt', 'reply', 'response',
  'completion', 'output', 'input',
  'delta',             // 流式增量文本
  'note', 'notes',     // 情绪快照备注 / 急救气泡备注
  'summary', 'localSummary',
  'title',
  'feedback',          // 用户反馈
  'query',             // 搜索关键词
  'description', 'reason', 'lockedReason',
  'rootCause', 'creatureTrait',
  'teachingNote', 'resourceGuidance', 'boundaryNotice',
  'authorAnonymousName',
  'emoji',
  // 用户输入 / 对话
  'userInput', 'userText', 'userMessage', 'userQuery', 'userContent',
  'diary', 'entry', 'journal',
  'answer', 'answers', 'scaleAnswer', 'scaleAnswers', 'assessment',
  'emotion', 'feeling', 'mood',
  'conversation', 'chat', 'messages', 'history', 'dialogue',
  'selfHarm', 'crisis', 'suicide', 'trauma', 'riskNote',
  'report', 'transcript', 'audioText', 'asrText',
  // 数组类型（元素都是字符串）
  'perspectiveQuestions', 'observedThemes', 'themes', 'tags',
  'steps', 'examples', 'openQuestions', 'keywords',
  'suggestedResource',
  // 泛透传字段（内容完全不可控）
  'context',           // emergency DTO 的 Record<string, unknown>
]);
```

> ⚠️ **不列入黑名单的字段名**：`data` / `payload` / `input` / `output`——这些太宽泛，在 extra 里经常是正常业务数据（如 `{ code: 0, data: { userId: 'u123' } }`），全局遮会误伤调试信息。请求体里如果有这些字段名，由 `request.data` 整体过 `redactRecord` 时自然处理（但它们不在 CONTENT_NAMES 里，所以不会被遮——这是有意的，因为请求体里的 `data` 字段名太泛，我们靠具体业务字段名黑名单来遮真正的心理内容）。

### 3.3 IP 脱敏（企业级）

- **IPv4**：`1.2.3.4` → `1.2.3.0`（保留 /24）
- **IPv4-mapped IPv6**：`::ffff:1.2.3.4` → `1.2.3.0`（识别并按 IPv4 处理）
- **IPv6**：`2001:db8:85a3::8a2e:370:7334` → `2001:db8:85a3::`（保留前 48 位 = 前 3 组）
- `undefined` / `null` → 保留 `undefined`

### 3.4 e2e 测试端点

在 e2e `TestingModule` setup 里动态注册临时 controller，生产代码零痕迹。测试端点**不把 body 拼进 Error.message**——因为 Error.message 里的心理原文识别不归 Sentry 脱敏层（见 §五.7）。

### 3.5 Sentry 平台侧配置（大炮手动在 Web UI 配）

代码侧已做 `sendDefaultPii: false` + `serverName: 'unknown'`。大炮需要在 Sentry Web UI 确认：
- Settings → Project Settings → Security → Data Scrubbing：默认 scrubber 全开
- Settings → Project Settings → Privacy → Send Default PII：关闭
- 可选加一条自定义 scrubber 正则：`(我想自杀|不想活|结束生命|自残)` 命中即替换（平台侧最后兜底）

### 3.6 engine-core 边界

- 本单所有改动都在 `src/shared/infra/observability/` + `src/common/filters/` + `src/agent/llm/` + `src/engine-adapters/rendering/` + `src/voice/tts/` + `src/knowledge-base/providers/` + 测试目录。
- **本单不涉及 engine-core**（Sentry 脱敏是基础设施层的事，跟 BDI 决策内核无关）。
- 永久红线仍然有效：`boundary.spec.ts` 的 11 条断言（零 NestJS / 零网络 / 零 prompt）必须全绿。

---

## 四、验收标准

### 4.1 功能验收

- [ ] `pnpm build` 0 TS 错
- [ ] `pnpm lint` 0 error
- [ ] `pnpm test` 全绿（含新增 spec + e2e）
- [ ] `boundary.spec.ts` 11 条断言全绿（永久红线）
- [ ] e2e 测试在没接 redactor 前失败，接了之后通过

### 4.2 脱敏口径验收

- [ ] POST `/__test__/throw5xx` body 含 `{ body: '心理原文', title: '标题', password: 'x', userId: 'u123' }`，Sentry event 的 `request.data` 里 `body`/`title`/`password` 为 `[REDACTED]`，`userId` 保留
- [ ] `redactIp('1.2.3.4') === '1.2.3.0'`；`redactIp('::ffff:1.2.3.4') === '1.2.3.0'`
- [ ] Sentry init 里显式有 `sendDefaultPii: false` 和 `serverName: 'unknown'`
- [ ] event.user 里 email/username 被删，id 保留
- [ ] extra 里 `userId`/`sessionId`/`code` 保留，`password`/`token` 被遮

### 4.3 5 处 warn 修复验收

- [ ] `grep "slice(0, 100)" src/agent/llm/llm.service.ts` 0 命中
- [ ] `grep "slice(kept.length" src/engine-adapters/rendering/llm-render.adapter.ts` 0 命中
- [ ] `grep "片段=" src/engine-adapters/rendering/llm-render.adapter.ts` 在 prod 分支 0 命中（dev 分支保留）
- [ ] `grep "slice(0, 120)" src/voice/tts/tts-bidi-client.ts` 0 命中
- [ ] `grep "userInput.slice" src/knowledge-base/providers/preview.service.ts` 0 命中

### 4.4 反双胞胎验收

- [ ] `biz-exception.filter.ts` 底部不再有私有脱敏正则副本，全部从 `pii-redactor.js` import
- [ ] 全仓 grep `PHONE_PATTERN|ID_CARD_PATTERN|EMAIL_PATTERN` 只在 `pii-redactor.ts` 一处定义
- [ ] `pii-redactor.ts` 不 import `@sentry/node` 或任何 Sentry 类型

---

## 五、不做什么（范围外）

1. **不做 NLP 级心理内容识别**——Error.message 里如果夹带非 SQL/凭据/手机类的心理原文（比如业务代码把用户输入拼进了 Error.message），那是业务代码的 bug，应该修业务代码，不是在 Sentry 脱敏层加关键词识别。
2. **不改 pino 日志层的其他业务调用点**——本单只修 §2.6 列的 5 处，其他日志里如果还有打原文的，后续另开单扫。
3. **不做 Sentry 平台侧 Web UI 配置**——大炮手动配（§3.5）。
4. **不处理 Flutter 客户端的 Sentry 脱敏**——`xin_su_app` 仓库的事。
5. **不处理 admin-dashboard 前端**——grep 0 处 Sentry 引用。
6. **不重写 WP26 P2-39 的本地日志脱敏逻辑**——只搬位置，不改行为。
7. **不在 extra 里遮业务内容类字段**——extra 是业务手动传的，业务 id 是调试必需；如果业务代码把心理原文塞进 extra，dev 模式会 `console.warn` 提示，但不自动遮（自动遮会误伤正常调试数据）。
8. **不动 BullMQ Worker 的业务逻辑**——Worker 进程天然被 Sentry 覆盖。

---

## 六、决策记录（大炮 2026-11-06 拍板）

| # | 问题 | 决策 |
|---|---|---|
| 1 | 敏感字段黑名单 | DTO 实扫 9 个高敏文件，分层为 KEY_NAMES（凭据，全局遮）+ CONTENT_NAMES（业务内容，只遮 request.data） |
| 2 | IP 脱敏 | /24 截断（IPv4）/ 前 48 位（IPv6），识别 IPv4-mapped IPv6 |
| 3 | Sentry 平台侧 | 代码显式 `sendDefaultPii: false` + `serverName: 'unknown'`；Web UI 大炮手动配 |
| 4 | e2e 测试端点 | TestingModule 动态注册临时 controller，生产零痕迹；测试端点不拼 body 进 Error.message |
| 5 | 5 处 text.slice warn | 本单顺手修，只改日志内容不改逻辑 |

---

## 七、交付记录位置

完成后移到：
`docs/worklog/completed/phase2/engine-wp46-sentry-redaction-implementation-2026-11-06.md`

更新 `docs/worklog/README.md` 的 Phase2 已交付列表。
