# 过期判定与丢弃 · 审议结果快照版本校验

> 状态: ✅ 已交付
> 交付记录: [`engine-deliberation-stale-check-implementation-2026-11-07.md`](engine-deliberation-stale-check-implementation-2026-11-07.md)
> 先读 `docs/worklog/README.md` 和 `docs/README.md` 确认后端当前阶段与模块边界。

## 一、为什么做这个（问题与目标）

### 背景

影子模式下审议结果不写 BDI 快照，只写 Redis trace。但**切灰度（审议结果开始生效）之前必须补过期判定**——否则 LLM 审议是异步的（BullMQ 队列跑），等它跑完的时候，快照可能已经被规则算子更新过了（用户又说了一句话，又跑了一轮）。这时候把旧快照的 delta apply 到新快照上，就会导致状态错乱。

### 现状

WP65 后半段已经把**快照版本号透传**做完了：
- 内核 `EngineTurnOutput.revision` 透传到门面
- 门面把它当 `baseRevision` 传进审议入参（`DeliberationShadowInput.baseRevision`）
- trace 里也记了 `baseRevision`（`DeliberationTraceRecord.baseRevision`）

**但现在只传了、记了，没有做判定**——审议跑完后，不知道"当前快照的 revision 是多少"，没法对比。

### 目标

切灰度前置安全网：审议跑完后，load 一次当前快照的 revision，对比 baseRevision。不一致 = 快照变了 = 审议结果过期了。

**影子模式下只是观测**——trace 里记过期率，切灰度后再用这个判定决定"要不要 apply 审议结果"。

---

## 二、开工前核实清单（8 条，开工前逐条自己 grep 确认）

> ⚠️ 这 8 条是大炮扫完代码后整理的，后端开工前必须自己再 grep 一遍核实，不能只凭这份清单。

| # | 核实项 | 确认方式 |
|---|---|---|
| 1 | `DeliberationShadowInput.baseRevision` 已经存在 | ✅ 已确认（`llm-deliberation.service.ts:194`） |
| 2 | `DeliberationTraceRecord.baseRevision` 已经存在 | ✅ 已确认（`llm-deliberation.service.ts:581`） |
| 3 | `BdiStateRepository` 已经在 engine.module 里提供了 | ✅ 已确认（`engine.module.ts:300`，`bdiStates: BdiStateRepository`） |
| 4 | 仓储的 `load()` 返回的 `BdiStateRecord` 里有 `revision` 字段 | ✅ 已确认（`engine-core/domain/ports/bdi-state.repository.ts:54`） |
| 5 | 审议 Service 现在没注入 `BdiStateRepository` | ✅ 已确认（constructor 只有 llmJson / config / redis） |
| 6 | baseRevision 的口径是 **R1 = 本轮落库后的版本**，不是 R0 | ✅ 已确认（`llm-deliberation.service.ts:186-192` 的注释） |
| 7 | `buildSuccessRecord` 和 `buildFailureRecord` 两个函数都在写 trace | ✅ 已确认（`llm-deliberation.service.ts:1177` 和 `:1215`） |
| 8 | `tenantId` 和 `sessionId` 在 `DeliberationShadowInput` 里都有 | ✅ 已确认（load 需要这两个参数） |

---

## 三、技术方案

### 核心思路

审议跑完后，`load()` 一次当前快照的 revision，对比 baseRevision：
- `currentRevision === baseRevision` → 没过期（中间没别的轮次）
- `currentRevision > baseRevision` → 过期了（中间又跑了几轮）
- `currentRevision < baseRevision` → 不可能（防御性处理）

### 为什么锚 R1 而不是 R0

注释里写得很清楚（`llm-deliberation.service.ts:186-192`）：
- R1 = 本轮**落库后**的版本；本轮开始时的那份（baseSnapshot）是 R0 = R1 - 1
- 锚 R1 是因为过期判定是"回来时的当前版本 == 本字段"：审议在本轮落库**之后**才入队，回来时当前版本必然 >= R1
- 锚 R0 会让判定永远为"过期"（回来时已经是 R1 了）

### 保守兜底原则

- load 失败（Redis 挂）→ `currentRevision: null`，`stale: false`（宁可误判没过期，不误判过期）
- load 返回 null（会话不存在）→ 同上
- 为什么保守？因为影子期只是观测，误判过期会让你以为"很多审议都过期了"，导致切灰度决策偏保守；误判没过期只是少记几条，不影响大局

---

## 四、写入侧（详细设计）

### 4.1 新增依赖注入

**位置**：`LlmDeliberationService` 的 constructor

**改动**：加一个参数 `private readonly bdiStates: BdiStateRepository`

**为什么**：要 load 当前快照的 revision，必须通过仓储端口。DI 会自动从 engine.module 里拿。

### 4.2 新增私有方法：`checkStale`

**位置**：`LlmDeliberationService` 内部

**职责**：load 当前快照的 revision，对比 baseRevision，返回判定结果。

**接口**：
```typescript
/**
 * 过期判定: 审议回来时, 快照是不是还在 baseRevision 那个版本.
 *
 * 影子期只是观测, 切灰度后用这个判定决定"要不要 apply 审议结果".
 * 保守兜底: load 失败 / 会话不存在 → 判没过期 (宁可误判, 不误杀).
 */
private async checkStale(
  tenantId: string,
  sessionId: string,
  baseRevision: number,
): Promise<{ stale: boolean; currentRevision: number | null }>
```

**逻辑**：
1. try { `const record = await this.bdiStates.load(tenantId, sessionId)` }
2. catch { return `{ stale: false, currentRevision: null }` }
3. 如果 `record === null` → 同上
4. 如果 `record.revision > baseRevision` → `{ stale: true, currentRevision: record.revision }`
5. 否则 → `{ stale: false, currentRevision: record.revision }`

### 4.3 调用点：`buildSuccessRecord` 之前

**位置**：`executeShadowMode` 里，LLM 跑完、格式校验通过、cap 砍幅做完之后，`buildSuccessRecord` 之前。

**流程**：
1. 现有：LLM 调用 → 格式校验 → cap 砍幅
2. **新增**：`const { stale, currentRevision } = await this.checkStale(input.tenantId, input.sessionId, input.baseRevision)`
3. 把 `stale` 和 `currentRevision` 传进 `buildSuccessRecord`
4. `buildSuccessRecord` 把这两个字段塞进 trace

### 4.4 trace 加字段：`stale` + `currentRevision`

**位置**：`DeliberationTraceRecord` 接口

**改动**：
```typescript
export interface DeliberationTraceRecord {
  // ... 现有字段 ...

  /**
   * 过期判定: 审议回来时, 快照是不是还在 baseRevision 那个版本.
   *
   * true = 中间又跑了几轮, 审议结果是基于旧快照做的, 切灰度后应该丢弃.
   * false = 没过期, 或者判定失败 (保守兜底).
   */
  readonly stale: boolean;

  /**
   * 审议回来时读到的当前快照 revision.
   *
   * null = load 失败 / 会话不存在 (保守兜底).
   */
  readonly currentRevision: number | null;
}
```

**注意**：
- `buildFailureRecord` 也要填这两个字段：`stale: false` + `currentRevision: null`（失败轮次不用判过期，形状一致就行）

---

## 五、读取侧（详细设计）

本期**不新增 admin 查询接口**——`stale` 和 `currentRevision` 直接出现在 Redis trace 的 JSON 里，现有的 debug 面板查 trace 的接口已经能看到。

---

## 六、开关与配置

### 6.1 现有开关复用

- `ENGINE_DELIBERATION_ENABLED`——审议总开关，关着就啥都不跑（包括过期判定）
- 不需要新增 env 开关——过期判定是审议的内部机制，审议开了就该有

---

## 七、隐私与安全

1. **stale / currentRevision 里只有数字**——版本号，不是心理内容
2. **日志只出定位信息**——过期是正常观测，不打对话原文
3. **租户隔离**——load 时传了 tenantId，不会串号

---

## 八、反双胞胎（刻意不做的事）

1. **不做"过期了就重试"**——影子期只是观测，切灰度后过期的就直接丢弃，不重跑
2. **不做"过期率告警"**——trace 里有数据就行，切灰度前真出问题了再加告警
3. **不做 admin 前端面板**——trace 里已经有了，debug 面板能查
4. **不改内核**——直接用现有的 `BdiStateRepository.load()`，不动内核代码
5. **不做"过期算失败"**——过期不算审议失败，不影响熔断器（熔断器统计的是 LLM 调用失败次数）
6. **不替换现有的 baseRevision 透传**——WP65 后半段已经做了，本单只是加判定

---

## 九、闸门（验收标准）

| # | 闸门 | 要求 |
|---|---|---|
| 1 | ESLint | 0 problem |
| 2 | TypeScript | 0 error |
| 3 | 单测 | 全量跑通，不新增失败 |
| 4 | engine-core | 零改动（直接用现有的 BdiStateRepository.load()） |
| 5 | 判定口径 | currentRevision > baseRevision → stale: true |
| 6 | 边界 | currentRevision === baseRevision → stale: false |
| 7 | 兜底 | load 失败 / 会话不存在 → stale: false + currentRevision: null |
| 8 | trace 形状 | 成功 / 失败两种情况下 trace 形状一致（都有 stale + currentRevision） |

---

## 十、交付物清单

1. **新增依赖注入**：`LlmDeliberationService` 加 `bdiStates: BdiStateRepository`
2. **新增私有方法**：`checkStale()`
3. **调用点**：`buildSuccessRecord` 之前加一步过期判定
4. **trace 加字段**：`DeliberationTraceRecord` 加 `stale` + `currentRevision`
5. **单测**：`test/engine-adapters/wp-deliberation-stale-check.spec.ts`

### 交付后回写文档（与之前 WP 同款）

| 文件 | 改什么 |
|---|---|
| `docs/worklog/pending/deliberation-stale-check-2026-11-07.md` | 状态行改 ✅ + 指向交付记录，然后移到 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | 切灰度前置剩余清单里，"过期判定与丢弃"那条打 ✅ |
| `docs/worklog/README.md` | Phase2 已开工列表加一条 |

---

## 十一、commit message 草稿

```
feat(deliberation): 过期判定与丢弃 - 审议结果快照版本校验

审议跑完后 load 一次当前快照 revision, 对比 baseRevision.
不一致 = 快照变了 = 审议结果过期了.
切灰度前置安全网, 影子模式下只是观测.
保守兜底: load 失败判没过期, 不误杀.
```

---

## 十二、交付后补记（偏差表）

> 交付记录: [`engine-deliberation-stale-check-implementation-2026-11-07.md`](engine-deliberation-stale-check-implementation-2026-11-07.md)
> 本单**任务单 §二 的 8 条核实清单已逐条自己 grep 核实** —— 其中**第 3 条任务单写错了**（见 B1）。

| # | 偏差 | 任务单怎么写的 | 代码实际是什么 | 怎么改的 | 为什么 |
|---|---|---|---|---|---|
| B1 | **DI 注入方式**（最重要） | §二 第 3 条："`BdiStateRepository` 已经在 engine.module 里提供了（`engine.module.ts:300`, `bdiStates: BdiStateRepository`）"；§4.1："加一个参数 `private readonly bdiStates: BdiStateRepository`" | `engine.module.ts:300` 是 `ENGINE_SESSION_PORT` 的 **useFactory 形参类型标注**，**不是 provider 注册**。真正的 provider 在 `:277`，token 是 **Symbol** `ENGINE_BDI_STATE_REPOSITORY` | 改成 `@Inject(ENGINE_BDI_STATE_REPOSITORY) private readonly bdiStates: BdiStateRepository` | `BdiStateRepository` 是 **interface**，编译后没有运行时值，当不了 token。裸写类型会让 Nest 按 `design:paramtypes` 找名为 `Object` 的 provider → **静默注入 undefined** → 判定恒走兜底 → **过期率恒为 0 且不报错**。先例：`admin-debug/debug-kernel-state.ts:342`（同一个 token、同一个写法）。装配层零改动（provider 与 exports 早就存在） |
| B2 | 判定插入位置 | §4.3："LLM 跑完、格式校验通过、cap 砍幅做完之后，`buildSuccessRecord` 之前" | cap 砍幅是在 `buildSuccessRecord` **内部**做的（delta-cap 那单的结构性设计）—— 代码里没有独立的"cap 做完"这一步 | 插在 `resolveLock` 之后、`buildSuccessRecord` 之前 | 语义与 §4.3 一致；放在 `resolveLock` 后是让"读当前 revision"离"写 trace"更近，判定更准 |
| B3 | 兜底的实现形态 | §4.2 只写了"catch → `{ stale: false, currentRevision: null }`" | `RedisBdiStateRepository.load()` 在底层不可达时**抛 `EngineCoreError(STORAGE_FAILURE)`**（不是返回 null） | try/catch **同时**覆盖"抛错"与"返回 null"两种兜底 | 漏了 catch 分支 = Redis 挂时审议层直接炸（影子期也不该炸主流程） |
| B4 | 失败轮次 | §4.4："`buildFailureRecord` 也要填 `stale: false` + `currentRevision: null`" | 一致 | 照办 | 失败轮次没有结果可丢弃，但 trace 形状必须一致（消费方不用判分支） |
| B5 | 判定方向 | §三 列了 `==` / `>` / `<` 三种 | 一致 | 严格 `>` 判过期；其余（含 `<`）判没过期 | `<` 在真实链路不可能发生；真出现说明有未预料状态 → **保守**（判没过期）比激进安全 |

**闸门实跑**：lint **0 error** / `tsc -p tsconfig.build.json --noEmit` **0 error** / 全量单测 **126 文件 2152 例全绿**（基线 125 文件 2136 例，+1 文件 +16 例，既有零失败）/ `boundary.spec.ts` **12 例全绿** / `git diff --stat HEAD -- src/engine-core` **空**。
