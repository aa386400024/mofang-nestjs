# WP-J P1e Phase3 · visitor prompt 语义标记迁移片段（只出文档，本批不改代码）

> 目标文件（**下一批**才改）：`src/agent/visitor/visitor.prompts.ts` 的 `DIFFICULTY_TAG_FREQ`
> 依据：`docs/worklog/completed/phase2.5/wp-j-p1e-semantic-wiring-offline-2026-11-10.md`（P1e Phase2 接线）
> 官方格式参考：`docs/reference/minimax-t2a-api.md`
> 时间戳：2026-11-10

---

## 一、为什么要迁移（背景）

现在 visitor prompt 让 LLM 直接输出 **MiniMax 厂商标记**：`(sighs) (breath) (laughs) (sniffs) (humming)`。
这套做法在本仓已有一个隐患（`visitor.prompts.ts` 的注释里写着）：**白名单外的 tag 会被 TTS 当普通文字念出来** ——
用户会听到机器念出英文词。

P1e 加了一层语义标准：LLM 改输出**语义标记** `[sigh] [pause:0.5] [emotion:sad]`，
由 `SemanticTagParser` 统一解析（带模糊纠正 + 归一化 + 三级降级），再由 `MiniMaxTtsAdapter` 映射回厂商格式喂给 TTS。

这样换来三件事：

1. **换厂商不用改 prompt**（语义层与厂商解耦 —— 火山/阿里云只换适配层）；
2. **标记写错不会进 TTS**（parser 兜底：模糊纠正 / 归一化 / 降级）；
3. **能观测**（解析降级级别落库，事后知道哪一批标记质量差）。

---

## 二、`DIFFICULTY_TAG_FREQ` 替换文本（可直接粘贴）

```ts
const DIFFICULTY_TAG_FREQ: Readonly<Record<PersonaDifficulty, string>> = {
  L1: `情绪 inline tag 频率 (L1 入门):
- 可主动用, 表达真实感受
- 推荐 (只用语义标记): [sigh] [breath] [laugh]
- 每 2-3 轮至少出现一个 tag, 让语音语气有起伏`,

  L2: `情绪 inline tag 频率 (L2 进阶):
- 偶尔用, 不频繁
- 推荐 (只用语义标记): [sigh] [breath]
- 多数回复可不用 tag, 偶尔压抑不住流露一个 [sigh]`,

  L3: `情绪 inline tag 频率 (L3 专家):
- 极少用, 最多 5-8 轮一个
- 推荐 (只用语义标记): [sigh] [emm]
- 即便内心有情绪, 也不主动让咨询师察觉`,
};
```

> ⚠️ **只改 tag 名称形态**（厂商标记 → 语义标记），频率纪律与难度分层一字不动。
> ⚠️ **不要**在 prompt 里教 `<#0.5#>` / `(sighs)` —— 那是厂商格式，只应由适配层产出。

---

## 三、新增：停顿标记 `[pause:x]` 的使用纪律

停顿是**新增能力**（厂商标记体系里没有停顿，LLM 现在不会自己写），所以要单独教。

```
停顿标记 (可选, 谨慎使用):
- 格式: [pause:0.5] —— 括号里是秒数, 范围 [0.01, 99.99], 最多两位小数
- 一轮最多 1 个, 且必须放在**句子中间** (两个可发音的词之间)
- 放在句尾的停顿会被解析层丢弃 —— 不要在句尾写停顿
- 不要连着写两个停顿 (例如 [pause:0.3][pause:0.5]) —— 会被合并成一个
- 用途: 犹豫、吞咽、话说到一半收住 —— 不是每轮都要用
```

**为什么句尾停顿会被丢弃**：一轮对话的末尾停顿没有可发音的文本承接，
厂商侧也不接受（官方要求停顿必须夹在两段可发音文本之间）—— 留着只会变成一段静音。

---

## 四、新增：情绪标记 `[emotion:xxx]` 的使用纪律

```
情绪标记 (可选, 一轮最多 1 个):
- 格式: [emotion:sad] —— 放在**这一轮的最后**
- 合法值只有这 7 个: happy / sad / angry / fearful / disgusted / surprised / calm
- calm 就是中性 —— **不要写 neutral** (那不是合法值, TTS 会报参数异常)
- 不要写 fluent / whisper —— 那是 speech-2.6 系列专属, speech-2.8 不支持
- 一轮里情绪最多出现一次; 后面的会被忽略 (第一个说了算)
```

> 情绪标记**不会出现在念出来的台词里** —— 它走 TTS 请求的 `voice_setting.emotion` 参数。
>
> 语义层目前只认 5 个情绪值（`sad / calm / fearful / angry / happy`）；
> `disgusted` / `surprised` 属于官方白名单但语义层暂时表达不了 —— 会被丢弃并记一条 warning。
> **给 LLM 的白名单按上面 7 个写**（与官方一致，避免模型学到一个会被丢的值），
> 但要知道 `disgusted` / `surprised` 目前**实际不生效**。

---

## 五、纪律（5 条）

1. **只用语义标记** —— `[sigh] [breath] [inhale] [emm] [laugh] [pause:x] [emotion:x]`；
   **绝不**输出厂商标记 `(sighs)` / `<#0.5#>`（那些是解析层与适配层的内部格式）。
2. **情绪值只能取官方白名单** —— `happy/sad/angry/fearful/disgusted/surprised/calm`；
   `calm` 才是中性（`neutral` 非法）。
3. **停顿放句中、每轮最多一个** —— 句尾停顿会被丢弃，连写会被合并。
4. **标记闭合要完整** —— `[sigh` 少一个 `]` 会被降级处理，整段按纯文本念。
5. **一轮一个情绪** —— 重复的情绪标记以后面的为准会被忽略，第一个说了算。

---

## 六、正反例

### ✅ 正例

```
[sigh]我最近[sigh]……算了，没什么。[emotion:sad]
```

> 解析结果：语气 `sigh` + 情绪 `sad` → TTS 文本 `(sighs)我最近[sigh]……算了，没什么。` + `voice_setting.emotion=sad`。
> （第二个 `[sigh]` 是重复语气 —— 会被忽略并记 warning，实际只保留第一个；下面的例子更干净：）

```
[sigh]我最近……算了，没什么。[emotion:sad]
```

> 解析结果：语气 `sigh` + 情绪 `sad` → TTS 文本 `(sighs)我最近……算了，没什么。`，情绪走 `voice_setting.emotion=sad`。

### ❌ 反例

```
(sighs) 我最近……算了。(laughs) 没什么。[pause:0.5]
```

> 三处问题：
> ① `(sighs)` / `(laughs)` 是**厂商标记** —— 新体系里不该出现（parser 会做"认领式转换"，但那是兜底，不是常态）；
> ② `[pause:0.5]` 落在**句尾** —— 会被解析层直接丢弃（白写）；
> ③ 缺情绪标记 —— 整段没有情绪参数，语音会很平。

---

## 七、迁移纪律（下一批执行时照做）

- **本批只出这份文档**，不改 `visitor.prompts.ts` —— 那是**在线对练的生产 prompt**，
  改了所有真实会话的 AI 来访者语气都会变，必须单独灰度；
- 灰度顺序建议：先在**离线批量对练**上跑一批（用 P1e 已落库的 `visitor_semantic_level`
  对比降级率与 `[pause]` 命中率），确认无损再切在线；
- 切换时**两套标记不能混用** —— 混用时 parser 会把厂商标记转成语义标记再转回去，
  语义上没错，但会让"标记来源"不可观测（`semanticJson` 里看不出是模型直接写的还是转换来的）。
