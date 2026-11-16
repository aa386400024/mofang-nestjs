# WP58 后半段 · 事件 + delta 审计观测

> 状态: ✅ 已交付（2026-11-06）→ [engine-wp58-turn-delta-audit-implementation-2026-11-06.md](engine-wp58-turn-delta-audit-implementation-2026-11-06.md)
> 先读 `docs/worklog/README.md` 和 `docs/README.md` 确认后端当前阶段与模块边界。

## 一、为什么做这个（问题与目标）

### 现状痛点

1. **只有被砍的才记，没被砍的无痕**——现在 `delta-cap.logger.ts` 只在 cap 砍幅时打 warning，每维度一条。没被砍的轮次完全没有观测记录，"这一轮到底触发了什么事件、改了多少分"全靠日志翻。
2. **调试会话能看，正式会话看不到**——`debug-session.service.ts` 每轮返回完整 delta 明细，但只在 HTTP 响应里、不落库、只对调试会话有效。正式训练会话出问题，没法按 sessionId 检索。
3. **只有日志，不可查询**——cap 日志散在终端里，没法按 sessionId / turnIndex 检索、没法聚合统计。

### 目标

正式训练会话也能按 sessionId 查询"每一轮触发了什么事件、每个事件命中了哪些词、原始 delta 是多少"，为切灰度后排错、督导报告、成长档案提供数据底座。

---

## 二、开工前核实清单（6 条，开工前逐条确认）

| # | 核实项 | 确认方式 |
|---|---|---|
| 1 | `aggregateTurnDelta` 是 engine-core 公开 API（从 barrel 导出） | ✅ 已确认（index.ts:161） |
| 2 | `RuleBasedClassifier` **不是** barrel 导出的——需要改 barrel 导出它（注释写了"为什么不导出规则实现"） | ✅ 已确认，需改公开面 |
| 3 | `EngineSessionRegistry` 可注入，能从 handleId 拿到 sessionId / tenantId | ✅ 已确认 |
| 4 | `TurnSessionContext` 里**没有** sensitiveTopics——sensitive_touch 事件本期只记类型不记 matchedTerms | ✅ 已确认 |
| 5 | 现有 TypeORM entity 模式（supervision-report.entity.ts 为样板） | ✅ 已读 |
| 6 | TypeOrmModule.forFeature 要加在 engine.module.ts 里（现有只有 character-pool.module.ts 用了） | ✅ 已确认 |

---

## 三、技术方案

### 核心思路

**adapter 层自观测**：在 `EngineTurnService.turn()` 出口挂观测服务，自己跑一遍分类器 + delta 聚合，fire-and-forget 落库。**engine-core 零改动**——观测全在 adapter 层，复用内核公开 API，不改任何内核代码。

### 为什么是 adapter 层自观测（而不是改内核输出）

- `EngineTurnOutput.events` 只有 `CounselorEventKind[]`（只有类型），注释明确写了"不带命中词明细（那是内核内部产物）"
- `EngineTurnOutput` 只有最终 snapshot，没有 raw_delta / modulated_delta / capped_delta 的中间向量
- 改内核输出 = 改公开契约 = 影响面大；adapter 层自观测 = 零侵入、可开关、可回退
- 咨询师文本 adapter 层有（`EngineTurnInput.userText`），自己跑一遍分类器完全可行
- 分类器是纯函数（词典匹配），漂移风险极低

### ⚠️ 偏差说明：RuleBasedClassifier 不在 barrel 导出

核实发现：`engine-core/index.ts` 注释明确写了"为什么不导出规则实现（RuleBasedClassifier / 算子纯函数 / 默认常量）—— 它们是内部实现细节; 对外只暴露 EventClassifier 接口"。

**处理方案：**
- 在 `engine-core/index.ts` barrel 里加一行导出 `RuleBasedClassifier`
- 这是**纯公开面扩展**，不改任何内核逻辑，只是多导出一个符号
- boundary.spec.ts 的公开面白名单会自动覆盖，改了跑测试验证
- 理由：观测需要看 matchedTerms，调试期合理；模型轨替换分类器后，本导出可退役

---

## 四、写入侧（详细设计）

### 4.1 新增表：`turn_delta_audits`

手写 DDL migration（与 AddSupervisionReports 同款风格）：

| 列名 | 类型 | 说明 |
|---|---|---|
| id | VARCHAR(36) PK UUID | 主键 |
| tenant_id | VARCHAR(64) NOT NULL DEFAULT 'default' | 租户隔离 |
| session_id | VARCHAR(128) NOT NULL | 业务会话 id |
| turn_index | INT NOT NULL | 第几轮（从 1 起） |
| event_kinds | JSON NOT NULL | 本轮命中的事件类型数组（去重，如 `["empathy", "open_probe"]`） |
| event_details | JSON NOT NULL | 每个事件的详细信息：`[{ kind: "empathy", matchedTerms: ["听起来你", "我能理解你"], strength: 1 }]` |
| raw_delta | JSON NOT NULL | 聚合后的原始 delta（11 维：trust / safety / bond / verbal / depth / style / valence / arousal / positive / negative / dependency） |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | 创建时间 |

**索引：**
- `PRIMARY KEY (id)`
- `UNIQUE KEY idx_turn_delta_audit_turn (tenant_id, session_id, turn_index)` —— 一场会话一轮一条，BullMQ 重试不会堆多条
- `KEY idx_turn_delta_audit_session (tenant_id, session_id)` —— 按会话查询

### 4.2 Entity：`TurnDeltaAuditEntity`

TypeORM 装饰器风格（与 SupervisionReportEntity 同款）：
- `@Entity('turn_delta_audits')`
- `@PrimaryGeneratedColumn('uuid')`
- JSON 字段用 `type: 'json'`
- `@CreateDateColumn`

### 4.3 Service：`TurnDeltaAuditService`

**职责：** 收集本轮事件 + delta 明细，fire-and-forget 写库。

**接口：**
```typescript
record(
  handleId: string,
  userText: string,
  output: EngineTurnOutput,
): void;  // fire-and-forget，不返回 Promise，不抛错
```

**内部流程：**
1. **开关检查**：`TURN_DELTA_AUDIT_ENABLED` 关着 → 直接 return（零开销）
2. **拿归属**：从 `EngineSessionRegistry.resolve(handleId)` 拿 sessionId / tenantId
   - 拿不到 → 静默跳过（观测通道不该炸主链路）
3. **跑分类器**：`new RuleBasedClassifier().classify(userText)`
   - ⚠️ **不传 sensitiveTopics**——TurnSessionContext 里没有这个字段，拿不到
   - 影响：sensitive_touch 事件本期观测不到 matchedTerms（但事件类型能从 `EngineTurnOutput.events` 拿到）
   - 拿到 event_details（每个事件的 kind + matchedTerms + strength）—— 9 种静态词典事件
4. **算 raw_delta**：`aggregateTurnDelta(events)`
   - events 是分类器输出的完整 SessionEvent[]
5. **拼记录**：event_kinds（去重）+ event_details + raw_delta + turnIndex
6. **写库**：`this.repo.save(entity)` —— fire-and-forget，try/catch 吞掉所有错误
   - 失败只打一条 debug 日志，不抛、不重试、不告警

**为什么 fire-and-forget 且失败静默：**
- 观测通道是增强，不是主链路依赖
- 写库失败不该让整轮 turn 失败
- 与仓库里 `notifyDeltaCap` 同一纪律（"观测通道失败不影响状态迁移"）

### 4.4 挂观测点

挂在 `EngineTurnService.turn()` 和 `EngineTurnService.turnStream()` 的出口：
- turn 正常返回后 → 调 `auditService.record(handleId, input.userText, output)`
- 流式路径同样挂（两条路径共用同一套闭环）
- 用 `void this.auditService.record(...)` fire-and-forget

**为什么挂在 EngineTurnService 而不是 orchestrator：**
- EngineTurnService 是门面，所有调用都经过这里
- 归属信息（Registry）就在它旁边，不用跨模块拿
- 改动面最小，不侵入 orchestrator 的内部逻辑

---

## 五、读取侧（详细设计）

### 5.1 新增接口

`GET /admin/api/debug/sessions/:sessionId/delta-audit`

**鉴权：** 与既有 admin 接口同款（AdminBasicAuthMiddleware + AdminRoleGuard，class 级挂一次自动继承）。

**返回：**
```typescript
{
  code: 0,
  data: {
    sessionId: string,
    turns: Array<{
      turnIndex: number,
      eventKinds: string[],
      eventDetails: Array<{ kind: string, matchedTerms: string[], strength: number }>,
      rawDelta: { trust: number, safety: number, bond: number, verbal: number, depth: number, style: number, valence: number, arousal: number, positive: number, negative: number, dependency: number },
      createdAt: string,
    }>,
  },
}
```

**排序：** 按 turnIndex 升序（第 1 轮在前）。

**空态：** 没数据返回空数组，不报错。

---

## 六、开关与配置

### 6.1 env 开关

`TURN_DELTA_AUDIT_ENABLED`（默认 `false`）

- 生产环境默认关，不占空间、不耗性能
- 排障 / 灰度测试时开
- 配错（非布尔值）→ 回退默认 false，不抛错

### 6.2 配置读取

走 adapter 层（`delta-cap.config.ts` 同款风格）：
- env → adapter 读 → 注入 TurnDeltaAuditService
- 内核零 env 读取

---

## 七、隐私与安全

1. **不存咨询师原话**——只存事件类型 + matchedTerms（命中的关键词），不存整段文本
2. **不存完整 BDI 快照**——只存 delta 向量（11 维数字），不存信念层 / 愿望层 / 记忆层
3. **心理内容不进日志**——本服务的日志只出定位信息（sessionId / turnIndex / 失败原因），不打事件详情 / delta 数值
4. **租户隔离**——所有查询带 tenant_id，不会串号

---

## 八、反双胞胎（刻意不做的事）

1. **不改 EngineTurnOutput 形状**——不加 raw_delta / modulated_delta 字段，观测全在 adapter 层
2. **不重复实现分类器**——直接 import 内核的 RuleBasedClassifier，不自己写一套
3. **不重复实现 delta 聚合**——直接 import 内核的 aggregateTurnDelta，不自己算
4. **不存 cap_entries**——cap 砍幅已经有 DeltaCapLogger 打日志了，不重复存
5. **不存 final_delta（快照前后差值）**——final_delta 可以通过查询 BDI 状态表的前后快照差值算出来，不需要单独存
6. **不做实时推送 / WebSocket**——本期只做落库 + 按 sessionId 查询，不做实时流
7. **不做前端面板**——本期只做后端接口，前端 admin 面板后续单再做

---

## 九、闸门（验收标准）

| # | 闸门 | 要求 |
|---|---|---|
| 1 | ESLint | 0 problem |
| 2 | TypeScript | 0 error |
| 3 | 单测 | 全量跑通，不新增失败 |
| 4 | engine-core | 零改动（0 文件 0 行） |
| 5 | 开关 | 关着时 turn 管线零开销（连分类器都不跑） |
| 6 | 失败静默 | 写库失败不影响主链路（turn 正常返回） |

---

## 十、交付物清单

1. **engine-core barrel 导出**：`src/engine-core/index.ts` 加一行导出 `RuleBasedClassifier`（纯公开面扩展，不改逻辑）
2. migration 文件：`src/migration/1714900000031-AddTurnDeltaAudits.ts`
3. entity：`src/engine-adapters/wiring/turn-delta-audit.entity.ts`
4. service：`src/engine-adapters/wiring/turn-delta-audit.service.ts`
5. 配置：`src/engine-adapters/wiring/turn-delta-audit.config.ts`
6. 观测点挂载：`engine-turn.service.ts` 两处（turn + turnStream）
7. module 注册：`engine.module.ts` 加 `TypeOrmModule.forFeature([TurnDeltaAuditEntity])` + providers
8. admin controller：新增 `GET /admin/api/debug/sessions/:sessionId/delta-audit`
9. 单测：`test/engine-adapters/wp58-turn-delta-audit.spec.ts`

---

## 十一、commit message 草稿

```
feat(wp58): 事件 + delta 审计观测

新增 turn_delta_audits 表，存每轮事件类型 + matchedTerms + raw delta。
adapter 层自观测（复用内核公开 API），engine-core 零改动。
env 开关控制，默认关闭。
admin 接口：GET /admin/api/debug/sessions/:sessionId/delta-audit
```
