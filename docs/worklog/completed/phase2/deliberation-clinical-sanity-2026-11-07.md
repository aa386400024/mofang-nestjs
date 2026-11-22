# 临床合理性校验 · 观测版

> 状态: ✅ 已交付（2026-11-07）
> 交付记录: [`engine-deliberation-clinical-sanity-implementation-2026-11-07.md`](engine-deliberation-clinical-sanity-implementation-2026-11-07.md)
> 先读 `docs/worklog/README.md` 和 `docs/README.md` 确认后端当前阶段与模块边界。

## 一、为什么做这个（问题与目标）

### 背景

切灰度前置安全网已经做了三道：
1. ✅ delta cap（逐维砍幅，与规则算子同口径）
2. ✅ 过期判定与丢弃（快照版本对比）
3. ✅ cap 配置统一（审议侧与规则算子同一份 config）

蓝图 §2.3 里的"临床合理性校验"是最后一块——但这是一类需要临床数字的规则，我们没有临床顾问，不能自己发明。

### 目标

**先做观测版**：不拦截、不砍幅，只把"可疑"的轮次标记出来记进 trace，供督导复盘。等影子模式数据跑够了，再把确认的规则从观测切换到拦截。

---

## 二、开工前核实清单（6 条，开工前逐条自己 grep 确认）

| # | 核实项 | 确认方式 |
|---|---|---|
| 1 | 校验链的顺序是：格式校验 → delta cap → 过期判定 → 意图锁定 | ✅ 已确认 |
| 2 | `applyDeliberationDeltaCap` 在 `buildSuccessRecord` 内部调用 | ✅ 已确认 |
| 3 | `DeliberationTraceRecord` 已经有 `capEntries` 字段 | ✅ 已确认 |
| 4 | `DeliberationCapEntry` 的结构是 `{ dimension, raw, capped }` | ✅ 已确认 |
| 5 | 同盟三维是 trust / safety / bond，阻抗三维是 verbal / depth / style | ✅ 已确认 |
| 6 | 现有的 env 开关是 `ENGINE_DELIBERATION_ENABLED`（审议总开关） | ✅ 已确认 |

---

## 三、技术方案

### 校验链分层（从粗到细）

| 层 | 函数 | 性质 | 作用 |
|---|---|---|---|
| 第 1 层 | `validateDeliberationOutput` | 硬拦截 | 格式校验 |
| 第 2 层 | `applyDeliberationDeltaCap` | 硬砍幅 | 逐维 cap |
| **第 3 层** | **`applyClinicalSanityCheck`** | **软观测** | **临床合理性标记，不砍不丢** |
| 第 4 层 | `checkStale` | 硬判定 | 过期判定 |
| 第 5 层 | `resolveLock` | 硬判定 | 意图锁定 |

### 核心思路

- **只观测，不拦截**——标记出来，但不砍不丢
- **阈值是工程种子值**——明确标注"非临床标定，只是观测标记"
- **为切灰度提供数据**——影子模式跑的时候，督导看这些 flagged 轮次，校准哪些规则是真的

---

## 四、写入侧（详细设计）

### 4.1 新增类型：`ClinicalFlag`

```typescript
/** 单条临床合理性标记（观测版，不拦截） */
export interface ClinicalFlag {
  /** 规则名 */
  readonly rule: string;
  /** 维度名 */
  readonly dimension: string;
  /** 实际值 */
  readonly value: number;
  /** 阈值 */
  readonly threshold: number;
  /** 严重程度：info = 稍微可疑，warn = 很可疑 */
  readonly severity: 'info' | 'warn';
}
```

### 4.2 新增函数：`applyClinicalSanityCheck`

**位置**：`llm-deliberation.service.ts`

**职责**：对砍幅后的 delta 列表，跑临床合理性规则，标记可疑的。

**接口**：
```typescript
export function applyClinicalSanityCheck(
  deltas: readonly DeliberationDeltaEntry[],
): {
  /** 原始 delta 列表（不改，因为是观测版） */
  readonly checkedDeltas: readonly DeliberationDeltaEntry[];
  /** 临床合理性标记 */
  readonly clinicalFlags: readonly ClinicalFlag[];
}
```

**为什么不改 deltas**：因为是观测版，只标记不砍。

### 4.3 三条规则（工程种子值）

| # | 规则名 | 维度 | 阈值 | severity | 临床含义 |
|---|---|---|---|---|---|
| 1 | `alliance_positive_spike` | trust / safety / bond | 正向 delta > 0.15 | `warn` | 信任建立得太快 |
| 2 | `alliance_negative_spike` | trust / safety / bond | 负向 delta < -0.25 | `warn` | 信任破裂得太快 |
| 3 | `resistance_triple_jump` | verbal / depth / style | 三维同时正向 delta > 0.1 | `info` | 阻抗集体上升 |

### 4.4 调用点

**位置**：`buildSuccessRecord` 内部，`applyDeliberationDeltaCap` 之后。

**流程**：
1. 现有：`applyDeliberationDeltaCap(output.deltas, this.capConfig)` → `{ cappedDeltas, capEntries }`
2. **新增**：`const { clinicalFlags } = applyClinicalSanityCheck(cappedDeltas)`
3. `clinicalFlags` 塞进 trace

### 4.5 trace 加字段

**位置**：`DeliberationTraceRecord` 接口

**改动**：
```typescript
/**
 * 临床合理性标记（观测版，不拦截）.
 *
 * 空数组 = 没发现可疑.
 * 影子模式下只是观测, 切灰度后再决定要不要变成拦截.
 */
readonly clinicalFlags: readonly ClinicalFlag[];
```

**失败轮次**：填空数组，与 `capEntries` 一致。

### 4.6 开关

**新增 env 键**：`ENGINE_CLINICAL_SANITY_ENABLED`，缺省 `false`。

**逻辑**：
- 关着的时候，`applyClinicalSanityCheck` 直接返回空数组，零开销
- 开着的时候，跑 3 条规则

---

## 五、读取侧（详细设计）

本期**不新增 admin 查询接口**——`clinicalFlags` 直接出现在 Redis trace 的 JSON 里，debug 面板原样可见。

---

## 六、隐私与安全

1. **clinicalFlags 里只有数字和规则名**——不含心理内容
2. **日志只出定位信息**——不打对话原文

---

## 七、反双胞胎（刻意不做的事）

1. **不做拦截**——本期只观测，不砍不丢
2. **不发明临床数字**——阈值明确标注"工程种子值，非临床标定"
3. **不做逐条规则开关**——先总开关，切灰度后再细化
4. **不改内核**——纯适配层实现，engine-core 零改动
5. **不替换 delta cap**——两道各司其职：cap 是硬边界，临床校验是软观测
6. **不做 admin 前端面板**——trace 里已经有了，debug 面板能查

---

## 八、闸门（验收标准）

| # | 闸门 | 要求 |
|---|---|---|
| 1 | ESLint | 0 problem |
| 2 | TypeScript | 0 error |
| 3 | 单测 | 全量跑通，不新增失败 |
| 4 | engine-core | 零改动 |
| 5 | 规则 1 | trust 正向 delta = 0.18 → flagged（alliance_positive_spike） |
| 6 | 规则 2 | trust 负向 delta = -0.3 → flagged（alliance_negative_spike） |
| 7 | 规则 3 | verbal / depth / style 同时 0.12 → flagged（resistance_triple_jump） |
| 8 | 边界 | 正好等于阈值 → 不 flagged |
| 9 | 开关 | 开关关着 → clinicalFlags 空数组 |
| 10 | trace 形状 | 成功 / 失败两种情况下形状一致 |

---

## 九、交付物清单

1. **新增类型**：`ClinicalFlag`
2. **新增函数**：`applyClinicalSanityCheck`
3. **调用点**：`buildSuccessRecord` 内部，delta cap 之后
4. **trace 加字段**：`DeliberationTraceRecord` 加 `clinicalFlags`
5. **新增 env 开关**：`ENGINE_CLINICAL_SANITY_ENABLED`
6. **单测**：`test/engine-adapters/wp-deliberation-clinical-sanity.spec.ts`

### 交付后回写文档（与之前 WP 同款）

| 文件 | 改什么 |
|---|---|
| `docs/worklog/pending/deliberation-clinical-sanity-2026-11-07.md` | 状态行改 ✅ + 指向交付记录，然后移到 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | 切灰度前置剩余清单里，"临床合理性校验"那条打 ✅（观测版） |
| `docs/worklog/README.md` | Phase2 已开工列表加一条 |

---

## 十、commit message 草稿

```
feat(deliberation): 临床合理性校验 - 观测版

三条工程种子值规则, 只标记不拦截.
影子模式下观测可疑轮次, 供督导复盘.
切灰度后再校准阈值, 从观测切换到拦截.
engine-core 零改动.
```

---

## 十二、交付后补记（偏差表）

> 交付记录: [`engine-deliberation-clinical-sanity-implementation-2026-11-07.md`](engine-deliberation-clinical-sanity-implementation-2026-11-07.md)
> 本单**任务单 §二 的 6 条核实清单已逐条自己 grep 核实** —— **第 1 条任务单写错了**（见 B1）。

| # | 偏差 | 任务单怎么写的 | 代码实际是什么 | 怎么改的 | 为什么 |
|---|---|---|---|---|---|
| B1 | **校验链顺序写错** | §二 第 1 条 + §三 分层表："格式校验 → delta cap → 过期判定 → 意图锁定" | 实际是 **格式校验 → 意图锁定（`executeShadowMode:1160` `resolveLock`）→ 过期判定（`:1164` `checkStale`）→ delta cap（`buildSuccessRecord` 内部 `:1298`）** —— cap 是**最后**一步，过期判定在**意图锁定之前** | 核实结论进交付记录 §2.1，按代码实际顺序落法 | 顺序错 → 直接决定"临床校验插在哪"，必须先查准再动手（见 B2） |
| B2 | **调用点的"过期判定之前"不可达** | §三 分层表把临床校验放在"delta cap 之后、过期判定之前" | cap 在 `buildSuccessRecord` **内部**（最后一步），过期判定在它**之前** —— 要同时满足"cap 之后 + 过期判定之前"，**必须把 cap 从 `buildSuccessRecord` 挪出来** | 按 **§4.4 的原文**落：`buildSuccessRecord` 内部、`applyDeliberationDeltaCap` **之后** | 挪 cap 会破坏 delta-cap 单明确的不变式（"进 trace 的东西必然过了约束校验层"），且**对输出零影响**（两个独立观测落进同一条 trace，内容逐字相同）—— 为零差异动已交付单的结构性决策是净亏。"两道各司其职"这条完全满足（cap 改 delta，临床校验只标记） |
| B3 | **函数签名与开关行为自相矛盾** | §4.2 签名 `applyClinicalSanityCheck(deltas)`（**单参**）；§4.6 却要求"关着的时候直接返回空数组" | 单参签名**没法知道开关状态**（函数是纯的，不读 env） | 加**必填**第二参 `enabled: boolean` | 必填而非可选：强制调用方显式表态，杜绝"忘了传 → 默认跑/默认不跑"的静默分歧；"空数组"保证落在函数内部，未来切灰度改"观测/拦截"时这个函数是唯一要改的地方 |
| B4 | **flag 字段类型收窄** | §4.1：`rule: string` / `dimension: string` | 仓库先例：`DeliberationCapEntry.dimension` 在 delta-cap 单里就收窄成 `DeliberationDim` | `rule: ClinicalSanityRule`（三字面量联合）/ `dimension: DeliberationDim` | 消费方拿到的维度一定是合法审议维度，不用再判一遍；`rule` 收窄后拼错**编译期就红**（规则名是稳定的统计口径，混进错名会静默多出一组"未知规则"） |
| B5 | **规则 3 的产出形态 + 重复维度口径（任务单未规定）** | §4.3 只说"三维同时正向 delta > 0.1"，没说产出几条 flag，也没说同维度多条怎么办 | `ClinicalFlag` 只有一个 `dimension` 字段；`buildSuccessRecord` 拼 `deliberationDelta` 是**后写覆盖前写** | 规则 3 产出 **3 条** flag（每维一条）；同维度多条**取最后一条** | 塞 "verbal,depth,style" 会毁掉 `dimension` 字段的语义；取最后一条是**为了与 trace 同口径** —— 否则标记说的值和 trace 记的值对不上，督导会以为数据坏了 |
| B6 | **新增 env 键的登记位置（任务单漏了）** | §4.6 / §九 只说"新增 env 键 `ENGINE_CLINICAL_SANITY_ENABLED`" | 仓库的 env 守卫（`wp25-env-example-coverage.spec.ts`）双向断言：代码读的每个键都要在 `.env.example` 有**生效行**，`.env.example` 的每个生效行都要**真被读** | 同时登记 `typings/global.d.ts`（ProcessEnv 声明）+ `.env.example`（生效行 + 注释块） | 漏登记 → env 守卫直接红；且运维照抄模板时不知道有这个键，配不了 |

**额外发现（任务单未列，不算偏差，算事实）**：**规则 2 在完整管道里不可达** —— 格式校验的粗口径（`|delta| ≤ 0.2`）比规则 2 的阈值（-0.25）更严，能过校验的负向 delta 最小是 -0.2。观测数据里规则 2 恒为 0 条，**不是 bug**。本单照任务单的阈值实现（不发明临床数字），把这件事写进代码注释 + 用例 ⑧-3 钉死。

**闸门实跑**：lint **0 error / 0 warning** / `tsc -p tsconfig.build.json --noEmit` **0 error** / 全量单测 **128 文件 2186 例全绿**（基线 127 文件 2160 例，+1 文件 +26 例，既有零失败）/ `boundary.spec.ts` **12 例全绿** / `git diff --stat HEAD -- src/engine-core` **空**。
