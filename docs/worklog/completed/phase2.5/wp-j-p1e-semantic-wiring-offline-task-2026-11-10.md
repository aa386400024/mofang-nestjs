# WP-J P1e · Phase 2 离线接线任务单（2026-11-10 v2 已核方向）

> **状态：✅ 已完成（2026-11-10）** → 交付记录：[`wp-j-p1e-semantic-wiring-offline-2026-11-10.md`](./wp-j-p1e-semantic-wiring-offline-2026-11-10.md)
> 执行方：MiniMax Code
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 前置：P1e 第一批已交付（`semantic-tag-parser.ts` + `minimax-tts-adapter.ts` + 68 例单测，全绿，未接生产）

---

## 一、背景（先读这段，方向别错）

**核心事实**：在「心塑」对练里，**TTS 输出的是 AI 来访者的话，不是 AI 咨询师的话**。

- 真实 Flutter 场景：真人咨询师麦克风输入 → ASR → 后端；后端 → AI 来访者 LLM → 回复文本 → **TTS 合成音频** → 耳机给真人咨询师听。
- 批量对练（auto-practice）：两边都是 AI。`practice-runner.service.ts` 的 loop 是
  ```
  counselorReply = counselorAgent.generate(...)   // AI 咨询师（控制标记 CLOSE_TAG 在这）
  result = engine.turn(counselorReply.text)      // AI 来访者（result.reply 才是要 TTS/parse 的文本）
  ```

**现有 TTS 链路已经是通的**：`src/agent/visitor/visitor.prompts.ts` 已经在让 LLM 输出 MiniMax 官方白名单厂商标记
`(sighs) (breath) (laughs) (sniffs) (inhale) (exhale) (coughs)...`，TTS 直接当语气指令念。
P1e 这层是在已有链路上加能力（语义标准化、`[pause:0.5]` 停顿、情绪标记、三级降级），**不是从零接 TTS**。

**本批目标**：让批量对练产出的**来访者回复**（`result.reply`）落库时拆成 `displayText / ttsText / semanticJson` 三份，
同时为在线流式链路备好一个句级缓冲预处理器（**先不接进在线生产链路**）。

**咨询师那半边**（`counselorReply.text`）：本批**只落纯文本，不 parse、不拆三份**（调试模式，文字看逐字稿就够）。

---

## 二、目标（5 个交付物）

### 1. migration：turn 记录加 5 列

**先查清楚逐字稿存在哪再加列**——`practice-session` 是 session 级实体，一轮一轮的文本（history）
大概率是 JSON 字段或单独的 turn 表，不要直接在 session 表上加列（那样 12-25 轮会挤成一行）。
读 `practice-session.entity.ts` 和 `practice-runner` 里 `history` 怎么落库的，选对落点：

- 如果有独立的 turn 实体 / turn 表 → 加在 turn 上
- 如果逐字稿是 session 上的 JSON 字段 → 5 列还是加在 session 上，但按 turnIndex 存成 JSON 对象数组
- 你判断哪种更合理，在交付记录里说明为什么

5 列：

| 列名 | 类型 | 可空 | 默认 |
|---|---|---|---|
| `visitor_display_text` | text | 是 | NULL |
| `visitor_tts_text` | text | 是 | NULL |
| `visitor_semantic_json` | json / longtext | 是 | NULL |
| `visitor_semantic_level` | tinyint | 是 | NULL |
| `visitor_semantic_version` | varchar(16) | 是 | NULL |

列名带 `visitor_` 前缀（明确是来访者那半边）。
**`visitor_semantic_version` 写死一个常量字符串**（比如 `'semantic-v1'`），定义在 persister 里导出，
以后 parser 升级了改这个常量就能区分新旧数据。

新建 migration 文件，**必须登记到 `src/migration/index.ts` 显式数组**（本仓库用显式 migration 列表，
不登记的文件静默不执行，真库会缺列）。咨询师那半边（counselor text）本批不加列，沿用现有逐字稿存储。

### 2. `SemanticTurnPersister` 服务

位置：`src/auto-practice/semantic/semantic-turn.persister.ts`。

接口形状（照这个写，不要自由发挥）：

```ts
interface SemanticTurnPersister {
  /** 解析来访者回复并落库. 单条 update 一次写 5 列, 要么全成要么全败, 不留脏数据. */
  persistVisitorTurn(args: {
    readonly practiceSessionId: string;
    readonly turnIndex: number;
    readonly rawVisitorText: string;
  }): Promise<void>;
}
```

- 纯 NestJS Injectable，不发网络请求、不连 TTS
- 内部：`SemanticTagParser.parse(rawVisitorText)` → `MiniMaxTtsAdapter.render(turn, { baseVoiceParams: {} })`
- 5 列在**同一条 update SQL** 里写完（不要分两次写，避免一半成功一半失败）
- **只处理来访者文本**，不碰咨询师文本
- 导出 `export const SEMANTIC_VERSION = 'semantic-v1' as const;` 给 migration 落库用
- 单测里 mock repo，**不要真连 MySQL**

### 3. 离线接线：`practice-runner.service.ts`

**严格边界**：只在来访者那半边加 parse + persist，咨询师那半边一行不动。

定位到 `practice-runner.service.ts` loop 里（约 L498-L527）：
- `const result = await this.engine.turn(...)` 拿到来访者回复
- **只在以下三个条件同时满足时才调 persister**：
  1. `result.trace.degraded === false`（不是渲染层兜底句，真调了 LLM）
  2. `result.reply.trim().length > 0`（不是阻断空轮）
  3. 不是 crisis 窗口特判（crisis 窗口内来访者回复也要 parse，正常走）
- 调 `persister.persistVisitorTurn({ practiceSessionId, turnIndex: result.turnIndex, rawVisitorText: result.reply })`
- **`counselorReply.text` 一行都不要改**（不 parse、不拆）
- gateway 事件推的 `visitorText: result.reply` **保持原样**（推原始带标签文本，标注台要看到标签才能校准 prompt；不要换成 displayText/ttsText）
- persister 失败要 catch 住，不能因为落库失败炸掉整批对练（warn 日志即可，日志里不许带对话原文，只打 `sessionId / turnIndex / errorName`）
- **不要动** `counselor-agent.service.ts`（豆包刚重构完的门面，本批不碰）
- **不要动** `counselor/` 目录（豆包地盘）
- **不要动** `src/engine-adapters/rendering/**`（visitor reply 是渲染层出来的，本批不碰渲染逻辑）

### 4. `StreamingSemanticPreprocessor` 纯类

位置：`src/auto-practice/utils/streaming-semantic-preprocessor.ts`。

**先读 MiniMax 官方 bidi 接口文档再设计**（关键事实，别按旧假设写）：

- 我们用的是 `/ws/v1/t2a_v2_bidi`（双向流式），**服务端自动攒句**，客户端可以逐 token 发
- **不要自己切句**——句边界是服务端的事（它会返回 `sentence_start`/`sentence_end`）
- 本类唯一职责：**缓冲到语义标签闭合**。因为 `[sigh]` `[pause:0.5]` `[emotion:sad]` 这些标签必须完整到达才能被 parser 解析成 `(sighs)` / `<#0.5#>`；如果 LLM 逐 token 流出时把前半截裸文本（比如 `[pa`）直接发给 TTS，会被念出来
- 因此：遇到 `[` 就暂停往外吐文本，缓冲到对应的 `]` 闭合后整段 parse 成 TTS-ready 文本再吐出去；`]` 闭合后继续透传
- 未闭合的 `[` 在 `flush()` 时按纯文本吐出去（不丢字）

接口形状（照这个写）：

```ts
class StreamingSemanticPreprocessor {
  /** 喂 LLM 增量 token, 返回可以立即发给 TTS 的文本 (可能为空字符串). */
  pushToken(chunk: string): string;
  /** 本轮结束, 把残余缓冲按纯文本 flush 出去 (不丢字). */
  flush(): string;
  /** 会话切换时重置内部状态. */
  reset(): void;
}
```

- **只写类 + 单测**
- **不准接进** `tts-bidi-client.ts` / `tts.service.ts` / `voice.gateway.ts` / `engine-stream-backend.adapter.ts`
  （在线语音链路是生产路径，下一批再合；本批只把工具备好）

**同时修正 P1e 第一批的一个 bug**（adapter 映射表）：

- P1e 交付记录里写"`calm` → `neutral`"是**错的**。官方 emotion 白名单就有 `calm`（值就是 `calm`），不需要映射
- 正确枚举：`happy / sad / angry / fearful / disgusted / surprised / calm / fluent / whisper`
- 其中 `fluent` / `whisper` 仅 speech-2.6 系列支持，speech-2.8 不支持 whisper
- 你在 adapter 里核对一下映射表，如果真把 calm 映射成了 neutral，改成直通；单测里加一条钉住

### 5. visitor prompt 升级片段（独立文档，不进代码）

位置：`docs/worklog/pending/phase2.5-visitor-semantic-tag-migration-snippet.md`。

背景：`src/agent/visitor/visitor.prompts.ts` 现在让 LLM 输出 MiniMax 厂商标记 `(sighs) (breath) (laughs)...`。
P1e 目标是让 LLM 改输出语义层标准标记 `[sigh]` `[pause:0.5]` `[emotion:sad]`，parser 统一处理后再映射回厂商标记。

文档内容：
- 把现有"情绪 inline tag 频率"那段（`DIFFICULTY_TAG_FREQ`）从厂商标记 `(sighs)` 升级成语义标记 `[sigh]` 的写法
- 新增 `[pause:0.5]` 停顿标记的使用纪律（句尾停顿会被 parser 丢弃，不要滥用；官方格式 `<#0.5#>` 范围 [0.01, 99.99] 秒）
- 新增 `[emotion:xxx]` 情绪标记，**合法值**：`happy / sad / angry / fearful / disgusted / surprised / calm`（`calm` 就是中性，不要写 `neutral`；`fluent/whisper` 是 speech-2.6 专属，2.8 模型不用）
- 3-5 条纪律 + 2 个正反例
- **本批只写 md 文档，不准改** `src/agent/visitor/visitor.prompts.ts`（那是在线对练生产 prompt，改了所有真实会话的 AI 来访者语气都会变，下一批单独灰度）

**参考文档**：项目里已经存了一份精炼速查，直接读本地文件：
```
docs/reference/minimax-t2a-api.md
```
包含：三个接口选型、`<#x#>` 停顿格式、语气词白名单、emotion 合法枚举（calm 直通）、错误码表、bidi 攒句规则。
**不要去改** `src/voice/tts/tts-bidi-client.ts`（它已按官方协议实现，本批不碰）。

---

## 三、硬约束（红线）

- ❌ `src/engine-core/**` 零改动
- ❌ 不接进 `src/voice/tts/**` / `src/voice/voice.gateway.ts` / `src/engine-adapters/wiring/engine-stream-backend.adapter.ts`
- ❌ 不碰 `src/engine-adapters/rendering/**`（visitor reply 是渲染层出来的，本批不碰渲染逻辑）
- ❌ 不碰 `src/auto-practice/counselor/**`（豆包地盘）
- ❌ 不碰 `src/auto-practice/counselor-agent.service.ts`
- ❌ 不改 `src/agent/visitor/visitor.prompts.ts`（本批只出 md 文档）
- ❌ `adapter.render(turn, { baseVoiceParams })` 的 `baseVoiceParams` 本批传空对象 `{}`
- ❌ 心理内容（对话原文）禁止进 `Logger.debug/log/error`，诊断 JSON 只出诊断码+计数（沿用 P1e 已立规矩）
- ❌ 不 `git add` / `git commit` / `git push`
- ✅ 自己跑闸门并把实际数字写进交付记录：
  - `npx tsc -p tsconfig.build.json --noEmit`
  - `npm run lint`
  - `npx vitest run test/auto-practice`
  - 跑不起来就写报错原因，不要留空"待用户执行"

---

## 四、已决方案（直接照做，不要重新设计）

- pause offset 口径：UTF-16 code unit（P1e 已定）
- SemanticTurn 不留 voiceParams（P1e 已定）
- level 一起落库（事后能区分"本来纯文本" vs "解析失败"）
- 控制标记 `END/MORE` 从 rawText 取，不能从 displayText 取
- `semanticJson` 直接序列化 turn（字段恒存在，null=无）
- **bidi 接口服务端自动攒句，preprocessor 不自己切句，只缓冲标签闭合**（本批新拍）
- **只 parse 来访者文本，咨询师文本不 parse**（本批核心方向）
- **emotion 白名单以官方为准**：happy/sad/angry/fearful/disgusted/surprised/calm（calm 直通，不映射 neutral）

---

## 五、希望 MiniMax 帮什么

- 5 项里如果有边界你觉得不安全（migration 落点、persister 失败处理、practice-runner 现有单测会不会炸），直接在交付记录里说，不要硬上
- **顺手修 P1e 第一批的 adapter emotion 映射 bug**：如果 `calm` 被映射成了 `neutral`，改回直通（官方白名单有 calm，没有 neutral），加单测钉住
- 单测覆盖：persister 三级降级路径、preprocessor 标签闭合缓冲 / 未闭合 `[` flush / reset() 状态清空，**至少 25 例新单测**
- 以下既有单测不能挂：
  - `test/auto-practice/counselor-agent.spec.ts`（5 例）
  - `test/auto-practice/wp-j-p1e-semantic-tag-parser.spec.ts`（68 例，P1e 第一批）
- 顺手修你跑闸门时碰到的既有测试抖动可以，但只准动测试文件，断言不能改

---

## 六、交付记录

写完这个文件：

```
E:\Work\Project\backend\mofang-nestjs\docs\worklog\completed\phase2.5\wp-j-p1e-semantic-wiring-offline-2026-11-10.md
```

交付记录末尾附一行 commit message 草稿（你不自己 commit，只给文案），格式参考上一批：

```
feat(wp-j-p1e): 离线接线 — 来访者回复语义拆三份落库 + StreamingSemanticPreprocessor 备好, 不接在线链路
```

写完后在对话里说一句"已写入文件"即可，不用重复贴全文。
