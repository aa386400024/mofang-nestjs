# WP12 · 记忆收尾 + 跨会话 resume 接线

> 日期：2026-10-30 ｜ 状态：**已交付** ｜ 前置：WP2（内核记忆纯函数已交付）
> 并行：可与 WP11 并行（两者零交集）
> 🔴 **本 WP 的核心不是补技术细节，是打通"学员第二次打开同一角色，引擎记得上次"这条产品链路**
> 📄 交付记录：[`engine-wp12-memory-closeout-resume-wiring-backend-2026-10-30-implementation-2026-10-30.md`](./engine-wp12-memory-closeout-resume-wiring-backend-2026-10-30-implementation-2026-10-30.md)

---

## 0. 一句话目标

把 WP2 交付时标注的 Qdrant 写侧缺口补上，加短时摘要晋升长时的编排，**并把 `resumeFromSessionId` 从握手 query 一路传到 `engine.open()`**——让学员关掉 App 第二天再打开同一个角色，来访记得上次核心议题，不是陌生人。

---

## 1. 范围

### 1.1 Qdrant 写侧冲突标记（补 WP2 缺口）

**现状**：`QdrantService` 只有 upsert + search，没有 setPayload（只改 payload 不改向量）和 scroll（按 filter 取点）。

**要做**：
- `QdrantService` 加 `setPayload(pointId, payload)` 方法
- `QdrantService` 加 `scroll(filter, limit)` 方法（按 visitorId 取该角色全部记忆点）
- `QdrantMemoryStore` 接内核已有的 `resolveConflict` / `applyConflictResolution`：写新记忆前，先 scroll 同 visitorId 的旧记忆，冲突的旧点在 payload 上标 `supersededBy: newPointId`
- **不物理删除**旧点（M4 约定）

### 1.2 短时摘要 + 会话结束晋升长时

**现状**：短时记忆在内存里，会话结束就丢了。

**要做**：
- 会话结束（`closeSession`）时，把本场 transcript 喂给 LLM 生成一段 200 字以内的摘要（"来访者核心议题 + 情绪基调 + 关键转折"）
- 摘要作为一条 `LONG_TERM` 记忆写入 Qdrant（scope=visitor，按 visitorId 归属）
- 复用内核 `promoteShortTermToLongTerm` 纯函数
- **摘要生成失败不阻断 closeSession**：记 warn，会话正常结束，只是这条记忆没晋升

### 1.3 衰减半衰期 + 召回阈值配置化

**现状**：种子值写死在代码里。

**要做**：
- 衰减半衰期：默认 30 天，从环境变量 `MEMORY_DECAY_HALF_LIFE_DAYS` 读
- 召回阈值：默认 0.1，从环境变量 `MEMORY_RECALL_THRESHOLD` 读
- 集中在一个 `memory-config.ts` 里导出，不散落
- **不做**：动态调参 / 按角色差异化配置（Phase2）

### 1.4 逐字稿落库口径写死

**现状**：`EngineStreamBackend.transcripts` 是进程内 `Map`，进程重启就丢。

**要做**：
- `closeSession` 时，把本场逐字稿快照写入报告库（复用 WP18 报告链路的 transcript 表）
- **不依赖内存 Map 扛进程重启**：close 时必须落库，不落库就报错
- 单实例 Phase1 可接受，但落库边界写死，不留模糊

### 1.5 🔴 跨会话 resume 接线（本 WP 核心）

**现状**：`EngineStreamBackend.openSession()` 调 `engine.open()` 时**从来没传过 `resumeFromSessionId`**。学员第二次打开同一角色，引擎完全不记得上次。

**要做**：

1. **握手 query 加 `resumeFromSessionId`**（可选）：
   - 前端不传 = 新会话（现状逐字一致）
   - 前端传 = 要接续上一场

2. **`VoiceTurnBackendOpenOptions` 加 `resumeFromSessionId?: string`**

3. **`EngineStreamBackend.openSession()` 把它传给 `engine.open()`**：
   ```ts
   ...(opts.resumeFromSessionId
     ? { resumeFromSessionId: opts.resumeFromSessionId }
     : {}),
   ```

4. **resume 时的行为**（内核已支持，本轮只接线）：
   - 内核搬上一场 BDI 快照（情绪/阻抗/移情基线）
   - 内核按 visitorId 召回 Qdrant 长时记忆 Top5
   - 开场首论带 `openingContext`（"上次我们聊到了……"）

5. **resume 失败不阻断**：
   - 上一场 sessionId 不存在 / 已过期 / 记忆召回失败 → 记 warn，按新会话开
   - **不抛错、不断连**

6. **前端配合**：
   - 前端在"继续训练"入口带上次 sessionId
   - 本期前端可以先不做 UI，后端链路先通，用 curl/Postman 验证

---

## 2. 不做（红线）

| 不做 | 理由 |
|---|---|
| 不改 `src/engine-core/**` | 内核纯函数已交付，本轮只在适配层接线 |
| 不做竞争抑制遗忘精细权重 | Phase2 |
| 不做 Chinese-MentalBERT 专用向量 | Phase2 评估 |
| 不做跨设备同步 | 单实例 Phase1 |
| 不做记忆编辑/删除 UI | 后期 admin 再说 |
| 不做摘要的人工审核 | 工程种子值，标注待专业复核 |
| 不强制前端本期就做"继续训练"入口 | 后端链路先通，前端后接 |

---

## 3. 验收

1. **新会话**（不传 resumeFromSessionId）→ 行为与现状逐字一致
2. **同角色第二次开场**（传上次 sessionId）→ 来访开场首论提到上次核心议题（openingContext 非空）
3. **resume 一个不存在的 sessionId** → 不报错，按新会话开，日志有 warn
4. **会话结束** → transcript 落库 + 摘要晋升长时记忆（Qdrant 可查到）
5. **Qdrant 写新记忆时** → 同 visitorId 的旧冲突记忆被标 `supersededBy`
6. **摘要生成失败** → closeSession 正常完成，只是没晋升，日志有 warn
7. `tsc -p tsconfig.build.json --noEmit` 0 错
8. `git diff --stat HEAD -- src/engine-core` 为空
9. 新增单测：resume 成功 / resume 不存在 / 摘要失败 / 冲突标记 四种场景

---

## 4. commit 文案

```text
feat(engine): WP12 Qdrant 写侧冲突标记 + 短时摘要晋升长时 + openSession 传 resumeFromSessionId 打通跨会话记忆接续
```

---

## 5. 交付摘要（2026-10-30）

📄 **完整交付记录**：[`engine-wp12-memory-closeout-resume-wiring-backend-2026-10-30-implementation-2026-10-30.md`](./engine-wp12-memory-closeout-resume-wiring-backend-2026-10-30-implementation-2026-10-30.md)

**§1 五小节全部落地**：Qdrant 补 `setPayload` + `scroll`（写侧先 scroll 再 upsert，走内核 `applyConflictResolution` 选存活者，旧点标 `supersededBy`，**不物理删除**）；会话结束把逐字稿喂 LLM 产摘要 → 构造 SHORT_TERM → 内核 `promoteShortTermToLongTerm` → 晋升长时记忆（**失败只记 warn，不阻断 closeSession**）；逐字稿 close 时**全量定稿**落库（不只靠进程内 Map 扛重启）；半衰期 / 召回阈值集中到 `memory-config.ts`（env 可读，非法值回退）；**🔴 `resumeFromSessionId` 从握手 query 一路传到 `engine.open()`**。

**三处与任务单字面不同（已在交付记录 §6 显式说明）**：

1. **长时记忆作用域从「角色」改成「学员 + 角色」**（超出字面，**但不改就是隐私事故**）：内核 `visitorId` 是跨会话归属键，而角色 key 对所有学员相同 —— 只用角色 key，学员 A 的咨询摘要会被学员 B 召回。落法 `学员id:角色key`；**无学员身份时干脆不写长时记忆**。对外 `persona.id` 仍为 personaId，渲染与决策零变化。
2. **§1.3 配置化只到 B 层**：红线禁改内核，内核那道 30 天 / 0.1 的地板**不可绕过** → env 阈值**只能收紧**；默认配置下与现状逐字一致。
3. **逐字稿原本就已每轮落库**：§1.4 的真实缺口是 **close 时的全量定稿（覆盖语义）**，补上增量写入失败的那些轮次 + 明确落库边界。

**闸门**：`tsc` **0 错** / eslint **0 error 0 warning** / `git diff --stat HEAD -- src/engine-core` **为空**（内核整树零改动）/ WP12 新增套件 **35 例全绿** / engine-adapters+engine-core+voice **28 套件 583 例全绿** / 全量 **57 套件 907 例中 905 例通过**（唯一失败 = `test/counselor/drill-judge.spec.ts` **2 例既有债**，与 WP11 交付记录同两例，非本轮引入）。

**未做（红线）**：不改内核 / 不做竞争抑制遗忘精细权重 / 不做 Chinese-MentalBERT / 不做跨设备同步 / 不做记忆编辑删除 UI / 不做摘要人工审核（工程种子值，已标注待专业复核）/ 不强制前端本期做「继续训练」入口（后端链路已通，前端接上 `resumeFromSessionId` 即可）。

**未自动 commit / push**：改动都在工作区，提交与否由用户决定。
