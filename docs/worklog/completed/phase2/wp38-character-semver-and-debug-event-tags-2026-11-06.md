# WP38 · 角色版本 semver + 调试 trace eventTags + 调试会话恢复能力

> **状态**：✅ 已交付（2026-11-06）→ [`engine-wp38-character-semver-and-debug-event-tags-implementation-2026-11-06.md`](engine-wp38-character-semver-and-debug-event-tags-implementation-2026-11-06.md)
> **路径**：`docs/worklog/completed/phase2/wp38-character-semver-and-debug-event-tags-2026-11-06.md`
> **一句话**：角色版本从「简单自增 int」升级成 **semver**（major = 进行中锁定 / 有活跃会话改主版本返回 409，minor = 平滑，patch = 实时）+ `character_profile_versions` 历史快照表（每次改版留痕，可回溯）+ 会话创建时把角色与版本写进 `training_sessions`；调试 trace 接上**内核事件分类真值**（`eventTags` 数组 + 后端权威中文标签映射，覆盖内核全部 11 类）。
> ⚠️ **engine-core 改了 2 个文件**（本单预批准例外）：`EngineTurnOutput` 加可选字段 `events` + 内核 `turn()` 填它 —— **纯加只读观测字段，决策路径与数值逐字不变**，`boundary.spec.ts` 11 条断言全绿、公开面白名单零改动。
> 开工前先读 `docs/worklog/README.md`。
> 日期：2026-11-06
> 范围：① 角色版本 semver（主版本锁定 / 次版本平滑 / 修订实时 + 历史版本回溯）；② 调试 trace 加 `eventTags`（接内核事件分类真值）；③ 调试会话恢复能力（后端重启后可继续调试）
> 边界：engine-core **2 个文件**（预批准例外 —— `EngineTurnOutput` 加可选字段，纯加观测字段，不改任何决策与数值）

---

## 一、背景

### 1.1 角色版本 semver

**现状核实：**
- `character_profiles` 表已有 `version` 字段（int，默认 1），但只是**简单自增**——每次 update 就 +1，没有 semver 语义，也没有"进行中锁定"的概念
- 没有 major/minor/patch 三列
- 没有历史版本表（改了就覆盖，找不回来）
- `training_sessions` 表没有 `character_version` 字段（会话不绑定角色版本）

问题：

- **正在进行中的会话**用的是旧版本角色，管理员改了角色参数，旧会话会**突然变味**（信任基线从 0.3 变成 0.5，正在聊的来访者突然"信任度高了"）
- **没有历史版本**——改坏了找不回来，不知道之前是怎么配的
- **没有版本语义**——不知道这个改动是"小修小补"还是"大改"，能不能直接生效

需要把现有的简单自增 `version` 升级成 semver 机制：
- **主版本（major）**：进行中锁定——已有会话正在用这个版本，不能改主版本号（要改先新开版本）
- **次版本（minor）**：平滑——可以改，不影响已有会话（新会话用新版本）
- **修订（patch）**：实时——小改动（文案错别字、微调参数）实时生效

### 1.2 调试 trace 接引擎事件标签（后续单 D）

WP69 交付时 §2.5 登记的缺口：调试面板"事件分类" tab 想看"这一轮咨询师说了什么 techniques"（共情回应 / 开放提问 / 评判…），但 `EngineTurnOutput` 不带事件字段，适配层取不到真值。

**内核其实已经算出了事件分类**（`state-transition.ts:643`），只是没填进出参。本单补这个出口。

---

## 二、要做的事

### 2.1 角色版本 semver

**核心设计：**

1. **版本字段**：`character_profiles` 加 `major` / `minor` / `patch` 三列（默认 `1.0.0`）
2. **版本语义**：
   - **major（主版本）**：角色定位大改（依恋风格变了、核心信念变了）—— 进行中锁定：有会话正在用这个角色时，不能改 major（要改先"发布新版本"，旧会话继续用旧版本）
   - **minor（次版本）**：参数调整（信任基线微调、阻抗档位调整）—— 平滑：可以改，新会话用新版本，旧会话不受影响
   - **patch（修订）**：文案错别字、小参数微调 —— 实时生效
3. **历史版本表**：`character_profile_versions` 存历史版本（每次更新都存一份快照），可回溯
4. **会话绑定版本**：`training_sessions` 加 `character_version` 字段，会话创建时绑定当时的版本号，后续这个会话一直用这个版本的角色

**验收标准：**
- [ ] `character_profiles` 有 `major` / `minor` / `patch` 三列
- [ ] 有会话正在用某角色时，改 major 会被拒绝（返回 409）
- [ ] `character_profile_versions` 表存历史版本（每次更新都存一份）
- [ ] `training_sessions` 有 `character_version` 字段，会话创建时绑定
- [ ] 旧会话继续用旧版本角色，不受角色更新影响

### 2.2 调试 trace 接引擎事件标签（eventTags）

**核心设计（方案 A —— 内核加只读出口）：**

1. `src/engine-core/domain/engine-session.types.ts` —— `EngineTurnOutput` 加可选字段：
   ```ts
   /** 本轮咨询师事件分类（观测用，不参与决策） */
   readonly events?: readonly CounselorEventKind[];
   ```
2. `src/engine-core/in-memory/in-memory-engine-session.ts` —— `turn()` 里把已算出的 `events.map(e => e.kind)` 填进出参
3. `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— `TurnRenderResult` 透传该字段
4. `src/admin-debug/debug-session.service.ts` —— 读进 trace 的 `eventTags`（并给中文标签映射）

**为什么是方案 A：**
- 事件分类是内核的**唯一真相**，适配层预判 = 双胞胎（内核 DTO 已明令禁止）
- 纯加可选字段，不改任何既有字段与决策，`boundary.spec.ts` 断言⑥ 的公开面白名单**不用改**（`CounselorEventKind` 已在白名单里）

**验收标准：**
- [ ] `EngineTurnOutput` 有 `events?: readonly CounselorEventKind[]` 可选字段
- [ ] 内核 turn() 真的填了这个字段（有事件时非空）
- [ ] 调试 trace 里有 `eventTags: string[]`
- [ ] `boundary.spec.ts` 11 条断言全绿
- [ ] engine-core 只改 2 个文件（`engine-session.types.ts` + `in-memory-engine-session.ts`）

### 2.3 调试会话恢复能力（后端重启后可继续调试）

**现状问题：**
- 内核句柄（BDI 快照、记忆、轨迹）都在内存里，后端一重启就全丢了
- 持久化的只有消息记录，没有内核状态
- 结果：后端重启后，所有历史会话变成"只读"，不能继续调试

**核心设计：**

1. **持久化内核状态快照**：调试会话每轮结束后，额外存一份"内核状态快照"（BDI snapshot + 记忆 + 轨迹节点）到持久化文件里
2. **恢复接口**：加 `POST /admin/api/debug/session/:id/resume` —— 从持久化的快照重建内核句柄，恢复后就能继续聊
3. **前端对接**：active=false 的会话，显示一个「继续调试」按钮，点一下调 resume 接口，恢复后自动变成 active=true，就能继续发消息了

**边界：**
- 只影响**调试会话**（debug-session），真实用户的 `training_sessions` 不受影响——那是真结束了，不能继续
- 恢复后从最后一轮的状态继续聊，不是从头开始

**验收标准：**
- [ ] 调试会话每轮结束后，持久化文件里有内核状态快照
- [ ] 有 `POST /admin/api/debug/session/:id/resume` 接口，传入 sessionId 能恢复会话
- [ ] 后端重启后，调 resume 接口能恢复会话，继续发消息
- [ ] 恢复后的会话，BDI 状态和最后一轮一致（不是从头开始）

---

## 三、设计决策

### 3.1 角色版本 semver

**Q：为什么要会话绑定版本？**
A：不绑定的话，管理员改了角色参数，正在进行中的会话会"突然变味"——来访者的信任基线从 0.3 变成 0.5，正在聊的来访者突然"信任度高了"，这在临床场景里是不可接受的。

**Q：major 锁定怎么判定"正在用"？**
A：查 `training_sessions` 里 `character_template_id = ?` 且 `created_at >= 最近 major 发布时间` 的会话数量 > 0。

**Q：历史版本存什么？**
A：存完整快照（整个 `character_profiles` 行的内容 + 版本号 + 更新时间 + 更新人）。回溯时能看到"这个版本当时是怎么配的"。

### 3.2 eventTags

**Q：为什么是可选字段？**
A：向后兼容——不传 = 行为与之前逐字一致。`EngineTurnOutput` 的既有消费者不用改，只有调试面板那个消费者读这个字段。

**Q：为什么要动内核？**
A：事件分类锁在 `InMemoryEngineSession.turn()` 内部，适配层取不到真值（三条堵死路径见 WP69 交付记录 §2.5）。唯一干净的口径是内核加一个只读出口。

### 3.3 调试会话恢复能力

**Q：为什么只给调试会话加恢复能力，不给真实用户加？**
A：真实用户的场景里，访谈结束了就是结束了——这是临床伦理（不能中途重启）。调试场景不一样，开发者就是要反复调试，重启后要能继续接着聊。

**Q：恢复后从哪开始？**
A：从最后一轮的内核状态（BDI snapshot + 记忆 + 轨迹）继续，不是从头开始。这样调试体验是连贯的。

**Q：恢复接口安全吗？会不会误操作？**
A：前端加了「继续调试」按钮，用户手动点才会恢复——不是自动恢复。而且只影响调试会话，不影响真实用户数据。

---

## 四、闸门数字

```powershell
npx eslint "src/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit  # → 0 error
npx vitest run                    # → 全绿
git diff --stat HEAD -- src/engine-core   # → 2 个文件（预批准例外）
```

---

## 五、待确认问题

1. **major 锁定的判定粒度**：是"有任何会话在用这个角色"就锁定，还是"有活跃会话（未结束）在用"才锁定？建议是后者——已结束的会话不影响。
2. **历史版本的保留策略**：保留所有历史版本，还是只保留最近 N 个？建议是保留所有（单人开发阶段，数据量不大）。
3. **前端接线**：角色版本 semver 的前端展示（admin-dashboard 角色页加版本号 + 历史版本回溯入口）归前端 AI，后端只出接口。

---

_任务单写完，等大炮确认后开工。_
