# WP14 优化项：block 时不发 llm_start（最佳实践收口）

> 日期：2026-11-02 ｜ 前置：WP14 主单已交付
> 性质：**体验优化**，不是新功能。修"阻断轮 llm_start 先弹半圈 loading 再弹 modal"的视觉瑕疵。
> 红线：engine-core 仍一行不动；不重构流式路径，只在前面加 gate。
>
> **状态：✅ 代码已交付并复跑绿（未 commit）**
> 交付记录：`docs/progress/wp14-block-no-llm-start-optimization-implementation-2026-11-02.md`

---

## 1. 现在的问题

学员发"我想死"→ 当前时序：

```
voice 层发 llm_start（前端 loading 转起来）
  → 内核 turn 内部 safety 判定 → block
    → 不调 render（无内容帧）
      → voice 层发 crisis_modal
```

前端体感：loading 圈刚转半圈，全屏 modal 突然弹出；且收不到对应的 `llm_done`（后端根本没渲染），等于"开始了但永远不会结束"。

## 2. 目标时序

```
voice 层收到学员本轮 message
  → 前置 safety gate（对本轮 user message 跑 probe）
    ├─ block → 不发 llm_start，直接发 crisis_modal + 写审计，不调内核 turn/render
    ├─ warn  → 正常发 llm_start，调 render，内核内部兜底判 warn 发 crisis_toast
    └─ pass  → 正常流程
```

block 时前端不会先转 loading，modal 直接弹出来，干净。

## 3. 改动点（只动这三处，别自由发挥重构）

### 3.1 voice 层加前置 gate 端口

`voice-turn-backend.port.ts` 加一个可选方法：

```ts
/**
 * 前置 safety 判定 — voice 层在发 llm_start 之前调。
 * block 时 voice 层直接发 crisis_modal，不调内核 turn，避免 llm_start 孤儿帧。
 */
preCheckSafety?(text: string): Promise<{
  level: 'pass' | 'warn' | 'block';
  category?: string;
}>;
```

### 3.2 adapter 实现这个端口

`engine-stream-backend.adapter.ts` 实现 `preCheckSafety`：委托给已有的 `RiskProbePort.probe(text, 'counselor_input')`，返回 level + category。**复用现有的探测器实例，不新建。**

### 3.3 voice.service.ts 发 llm_start 前插入 gate

在发 `llm_start` 帧的那个位置之前：

1. 调 `backend.preCheckSafety?.(本轮 user text)`
2. 如果返回 `level === 'block'`：
   - **不发** `llm_start`
   - **不调** 内核 turn / render
   - 直接发 `crisis_modal` 帧（复用现有的 modal 帧构造逻辑）
   - 写审计（复用现有的 audit 写入逻辑，source 记 `local_dict` 或 `psyguard`——跟内核判定同一套）
   - 不发 `llm_done` / `tts_done`（因为 llm_start 都没发，这俩也不需要）
3. warn / pass → 走现有流程，不动

## 4. 必须守住的边界

| 边界 | 说明 |
|---|---|
| **不重复写审计** | 前置 gate block 时 voice 层写了审计；因为不调内核 turn，内核不会再写第二次。不要在内核侧加"去重检查"——那就过度设计了。 |
| **warn 场景不变** | warn 仍由内核内部判定发 crisis_toast，voice 层前置 gate 对 warn 不拦截（让正常渲染走）。前置 gate 只拦 block。 |
| **前置 gate 漏判兜底** | 如果前置 gate 因为网络抖动漏了（PsyGUARD 超时 fallback 到本地词典也没中），内核内部的 safety 判定仍然会 catch——双层防御，不会因为前置 gate 加了就放宽内核侧。 |
| **visitor_output 侧不动** | AI 来访说的话不经过这个前置 gate（gate 只对 counselor_input）。 |
| **monitored 标志照常置位** | 前置 gate block 时，monitored=true 照常写（跟内核判 block 一样的逻辑）。 |

## 5. 验收

| # | 验收条 |
|---|---|
| 1 | 学员发"我想死" → 前端**先收到 crisis_modal**，全程无 llm_start、无 llm_done、无 tts 帧 |
| 2 | 学员发"活着没意思"（warn）→ 前端正常收到 llm_start → 流式回复 → crisis_toast，时序跟现在一致 |
| 3 | 学员发普通咨询话术 → 完全正常，无任何额外帧 |
| 4 | PsyGUARD 挂掉 → 前置 gate 走本地词典兜底，block 仍能拦住 |
| 5 | 前置 gate 超时/异常 → 静默降级到现有流程（正常发 llm_start 调 render），不把对练搞挂 |
| 6 | engine-core git diff 为空 |

## 6. commit 文案

```
feat(voice): block 级危机前置 gate——发 llm_start 前判定，block 直接发 crisis_modal 不发孤儿帧
```

---

## 7. 交付回写（2026-11-02）

> 完整记录见 `docs/progress/wp14-block-no-llm-start-optimization-implementation-2026-11-02.md`。

### 7.1 §5 六条验收 —— 逐条对照

| # | 验收条 | 结果 | 落地方式 / 用例 |
|---|---|---|---|
| ① | "我想死" → 先收 `crisis_modal`，全程无 `llm_start` / `llm_done` / tts 帧 | ✅ | gate 排在 **TTS 之前**（不只是 `llm_start` 之前）；block 直接 return。voice 套件「只发 crisis_modal, 内核 turn 一次都没跑」+「voice 模式 TTS 连接根本没起」+ 端到端例 |
| ② | warn → `llm_start` → 流式回复 → `crisis_toast`，时序不变 | ✅ | 前置 gate **只判不拦** warn（不推帧不写审计），toast 仍由内核侧发。voice 套件「判 warn → 帧序列与优化项之前一致」 |
| ③ | 普通咨询话术 → 完全正常，无任何额外帧 | ✅ | `pass` 一律放行。voice 套件「判 pass → 逐帧一致」 |
| ④ | PsyGUARD 挂掉 → 前置 gate 走本地词典兜底，block 仍能拦住 | ✅ | 复用**同一个** `RISK_PROBE` 实例 → D12 的 `fallback` 委托天然生效。adapter 套件「远端 503 → 委托本地词典 → 仍判 block, source=local_dict」 |
| ⑤ | 前置 gate 超时/异常 → 静默降级到现有流程 | ✅ | adapter 内部 catch → 放行；voice 层再兜一层 catch → 放行。adapter 套件「探测器抛错 → 放行」+ voice 套件「前置判定抛错 → 照常 llm_start…」 |
| ⑥ | engine-core git diff 为空 | ✅ | `git diff --stat HEAD -- src/engine-core` → 空 |

**§4 四条边界**：不重复写审计（前置 gate 不调内核 turn → 审计恒 1 条，**内核侧没加去重检查**）；
warn 场景不变；前置 gate 漏判兜底（内核侧 safety 判定一行未动）；
visitor_output 侧不动（只问 `counselor_input`）；monitored 照常置位。

### 7.2 与本单的三条偏差

1. **端口签名改成入参对象**（§3.1 的 `preCheckSafety?(text: string)` 不够用）：
   判成 block 后要推帧 / 写审计 / 置监测，三件事都要"本场"口径（会话 id、落库 id、学员 id、轮次、内核句柄）。
   只给 `text` → §3.3 的三条要求一条都落不了地。方法仍是**可选**的，返回值三档一字不差。
2. **危机帧由后端推**（不是 voice 层自己拼）：帧构造逻辑在 `engine-adapters/rendering/`，
   而 voice 层不能反向 import engine-adapters（成环）。分工改成"voice 层给出口回调、后端构造并推帧"，
   对前端是同一件事（第一帧就是 `crisis_modal`）。
3. **阻断轮仍记逐字稿**（"问" 有 / "答" 空，本单没提但必须做）：
   审计表 `turn_index` 与逐字稿下标必须同源（报告按 `(turnIndex-1)*2` 定位那条"问"）；
   且主单的 block 轮本来也写"问有答空"，两条路径形状要一致。

### 7.3 闸门实测

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | **0 error / 0 warning** |
| 新增套件（2 文件） | **19 例全通过** |
| 全量 `npx vitest run --exclude '**/e2e/**/*.ts'` | **64 文件 / 997 例全通过**（之前 62 文件 / 978 例） |
| `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

### 7.4 已知成本（诚实记录）

- **每轮多一次 PsyGUARD 调用**（两层各探一次，QPS ×2；超时上限 = 内核 `DEFAULT_PROBE_TIMEOUT_MS` = 500ms；
  远端不可达时走本地词典兜底 ≈ 不增延迟）。这是"双层防御"的直接代价；
  用 memo 合并成一次会破坏 §4 要的双层防御，建议独立后续单评估。
- **前置 gate 拦下时内核 turn 不执行** → 内核 `turnIndex` / BDI / 工作记忆不推进，
  学员那句危机表达不进内核工作记忆（语义上对，但与主单"内核照跑只跳过渲染"不同）。
- **审计 `turn_index` 两套口径**：前置路径用 voice 层轮次、内核路径用内核 `turnIndex`，
  正常轮次恒等，仅在 barge-in 之后错开（主单已存在的口径问题，本单不扩大改动面）。

### 7.5 commit

**未自动 commit。** 工作区还混着 WP14 主单的改动与 WP19-R 的遗留改动
（`test/admin-debug/wp19r-trace-wiring.spec.ts`，本优化项开始前就存在）——
真要 commit 建议分三次（WP19-R 遗留 → 主单 → 本优化项），或至少确认这三次的边界。
