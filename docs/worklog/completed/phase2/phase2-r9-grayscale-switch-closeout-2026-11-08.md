# R9 灰度切换开关 · Phase2 收尾任务

> **路径**：`docs/worklog/completed/phase2/phase2-r9-grayscale-switch-closeout-2026-11-08.md`
> **状态**：✅ 已交付 → 交付记录：[`phase2-r9-grayscale-switch-implementation-2026-11-08.md`](phase2-r9-grayscale-switch-implementation-2026-11-08.md)
> **优先级**：🔴 P0（Phase2 最后一个收尾任务）
> **创建日期**：2026-11-08
> **来源**：Phase2 代码级对账审计报告 §5.4 R9（`audits/phase2-code-vs-blueprint-audit-2026-11-08.md`）
> **蓝图依据**：`docs/architecture/hybrid-bdi-agent-blueprint-v1.0.md` §6 Phase 3A「两种模式可配置切换，不硬切」+ §7 红线提醒
> **定位说明**：本任务虽出自审计报告「Phase3 阻塞项 R9」，但本质是引擎能力建设的一部分——把影子模式升级到可配置生效，算 Phase2 的最后一块拼图。**做完本任务，Phase2 才正式封版；之后再规划 Phase3。**

---

## 一、背景

### 1.1 现在是什么状态

影子模式（PoC 期）已经做完：
- 开关 `ENGINE_DELIBERATION_ENABLED`（缺省关）
- 触发点：`TurnRenderOrchestrator.shadowDeliberation()`，旁路 fire-and-forget
- 结果只写 Redis trace 表，**不回写 BDI 状态**，不影响渲染

四道安全网全部做完：
- 逐维 delta cap（与规则算子同口径）
- 过期判定与丢弃（baseRevision vs currentRevision）
- cap 配置统一（env `ENGINE_CAP_*` 22 键，两侧同一份）
- 临床合理性校验观测版（只标记不拦截）

影子模式统计面板做完（后端接口 + 前端页面 + 时间窗口扩展）。

### 1.2 问题是什么

**现在只有"影子模式开关"，没有"规则 vs LLM 可配置切换"的开关。**

也就是说：
- 影子模式 = 审议跑，结果只观察，不生效
- 规则模式 = 审议不跑，完全走规则算子

但蓝图 Phase 3A 要求的是：
> 规则算子不够用的场景（新角色、复杂对话）→ 切 LLM 审议
> 伦理盲盒、标准化考核 → 继续用规则（保证可复现）
> **两种模式可配置切换，不硬切**

现在缺的就是"LLM 审议模式"——审议跑，结果真的生效。

### 1.3 为什么这是 Phase2 收尾任务

审计报告列了 6 个 Phase3 阻塞项，但 R9 不一样——它是**引擎能力本身**的缺口：
- 影子模式做完了，但只能观察不能生效
- 没有"LLM 审议真的生效"的开关，灰度验证就无从谈起

把它放在 Phase2 收尾做，原因：
1. **四道安全网已经做完了**（delta cap / 过期判定 / cap 配置统一 / 临床合理性校验），切生效的前提条件已经齐备
2. **它是引擎能力的一部分**，不是新功能——只是把已有的影子模式升级成可配置生效
3. **做完它，Phase2 才算真正封版**——引擎能力的最后一块拼图补齐

剩下的 5 个阻塞项（R4+R7 / R6 / R8+R12）才是真正的 Phase3 内容，做完 R9 之后再统一规划 Phase3。

---

## 二、目标

### 2.1 本单要做什么

**把审议从"旁路观察"升级到"可配置生效"，做一个企业级灰度切换开关。**

具体来说：
1. **内核加审议钩子端口**（`DeliberationHookPort`）—— 可注入的决策点，内核还是纯层
2. **适配层两个实现**：Noop（缺省，直接返回规则 delta）/ LLM（跑审议，返回修正后的 delta）
3. **生效模式开关**：shadow / rule_only / llm_active 三种模式可配置
4. **按用户灰度**：内测用户名单（env 配置），名单内用户走 LLM 审议模式，名单外走纯规则模式
5. **超时降级**：审议超过 N 秒就回退规则 delta，不能炸主流程
6. **场景路由接口留好**：端口/配置结构先定义，具体路由逻辑等 Phase4 场景类型建好了再接

### 2.2 本单不做什么（边界）

| 不做的 | 为什么 | 什么时候做 |
|---|---|---|
| 按场景类型路由（自由练习/全真执业/考核） | 现在代码里还没有这三种场景的区分机制（`VoiceSessionMode` 只有 text/voice） | Phase4（等场景类型机制建好了再接） |
| 按比例灰度（10% / 50% / 100%） | 内测期用户少，按名单灰度就够了 | 后续按需加 |
| 考核场景锁死纯规则 | 考核场景的区分机制还没建 | Phase4（等场景类型建好了再锁） |
| R4 可复现控制（锁温度/锁版本/逐字复现） | 另一个阻塞项 | 后续单 |
| R6 心理数据合规（审议 prompt 传原文） | 另一个阻塞项 | 后续单 |
| R8 上下文成本优化 | 另一个阻塞项 | 后续单 |

---

## 三、方案设计

### 3.1 核心思路：审议钩子端口

**为什么要在加端口？**

现在的管道是：
```
内核 turn() → 规则算子算 delta → cap → 应用到状态 → 渲染
```

要让 LLM 审议结果生效，有两种做法：
- A. 改内核 turn()，把规则算子换成 LLM 审议 —— 不行，硬切，不符合"可配置切换"
- B. 加一个可注入的决策点 —— 审议钩子，内核调用它，适配层提供实现

选 B。这样：
- 内核还是纯层（零 NestJS / 零网络 / 零 prompt）—— 审议钩子是纯函数端口
- 缺省实现 = Noop（直接返回规则 delta），零回归
- 要切 LLM 审议，换个实现就行

### 3.2 内核改动（engine-core）

**新增：审议钩子端口**

```typescript
// src/engine-core/runtime/deliberation-hook.port.ts
export interface DeliberationHookPort {
  /**
   * 审议钩子：对规则算子算出的 delta 做修正。
   * 
   * @param context 审议上下文
   * @returns 修正后的 delta（如果不需要修正，返回原 delta）
   */
  applyDeliberation(
    context: DeliberationHookContext
  ): Promise<DeltaVector>;
}

export interface DeliberationHookContext {
  readonly snapshot: BdiSnapshot;        // 当前状态（本轮开始时的）
  readonly ruleDelta: DeltaVector;       // 规则算子算出的 delta（已过 cap）
  readonly counselorText: string;        // 咨询师本轮文本
  readonly visitorText?: string;        // 来访者渲染文本（可选）
  readonly sessionKind: SessionKind;     // 会话类型（预留，Phase4 用）
}

export type SessionKind = 'freeform' | 'full_simulation' | 'exam' | 'unknown';
```

**改动：`in-memory-engine-session.ts` 的 turn()**

在第 5 步（总 delta 算出来之后、应用到状态之前）插入：

```typescript
// 第 5 步：总 delta = eventDelta + trajectoryDelta → cap
const totalDelta = trajectory.delta ? addDeltaVectors(eventDelta, trajectory.delta) : eventDelta;
const cappedTotal = capTurnDelta(totalDelta, this.capConfig);

// 【新增】第 5.5 步：审议钩子（如果有）
let finalDelta = cappedTotal;
if (this.deliberationHook) {
  try {
    finalDelta = await this.deliberationHook.applyDeliberation({
      snapshot: base.snapshot,
      ruleDelta: cappedTotal,
      counselorText: userText,
      sessionKind: runtime.sessionKind ?? 'unknown',
    });
    // 审议结果再过一次 cap（约束校验层）
    finalDelta = capTurnDelta(finalDelta, this.capConfig);
  } catch (err) {
    // 审议挂了就用规则兜底，不能炸主流程
    finalDelta = cappedTotal;
    // warn 日志记一下，但不打心理内容
  }
}

// 第 6 步：用最终 delta 应用到状态
const nextSnapshot = applyBeliefEvolution(applyDeltaVector(base.snapshot, finalDelta), userText);
```

**关键：**
- 审议钩子是**可选注入**的 —— 缺省不注入 = Noop = 行为与现在逐字一致（零回归）
- 审议是**同步**的（await）—— 状态是原子更新的，渲染基于最终状态
- 审议失败 → 回退规则 delta —— 不炸主流程

**engine-core 红线确认：**
- ✅ 零 NestJS / 零网络 / 零 prompt —— 审议钩子是纯函数端口
- ✅ 只加可选字段 / 可选方法 —— 不传 = 行为逐字不变
- ✅ 边界断言同步更新（白名单加新文件）

### 3.3 适配层改动（engine-adapters）

**两个审议钩子实现：**

| 实现 | 行为 | 用途 |
|---|---|---|
| `NoopDeliberationHook` | 直接返回 `context.ruleDelta`，什么都不做 | 缺省实现 / 纯规则模式 |
| `LlmDeliberationHook` | 跑 LLM 审议，拿到 LLM delta，返回修正后的 delta | LLM 审议模式 |

**`LlmDeliberationHook` 的行为：**
1. 把规则 delta + 当前状态 + 咨询师文本组装成审议入参
2. 调用现有的 `LlmDeliberationService`（影子模式那个服务，复用）
3. 拿到审议结果（LLM delta）
4. 做格式校验（复用现有的）
5. 做过期判定（复用现有的：baseRevision vs currentRevision）
6. 如果校验通过 → 返回 LLM delta
7. 如果校验失败 / 超时 / 异常 → 返回原 ruleDelta（兜底）

**生效模式开关（新增 env）：**

```
ENGINE_DELIBERATION_EFFECTIVE_MODE=shadow|rule_only|llm_active
```

| 值 | 含义 | 行为 |
|---|---|---|
| `shadow`（缺省） | 影子模式 | 审议跑，结果只进 trace，不生效（现状） |
| `rule_only` | 纯规则模式 | 审议不跑，完全走规则算子 |
| `llm_active` | LLM 生效模式 | 审议跑，结果真的生效 |

**按用户灰度（新增 env）：**

```
ENGINE_DELIBERATION_GRAYSCALE_USER_IDS=user1,user2,user3
```

名单内的用户走 LLM 审议模式，名单外的用户走纯规则模式。

**判定逻辑：**
```
最终模式 = 全局生效模式 × 用户灰度
  - 如果全局 = rule_only → 所有用户都走 rule_only
  - 如果全局 = shadow → 所有用户都走 shadow（现状）
  - 如果全局 = llm_active → 按用户灰度
    - 名单内用户 → llm_active
    - 名单外用户 → rule_only
```

**超时降级（新增 env）：**

```
ENGINE_DELIBERATION_TIMEOUT_MS=3000
```

审议超过 3 秒就超时，回退规则 delta。

**场景路由接口（预留）：**

配置结构先定义好，但具体路由逻辑等 Phase4 场景类型建好了再接：

```typescript
// 预留：Phase4 接场景路由
interface ScenarioRouteConfig {
  freeform: 'shadow' | 'rule_only' | 'llm_active';
  full_simulation: 'shadow' | 'rule_only' | 'llm_active';
  exam: 'shadow' | 'rule_only' | 'llm_active';  // 考核永远 rule_only
}
```

本单只定义类型，不接路由逻辑。

### 3.4 装配层改动（engine.providers.ts）

根据生效模式开关 + 用户灰度，决定注入哪个审议钩子实现：
- shadow → NoopDeliberationHook（影子模式的旁路逻辑还在 TurnRenderOrchestrator 里，不变）
- rule_only → NoopDeliberationHook
- llm_active + 名单内用户 → LlmDeliberationHook
- llm_active + 名单外用户 → NoopDeliberationHook

---

## 四、交付物

### 4.1 代码改动

| 文件 | 改什么 |
|---|---|
| `src/engine-core/runtime/deliberation-hook.port.ts` | 新建：审议钩子端口定义 |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | 改：turn() 接入审议钩子（可选注入） |
| `src/engine-core/index.ts` | 改：导出新端口类型 |
| `test/engine-core/boundary.spec.ts` | 改：边界断言白名单加新文件 |
| `src/engine-adapters/deliberation/noop-deliberation.hook.ts` | 新建：Noop 实现 |
| `src/engine-adapters/deliberation/llm-deliberation.hook.ts` | 新建：LLM 实现（复用现有 LlmDeliberationService） |
| `src/engine-adapters/deliberation/deliberation-mode.config.ts` | 新建：生效模式开关 + 用户灰度 + 超时配置 |
| `src/engine-adapters/wiring/engine.providers.ts` | 改：装配层根据开关注入对应实现 |

### 4.2 测试

| 测试 | 覆盖什么 |
|---|---|
| `deliberation-hook.port.spec.ts` | 内核：Noop 注入时行为逐字不变（零回归） |
| `llm-deliberation.hook.spec.ts` | 适配层：LLM 钩子正常路径 / 格式非法兜底 / 超时兜底 / 过期兜底 |
| `deliberation-mode.config.spec.ts` | 适配层：生效模式开关 + 用户灰度判定逻辑 |

### 4.3 文档

| 文档 | 内容 |
|---|---|
| 本任务单 | `pending/phase3-r9-grayscale-switch-2026-11-08.md` |
| 交付记录 | `completed/phase3/r9-grayscale-switch-implementation-2026-11-08.md` |
| README.md | §0 加 Phase3 开工状态行 |

---

## 五、闸门（验收标准）

### 5.1 测试闸门

| 闸门 | 要求 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | 0 error |
| `npx vitest run --reporter=dot` | 全量测试全绿（不红不增 skip） |
| `npx eslint src/engine-core/ src/engine-adapters/deliberation/ --max-warnings 0` | 0 error / 0 warning |
| `npx vitest run test/engine-core/boundary.spec.ts --reporter=dot` | 边界断言全绿 |
| `git diff --stat HEAD -- src/engine-core` | 只加了端口文件 + turn() 可选注入 + barrel 导出，决策逻辑零改动 |

### 5.2 功能闸门

| 闸门 | 要求 |
|---|---|
| 缺省行为零回归 | `ENGINE_DELIBERATION_EFFECTIVE_MODE` 缺省 = shadow，行为与改造前逐字一致 |
| Noop 注入零回归 | 不传审议钩子 = 行为与改造前逐字一致 |
| 审议失败兜底 | LLM 审议异常 / 超时 / 格式非法 → 回退规则 delta，主流程不炸 |
| 用户灰度生效 | 名单内用户走 LLM 审议，名单外走纯规则 |
| 超时降级生效 | 审议超过 3s → 超时兜底 |

### 5.3 红线闸门

| 闸门 | 要求 |
|---|---|
| engine-core 永久红线 | 零 NestJS / 零网络 / 零 prompt |
| 零回归 | 缺省配置下，所有现有测试逐字通过 |

---

## 六、偏差说明要求

如果开发期间发现更合理更专业的方案，可以按后端的来，但要在交付记录里写明：
- 原方案是什么
- 实际做的是什么
- 为什么改（理由）

---

_本单为 Phase3 第一个任务：灰度切换开关。_

---

## 七、交付结论（2026-11-08）

✅ **已交付**。交付记录：[`phase2-r9-grayscale-switch-implementation-2026-11-08.md`](phase2-r9-grayscale-switch-implementation-2026-11-08.md)

**闸门实测**：tsc **0 error** · 全量 **145 文件 / 2375 例 / 2356 passed / 19 skipped / 0 failed**（90.56s，连跑 2 次全绿）· eslint **0 error / 0 warning** · boundary **12 用例全绿** · engine-core diff **2 文件 +78/-1 + 1 新文件**（用户明确批准的例外）。

**⚠️ 本单与任务单有 13 处偏差**（全部记在交付记录 §五「偏差说明」表里，逐条写明「任务单怎么写的 / 实际做的 / 为什么改」）。其中三条最要紧的：

1. **端口是同步的、审议两拍分离**（任务单原文是 async + 内核 await）—— 语音对练每轮 await 一个 LLM 往返会毁掉实时对话节奏；代价是**建议滞后一轮**，已写进端口契约与测试；
2. **按会话灰度**（任务单原文是按用户）—— 内核会话端口是单例，装配期拿不到当前用户；且同一场会话内模式必须恒定（否则状态轨迹不可复现）；
3. **内核必然出现 "deliberat" 字样** → WP65–68 的 4 条粗粒度断言被**收紧**为精确断言（白名单三处 + 端口零实现 + 端口零外部引用），不弱化、不 skip、不删用例。

**缺省口径**：不配任何 env = **纯规则**，与改造前逐字一致；生效路径要显式开 `ENGINE_DELIBERATION_ENABLED=true` + `ENGINE_DELIBERATION_EFFECTIVE_MODE=llm_active` 才会被装配。
