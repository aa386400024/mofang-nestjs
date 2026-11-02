# WP9-A · 角色内核解析注入管线（内置种子先跑通）· 后端任务单

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md)
> backlog 原条目: [`phase1-integration-backlog-2026-10-28.md`](./phase1-integration-backlog-2026-10-28.md) §WP9
> 前置（均已交付复跑绿）: WP0–WP7 / WP8-A 聚合装配 / MiniMax chat provider / [WP8-B 流式+灰度](./engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-29
> 闸门由大炮在 Windows PowerShell 复跑 `tsc` / `eslint` / `jest`，后端勿代跑 flutter/dart。

---

## 0. 一句话目标

把 WP8-B 留下的"中性基线"缺口补上：在**适配层**建一个可替换数据源的「角色解析器」，本期用**内置硬编码种子角色**（零数据库）把角色基线解析成内核 `CharacterProfile`，在 `openSession` 注入，让新引擎开场就带稳定的信念/阻抗/情绪/信任基线；解析不到角色时**回退中性基线**，不阻断、可回退、`engine-core` 零改动。

> 为什么先做 A、把 MySQL 5Ps 落库放 WP9-B：角色池建表/审核状态/migration 是独立一块；先把"角色定义 → CharacterProfile → 内核快照"的解析与注入链路用内置种子打通并钉死单测，二期接 DB 仓储时**只换数据源、不改注入点**，避免边建表边改装配导致返工。

---

## 1. 现状事实（开工先 Read 对齐，不要凭印象）

- 内核角色契约 `src/engine-core/domain/character-profile.ts`：`CharacterProfile{ coreBeliefs, attachmentStyle?, underlyingDesires?, baseline?:{trust?,resistance?,emotion?,transference?}, forbiddenBehaviors, sensitiveTopics }`；`coreBeliefs` 永久不可变，由 adapter 解析注入，内核**不读数据库、不感知角色实体**。
- 开场入口 `OpenEngineSessionInput.characterProfile`（`engine-core/domain/engine-session.types.ts:66`）已就位；`resumeFromSessionId` 接续时**不覆盖**上一场状态，本期沿用，不新增 resume 逻辑。
- 基线类型：`BdiResistance{verbal,depth,style}`（均 [0,1]，越高阻抗越强）；`EmotionState{label,valence[-1,1],arousal[0,1]}`，`label` 由内核 `resolveEmotionLabel(valence,arousal)` 确定性重算，**外部不手填 label**；`TransferenceState{positive,negative,dependency}` 默认全零。
- WP8-B 的 `EngineStreamBackend.openSession`（`src/engine-adapters/wiring/engine-stream-backend.adapter.ts`）当前只拿 `sessionId/tenantId/personaId`，返回硬编码 `NEUTRAL_PERSONA`（"来访者"，L1），**未向 `engine.open` 传 `characterProfile`** —— 这就是本期要补的点。
- 握手侧已有角色与临场参数（`voice/voice-handshake.ts` / `voice.gateway.ts`）：`templateId`、`skillCode`、`preset{difficulty,style,emotionBaseline,defenseLevel,visitorMode}`，旧链路用于拼 prompt；新引擎窄接口目前没把这些透传进来。
- 窄接口 `VoiceTurnBackend.openSession(opts)`（`src/voice/voice-turn-backend.port.ts`）本期只增**可选**字段，旧 `VisitorService` 结构化仍满足，不破坏契约。

## 2. 本期范围（WP9-A）

**做：**

1. 适配层角色解析端口 + 内置种子注册表（2 个最小角色，硬编码纯数据）。
2. 角色 key + 握手 `preset` → `CharacterProfile` 的**确定性**映射（纯函数，不调 LLM、不读 DB、结果可复现）。
3. 窄接口 `openSession` 增补可选角色参数透传；`EngineStreamBackend.openSession` 调 `engine.open` 时注入 `characterProfile`（及可选确定性 `seed`）。
4. 解析失败 / 无角色 → 返回 null，回退 WP8-B 中性基线（现状行为不变）。
5. 单测钉死：同角色同序列基线可复现、不同角色基线可区分、无角色回退中性。

**不做（明确切给 WP9-B 或更后，见 §7）：** MySQL 5Ps schema/migration、审核状态/未审核不可用、角色 CRUD 与后台、真实 5Ps 文本入库、UGC、角色版本 semver。

---

## 3. 架构设计

### 3.1 可替换数据源：解析端口 + 内置实现（为 WP9-B 接 DB 留口）

在 `src/engine-adapters/wiring/character/` 下新增：

- `character-profile.resolver.ts` —— 解析端口（纯 TS 接口，适配层，**不进 engine-core**）：

```ts
/** 角色解析结果; null = 无可用角色, 调用方回退中性基线. */
interface CharacterProfileResolver {
  resolve(request: CharacterResolveRequest): Promise<ResolvedCharacter | null>;
}

interface CharacterResolveRequest {
  readonly templateId?: string;
  readonly skillCode?: string;
  readonly preset?: {
    readonly difficulty?: string;      // L1 / L2 / L3
    readonly style?: string;           // cooperative / mixed / resistant
    readonly emotionBaseline?: number; // 0..1
    readonly defenseLevel?: number;    // 0..1
  };
}

interface ResolvedCharacter {
  readonly characterProfile: CharacterProfile;
  /** 确定性可复现种子; 省略由内核自行生成. */
  readonly seed?: number;
  /** 展示用角色名 (供 persona 快照/日志, 不进决策). */
  readonly displayName: string;
}
```

- `builtin-character-registry.ts` —— 本期唯一实现，内置 2 个种子角色的纯数据定义；`resolve` 同步或异步均可，但**必须纯函数式、无外部 IO、同一输入同一输出**。
- WP9-B 接 MySQL 时，新增一个 `DbCharacterProfileResolver` 实现同一端口，在装配层替换绑定，**注入点与 EngineStreamBackend 不动**。

### 3.2 装配注入

- `EngineStreamBackend` 构造注入 `CharacterProfileResolver`（用 `@Optional()`，未装配时按"无角色=中性"处理，保证旧装配/单测不破）。
- `openSession`：`resolver.resolve({templateId, skillCode, preset})` → 有结果则 `engine.open({sessionId, tenantId, visitorId, characterProfile, seed})`；无结果走现状中性基线。
- persona 快照 `displayName` 用解析结果的名字，无角色仍用中性 `来访者`。

### 3.3 确定性 seed（可复现性入口）

- 本期不强制传 seed；若传，必须由角色 key 确定性派生（如稳定 hash → 整数），保证**同一角色 + 同一行为序列**产出同一 BDI 轨迹（呼应 WP1/WP3 伦理盲盒可复现）。
- 省略时由内核生成，行为与现状一致。

---

## 4. 角色 → CharacterProfile 确定性映射（纯函数，clamp01）

映射全部在适配层完成，**内核只消费纯对象**。数值统一 `clamp01`，`emotion.label` 交给内核重算，禁止在适配层手填离散标签。

| CharacterProfile 字段 | 来源 / 映射规则（确定性，给口径不给死值，数值落在种子表） |
|---|---|
| `attachmentStyle` | 种子直接声明（`secure/anxious/avoidant/disorganized`），不由 preset 推。 |
| `coreBeliefs[]` | 种子直接写：`{theme, statement(第一人称), activationTags[]}`；永久不可变，与情绪/阻抗解耦。 |
| `underlyingDesires[]` | 种子直接写：`{key, label, baselineWeight[0,1]}`。 |
| `baseline.trust` | 种子声明初始信任（回避型低、安全型偏高），preset 不覆盖。 |
| `baseline.resistance.verbal/depth/style` | 由种子基线 + `defenseLevel` + `difficulty`(L1/L2/L3 系数) 确定性加权，全部 clamp01；`style` 再受 preset.style 微调。 |
| `baseline.emotion` | `arousal` 由 `emotionBaseline` 映射到 [0,1]；`valence` 由种子情绪基调给；`label` 不填，内核重算。 |
| `baseline.transference` | 本期固定全零（移情随会话演化，不在开场预设正负）。 |
| `forbiddenBehaviors[]` | 种子声明（透传 WP5 回避；负向约束，不作风险信号）。 |
| `sensitiveTopics[]` | 种子声明敏感议题词表（命中触发 sensitive_touch）。 |

> 数值是**工程种子值**，非临床标定；本期只要求确定性、可复现、落在合理区间，不追求专业精确（专业标定归后期专业评审）。

### 4.1 本期内置种子（最小 2 个，硬编码在注册表）

1. **回避依恋 · L1（示例 key `builtin_avoidant_l1`）**：低初始信任、三维阻抗偏高、情绪偏压抑（低 valence / 低-中 arousal）；核心信念如"主动靠近就会受伤/被抛弃"。
2. **焦虑低落 · L1（示例 key `builtin_anxious_low_mood_l1`）**：中低信任、depth 阻抗中、情绪负向中唤醒；核心信念如"我是没用的、事情不会变好"。

> 种子文案与基线数值由实现方按上表口径拟定，单测钉住"两角色基线互不相同、同角色可复现"即可；不在本期追求临床精修。

---

## 5. 异常与边界语义

| 场景 | 行为 |
|---|---|
| 握手无 `templateId` 且无 skillCode 角色 | resolver 返回 null → 中性基线（WP8-B 现状），行为不变。 |
| `templateId` 在内置注册表查不到 | **不当错误抛断**，回退中性基线 + warn 日志（DB 角色池未接，查不到是常态）。 |
| 映射函数收到非法/越界数值 | clamp01 兜底，不抛；缺省字段回中性。 |
| 解析器未装配（@Optional 缺失） | 等同无角色，中性基线，不 500。 |
| `resumeFromSessionId` 接续 | **不覆盖**上一场状态（内核既有契约），本期不新增跨场角色替换。 |
| 灰度开关关 / 名单外 | 走旧链路，本注入逻辑完全不参与，帧序列与现状一致。 |
| 引擎整体故障/降级 | 沿用 WP8-B 回落矩阵，不因角色注入改变。 |

---

## 6. 窄接口透传（只增可选字段）

`VoiceTurnBackendOpenOptions` 增补（全部可选，旧实现不受影响）：

```ts
readonly templateId?: string;
readonly skillCode?: string;
readonly preset?: {
  readonly difficulty?: string;
  readonly style?: string;
  readonly emotionBaseline?: number;
  readonly defenseLevel?: number;
};
```

- `voice.service.openBackendSession` 把握手已解析的 `meta.templateId / meta.skillCode / meta.preset` 带入 `openSession` 选项（消费器零改动，沿用 WP8-B 灰度/回落）。
- 翻译点仍收敛在 `EngineStreamBackend`，voice 层不感知角色内部语义。

---

## 7. 明确不做（Out of Scope）

| 不做项 | 归属 |
|---|---|
| 5Ps schema（主诉/易感/诱发/维持/保护）落 MySQL、手写 migration、审核状态字段、未审核不可用、可回滚 DDL | **WP9-B**（backlog §WP9 原条目主体） |
| 角色 CRUD / 后台管理 / 角色上下架 | WP9-B 及以后 |
| 真实 5Ps 长文本、人格沟通标签、专业标签入库 | WP9-B |
| TrajectoryScript 强剧本注入（WP3 能力已在，角色剧本归 WP10 伦理盲盒，不在本期） | WP10 |
| UGC 提交-审核-分成、角色版本 semver、运行时风控 | Phase2 队列 |
| 角色 LLM 动态生成、流派差异化参数 | Phase2 |
| 新引擎逐字稿与 counselor 桥字段对齐 | 后续轮（WP8-B 遗留 #2） |
| 修改内核决策/快照/算子、`engine-core` 整树零改动 | 禁止 |

---

## 8. 目录落点（建议，按仓库惯例微调）

```
src/engine-adapters/wiring/character/
├── character-profile.resolver.ts      【新】解析端口 + ResolvedCharacter/Request 纯类型
├── builtin-character-registry.ts      【新】2 个内置种子纯数据 + 确定性映射纯函数
└── index.ts                          【新】re-export（可选）

src/engine-adapters/wiring/engine-stream-backend.adapter.ts  【改】注入 resolver, open 带 characterProfile
src/voice/voice-turn-backend.port.ts                          【改】openSession 选项增补可选字段
src/voice/voice.service.ts                                   【改】openBackendSession 透传角色参数(最小改动)
src/engine-adapters/wiring/engine.module.ts                   【改】绑定内置 resolver(可选 provider)

test/engine-adapters/wp9a-character-resolver.spec.ts           【新】解析映射/可复现/无角色回退/边界 clamp
test/engine-adapters/wp9a-open-profile.spec.ts                【新】openSession 注入 characterProfile, 中性回退
```

> 端口/解析器放 `wiring/character/`（装配层），**不得**放进 `engine-core`（内核零 IO、零角色实体）。

---

## 9. 配置面（env，全部可选，本期无新必需配置）

- 不新增必需 env；内置角色开箱可用。
- 预留 `ENGINE_CHARACTER_SOURCE=builtin|db`（默认 `builtin`），本期只认 builtin，db 分支留 WP9-B 占位不实现。

---

## 10. 单测清单（全 mock，不连真实上游/DB/网络）

**`test/engine-adapters/wp9a-character-resolver.spec.ts`**

1. 内置角色按 key 解析出非 null 的 `characterProfile`，字段完整（coreBeliefs/forbiddenBehaviors/sensitiveTopics 非空数组，baseline 数值在 [0,1]）。
2. **可复现**：同一角色 key + 同一 preset 连续 resolve 两次，结果对象深相等（含基线数值、seed）。
3. **可区分**：两个内置角色的 `baseline.resistance` / `baseline.trust` / coreBeliefs 明显不同。
4. 未知 `templateId` / 无任何角色参数 → 返回 null（不抛、不造默认角色）。
5. 越界 preset（`emotionBaseline=1.9`、`defenseLevel=-0.2`）→ clamp01，不抛、不 NaN。
6. `baseline.emotion` 不手填 label；解析结果只给 valence/arousal。

**`test/engine-adapters/wp9a-open-profile.spec.ts`**

7. 有角色 → `engine.open` 收到非空 `characterProfile`，persona 快照 `displayName` 为角色名。
8. 无角色 / resolver 未装配 → `engine.open` 不带 characterProfile，回退中性，不抛。
9. 同一角色两次开场，初始快照基线一致（可复现）；切换角色基线不同。
10. resume 路径（若带 resumeFromSessionId）不覆盖已存在状态（沿用内核契约，断言不注入覆盖）。
11. 灰度关 / 名单外不触发 resolver（旧链路不受影响）。

---

## 11. 验收（Done 的可观察标准）

- `npx tsc -p tsconfig.build.json --noEmit` 0 错；`eslint` 0 error；新增套件全绿；`test/engine-core`、`test/engine-adapters`、`test/voice` 既有套件零回归。
- 选中内置角色开场，初始 BDI 快照带该角色信念与非中性基线；同角色多次开场基线一致，换角色基线不同。
- 无角色/未知角色/未装配 → 中性基线，会话正常进行，不 500、不阻断。
- `git diff --stat -- src/engine-core` 为空；旧 `agent/visitor`、voice TTS/ASR/bridge 零改动；灰度关旧链路逐帧一致。
- 解析端口抽象到位：WP9-B 接 DB 时只新增一个 resolver 实现并改绑定，EngineStreamBackend 与注入点零改动。

## 12. 闸门命令（大炮在 Windows PowerShell 复跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx tsc -p tsconfig.build.json --noEmit
npm run lint
npx jest test/engine-adapters/wp9a-character-resolver.spec.ts test/engine-adapters/wp9a-open-profile.spec.ts
npx jest test/engine-core test/engine-adapters test/voice --maxWorkers=2
git diff --stat -- src/engine-core   # 必须为空
```

---

## 13. 交接

- **WP9-B（下一轮）**：5Ps schema 落 MySQL + migration + 审核状态 + `DbCharacterProfileResolver` 实现同一端口替换 builtin；回指 backlog §WP9 原条目。
- 角色强剧本/伦理盲盒 → WP10；逐字稿桥对齐、前置实时 RiskProbe、聚合兜底句落账语义统一 → 后续轮。

---

## 14. 交付回写（2026-10-29）

> 交付记录：[`engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md`](./engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md)
> 状态：✅ **代码已交付并复跑绿**（闸门由大炮在 Windows PowerShell 复跑）

### 14.1 实际目录落点（与 §8 建议一致，另有 1 处增量）

```
src/engine-adapters/wiring/character/
├── character-profile.resolver.ts      【新】解析端口 + 请求/结果纯类型 + DI token
├── builtin-character-registry.ts      【新】2 个内置种子 + 确定性映射 + 稳定 seed
└── index.ts                           【新】barrel re-export（§8 标"可选"，实际落地 —— 装配层
                                          import"角色解析"这件事而非某个文件，WP9-B 加第三个实现时路径不变）

src/engine-adapters/wiring/engine-stream-backend.adapter.ts  【改】注入 resolver, open 带 characterProfile/seed, displayName 回填
src/voice/voice-turn-backend.port.ts                          【改】openSession 选项增补可选字段
src/voice/voice.service.ts                                   【改】openBackendSession 透传角色参数（最小改动）
src/engine-adapters/wiring/engine.module.ts                   【改】绑定 builtin resolver（useFactory）+ ENGINE_CHARACTER_SOURCE 占位告警

test/engine-adapters/wp9a-character-resolver.spec.ts          【新】清单 1-6（13 例）
test/engine-adapters/wp9a-open-profile.spec.ts                【新】清单 7-11（15 例）
```

### 14.2 闸门结果

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| `npx eslint "src/**/*.ts"` | **0 error / 0 warning** |
| `npx jest test/engine-adapters/wp9a-character-resolver.spec.ts test/engine-adapters/wp9a-open-profile.spec.ts` | **2 套件 / 28 用例全绿** |
| `npx jest test/engine-core test/engine-adapters test/voice --maxWorkers=2` | **18 套件 / 398 用例全绿**（engine-core 7/177 零回归；engine-adapters 8/133；voice 3/88） |
| `git diff --stat -- src/engine-core` | **空**（内核整树零改动） |
| `src/voice/tts` · `src/voice/asr-token` · `src/voice/voice-session-bridge.ts` · `src/agent` | **零改动** |

### 14.3 与任务单的 5 处显式差异

1. **§3.1 端口目录**：额外加了 `index.ts` barrel（§8 标"可选"，实际落地）。
2. **§3.1 `preset` 形状**：拆成两份互不 import 的命名接口 —— voice 侧 `VoiceTurnBackendCharacterPreset`（窄接口内联形状）/ 角色侧 `CharacterPresetInput`；改一侧不动另一侧。
3. **§3.3 seed**：任务单说"本期不强制传 seed；若传必须由角色 key 确定性派生" —— 实际**传了**（FNV-1a 稳定派生），内核忽略与否都不改变现状行为，但为 WP3/WP10 的可复现性留好入口。
4. **§5 "解析器未装配"**：落地为 `@Optional() @Inject(CHARACTER_PROFILE_RESOLVER)`（构造注入），未装配 = 无角色 = 中性基线，不 500。
5. **§10 清单 10（resume）**：**未新增任何 resume 逻辑**，只沿用内核既有契约（`loadState` 的 resume 分支直接搬上一场快照、不用 profile 覆盖），并用**真实内核**断言"接续会话沿用上一场信任与信念，不被新角色覆盖"。

### 14.4 灰度与验证说明

- 灰度开关 `ENGINE_VOICE_ENABLED` 缺省**关** → 旧链路逐帧一致，**角色解析逻辑完全不参与**（单测第 11 条用计数 resolver 断言"开关关 / 名单外 → resolver 0 次调用"）。
- 开关开且命中名单 → resolver 被调用一次，拿到握手透传的 `templateId` / `skillCode` / `preset`（difficulty·style·emotionBaseline·defenseLevel）。
- 清单 9/10 用**真实 `InMemoryEngineSession`** + 一条**中性**咨询师文本（不命中规则词典 → 事件 delta 全零 → 快照不被状态迁移改写），因此断言到的确实是"开场基线"而不是"跑完一轮之后的基线"。

### 14.5 遗留缺口（下一轮的入口）

1. **生产 WS 路径下内置角色命中率目前为 0**：内置种子 key（`builtin_*`）≠ 公共人物模板 id（`vpt_*`），线上真实会话解析不到角色 → 走中性基线（WP8-B 现状，逐字不变）。这符合 §5"DB 角色池未接，查不到是常态"，但要让内置种子真正生效，需**先拍板"公共模板 id → 角色 key"的映射口径**（产品口径，后端未擅自决定）。
2. **`ENGINE_CHARACTER_SOURCE=db` 未实现**（归 WP9-B）：本期只认 builtin，配了 db 打 warn 并继续用内置种子，**不静默假装 db 生效**。
3. **角色语义未进渲染 prompt**：`forbiddenBehaviors` 已透传内核意图规划（WP5 回避），但渲染层还没吃 `coreBeliefs` / `sensitiveTopics` —— 不在本期范围。
4. 角色强剧本 / 伦理盲盒 → WP10；逐字稿桥对齐、前置实时 RiskProbe、聚合兜底句落账语义统一 → 后续轮。
