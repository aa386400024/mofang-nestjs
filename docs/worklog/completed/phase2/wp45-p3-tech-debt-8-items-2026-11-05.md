# WP45 · P3 技术债 8 条清理 · 任务单

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp45-p3-tech-debt-8-items-implementation-2026-11-05.md`](./engine-wp45-p3-tech-debt-8-items-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp45-p3-tech-debt-8-items-2026-11-05.md`
> 日期：2026-11-05
> 范围：清理 Phase1 攒下的 8 条技术债
> 边界：engine-core 纯层改动要特别谨慎 · 不自动 commit/push

---

## 一、背景

Phase1 跑了 26 个 WP，攒了一些技术债。现在 Phase2 收尾阶段，穿插清一下。

---

## 二、8 条技术债清单

### 2.1 已确认存在的（4 条）

| # | 技术债 | 现状 | 要做什么 |
|---|---|---|---|
| ① | Qdrant `client: any` | `qdrant.service.ts` 里 `private client: any`，避开类型检查 | 换成真 SDK 类型，或者至少收窄成窄接口（不要裸 any） |
| ② | `TemplateParameter = any[]` | `util.service.ts` 里 `type TemplateParameter = any[]` | 换成具体类型，或者至少收窄成 `unknown[]` + 类型守卫 |
| ③ | cancelled 状态只写不读 | `voice.service.ts` 里 `state.status = 'cancelled'`，但不知道有没有地方读它 | 确认 cancelled 状态有没有消费方；没有的话，要么补消费逻辑，要么删掉这个状态 |
| ④ | Prometheus 告警规则写了但没指标 | `docker/prometheus/alerts.yml` 里有一堆告警规则（HighErrorRate / HighP99Latency / RedisDown 等），但后端可能没暴露对应的 Prometheus 指标 | 确认后端有没有暴露这些指标（http_requests_total / http_request_duration_seconds / auth_login_attempts_total 等）；没有的话，要么补指标，要么删掉没用的告警规则 |

### 2.2 需要你核实的（4 条）

| # | 技术债 | 描述 | 要做什么 |
|---|---|---|---|
| ⑤ | 死配置 | 配了但没用到的 env / 配置项 | 盘一下 `.env.example` 里的键，哪些是代码里根本没读的；读了但没真被消费的（读进 config 但没人用）也列出来 |
| ⑥ | 状态衰减 / 边际递减 / 饱和 | BDI 状态机里的这些机制？还是记忆系统里的？ | 盘一下引擎核心，哪些该有衰减 / 边际递减 / 饱和但还没做；做了的话，口径对不对 |
| ⑦ | QdrantMemoryStore 默认值耦合 | Qdrant 记忆存储的默认值硬编码在哪里？ | 看一下 `QdrantMemoryStore` 的构造默认值（collection 名 / ttl / 衰减配置等），哪些是硬编码死的，应该走 env 或内核种子值 |
| ⑧ | 其他你盘出来的 | 盘代码时发现的其他技术债 | 列出来，一起清 |

---

## 三、设计原则

### D1：先核实再动手

不要上来就改，先盘清楚每条技术债是不是真的存在、影响有多大。有些技术债可能是早期临时方案，现在已经不需要了。

### D2：engine-core 纯层改动要谨慎

如果技术债涉及 engine-core 纯层，要特别谨慎。能在适配层解决的就别动内核；必须动内核的话，要说明为什么。

### D3：不发明新东西

清技术债就是把"临时方案"换成"正式方案"，不是加新功能。不要顺手加需求外的东西。

---

## 四、验收标准

- [x] 8 条技术债每条都盘清楚了（存在 / 不存在 / 影响多大）
- [x] 该改的都改了，该删的都删了
- [x] ESLint 0 error / TypeScript 0 error
- [x] 测试全绿（不能因为清技术债把现有功能搞坏了）
- [x] engine-core 零改动（如果必须动，要单独说明）

---

## 五、待确认问题

1. 状态衰减 / 边际递减 / 饱和这条，具体是指哪个模块的？BDI 状态机？记忆系统？还是别的？
   - **答**：三个机制里**两个早就做了** —— **衰减**（`engine-core/cognition/session-decay.ts`，WP36 跨会话三档半衰期 + WP54 破裂态阻抗衰减下限）、**饱和**（内核 `clamp01` / `clampValence`）；**边际递减真没做**（delta 是线性叠加后 clamp）。
   - 但边际递减**不是技术债、是"没建的临床机制"**：要什么曲线（对数？平方根？）是**临床标定**决策，且会改内核状态迁移的每一个数值（100+ 内核测试重算）→ **本单不动内核**，登记为建议另开单（R1）。
2. Prometheus 指标现在有没有？还是完全没接？
   - **答**：**指标早就接了**（`src/shared/infra/metrics/metrics.service.ts`）：`http_requests_total` / `http_request_duration_seconds` / `auth_login_attempts_total` / `audit_log_failed_total` 等全都有。
   - **真问题不是"没指标"，是规则本身三类缺陷**：① 3 条引用 node_exporter / redis-exporter 的指标，而 `prometheus.yml` 里这两个 scrape job **是注释掉的** → **永不触发**（已删）；② 4 处模板语法写错（`{{ ${ $value } }}`）→ 描述里的值渲染不出来（已修）；③ 3 处拿 `rate()` 比"次数"阈值 → 与描述口径对不上（已改成 `increase()`）。
3. 死配置这条，要不要顺便把 `.env.example` 里的预留键清理一下？
   - **答**：**不用** —— WP28（2026-11-03）已经处理过：`QDRANT_COLLECTION` / `VOICE_SESSION_IDLE_TIMEOUT_MS` 已挪到文件底部一个明确标注"配了不生效"的区。
   - ⚠️ **不能直接注释掉**：机器守卫断言①要求"代码里读的每个 env 键在模板里都要有**生效行**"，注释掉会让守卫变红 —— 等于为了"看起来干净"削弱部署契约。所以形态是"仍是生效行，但**位置即语义**"。
   - 本单全量扫描（155 个 `config.get` 命名空间键 + 守卫 9 例）**未发现新的死键**；守卫盲区本身归 **WP48**。

---

## 六、交付后补记（2026-11-05）

- 交付记录：[`engine-wp45-p3-tech-debt-8-items-implementation-2026-11-05.md`](./engine-wp45-p3-tech-debt-8-items-implementation-2026-11-05.md)
- **最需要留意的**：本单从 ①（`client: any`）里挖出了一个**线上一直在犯的 bug** —— `setPayload` 按 v0.x 的三参形状调，真 SDK v1.19 是两参 → **WP12 的冲突消解标记从未真正落库** → 同主题的新旧矛盾记忆会一起被召回。已修 + 新增打到 HTTP 层的契约回归测试（4 例）。
- 其余各条的结论见交付记录 §二（逐条核实表）。
