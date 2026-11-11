# P1e-3 · visitor prompt 语义标记迁移（厂商标记 → 语义标记）— 交付记录

> 日期：2026-11-11
> 执行方：MiniMax Code（后端仓库 `mofang-nestjs`，分支 `integrate`）
> 任务单：`docs/worklog/completed/phase2.5/phase2.5-p1e-phase3-visitor-semantic-tag-migration-2026-11-11.md`
> 事实源：`docs/worklog/pending/phase2.5-visitor-semantic-tag-migration-snippet.md`

---

## 一、一句话总结

visitor prompt 的厂商标记段已按 snippet 逐字迁移成语义标记（`DIFFICULTY_TAG_FREQ` 三档），并补入停顿 `[pause:x]` 与情绪 `[emotion:x]` 两段纪律；离线灰度在 **76 份真实离线逐字稿（802 来访者轮）** 上跑出三形态对比 —— **新形态解析零降级、停顿/情绪 100% 可承载**，而旧形态模板 **100% 降级**（其中 28.4% 直接 Level 2 语义作废）；真实 LLM 批次因本地 MySQL / Redis 未启动跑不了，已写清阻塞原因与用户执行步骤，**在线切换留待用户复核指标后拍板**。

---

## 二、实际改动 vs snippet 方案（偏差逐条说明）

### 偏差 1：离线对比没有走 `POST /admin/api/auto-practice/batch`，改走「既有离线批次产物 + 无 DB 依赖的解析层脚本」

任务单 §2.4 要求「若仓库已有离线批次入口则复用，**不新造 LLM 调用链**」，§3 交付物 2 允许「若本环境跑不了 LLM 批次，写明阻塞原因与用户执行步骤」。

实测本环境 **MySQL(3306) 与 Redis(6379) 均未启动**（`Test-NetConnection` 两次均 False），离线批次入口 `POST /admin/api/auto-practice/batch` 需要完整服务栈，跑不起来。

替代方案（仍不新造 LLM 调用链）：**直接复用仓库既有的离线批次产物** —— `data/debug-sessions/*.json` 逐字稿（P1e Phase2 交付记录已确认「逐字稿不在 DB，在文件里」），共 **76 份 / 802 来访者轮**，其中 **19 份 / 208 轮**由 `data/debug-sessions/_batches/*.json` 批次索引登记为离线批次场次。

再叠一个**无 DB 依赖**的解析层对比脚本（新增，见 §三），复用**生产解析器** `parseSemanticTags` 跑三形态对比。

**口径边界（必须一起读）**：脚本比的是「同一批真实输出在两套模板下的解析结果」，能证明「新形态的解析链路无损」，**不能**替代「新 prompt 真跑一批 LLM」（新 prompt 会改变模型输出习惯，那一步必须真调 LLM）。§五 给了完整执行步骤。

### 偏差 2：「旧形态模板」按旧 prompt 教的**集合**轮换，不是固定单个标记

旧 prompt（迁移前 HEAD 版）教的是一个**集合**：L1 五词 `(sighs) (breath) (laughs) (sniffs) (humming)` / L2 三词 / L3 两词。固定只测 `(sighs)` 会**低估**旧形态的降级成本（它能转换，没有丢弃成本）。脚本按 7 词轮换，覆盖「能转换」与「语义层表达不了 → 丢弃」两条路径。

### 偏差 3：新形态模板的停顿放**句中**（按 snippet §三），不放句尾

句尾停顿会被解析层按 `PAUSE_TRAILING_DROPPED` 丢弃（后面没有可发音文本）——若模板把停顿放句尾，测出来的是「模板摆错位置」而非「新形态的解析表现」，必然假失败。脚本按「前半段最后一个句读，否则取中点」插入句中，802 轮**全部插入成功**。

### 偏差 4：脚本抽取只认**顶层 `messages`**，不做递归全扫

逐字稿 JSON 里 `kernelState.memories` 存着同一批消息的副本（`role` + `content` 形态）。递归扫会把每轮算两遍（首版脚本因此把 802 轮算成 1386 轮）。已改为只读顶层 `messages[]`。

### 偏差 5：本单自写用例的 3 处错误已修（记录在案，非既有问题）

1. **类型 import 路径错**：新 spec 原本 import `../../src/persona/domain/entities/persona.entity.js` —— 该目录不存在（真实路径是 `src/agent/persona/...`）。因为是 `import type`，编译期擦除，**vitest 不报错**；又因为 `tsconfig.build.json` 排除 `test/**`，**tsc 闸门也不报错** → 已改为真实路径，并额外用根 tsconfig 过滤确认该文件 0 错。
2. **`as unknown as Persona` / `as unknown as VisitorSessionMemory`** 被 `@typescript-eslint/no-unnecessary-type-assertion` 判红 → 改为**补全全部字段的完整对象字面量**，零断言。
3. **prettier 格式**（`VENDOR_MARKERS` 数组换行）→ 已按 prettier 形态重排。

---

## 三、改动文件清单（本单 3 个文件，互不外溢）

| 文件                                                              | 状态              | 改了什么                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/visitor/visitor.prompts.ts`                            | 修改（+54 / −13） | ① `DIFFICULTY_TAG_FREQ` 三档按 snippet §二**逐字替换**为语义标记（频率纪律与难度分层一字未动）；② 新增 `PAUSE_TAG_RULES`（snippet §三）与 `EMOTION_TAG_RULES`（snippet §四）两个常量；③ 渲染顺序 `tagFreq → pause → emotion → hard rules`（§7「位置与既有 tag 频率段同级」）；④ 文件头设计目标第 4 条与历史注释改写为「厂商标记 → 语义标记」的迁移依据，**源码注释里不再出现厂商标记字面量** |
| `test/agent/visitor-prompt-semantic-tags.spec.ts`                 | 新增（12 例）     | 断言对象是**渲染出的 prompt 字符串**（不是文件文本）：厂商标记零残留、厂商停顿格式零残留、三档只教语义标记、三档互斥、停顿/情绪段齐备与关键约束、段落优先级顺序、parser 白名单认领                                                                                                                                                                                                           |
| `scripts/ops/semantic-tag-migration/compare-parse-degradation.ts` | 新增              | 离线灰度对比脚本（三形态），复用生产 `parseSemanticTags`，**只出码与计数**                                                                                                                                                                                                                                                                                                                   |

**没动**（红线逐条守住）：`src/auto-practice/utils/semantic-tag-parser.ts`（解析器）、`src/auto-practice/adapters/minimax-tts-adapter.ts`（TTS 映射）、`src/auto-practice/semantic/semantic-turn.persister.ts`（落库口径）、`visitor_semantic_level` 落库口径、DB / migration、`src/engine-core/**`、前端、Flutter、`test/engine-core/boundary.spec.ts`（**未改**）。

---

## 四、闸门表（真实数字）

| 闸门                | 命令                                                                                                                                                                                                                                                                                                               | exit   | 结果                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 类型                | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                                                                                                                                                                    | **0**  | **0 error**（该口径**含 `scripts/`**，新脚本 0 错）                                                                                                                                                                                                          |
| Lint                | `pnpm lint`                                                                                                                                                                                                                                                                                                        | **0**  | **0 error / 2 warning** —— 两条都是既有债（`src/auto-practice/metrics/batch-metrics.service.ts:23` / `:25` import/order），与本单无关                                                                                                                        |
| 测试                | `pnpm test`                                                                                                                                                                                                                                                                                                        | **0**  | **185 文件**（184 passed + 1 skipped）/ **2991 例**（2987 passed + 4 skipped），**0 failed**，74.38s                                                                                                                                                         |
| 定向 visitor+parser | `pnpm exec vitest run test/agent/visitor-prompt-semantic-tags.spec.ts test/auto-practice/wp-j-p1e-semantic-tag-parser.spec.ts test/auto-practice/wp-j-p1e-semantic-turn-persister.spec.ts test/auto-practice/wp-j-p1e-semantic-wiring.spec.ts test/auto-practice/wp-j-p1e-streaming-semantic-preprocessor.spec.ts` | **0**  | **5 文件 / 118 例全绿**                                                                                                                                                                                                                                      |
| 定向 auto-practice  | `pnpm exec vitest run test/auto-practice`                                                                                                                                                                                                                                                                          | **0**  | **17 文件 / 239 例全绿**，8.41s                                                                                                                                                                                                                              |
| 日常内循环          | `pnpm test:related -- src/agent/visitor`                                                                                                                                                                                                                                                                           | **0**  | 输出 `No affected test files found, exiting with code 0` —— **不是失败**：`vitest related` 靠 git 跟踪文件反查关联用例，本单改动尚未 commit、新 spec 又是未跟踪文件 → 关联不到。定向命令已在上两行覆盖                                                       |
| engine-core         | `git diff --stat HEAD -- src/engine-core`                                                                                                                                                                                                                                                                          | —      | **本单 0 个 engine-core 文件**。工作树该 diff 非空（4 files / +139 / −10），**全部来自同批 I-12 与 I-20 两单**（`alliance-config.ts` / `engine-session.types.ts` / `in-memory-engine-session.ts` 属 I-12，`personality-modulator.ts` 属 I-20），与本单零重叠 |
| 厂商标记残留        | `grep -E "[(](sighs                                                                                                                                                                                                                                                                                                | laughs | chuckle                                                                                                                                                                                                                                                      | sniffs | humming | breath | emm)[)]" src/agent/visitor/visitor.prompts.ts`+`grep -E "<#[0-9.]+#>"` | —   | **0 命中 / 0 命中**（文件级）；**渲染结果**同样 0 命中（由新 spec 断言：`not.toContain(marker)` + `not.toMatch(/\([a-z][a-z-]+\)/)`） |
| 离线对比            | `pnpm exec tsx scripts/ops/semantic-tag-migration/compare-parse-degradation.ts --input data/debug-sessions`                                                                                                                                                                                                        | **0**  | 三形态数字见 §五                                                                                                                                                                                                                                             |

**用例数变化对账**：I-20 交付后基线为 184 文件 / 2979 例（2975 passed + 4 skipped）；本单新增 1 个 spec（12 例）→ 185 文件 / 2991 例（2987 passed + 4 skipped），**增量恰为 1 文件 12 例**，无既有用例被动。

---

## 五、离线对比指标（真实跑出来的数字）

### 5.1 语料

- 输入：`data/debug-sessions/`（gitignored 运行期目录，**真实离线对练逐字稿**）
- 86 个 JSON → 76 份逐字稿（其余 10 个是 `_batches/` 批次索引，本身不含逐字稿）
- **802 来访者轮**；其中 **19 份 / 208 轮**由批次索引 `_batches/*.json` 登记为离线批次场次
- 输出**只含码与计数**，心理对话原文不进输出（脚本不打印任何原文片段）

### 5.2 三形态对比结果

| 指标                 | 形态 A · 实测旧形态<br>（真实旧 prompt 输出，零加工） | 形态 B · 旧形态模板<br>（句首厂商标记）                                                      | 形态 C · 新形态模板<br>（句首语义标记 + 句中停顿 + 句末情绪） |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 轮数                 | 802                                                   | 802                                                                                          | 802                                                           |
| L0 干净              | 802 (100.0%)                                          | **0 (0.0%)**                                                                                 | 802 (100.0%)                                                  |
| L1 轻度              | 0                                                     | 574 (71.6%)                                                                                  | 0                                                             |
| L2 重度              | 0                                                     | 228 (28.4%)                                                                                  | 0                                                             |
| **降级率 (L1+L2)**   | **0.0%**                                              | **100.0%（802 轮）**                                                                         | **0.0%**                                                      |
| `[pause]` 命中       | 0 轮 (0.0%)                                           | 0 轮 (0.0%)                                                                                  | **802 轮 (100.0%)**                                           |
| 情绪标记命中         | 0 轮 (0.0%)                                           | 0 轮 (0.0%)                                                                                  | **802 轮 (100.0%)**                                           |
| 句首语气命中         | 0 轮 (0.0%)                                           | 573 轮 (71.4%)                                                                               | 802 轮 (100.0%)                                               |
| 厂商标记 转换 / 丢弃 | 0 / 0                                                 | **573 / 229**                                                                                | 0 / 0                                                         |
| 未知标记             | 0                                                     | 0                                                                                            | 0                                                             |
| 诊断码               | （无）                                                | `VENDOR_FORMAT_CONVERTED=573`<br>`VENDOR_MARKER_DROPPED=229`<br>`ILLEGAL_RATIO_EXCEEDED=228` | （无）                                                        |

### 5.3 三条判定

- **判定 1 · 解析链路无损** —— 旧形态模板降级轮 802 vs 新形态降级轮 0 → **PASS**。
- **判定 2 · 能力增量** —— 新形态 `[pause]` 命中率 100.0%、情绪命中率 100.0% → **PASS**（旧形态体系里根本没有这两种能力）。
- **判定 3 · 旧 prompt 实测产出率** —— 带标记轮 **0 / 802** → 旧 prompt 在这批真实语料里**零标记产出**。

### 5.4 关键发现（比数字本身更重要）

**① 这次迁移是「从 0 到 1」，不是「换壳」。**

802 轮真实旧 prompt 输出里，厂商标记出现 **0 次** —— 旧 prompt 教了 `(sighs)` 等词，模型实际一个都没写。所以形态 A 的降级率 0% **不是因为解析层无损，而是因为压根没有标记可解析**。新形态的价值不是「把旧标记换个写法」，而是**第一次让模型有机会产出停顿与情绪**。

**② 旧形态一旦被遵守，成本是 100% 降级，且 28.4% 直接语义作废。**

成因在解析层（`semantic-tag-parser.ts:799-814`）：

- `(sighs) (breath) (laughs) (chuckle) (emm)` → 能映射到语义层 → `VENDOR_FORMAT_CONVERTED`（warning）→ **Level 1**（573 轮）；
- `(sniffs) (humming)` → 语义层表达不了 → `VENDOR_MARKER_DROPPED`（warning）**且该标记字符计入非法比例** → 短回复里非法比例 > 10% → `ILLEGAL_RATIO_EXCEEDED` → **Level 2，语义字段全部作废**（228 轮）。

也就是说：**旧 prompt 教的 5 个 L1 词里有 2 个在语义层表达不了，模型一旦照写就会把整轮打成 Level 2**。新形态的标记全部是语义层原生支持的值，解析零降级。

> 数字脚注：形态 B 的 L1=574 但句首语气命中 573 —— 差的那 1 轮是「厂商标记被丢弃、但回复较长没触发非法比例上限」的轮次（Level 1 且无语义语气）。同理 L2=228 比丢弃数 229 少 1，原因相同。

**③ 迁移后 `convertedVendorTags` 应恒为 0。**

新 prompt 不再教厂商标记 → 解析层不应再出现 `VENDOR_FORMAT_CONVERTED`。这是「两套标记不混用」（snippet §七）的**可观测证据**，建议作为上线后的第一条监控指标。

### 5.5 真实 LLM 批次的阻塞原因与用户执行步骤

**阻塞原因**（实测）：

```
Test-NetConnection 127.0.0.1 -Port 3306  →  False   # MySQL 未启动
Test-NetConnection 127.0.0.1 -Port 6379  →  False   # Redis 未启动
```

离线批次入口 `POST /admin/api/auto-practice/batch`（`src/auto-practice/auto-practice.controller.ts:65` 控制器前缀 `admin/api/auto-practice`，需 AdminRoleGuard 鉴权）依赖完整服务栈，本环境跑不起来。

**用户执行步骤**（跑完把数字回填本节即可）：

```bash
# 1. 起依赖（仓库根有 docker-compose.yml）
docker compose up -d mysql redis

# 2. 建表（若尚未 migrate）
pnpm migration:run

# 3. 起后端
pnpm start:dev

# 4. 跑一批离线对练（admin 鉴权）
#    POST /admin/api/auto-practice/batch
```

然后看两个口径（`ap_practice_turns` 表，`visitor_semantic_json` 存的是 `parsed.turn` 结构：`text / preSpeech / pauses / controlTags / emotion / unknownTags`）：

```sql
-- ① 降级级别分布（visitor_semantic_level 0/1/2）
SELECT visitor_semantic_level, COUNT(*) AS n
FROM ap_practice_turns GROUP BY visitor_semantic_level ORDER BY visitor_semantic_level;

-- ② [pause] 命中率（pauses 数组非空）
SELECT COUNT(*) AS turns_with_pause FROM ap_practice_turns
WHERE JSON_LENGTH(JSON_EXTRACT(visitor_semantic_json, '$.pauses')) > 0;

-- ③ 情绪命中率（emotion 非 null）
SELECT COUNT(*) AS turns_with_emotion FROM ap_practice_turns
WHERE JSON_EXTRACT(visitor_semantic_json, '$.emotion') IS NOT NULL;
```

再验「模型没偷写厂商标记」（逐字稿原文在文件里，不在 DB —— `visitor_semantic_json` 存的是**剥掉标记后**的 `turn`）：

```bash
# 对新批次产生的逐字稿做厂商标记扫描 —— 期望 0 命中
grep -rE "[(](sighs|breath|laughs|chuckle|sniffs|humming|emm)[)]" data/debug-sessions/debug_*.json
```

**判定口径**：把上面三个数字与本节基线对照 —— 解析层基线是「新形态 0 降级 / pause 100% / emotion 100%」；真实批次若出现 L1/L2，差异来自**模型写错标记**（解析层纠正）而非解析层本身；`pause` / `emotion` 命中率低于 100% 说明**模型遵守率不足**，那属于 prompt 教法问题，不是解析问题。

---

## 六、parser 覆盖核对清单 + 未支持标记遗留

snippet §五 白名单逐个核对（parser 实际认领清单为准）：

| 标记          | 语义层   | parser 认领 | 备注                                                                             |
| ------------- | -------- | ----------- | -------------------------------------------------------------------------------- |
| `[sigh]`      | 句首语气 | ✅          | `SEMANTIC_PRE_SPEECH_TAGS` 全收                                                  |
| `[breath]`    | 句首语气 | ✅          | 同上                                                                             |
| `[inhale]`    | 句首语气 | ✅          | 同上                                                                             |
| `[emm]`       | 句首语气 | ✅          | 同上                                                                             |
| `[laugh]`     | 句首语气 | ✅          | 同上                                                                             |
| `[pause:x]`   | 句中停顿 | ✅          | 参数型，秒数 clamp 到 `[0.01, 99.99]`；**句尾会被丢弃**（prompt 已教「放句中」） |
| `[emotion:x]` | 句末情绪 | ⚠️ 部分     | 语义层只认 **5 值**：sad / calm / fearful / angry / happy                        |

**未支持标记遗留**（本单不改解析层，按任务单登记）：

- **L-P1e-1**：`disgusted` / `surprised` —— 官方 7 值白名单内，但语义层表达不了 → **被丢弃并记 warning**。prompt 仍按官方 7 值写（snippet §四：避免模型学到一个会被丢的值），但这两个值**目前实际不生效**。新 spec 已断言 prompt 里留有这两个值（留证）。
- **L-P1e-2**：`neutral` 非法（prompt 已明令不要写）；`fluent` / `whisper` 是 speech-2.6 专属（prompt 已明令不要写）。
- **L-P1e-3**：本单的三形态对比用的是 `[emotion:sad]` 模板，**未覆盖** `disgusted` / `surprised` 被丢弃时的告警路径；真批次若模型学这两个值，会看到 `TAG_UNKNOWN` 类诊断 → 上线监控时留意。

---

## 七、在线切换前置条件（用户拍板清单）

1. **跑完 §5.5 的真实 LLM 批次**，拿到真实的 `visitor_semantic_level` 分布与 `[pause]` / 情绪命中率。
2. **对照解析层基线**（本记录 §5.2 形态 C）：新形态若出现 L1/L2，先分清是「模型写错标记」还是「解析层缺陷」。
3. **看模型遵守率**：旧 prompt 实测带标记率 0/802。若新 prompt 仍接近 0，则这次迁移只是「把 prompt 改对」，**行为没变** —— 需要另立议题讨论「怎么让模型愿意打标记」（这不在本单范围）。
4. **上线后第一条监控指标**：`convertedVendorTags` 应恒为 0（新 prompt 不该再出现厂商标记）；出现非 0 即说明模型在偷写厂商标记或两套标记混用（snippet §七）。
5. **放量决策**（在线 / 灰度比例 / 回滚条件）由用户拍板 —— 本单**不做**在线切换。

---

## 八、提交分组与 commit message 草稿（不自动 commit / push）

**本单分组（建议单独一个 commit）**：

```
src/agent/visitor/visitor.prompts.ts
test/agent/visitor-prompt-semantic-tags.spec.ts
scripts/ops/semantic-tag-migration/compare-parse-degradation.ts
docs/worklog/completed/phase2.5/p1e3-visitor-semantic-tag-migration-2026-11-11.md
docs/worklog/completed/phase2.5/phase2.5-p1e-phase3-visitor-semantic-tag-migration-2026-11-11.md
```

**commit message 草稿**：

```
feat(p1e): visitor prompt 迁移语义标记（厂商标记清零 + 停顿/情绪纪律，离线三形态对比零降级）
```
