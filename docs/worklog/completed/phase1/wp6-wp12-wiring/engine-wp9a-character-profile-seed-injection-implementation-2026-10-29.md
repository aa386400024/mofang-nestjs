# WP9-A · 角色内核解析注入管线（内置种子先跑通）· 后端交付记录

> 任务单: [`engine-wp9a-character-profile-seed-injection-backend-2026-10-29.md`](./engine-wp9a-character-profile-seed-injection-backend-2026-10-29.md)
> 前置: WP0–WP7 / [WP8-A](./engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md) / [MiniMax chat provider](./llm-minimax-chat-provider-implementation-2026-10-28.md) / [WP8-B](./engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-29

---

## 0. 一句话结论

**角色定义从哪来，被抽成了一个可替换端口**：`CharacterProfileResolver`（适配层，`src/engine-adapters/wiring/character/`），本期唯一实现是**内置硬编码种子**（回避依恋 L1 / 焦虑低落 L1），经**确定性映射**成内核 `CharacterProfile`，在 `EngineStreamBackend.openSession` 注入内核；解析不到角色 / 角色 key 查不到 / resolver 未装配 / resolver 抛错 —— **四种情况一律回退 WP8-B 的中性基线，不抛错、不阻断会话**。窄接口 `VoiceTurnBackendOpenOptions` 只**增可选字段**（`templateId` / `skillCode` / `preset`），旧 `VisitorService` 结构化仍满足；**`src/engine-core/` 整树零改动**。

WP9-B 接 MySQL 角色池时：**只新增一个 `DbCharacterProfileResolver` 实现 + 改一行绑定**，注入点与 `EngineStreamBackend` 零改动。

---

## 1. 实际落点

### 新增（3 个源文件 + 2 个测试文件）

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/wiring/character/character-profile.resolver.ts` | 解析端口（纯 TS 接口）：`CharacterProfileResolver`（`resolve` 返 `Promise<ResolvedCharacter \| null>`）、`CharacterResolveRequest`、`ResolvedCharacter`、`CharacterPresetInput` + DI token `CHARACTER_PROFILE_RESOLVER` |
| `src/engine-adapters/wiring/character/builtin-character-registry.ts` | 内置 2 个角色种子（纯数据）+ **确定性映射**（`buildCharacterProfile`）+ 稳定种子（`stableSeedFromKey`，FNV-1a） |
| `src/engine-adapters/wiring/character/index.ts` | 包出口（barrel re-export）：装配层与单测都从这里 import，将来加第三个实现（db resolver）不改 import |
| `test/engine-adapters/wp9a-character-resolver.spec.ts` | 任务单 §10 清单 1-6 |
| `test/engine-adapters/wp9a-open-profile.spec.ts` | 任务单 §10 清单 7-11 |

### 修改（4 个源文件）

| 文件 | 改动 |
|---|---|
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | 构造注入 `@Optional() @Inject(CHARACTER_PROFILE_RESOLVER)`；`openSession` 先解析角色 → 有角色则 `engine.open({..., characterProfile, seed})`，persona 快照 `name` 用角色名；解析异常/未命中 → 中性基线 + warn |
| `src/voice/voice-turn-backend.port.ts` | `VoiceTurnBackendOpenOptions` 增**可选** `templateId` / `skillCode` / `preset`；新增内联形状 `VoiceTurnBackendCharacterPreset` |
| `src/voice/voice.service.ts` | `openBackendSession` **只透传**握手已解析的 `meta.visitor?.templateId` / `meta.skillCode` / `meta.preset`（最小改动，消费器零改动） |
| `src/engine-adapters/wiring/engine.module.ts` | 绑定 `CHARACTER_PROFILE_RESOLVER`（`useFactory` → `BuiltinCharacterProfileResolver`）+ 预留 `ENGINE_CHARACTER_SOURCE`（db 分支只告警、不实现） |

### 红线核查

- `git diff --stat -- src/engine-core` → **空**（内核整树零改动）
- `src/voice/tts/**`、`src/voice/asr-token/**`、`src/voice/voice-session-bridge.ts` → **零改动**
- `src/agent/visitor/**` → **零改动**（旧链路保留，可回退）
- 前端 WS 帧协议 → **零改动**
- 内核零 `@nestjs/*` / 零 `typeorm` / 零目录逃逸 import（角色解析全在适配层）

---

## 2. 关键设计决策

### 2.1 为什么先抽端口，再做数据源（而不是直接写死种子）

任务单的判断是对的：WP9-A 的数据源是**内置硬编码种子**，WP9-B 的数据源是 **MySQL 角色池**（5Ps 长文本 + 审核状态 + 版本）。两者差别只在"角色定义从哪来"，其余（怎么映射成 `CharacterProfile` / 怎么注入内核 / 解析不到怎么办）**完全一样**。

所以把"从哪来"抽成 `CharacterProfileResolver`，注入点只认端口。WP9-B 落地时**只改一行绑定**：

```ts
// WP9-B 的全部改动量（示意）
{ provide: CHARACTER_PROFILE_RESOLVER, useFactory: (deps) => new DbCharacterProfileResolver(deps) }
```

`EngineStreamBackend` 与 voice 侧窄接口**一行都不用动**。这正是任务单 §0 "先做 A、避免边建表边改装配导致返工"的落点。

### 2.2 解析失败返 `null` 而不抛错

"查不到角色"在 WP9-A 是**常态**而不是异常（DB 角色池未接，握手带来的 `templateId` 大概率不在内置注册表里）。抛错会把"没有角色"升级成"会话开不起来"，让一个**可选增强**变成硬依赖。

`resolveCharacter` 把四种"没有角色"统一收敛到 `null`（走中性基线），且**都不抛**：

| 情况 | 行为 |
|---|---|
| resolver 未装配（`@Optional` 缺省） | 等同无角色 → 中性基线，不 500 |
| 本场没有任何角色参数 | 中性基线（连 warn 都不打 —— 普通 voice session 没有角色是正常的） |
| 角色 key 查不到 | 中性基线 + `warn`（带 `templateId`，线上排查的唯一线索） |
| resolver 抛错 | 中性基线 + `warn`（异常**不冒泡**给会话） |

### 2.3 角色种子与临场参数**分离**（种子给基线，preset 给叠加量）

临场参数（难度 / 防御水平 / 配合风格 / 情绪基线）是**每一场都会变**的东西，角色种子是"这个角色本来是什么样"。两者必须分开表达：若把临场参数直接写进种子里，同一角色在不同临场参数下就没法区分，而且"谁改了这套基线"永远说不清。

### 2.4 映射口径（任务单 §4 的落地）

| `CharacterProfile` 字段 | 本期映射 |
|---|---|
| `attachmentStyle` | 种子直接声明（`avoidant` / `anxious`），**不由 preset 推** |
| `coreBeliefs[]` | 种子直接写（第一人称 + `activationTags`），内核不改写 |
| `underlyingDesires[]` | 种子直接写（`baselineWeight`） |
| `baseline.trust` | **种子给，preset 不覆盖** —— 信任是关系的产物，不是旋钮 |
| `baseline.resistance` | 种子基线 + `defenseLevel × 0.35` + 难度系数（L1 0 / L2 +0.08 / L3 +0.16），`style` 维再受 `preset.style` 微调（cooperative −0.1 / mixed 0 / defensive +0.08 / avoidant +0.1 / resistant +0.15），全部 `clamp01` |
| `baseline.emotion` | `arousal` 由 `preset.emotionBaseline` 决定（缺省用种子值）；`valence` 由种子给；**`label` 不填** |
| `baseline.transference` | 固定全零（移情随会话演化，不在开场预设正负） |
| `forbiddenBehaviors[]` / `sensitiveTopics[]` | 种子声明（负向约束**不作风险信号**；与 WP8-B 前置预检口径一致：预检只看 `coreBeliefs.statement` + `trajectoryNote`） |

**`emotion.label` 不手填**：标签的唯一真相在内核 `resolveEmotionLabel(valence, arousal)`（按双轴象限表重算）。适配层手填会让内核与适配层各说各话 —— 同一份双轴数值解出两个标签。单测第 6 条断言 `baseline.emotion` **只有 `arousal` / `valence` 两个键**。

**数值是工程种子值，非临床标定**（任务单 §4 尾注）：本期只要求确定性、可复现、落在合理区间，不追求专业精确（专业标定归后期专业评审）。

### 2.5 `clamp01` 在适配层自带一份（不是重复实现，是边界纪律）

内核 `clamp01` / `clampValence` **没有从公开 barrel 导出**，而本期 `engine-core` 整树零改动 —— 深路径 import 一个"没导出"的内部函数，会把内核的公开出口变成可有可无。所以适配层自带一个三行 clamp（语义与内核一致：`NaN → 0`、越界夹取），并在该文件里注明理由。

顺带一个**真实踩坑**：FNV-1a 的两个常数原本写成十六进制字面量，仓库里 `prettier` 要求十六进制小写、`unicorn/number-literal-case` 要求大写 —— **两条规则在字面量上互斥**，`eslint --fix` 直接报 `ESLintCircularFixesWarning` 并来回翻转。落地改为**十进制具名常量**（`FNV_OFFSET_BASIS = 2_166_136_261` / `FNV_PRIME = 16_777_619`），既绕开冲突，也让这两个魔法数有名字。

### 2.6 确定性 `seed`（可复现性入口）

`seed` 由**角色 key 稳定派生**（FNV-1a 32 位 → `Math.imul` 保精度），不传随机数 —— 随机种子等于没有种子。同角色 + 同行为序列 → 同一 BDI 轨迹，是 WP1/WP3"伦理盲盒每次触发点一致"的前置条件。

内核当前只把 `seed` 存进 runtime（尚无逻辑消费），传它是**可复现性入口的前置**，本期不承诺任何基于 seed 的行为差异。

### 2.7 窄接口只增**可选**字段（旧实现仍满足）

`VoiceTurnBackendOpenOptions` 新增的三个字段全部可选，缺省语义 = "本场无角色"。必填字段会让旧实现（`VisitorService`）再也塞不进这个契约 —— "新旧并存可回退"当场破产。WP8-B 已用**编译期自证**钉住"旧 `VisitorService` 结构化满足 `VoiceTurnBackend`"，本期的可选字段不破坏该自证（`test/voice/wp8b-grayscale.spec.ts` 清单 B 复跑仍绿）。

`preset` 的形状在窄接口侧**内联**定义（`VoiceTurnBackendCharacterPreset`），不 import 角色解析包的类型：voice 层不该知道"角色内核"这件事，它只负责把握手带来的现场旋钮原样透传。将来 WP9-B 换数据源、改映射口径，voice 层一行都不用动。

### 2.8 翻译点仍然只有一处

WP8-B 立下的纪律是"引擎语义 → 语音语义必须收敛在一个文件"。角色解析同属引擎语义：窄接口只透传**原始事实**（角色 key + 临场参数），"这个 key 意味着什么样的阻抗与信念"由 `EngineStreamBackend` 侧的 resolver 负责。voice 层若自己去解析角色，voice 层就得知道角色语义，灰度一关就全是死代码。

### 2.9 配置面

- **不新增必需 env**：内置角色开箱可用。
- 预留 `ENGINE_CHARACTER_SOURCE=builtin|db`（默认 `builtin`）。本期**只认 builtin**：配了 `db` 会打一条 `warn`（`[WP9-A] ENGINE_CHARACTER_SOURCE=db 尚未实现 (角色池落库属 WP9-B), 本轮回退内置种子`）并继续用内置种子 —— **不静默假装 db 生效**。

---

## 3. 与任务单的差异（显式说明）

| 任务单 | 实际落地 | 说明 |
|---|---|---|
| §3.1 端口放在 `wiring/character/` | 一致，并额外加了 `index.ts` barrel | 装配层 import "角色解析"这件事，而不是某一个文件；WP9-B 加第三个实现时 import 路径不变 |
| §3.1 `preset` 为内联对象类型 | 一致，但拆成命名接口 `VoiceTurnBackendCharacterPreset`（voice 侧）与 `CharacterPresetInput`（角色侧） | 两个模块各有一份形状，**互不 import**，改一侧不动另一侧 |
| §3.3 "本期不强制传 seed" | **传了**（由角色 key 稳定派生） | 任务单允许传但要求"必须由角色 key 确定性派生"；传它是可复现性入口的前置，且内核忽略与否都不改变现状行为 |
| §9 `ENGINE_CHARACTER_SOURCE` | 一致（默认 builtin，db 只告警） | db 实现归 WP9-B |
| §10 清单 10 resume | **只走内核既有契约**，未新增 resume 相关逻辑 | 内核 `loadState` 的 resume 分支本来就"直接搬上一场快照、不用 profile 覆盖"；单测用**真实内核**断言"接续会话沿用上一场信任与信念，不被新角色覆盖" |

---

## 4. 已知缺口（必须如实看）

1. **生产 WS 路径下内置角色命中率目前为 0**。
   内置种子的 key 是 `builtin_avoidant_l1` / `builtin_anxious_low_mood_l1`，而握手带来的公共人物模板 id（`meta.visitor.templateId`，形如 `vpt_*`）**不会等于**这两个 key → 线上真实会话解析不到角色 → 走**中性基线**（WP8-B 现状行为，逐字不变）。
   这不是缺陷，是任务单 §5 写明的常态（"DB 角色池未接，查不到是常态"）。WP9-A 交付的是**解析 + 注入链路**与**可替换端口**；等 WP9-B 接上角色池，或把内置种子 key 与公共模板 id 建立映射，命中率才有意义。
   → 若希望本期就能在内网验到角色效果，需要单独确认"公共模板 id → 内置种子 key"的映射口径（**尚未拍板，本期未擅自加**）。

2. **`db` 数据源未实现**（归 WP9-B）：只留了配置位与告警。

3. **角色强剧本 / 伦理盲盒**未做（归 WP10）；本期只注入"角色内核基线"。

4. **角色语义未进渲染 prompt**：`forbiddenBehaviors` 已透传给内核意图规划（WP5 回避），但渲染层的 prompt 还没吃角色的 `coreBeliefs` / `sensitiveTopics` —— 本期不在任务单范围。

---

## 5. 单测清单对照（任务单 §10）

### `test/engine-adapters/wp9a-character-resolver.spec.ts`（清单 1-6，13 例）

| 清单 | 用例 | 断言要点 |
|---|---|---|
| 1 | 按 key 解析出完整基线 | 非 null；`coreBeliefs` / `forbiddenBehaviors` / `sensitiveTopics` / `underlyingDesires` 非空；数值落在 [0,1]；移情全零；展示名 = 种子名 |
| 2 | 可复现 | 连续两次 resolve **深相等**（含基线与 seed）；seed 由 key 稳定派生且不同角色不同；结果**不共享可变引用** |
| 3 | 可区分 | 两角色 trust / resistance / 信念 / 依恋风格均不同；回避型 depth 阻抗高于焦虑型；同角色不同难度 → 阻抗不同 |
| 4 | 查不到 → null | 未知 key / 空参数 / 空白 key / 只给 skillCode → 全部 `null`，不抛不造默认角色 |
| 5 | 越界 clamp | `emotionBaseline=1.9` → arousal 夹到 1；`defenseLevel=-0.2` → 夹到 0（阻抗等于种子基线，**不是裸加负数**）；`emotionBaseline=-5` / `defenseLevel=9` → 全部夹进 [0,1]，不出 NaN |
| 6 | 不手填 label | `baseline.emotion` **只有 `arousal` / `valence` 两个键**；valence 由种子给（临场只动唤醒） |

### `test/engine-adapters/wp9a-open-profile.spec.ts`（清单 7-11，15 例）

| 清单 | 用例 | 断言要点 |
|---|---|---|
| 7 | 有角色 → 注入 | `engine.open` 收到非空 `characterProfile`（信念/负向约束/敏感议题齐全）+ 数字 seed；persona 快照 `name` = 角色名（`id` 仍沿用 personaId） |
| 8 | 无角色 / 未装配 / 抛错 → 中性 | 三种情况都**不带** `characterProfile`、不带 seed、persona 名为"来访者"、**不抛** |
| 9 | 初始快照可复现 / 可区分 | 用**真实 `InMemoryEngineSession`** + 一条**中性**咨询师文本（不命中规则词典 → 事件 delta 全零 → 快照不被状态迁移改写）：同角色两次独立开场的快照**逐字相等**；快照带该角色信念与**非中性**基线（trust / resistance / valence / arousal 逐值对上种子）；换角色 → 基线明显不同；情绪标签由内核重算（非 neutral） |
| 10 | resume 不覆盖 | 第一场（回避型）跑一轮落库 → 第二场 `resumeFromSessionId` 接续但**带另一个角色**（焦虑型）→ 首轮沿用上一场的信任与信念，**不被新角色覆盖** |
| 11 | 灰度关 / 名单外 | 真实 `EngineStreamBackend` + 计数 resolver：开关关 → resolver 0 次调用、旧 visitor 1 次；名单外 → 同上；开关开且命中 → resolver 1 次，且拿到握手透传的 `templateId` / `preset` 四项 |

---

## 6. 闸门结果（本机复跑）

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| `npx eslint "src/**/*.ts"` | **0 error / 0 warning** |
| `npx jest test/engine-adapters/wp9a-character-resolver.spec.ts test/engine-adapters/wp9a-open-profile.spec.ts` | **2 套件 / 28 用例全绿** |
| `npx jest test/engine-core test/engine-adapters test/voice --maxWorkers=2` | **18 套件 / 398 用例全绿**（engine-core 7 套件 177 用例零回归；engine-adapters 8 套件 133 用例；voice 3 套件 88 用例） |
| `git diff --stat -- src/engine-core` | **空**（内核整树零改动） |

> 闸门由大炮在 Windows PowerShell 复跑；后端未代跑 flutter/dart。

---

## 7. 交接 WP9-B

- **WP9-B 的全部改动量**：新增 `DbCharacterProfileResolver implements CharacterProfileResolver`（读 MySQL 5Ps 表 → 映射成 `CharacterProfile`）+ 改 `engine.module.ts` 里 `CHARACTER_PROFILE_RESOLVER` 的绑定 + 建表 / migration / 审核状态。
- **不需要改**：`EngineStreamBackend`、voice 侧窄接口与 `voice.service.ts`、`engine-core` 整树。
- 回指 backlog §WP9 原条目；任务单 §13 的交接项保持有效。
- 若要在 WP9-B 之前就让内置种子在真实会话生效，需要先拍板"公共人物模板 id → 内置种子 key"的映射口径（见 §4 第 1 条）—— **这属于产品口径，不应由后端擅自决定**。
