# 文字层真人度（不流利表达）体系化方案

> 状态：📋 待评审（第二轮复核已修订）
> 日期：2026-11-11
> 复核修订：2026-11-11 —— 修正 5.2.3 分析器落点（服务层执行、数值投影）、5.4 角色配置走 verbalVoice 侧通道、5.5.1 指纹口径（prompt 自动 / 配置显式加段），新增附录 C 文献依据与第 10 章跨话轮打断目标态预留（本期不实现）
> 适用范围：auto-practice 文字链路（前端页面轮次文字），**不含 TTS 层**
> 红线声明：本方案默认 **engine-core 零改动**；所有新逻辑落在 engine-adapters / auto-practice / scripts
> 关联议题：P1d 已知问题 I-17（L1 主导 47.2%、L4 讨好 0%）、I-18（neutral 吞冷漠）；与 P1e-3 语义标记迁移边界互斥不混用

---

## 1. 问题定义

### 1.1 现象

auto-practice 前端页面轮次中，AI 来访者的文字回复句间零卡顿、句内零修正，每轮都是结构完整、措辞均匀的句子，读感接近"打好草稿再念"，与真实会谈中来访者边想边说的状态存在可感知差距。

### 1.2 根因（已逐文件核实，非推测）

| 编号 | 根因                                                                                                       | 证据锚点                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| R1   | 不流利类型缺失：现有 prompt 只覆盖"省略号 + 嗯/短回应 + 叹气"，缺句中填充词、自我修正、重复、半截话、拖音  | `turn-render-orchestrator.ts:1507-1511, 1664`                                                 |
| R2   | 指令为许可式（"可以停顿""偶尔犹豫"），无频率配额，模型对"可以"默认忽略                                     | `turn-render-orchestrator.ts:1664`；同文件 VARIATION 从许可式改禁令式的成功先例（:1644-1652） |
| R3   | 无文字层不流利度量：语义解析器只统计结构化 tag，auto-practice 输出不带 tag，犹豫量无法进入任何指标与快照   | `semantic-tag-parser.ts` stats 口径；`metric-dictionary.ts` 无 text.* 段                      |
| R4   | 无角色差异与状态联动：WP41 四字段管叙事/语态不管磕巴；情绪与犹豫的联动只有一句"可能停顿"                   | `turn-render-orchestrator.ts:1592-1609, 1735-1751`                                            |
| R5   | 既有审计脚本已有 6 个填充词与 fillerPerTurn，但口径独立于批次快照，未形成"prompt → 输出 → 度量 → 校准"闭环 | `scripts/ops/quality/visitor-quality-audit.ts:134, 405-442`                                   |

### 1.3 关键约束

1. 不流利是**生成时自然产生**的文本，由 LLM 在配额约束下写出；禁止在适配层做随机插入（与 `turn-render-orchestrator.ts:1639-1642` 既有纪律一致：适配层随机 = 第二份真相且不可复现）。
2. 文字层不引入 `[pause:x]` 等结构化 tag；tag 通道只属于语音路径（P1e-3 边界）。
3. 度量全部基于纯文本可复算，不依赖 LLM 评审；输出只含 id、计数、比率，心理原文不进日志/报告/快照。
4. 零回归底线：所有新行为默认关闭（off/audit），缺省路径 prompt 与现状逐字一致。

---

## 2. 目标与非目标

### 2.1 目标（可验收）

1. 建立文字层不流利分类体系与纯函数分析器，指标可复算、可进批次快照、可跨版本回归。
2. 将 system prompt 的许可式提示升级为**配额式条件指令块**，不流利出现率落在标定区间内，且单轮不超过硬上限。
3. 不流利档位与内核状态（话量/情绪/阻抗/信任）及角色配置联动，角色之间存在可分辨的差异。
4. 提供 env 三态开关（off / audit / active）、灰度与一键回滚能力；配套 .env.example、配置指纹、单测全覆盖。
5. 离线 A/B 批次 + 人工读感复核形成准出证据，全部口径单一真相源。

### 2.2 非目标（本期明确不做）

1. 不改 TTS / 语音链路，不调试语义 tag 在线切换。
2. 不改 engine-core 任何文件（含 RenderSpec 契约、BehaviorStrategy 枚举、boundary.spec.ts）。
3. 不做 admin-dashboard 管理界面改造（新指标在批次快照与 CLI 报告可见；前端展示另立任务）。
4. 不做实时流式文本的不流利插入；不引入新的 LLM 调用（度量与 prompt 均不增加调用次数）。
5. 不清理任何既有技术债，不重构相邻文件。
6. 不做跨话轮打断（双向），目标态与预留边界见第 10 章，语音层接入时启动。

---

## 3. 设计原则

1. **度量先行**：先建指标、跑基线，再改 prompt；没有基线的"更像真人"不可证伪。
2. **单一真相源**：词表与口径在纯模块定义一次，prompt、审计脚本、批次快照、测试同源消费。
3. **区间而非越多越好**：不流利是双向风险（0 = 草稿感，过量 = 刻意磕巴/低智感），所有配额给 min/max 区间与单轮上限。
4. **条件渲染 + 零回归**：新 prompt 块按开关与档位注入，off/audit 时 system prompt 逐字不变。
5. **配置化、可回滚**：模式、配额、角色参数全部走注入配置与 env，不硬编码进适配器。
6. **隐私默认**：任何产物只出码与计数；唯一含原文的环节是现场逐字稿本身，不复制、不导出。

---

## 4. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ 内核（只读，零改动）：BDI 决策 / 情绪 / 阻抗 / 信任 / 策略     │
└──────────────────────────┬──────────────────────────────────┘
                           │ RenderSpec（既有契约）
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 适配层（engine-adapters/rendering）                          │
│  · disfluency-profile.ts：档位解析（状态+角色配置→档位）      │
│  · disfluency-instruction.ts：配额式 prompt 指令块（条件渲染）│
│  · turn-render-orchestrator：buildVisitorSystemPrompt 注入点 │
│  · render-adapter.config：模式/配额配置面（env 归一）         │
└──────────────────────────┬──────────────────────────────────┘
                           │ LLM 自然输出（含不流利文本）
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 度量层（auto-practice/metrics + scripts）                    │
│  · disfluency-analyzer.ts：纯文本分析纯函数 + 词表           │
│  · metric-dictionary：text.* 新指标（dict-v2）               │
│  · batch-metrics：快照接入；visitor-quality-audit：审计扩展  │
│  · 人工读感复核清单（只含 id/维度）                          │
└─────────────────────────────────────────────────────────────┘
```

闭环方向：配额指令 → 生成输出 → 纯函数度量 → 基线/区间对比 → 校准配额种子值。

---

## 5. 详细设计

### 5.1 不流利分类体系（Disfluency Taxonomy）

六类，每类给出口径、识别模式与示例。识别在纯函数分析器内实现，只计数不输出原文。

| 类型       | id 后缀      | 口径                                                  | 识别模式（实现要点）                                                                      | 示例（仅文档用，不进任何日志）         |
| ---------- | ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| 填充词     | `filler`     | 句中/句首的犹豫性填充，不含正常句法连接用法           | 词表命中且位于句首、或被逗号/省略号包夹；"然后/其实/就是"在句中主谓之间才算，正常承接不计 | "嗯……我那个，就是有点不知道怎么说"     |
| 停顿省略号 | `pause`      | 以省略号表示的句中/句末停顿                           | 统计 `……`、`…`、`。。。` 归一后的停顿点数；连续标点合并为一次                             | "我本来以为没事的……结果还是没忍住"     |
| 词语重复   | `repetition` | 相邻单字/双字非修辞性重复                             | 正则检测连续重复的 1-2 字词，排除叠词词表（妈妈、慢慢、一点点等）                         | "我我觉得这次可能真的有点问题"         |
| 自我修正   | `repair`     | 推翻或改口自己刚说的内容                              | 修正触发词 + 前后片段：不对/等等/不是/应该是/换个说法/算了                                | "我们关系还行，不对，应该说是表面还行" |
| 半截话     | `trailoff`   | 句子未完成即终止（句末省略号且无后续标点/无谓语收口） | 句末停顿 + 长度/结构启发式判定；与句末 pause 互斥归类                                     | "我其实想过要不要干脆就……"             |
| 拖音       | `elongation` | 单字拖长（中文罕用，保守识别）                        | 仅识别显式重复韵母字（如"嗯——""哎——"），破折号归一；默认关闭统计，留扩展位                | "嗯——，怎么说呢"                       |

口径纪律：

1. 一个文本位置只归一类，按 repair > trailoff > repetition > pause > filler > elongation 的优先级消歧。
2. 叠词白名单（妈妈、爸爸、慢慢、一点点、看看、想想等）在分析器内常量维护，不计 repetition。
3. "然后/其实/就是/那个"既是填充词也是正常词：只统计**句首**或**被标点隔离**的命中，句中正常承接不计入 filler，避免系统性高估。
4. 全部计数基于归一化文本（去空白、标点半角全角统一），与 `visitor-quality-audit.ts` 现有 normalize 口径对齐并复用，不另写一份。

### 5.2 度量层设计

#### 5.2.1 新增纯模块

`src/auto-practice/metrics/disfluency-analyzer.ts`（纯函数、零 IO、零框架依赖）：

```ts
export interface DisfluencyCounts {
  readonly filler: number;
  readonly pause: number;
  readonly repetition: number;
  readonly repair: number;
  readonly trailoff: number;
  readonly elongation: number;
}

export interface DisfluencyMetrics {
  readonly counts: DisfluencyCounts;
  /** 不流利事件总数（六类之和）。 */
  readonly events: number;
  /** 含至少一次不流利的轮次占比口径由聚合层计算，本层只给 per-turn 布尔。 */
  readonly hasEvent: boolean;
  /** 文本归一化字符数（密度分母，不暴露原文）。 */
  readonly normalizedLength: number;
}

export function analyzeDisfluency(text: string): DisfluencyMetrics;
export function aggregateDisfluency(turns: readonly DisfluencyMetrics[]): {
  readonly eventsPerTurn: number;
  readonly eventTurnRate: number;
  readonly densityPer100Chars: number;
  readonly typeCounts: DisfluencyCounts;
};
```

词表与正则单独成 `disfluency-lexicon.ts`（纯常量），与 `scripts/ops/quality/visitor-quality-lexicon.ts` 同范式；审计脚本改为从本模块 import，**废弃脚本内私有 FILLERS 的独立口径**（迁移时保留旧字段输出一个版本周期，标注 deprecated，不删历史快照字段）。

#### 5.2.2 指标字典扩展（dict-v2）

`metric-dictionary.ts` 新增 text.* 段（id 只增不改，版本手动递增 `dict-v1 → dict-v2`）：

| 指标 id                               | 单位     | 方向    | nullable | 口径定义                                                         |
| ------------------------------------- | -------- | ------- | -------- | ---------------------------------------------------------------- |
| `text.disfluency.events_per_turn`     | per_turn | neutral | false    | 六类不流利事件总数 ÷ 纳入轮数                                    |
| `text.disfluency.event_turn_rate`     | ratio    | neutral | false    | 含不流利事件的轮次 ÷ 纳入轮数                                    |
| `text.disfluency.density_per100`      | count    | neutral | false    | 事件总数 ÷ 归一化总字符数 × 100                                  |
| `text.disfluency.filler_per_turn`     | per_turn | neutral | false    | 填充词命中 ÷ 纳入轮数（与旧 fillerPerTurn 同口径，新 id 取代之） |
| `text.disfluency.pause_per_turn`      | per_turn | neutral | false    | 停顿事件 ÷ 纳入轮数                                              |
| `text.disfluency.repair_per_turn`     | per_turn | neutral | false    | 自我修正 ÷ 纳入轮数                                              |
| `text.disfluency.repetition_per_turn` | per_turn | neutral | false    | 词语重复 ÷ 纳入轮数                                              |
| `text.disfluency.trailoff_per_turn`   | per_turn | neutral | false    | 半截话 ÷ 纳入轮数                                                |

全部 bounds 给定量域（per_turn/ratio 为 [0,1] 语义，density 按历史观测给保守上界，首版 bounds 设 null 并在 definition 写清，待基线后补）。字典守卫：`NON_NULLABLE_IDS` 自动纳入新键，计算层缺赋值即测试失败。

#### 5.2.3 快照接入：分析器在服务层执行，纯计算层只聚合数字（隐私边界，复核修订）

**设计冲突与修正**：`batch-metrics.compute.ts` 是零 IO 纯函数层，其输入 `TraceInput` 经服务层"合规投影"，文件头注释明确投影物理上不含 messages / renderSpec / intention.rationale。若在 compute 层调用 `analyzeDisfluency`，等于让纯层接触原文，破坏既有隐私分层。正确落点如下：

1. **分析在服务层（IO 层）执行**：`batch-metrics.service.ts` 是唯一读取逐字稿文件的层（`buildBatchSnapshot` 内 `readFileSync`）。在 `projectTraces` 同一步骤中：
   - 从逐字稿顶层 `messages`（形状 `{ role: 'counselor' | 'visitor'; text; turnIndex; ts }`，见 `debug-session-store.ts:63-72`）取 `role='visitor'` 条目，按 `turnIndex` 与各 trace 对齐；
   - 对来访者 `text` 调用纯函数 `analyzeDisfluency`，拿到数值结果后，原始 `text` 不进任何下游结构，随解析对象释放。
2. **投影只扩展数值字段，不扩展文本**：`TraceInput`（compute 层类型，`batch-metrics.compute.ts:22-37`）新增一个**纯数值** `disfluency` 字段，形状为六类计数 + events + hasEvent + normalizedLength（即 `DisfluencyMetrics` 去掉一切文本引用）；`projectTrace` 把服务层算出的数字填入。投影后全链路无任何对话原文。
3. **纯计算层只做数值聚合**：`computeBatchSnapshot` 及各 `compute*` 函数读取 `TraceInput.disfluency` 的数字，聚合出 8 个 text.* 指标写入 metrics map；纯层仍零 IO、零原文、同输入逐字节相同。schema 仍为 v1（metrics 键由字典驱动，加键不破坏契约，**不升 schemaVersion**），byMode/byCharacter 切片同步带上。
4. 审计脚本：`scripts/ops/quality/visitor-quality-audit.ts` D4 段改为消费新模块，新增 D7 段输出六类不流利分布与区间对照；保留 `--dir` 离线目录用法，输出仍无原文。
5. 基线产物：`data/quality/disfluency-baseline-<batchId>.json`（只含数字与批次 id），作为后续 active 模式的对照锚点。

边界自检：`grep` 确认 `analyzeDisfluency` 的 import 与调用只出现在 `batch-metrics.service.ts`（及脚本/测试），`batch-metrics.compute.ts` 内不出现任何文本形参或 analyzer import。

#### 5.2.4 验收判据扩展

不改动 `intake-v1` 既有八条判据。新增 `humanization-v1` 判据版本（同文件追加，版本常量独立），active 批次才参与判定，首版判据为区间型：

- `text.disfluency.event_turn_rate` 落在 [0.20, 0.55]（工程种子区间，基线后校准）。
- `text.disfluency.events_per_turn` ≤ 0.8（单轮硬上限的聚合兜底）。
- `text.disfluency.repair_per_turn` ≤ 0.25（修正最易显假，单独压上限）。

### 5.3 Prompt 层设计（配额式条件指令块）

#### 5.3.1 档位解析

新增 `src/engine-adapters/rendering/disfluency-profile.ts`（纯函数，零内核依赖）：

```ts
type DisfluencyLevel = 'none' | 'light' | 'natural' | 'heavy';

function resolveDisfluencyLevel(spec: AdaptiveRenderSpec, config: DisfluencyConfig): DisfluencyLevel;
```

解析规则（工程种子值，全部可被 config 覆盖；与既有阈值范式一致并标注待标定）：

| 档位    | 判定条件（自上而下，先命中先得）                                                   |
| ------- | ---------------------------------------------------------------------------------- |
| none    | 角色配置显式关闭；或 config 模式 ≠ active                                          |
| heavy   | 话量 = short 且（策略 = resistance 或情绪 high 唤醒：anxious/angry arousal > 0.6） |
| natural | 默认档（medium 话量、非中性情绪、或信任 < 0.55）                                   |
| light   | 话量 = long 且信任 ≥ 0.6 且情绪中性（放松、表达流畅，仅偶发犹豫）                  |

角色配置缺省（undefined）时不参与判定，与 WP41 零回归同范式。

#### 5.3.2 指令块文案（一次成型，直接进模板）

`disfluency-instruction.ts` 常量，穷尽 Record（新增档位 TS 编译报错，与 STRATEGY_LABEL 同纪律）：

```
const DISFLUENCY_INSTRUCTION: Readonly<Record<DisfluencyLevel, string>> = {
  none: '',
  light:
    '你这轮状态放松、说话比较顺：大约每三四轮里有一轮带一处轻微犹豫就够，' +
    '比如句首一个「嗯」，或中间停一下（用……表示），不要多。',
  natural:
    '你这轮边想边说，自然地带出真人说话的卡顿：每两三轮里有一到两轮带一处犹豫，' +
    '可以用「嗯」「呃」「那个」「就是」这类填充词，可以在句中停顿（用……表示），' +
    '偶尔话没说完就收住。一轮最多一处，不要每句都加。',
  heavy:
    '你这轮防御或情绪上来了，说话更卡：可以犹豫、可以重复一两个字（比如「我我觉得」）、' +
    '可以改口（「不对，应该是……」），也可以话说一半停住。' +
    '但一轮最多两处，改口不能连着来；卡顿是因为你在想、在躲，不是装结巴。',
};
```

配套硬纪律块（active 模式恒定追加，所有档位共用）：

```
const DISFLUENCY_DISCIPLINE =
  '犹豫表达的纪律：① 不改变你本来要表达的意思，只影响说话的节奏；② 不写括号、不写旁白、不解释你为什么停顿；' +
  '③ 不要每句都带填充词，不要连续两轮都改口；④ 拿不准要不要加，就不加。';
```

正反例（写进 prompt 参考，仅 active 模式注入）：

- 正例：`嗯……我其实没想过他会这么说。` / `我们没吵架，不对，应该说是吵了但没讲开。` / `我本来想解释的，后来……算了。`
- 反例：`嗯，那个，就是，我觉得吧，其实吧……`（填充词堆叠）/ `我我我真的真的不知道`（重复过量）/ `（停顿）我没事`（括号旁白）。

#### 5.3.3 注入点

`buildVisitorSystemPrompt` 内、`NON_VERBAL_INSTRUCTION` 之后追加条件块：

1. active 模式且档位 ≠ none：插入 `DISFLUENCY_INSTRUCTION[level]` + `DISFLUENCY_DISCIPLINE` + 正反例块。
2. off/audit 模式或 none：整块不渲染，system prompt 与现状逐字一致（用快照测试锁定逐字 diff）。
3. 既有 `NON_VERBAL_INSTRUCTION` 保留不删（它还承载"禁止括号动作"的约束）；新块文案避免与话量/情绪块冲突，只讲节奏手段与配额，不重复话量指令。

### 5.4 角色配置层（零内核改动路径）

#### 5.4.1 数据落点

`src/engine-adapters/wiring/character/character-profile.entity.ts`（适配层实体，非内核）新增可空列：

- `disfluency_level` VARCHAR(16) NULL：角色基线档位倾向（none/light/natural/heavy，NULL = 不表态，走状态解析）。
- `disfluency_density` FLOAT NULL：角色密度倾向 [0,1]，作为档位解析的修正量（与 WP41 speechVolumeShift 同公式范式，权重 0.5），NULL = 修正量 0。

DDL 手写 migration（counselor/character 系一律手写，`migration:generate` 扫不到），在 `bin/ormconfig.ts` import + migrations[] 登记；列可空、无默认值，旧行零影响。单精度 FLOAT 的比较口径遵循既有 FLOAT 处理纪律（避免裸 !== 幂等失效）。

#### 5.4.2 装配链路：走 verbalVoice 式渲染侧通道，不进内核 profile（复核修订）

**通道事实**：`toCharacterSeed()`（`db-character-profile.resolver.ts:72-112`）的产物经 `buildCharacterProfile` 喂的是**内核** `CharacterProfile`；而 `verbalVoice` 不进 `toCharacterSeed`，是在 resolver 返回值 `ResolvedCharacter` 上**单独条件携带**的渲染侧增强（`db-character-profile.resolver.ts:158`；端口类型 `character-profile.resolver.ts:67-81`）。新增不流利配置沿用同一条侧通道，全程不进内核 profile：

1. **端口类型**：`ResolvedCharacter`（`character-profile.resolver.ts:67-81`）仿照 `verbalVoice?` 增加可选字段（如 `disfluencyLevel?: string`、`disfluencyDensity?: number`）；`db-character-profile.resolver.ts` 在 :152-159 的返回处条件展开新列（NULL 即不带键），**不写入 `toCharacterSeed`**。
2. **透传链（与 verbalVoice 逐段同构，已核实）**：
   - `engine-stream-backend.adapter.ts:441`：从 `character` 读新字段，条件放入 options；
   - `engine-turn.service.ts:148-190`：`TurnSessionContext` 增加同名字段，条件携带（undefined 不带键）；
   - `turn-render-orchestrator.ts:1015`：context 条件展开进渲染规格；
   - `spec-assembler.ts:108,163`：`AdaptiveRenderSpec`（适配层类型，非内核 RenderSpec）增加可选字段，条件渲染，缺省与旧规格逐字一致。
   - 调试路径 `debug-session.service.ts:474,705` 有 verbalVoice 的平行透传，新字段同步补两处，避免调试/正式路径口径分叉。
3. **档位解析消费**：`disfluency-profile.ts` 的 `resolveDisfluencyLevel` 从 `AdaptiveRenderSpec` 读这两个字段；`disfluency_density` 作为档位修正量（与 speechVolumeShift 同公式范式，权重 0.5），NULL/undefined = 修正量 0。
4. 种子：`builtin-character-registry.ts` / `character-profile.seed.ts` 首版**全部不写值**（NULL），保证零行为变化；数值标定待基线批次后另起校准任务，不在本方案内拍数。
5. `seed-verbal-voice.ts` 同目录已有角色自由文本种子脚本范式，密度校准脚本照此另建，不混入本批。

### 5.5 开关、配置与灰度

#### 5.5.1 配置面

`render-adapter.config.ts` 同层新增（不进 RenderAdapterConfig 既有结构，独立 `DisfluencyConfig`，构造注入）：

```ts
export interface DisfluencyConfig {
  /** off=完全不注入；audit=不注入但全量度量；active=注入配额块并度量。 */
  readonly mode: 'off' | 'audit' | 'active';
  /** 配额覆盖（undefined 走指令块种子文案）。 */
  readonly minEventTurnRate?: number;
  readonly maxEventTurnRate?: number;
  readonly maxEventsPerTurn: number;
}
```

env 键（装配层读取，适配层不直接读 env，沿用 WP8 纪律）：

| env 键                                  | 默认    | 说明                                                       |
| --------------------------------------- | ------- | ---------------------------------------------------------- |
| `RENDER_DISFLUENCY_MODE`                | `audit` | 上线首版默认 audit：只观测不改变输出，基线可算、零行为风险 |
| `RENDER_DISFLUENCY_MAX_EVENTS_PER_TURN` | `2`     | 单轮硬上限，prompt 纪律与输出侧校验共用                    |
| `RENDER_DISFLUENCY_RATE_MIN`            | 空      | 准出后按基线填区间，缺省走种子                             |
| `RENDER_DISFLUENCY_RATE_MAX`            | 空      | 同上                                                       |

强制配套：四键登记 `.env.example`（否则 `wp25-env-example-coverage.spec.ts` 失败）。配置指纹口径（复核修正，非"自动纳入"）：

- **prompt 侧自动覆盖**：配额指令块加在 `turn-render-orchestrator.ts`，该文件已在 `PROMPT_TEMPLATE_FILES`（`prompt-fingerprint.ts:83-90`）中，指令块一旦改动，`prompt_version` 必然变化，无需额外登记。
- **配置文件需显式新增指纹段**：`config-fingerprint.ts` 的 7 个段是固定枚举（`ConfigSegment` + `SEGMENT_FILES` + `CONFIG_SEGMENT_ORDER`），新增的 DisfluencyConfig 所在文件不会被自动哈希。需显式加一个 `disfluency` 段（扩展类型联合、文件清单、顺序数组与 `ConfigFingerprintSegments` 接口，均在 auto-practice 层，允许），模式切换跨批次即据此判 incomparable；禁止假设其自动纳入。

#### 5.5.2 输出侧校验（不新增 LLM 调用）

`createVisitorOutputGuard` 链路追加轻量检查：单轮不流利事件超过 `maxEventsPerTurn` 时，按既有 block/regenerate 口径处理（预算内重生成一次，同候选降温）；不做文本删改（删改会产生不可复现的第二份文本）。超限计数进 trace，只出码不出文。

#### 5.5.3 灰度顺序

1. 合并 P0 后 env 保持 audit，跑 ≥2 个离线批次（含既有 8 角色），产出基线。
2. 基线评审通过后单批次切 active（先覆盖 2-3 个角色），A/B 对照同批次 audit 组。
3. 人工读感复核通过、`humanization-v1` 判据全绿，逐批扩量；全量 active 后 audit 口径保留一个版本周期用于回归。

### 5.6 人工读感复核流程

1. 审计脚本 `--anchor` 模式扩展：按 active/audit 成对抽样，导出 CSV（debug_session_id、character_slug、level、六类计数、event_turn_rate），**不含原文**；复核人按 id 到逐字稿现场调阅。
2. 复核维度（三维度，1-5 分）：自然度（像不像边想边说）、可懂度（有没有因卡顿影响理解）、角色一致性（磕巴方式是否符合该角色状态）。
3. 准出：每批 ≥30 轮样本，自然度均值 ≥4、可懂度均值 ≥4.5、无单项 ≤3；复核记录落 `data/quality/`（只含分数与 id）。

---

## 6. 实施计划（四阶段，每阶段独立可验收）

### P0 · 度量层（零行为变化）

改动文件（新增为主）：

- 新增 `src/auto-practice/metrics/disfluency-analyzer.ts`、`disfluency-lexicon.ts`
- 新增 `test/auto-practice/metrics/disfluency-analyzer.spec.ts`（六类识别、消歧优先级、叠词白名单、连接词排除、聚合口径）
- `metric-dictionary.ts` 升 dict-v2 加 8 个 text.* 指标；补字典完整性测试
- `batch-metrics.service.ts` 投影接线（messages 对齐 + 调分析器 + 数值投影），`batch-metrics.compute.ts` 扩 `TraceInput.disfluency` 数值字段与聚合；快照 schema 测试补新键断言

闸门：`pnpm exec tsc -p tsconfig.build.json --noEmit` 0 错；`pnpm lint` 0 error；`pnpm exec vitest run test/auto-practice` 全绿。

### P1 · 审计基线（仍零行为变化）

- `visitor-quality-audit.ts` 迁 lexicon 口径、加 D7 段；新增 D7 输出快照测试
- env 默认 audit，跑两个离线批次，产出基线文档与区间建议（种子值校准建议，不直接改判据）

闸门：定向 vitest + 审计脚本实跑（exit 0、输出无原文，人工核对输出结构）。

### P2 · Prompt 与开关（active 能力就位，默认不启用）

- 新增 `disfluency-profile.ts`、`disfluency-instruction.ts` 及单测（档位解析穷尽性、prompt 逐字快照：off/audit 与现状逐字一致）
- `render-adapter.config` / 装配层加 DisfluencyConfig 与 4 个 env 键；`.env.example`、env 覆盖度测试、output guard 超限重生成接线
- 零回归证据：off 模式下 system prompt 拼装快照测试与改造前逐字 diff 为空

闸门：tsc 0 错、lint 0 error、`pnpm exec vitest run test/engine-adapters test/auto-practice` 全绿。

### P3 · 角色配置与灰度准出

- character 实体两列 + 手写 migration + ormconfig 双登记；ResolvedCharacter 侧通道（resolver/stream-backend/turn-context/spec，含 debug 平行路径）透链接线与测试
- 灰度 A/B、人工读感复核、`humanization-v1` 判据实跑；回写工作记录与 backlog
- 收尾闸门：全量 `pnpm test` 一次（基线 181 文件 / 2947 例，0 failed）、`git diff --stat HEAD -- src/engine-core` 为空

## 7. 风险与缓解

| 风险                                    | 等级 | 缓解                                                                                                                |
| --------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| 不流利过量导致"装磕巴/低智感"           | 高   | 单轮硬上限 + 区间配额 + 纪律块 + 人工可懂度准出；audit 默认先行                                                     |
| 填充词系统性误统计（连接词正常用法）    | 中   | 位置约束（句首/标点隔离）+ 叠词白名单 + 基线对照，词表纯模块单一真相源                                              |
| prompt 块与话量/情绪指令冲突            | 中   | 新块只讲节奏手段不讲话量；逐字快照测试锁定；off 逐字一致                                                            |
| migration 漏登记静默不建列              | 中   | 手写 DDL + ormconfig 双登记，列为可空无默认，落库后用只读查询验证                                                   |
| 配置口径漂移（env/快照/脚本三处不一致） | 中   | prompt 改动由 prompt_version 自动捕获，新配置文件显式加 disfluency 指纹段；字典 dict-v2 单一 id；测试强制非空键覆盖 |
| 心理原文泄漏进新报告/日志               | 高   | 全部输出只含 id/计数；anchor CSV 无原文；评审与测试夹具不使用真实原文                                               |
| 与 MiniMax 在跑批次的改动冲突           | 中   | 本方案在 7 单收口后开工；文件级隔离，不共享改动文件，提交分组不混提                                                 |

## 8. 回滚方案

1. 一级回滚（无需发版）：`RENDER_DISFLUENCY_MODE=off`，prompt 块即时不注入，行为回到现状；配置指纹变化可被批次对比识别。
2. 二级回滚：代码层 revert P2/P3 提交；P0 度量层为纯新增只读能力，可保留不影响行为。
3. 数据层：新列可空、不被旧逻辑消费，不做列删除回滚；快照新键不影响旧 schema 解析，历史快照不回溯、不重算。

## 9. 验收标准（Definition of Done）

1. 六类不流利分析纯函数落地，单测覆盖正例/反例/消歧/白名单/边界（空文本、纯标点、超长句）。
2. dict-v2 字典 8 个新指标进批次快照，非空键无遗漏；审计脚本 D7 可离线复算且与快照数字一致（抽 1 批交叉核对）。
3. off/audit 模式 system prompt 与改造前逐字一致（快照测试证据）；active 模式档位解析与指令块注入有穷尽性测试。
4. 4 个 env 键登记 .env.example，env 覆盖度测试通过；output guard 超限重生成有测试。
5. 灰度 A/B 批次 `humanization-v1` 判据全绿，人工读感三维度达准出线，复核记录归档。
6. 全量 `pnpm test` 0 failed（数字实填）；`git diff --stat HEAD -- src/engine-core` 为空；boundary.spec.ts 未改动。
7. 工作记录、backlog、指标字典版本、判据版本全部回写；无心理原文进入任何新增产物。

---

## 10. 跨话轮打断（本期不实现，语音期目标态与预留）

> 定性：**本期明确不做、不写代码、不占指标 id**；但目标态与预留边界在此固化，保证语音层接入时不返工、不推翻本方案结构。决策依据：2026-11-11 讨论确认，打断在语音期必然需要。

### 10.1 概念口径（与六分类的层级区别）

- 打断是**跨话轮的双方结构**，不是第七类单句不流利。会话分析区分 overlap（交叠，TRP 附近、短暂、常为 TRP 误判）与 interruption（打断，非 TRP 位置、有意抢话轮、常伴话题改变）。
- 完整结构含三方：**被打断方的截断标记 + 打断方的进入标记 + 打断后处置（放弃 / 重说 / 续回）**。
- 功能二分（Murata 1994；Tannen 1984）：侵入性（抢话轮、异议、阻断）与合作性（赞同、补全、澄清、高卷入式共建）。

### 10.2 为什么本期做不了（已核实的技术事实）

1. 文字链路严格轮替：`ap_practice_turns` 一轮一访，LlmRenderAdapter 的 AbortController 仅用于超时自断，auto-practice 前端无停止生成入口。
2. 真 barge-in（AbortController 中断 fetch）只存在于 `src/voice/` 实时语音链路；TTS/语音层当前未调试，按强约束不混入本期。
3. 文字层只能做"表征式打断"（文本标记模拟），而模拟错位会比没有更假，故不提前实现。

### 10.3 目标态（语音层接入时）

- **真打断**：复用 voice 层已有的 AbortController barge-in 机制（`voice.service.ts:424,474,1759`），用户/来访者语音触发即中断在途请求。
- **文字表征约定**：被打断方以截断标记收尾（硬截断破折号 / 渐弱省略号），打断方带进入标记（"哎""等等""不是"或无标记硬入），处置态支持放弃、原句 recycle、续回（"我刚说到……"）。
- 两个方向：来访者打断咨询师（高唤醒溢出、防御反击、焦虑型依恋求关注、合作性赞同）；咨询师打断来访者（危机阻断、grounding，或作为学员技术错误被标注）。

### 10.4 本期预留边界（防返工的四条纪律）

1. **指标命名预留**：字典 id 只增不改，未来打断指标统一使用 `text.interruption.*` 命名空间（打断率、方向拆分、处置类型）；本期**不登记 id**，仅声明命名约定，避免占用与返工。
2. **分析器边界预留**：单话轮分析器（5.2）只处理单条文本，不扩六分类；未来跨话轮分析是**独立模块**，在服务层对齐相邻两个话轮（被截断轮 + 进入轮），同样只把数值投影进 TraceInput，纯计算层不碰原文——与 5.2.3 同一边界范式。
3. **配置通道预留**：未来打断配置作为 DisfluencyConfig 的**兄弟字段**，同走 ResolvedCharacter 渲染侧通道（5.4.2），不塞进不流利档位、不进 toCharacterSeed、不进内核 profile。
4. **护栏交互已核实登记**：安全输出 guard 不判句法完整性，截断结尾不被拦；`dropUnclosedTail` 仅在 `finish_reason=length` 时触发——正常截断存活，长度截断会丢未闭合尾（标记丢失的边界情况，语音期实现时处理）；流式路径经 `splitClosedPrefix` 缓冲未闭合尾，接线需一并考虑。

### 10.5 待验证缝（登记，不阻塞本期）

- counselor policy 能否产出带截断标记的话轮（表征式打断的前置），尚未验证；语音期开工前先核实，不凭假设接线。

### 10.6 启动条件

- 语音层（含 TTS/barge-in）正式调试时启动本章；与本方案 P0–P3 解耦，不改变本期四阶段交付与 DoD。

---

## 附录 A · 首版词表与模式（种子值，待基线校准）

- 填充词（位置敏感）：嗯、呃、那个、就是、怎么说、你让我想想、我想想、怎么讲
- 修正触发词：不对、等等、不是、应该是、换个说法、算了、其实也不是
- 停顿归一：`……`、`…`、`。。。`、`..` → 统一 pause 事件
- 叠词白名单（不计 repetition）：妈妈、爸爸、宝宝、慢慢、一点点、看看、想想、说说、聊聊、试试、好好、轻轻
- 拖音（默认保守）：`嗯——`、`哎——` 等破折号拖长，仅显式模式命中

## 附录 B · 指标口径速查（与 dict-v2 同源）

- events_per_turn = 六类事件总和 ÷ 纳入轮数
- event_turn_rate = hasEvent 轮数 ÷ 纳入轮数
- density_per100 = 事件总和 ÷ 归一化字符总和 × 100
- 各类型 per_turn = 该类型计数 ÷ 纳入轮数
- 消歧优先级：repair > trailoff > repetition > pause > filler > elongation

---

## 附录 C · 专业文献依据（2026-11-11 检索，附证据分级与设计点映射）

证据分级口径：**一级** = 经长期引用的奠基性心理语言学/会话分析研究；**二级** = 对话系统/合成语音/LLM 工程实证，与本方案直接同构；**三级** = 文本人类性、AI 检测与中文本土研究，部分为间接证据。工业博客/厂商白皮书不纳入。

### C.1 一级证据：不流利的经典理论与分类

1. **Clark, H. H., & Fox Tree, J. E. (2002). Using uh and um in spontaneous speaking. _Cognition_, 84(1), 73–111.**
   uh/um 是按常规词规划产出的"延迟信号"：uh 预期短延迟、um 预期长延迟，并承担找词、维持/让出话轮等功能。支撑填充词分类与"功能差异、位置敏感"口径。
   http://columbia.edu/~rmk7/HC/HC_Readings/Clark_Fox.pdf
2. **Shriberg, E. (1994). Preliminaries to a theory of speech disfluencies. PhD thesis, UC Berkeley.**
   不流利分类学（填充停顿、重复、替换、插入、删除、自我修正等）与"待修正段—编辑段—修正段"三段结构。支撑本方案六分类与 repair 定义。
   （转引见 https://clp.ling.uni-potsdam.de/publications/Ginzburg-2014-1.pdf ；Switchboard 标注手册 https://groups.inf.ed.ac.uk/switchboard/disfluencies.pdf ）
3. **Levelt, W. J. M. (1983). Monitoring and self-repair in speech. _Cognition_, 14(1), 41–104；Levelt (1989). Speaking: From intention to articulation. MIT Press.**
   感知环路理论：说话人监控自身言语计划、发现问题即中断并修正。支撑自我修正的生成机制与"边想边说"语义。
4. **Schegloff, E. A., Jefferson, G., & Sacks, H. (1977). The preference for self-correction in the organization of repair in conversation. _Language_, 53(2), 361–382.**
   会话修正结构中自我修正优先于他人修正。支撑 self-repair 作为自然会话的主导性、常态化结构。
   https://icar.cnrs.fr/ecole_thematique/tranal_i/documents/org_seq/scheSacksJeff77_repair.pdf
5. **Corley, M., & Stewart, O. W. (2008). Hesitation disfluencies in spontaneous speech: The meaning of um. _Language and Linguistics Compass_, 2(4), 589–602.**
   犹豫承载人际信息（维持话轮等），um 后跟随更长延迟。支撑填充词的功能区分。
   https://www.pure.ed.ac.uk/ws/files/15012157/Corley_Stewart_2008.pdf
6. **Bortfeld, H., Leon, S. D., Bloom, J. E., Schober, M. F., & Brennan, S. E. (2001). Disfluency in native and nonnative speakers. _Journal of Psycholinguistic Research_, 30, 109–130.**
   不流利率随说话人状态与语境显著变化。支撑角色/状态差异化设计。

### C.2 二级证据：对话系统与 LLM 工程实证

7. **Wester, M., Aylett, M. P., Tomalin, M., & Dall, R. (2015). Artificial personality and disfluency. Interspeech 2015.**
   在合成语音中插入填充词与话语标记可塑造可分辨的不同"人工人格"。支撑角色级不流利配置。
   https://www.cstr.inf.ed.ac.uk/downloads/publications/2015/wester:artificial:IS2015.pdf
8. **Enhancing Naturalness in LLM-Generated Utterances through Disfluency Insertion (2024). arXiv:2412.12710.**
   LoRA 微调让 LLM 产出多类不流利；用户研究显示感知自发性显著提升，但伴随可懂度轻微下降。直接支撑"区间而非越多越好"与可懂度准出线。
   https://arxiv.org/pdf/2412.12710v1.pdf
9. **Towards Improving the Naturalness of Social Conversations with Dialogue Systems（Talkie 系统研究）.**
   加入不流利等内容无关增强后，听者感知自然度提升、人机归属判断更难。支撑"不流利→人类感"的因果链。
10. **Origlia, A., et al. (2023). Effects of disfluency patterns in neural speech synthesis. _Speech Communication_.**
    由语言学模型定位的不流利被评为更自然，且利于听者信息回忆。支撑"模型化定位优于随机插入"。
    https://iris.unina.it/retrieve/bafb86ea-1cbd-448b-8b20-4ee8228fc919/1-s2.0-S0885230823001043-main.pdf
11. **A Linguistically-Inspired Approach for the Evaluation of Spoken Language Features in Conversational Models (2025). TALN/RECITAL.**
    以反馈、重复、犹豫三类语言学指标，将模型输出与人类会话做统计对比。支撑度量层设计与基线对比方法。
    https://aclanthology.org/anthology-files/pdf/jeptalnrecital/2025.jeptalnrecital-evalllm.21.pdf
12. **Passali, et al. (2022) LARD；DRIVE (2025), arXiv:2507.19867；LLM-Dys (2025), arXiv:2505.22029.**
    合成不流利的三类操作（重复、替换、重启）与 11 类不流利检测语料。供分类口径与检测方法参照；其 post-hoc 随机插入路线本方案不采用（见 1.3 纪律）。
    https://arxiv.org/html/2507.19867 ；https://arxiv.org/html/2505.22029v1
13. **BeDLM: Behaviorally Aware Spoken Dialogue Generation with LLMs (2025, Seoul National University).**
    行为感知的口语对话生成，佐证"行为/状态驱动表达"的方向。

### C.3 三级证据：文本人类性与中文本土研究

14. **Distinguishing AI-Generated and Human-Written Text Through Psycholinguistic Analysis (2025). arXiv:2505.01800.**
    迭代修正、自我监控等元认知痕迹是人类文本的区分性特征，现模型靠统计模拟而非真监控。支撑"修正/不流利提升文字人类性"。
    https://arxiv.org/pdf/2505.01800.pdf
15. **Comparing the Humanness of Machine-Generated and Human-Authored Text (2026). ACM Computing Surveys.**
    人类性评测综述，指出场景覆盖与度量口径仍是研究缺口。支撑本方案"度量先行、场景化标定"。
    https://dlnext.acm.org/doi/10.1145/3806206
16. **中文本土研究**：
    - 《汉语学习者口语流利度研究》（2023，中国社会科学文库）：非流利停顿分类与频次。
    - 汉语填充标记研究：统计"这个/那个、然后、就是、嗯/呃"四类填充标记，存在不对称分布。直接支撑中文填充词表与位置敏感口径。
      https://m.book118.com/try_down/215031140104011241.pdf
    - 刘楚群：老年人口语"呃"类填塞语研究（填塞语与冗余重复的类型化）。
      https://www.linglab.cn/news/2209 ；非流利六类型报道 https://news.gmw.cn/2021-03/21/content_34702494.htm
    - 《汉语二语课堂会话修正策略探究》，华东师范大学学报：填充词用于启动修正、争取思考时间。
      https://xbzs.ecnu.edu.cn/CN/html/201601012.htm

### C.4 可引用的量化锚点（仅作区间合理性旁证，不直接照搬）

- 自然口语不流利总体发生率约 **6–10 次/100 词**（基于 Switchboard 等语料的综述口径）。
  https://scispace.com/pdf/phonetic-evidence-for-two-types-of-disfluency-14qcqtzezk.pdf
- 约 **30% 的轮次含填充词**（7161 轮中 2161 轮），单轮最多 5 个，分布零界、强右偏。
  https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0252602
- 法语自发口语约 **10.86 次/100 音节**；每个 AS-unit 平均 1.47 个填充停顿、1.28 个静默停顿。
  https://www.isca-archive.org/diss_2025/arida25_diss.pdf

**适用边界（诚实标注）**：以上数字来自英语/法语等语种、电话或叙事场景；中文心理咨询场景在语言结构、情绪防御与话轮长度上均不同，**不可直接套用**，仅用于判断本方案工程种子区间的数量级是否合理，最终阈值以本仓 P1 基线（数据落 `data/quality/`）为准。

### C.5 设计点 ↔ 文献映射

| 方案设计点                       | 支撑文献（编号） | 证据等级                   |
| -------------------------------- | ---------------- | -------------------------- |
| 六分类体系                       | 2, 12, 16        | 高                         |
| 填充词功能差异与位置敏感         | 1, 5, 16         | 高                         |
| 自我修正机制与自然优先性         | 3, 4             | 高                         |
| 配额式区间、非越多越好           | 8, 10, C.4       | 中高                       |
| 角色/状态差异化配置              | 6, 7, 13         | 中高                       |
| 纯函数度量 + 基线对比            | 9, 11, 15        | 中                         |
| 文字人类性 / 去 AI 味            | 14, 15           | 中                         |
| 中文词表（这个/那个/就是/嗯/呃） | 16               | 中（本土直接，场景待校准） |
