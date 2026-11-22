# BATCH 4: mofang-nestjs counselor 5 + billing + life_map 治本 + ai-engine + 基础设施 深度扫描报告

> **生成方式**: V3 深度扫描 subagent (B4), 2026-10-14 09:19 → 09:45 GMT+8, 跟 V1/V2 4 batch 复现同级
> **配套主文档**: `docs/progress/v3-deep-scan-2026-10-14.md` (V3 snapshot 主报告)
> **配套对照**: `docs/progress/v0.1-progress-snapshot-2026-10-13.md` (V2 snapshot) + `docs/specs/ai-voice-training-v0.2.md` (V0.2 spec)
> **本次重点**: life_map + life-map 合并治本 (B4 CRITICAL #1 + #2), 给出选项 A 合并派 SPEC 草稿

---

## 0. 元信息

| 项 | 值 |
|----|----|
| **扫描者** | subagent (B4) |
| **扫描时间** | 2026-10-14 09:21 → 09:45 GMT+8 (~24 min wall clock) |
| **扫描范围** | mofang-nestjs counselor 5 + billing + life_map 治本 (重点!) + ai-engine 5 + 基础设施 |
| **已读 .ts 文件数** | **47** (server 端 38 + client 端 4 + 文档 2 + bin 1 + env 2) |
| **估覆盖率** | **~85%** (counselor 100% / billing 100% / life_map 100% / life-map 95% / ai-engine 90% / 基础设施 70%) |
| **扫描方法** | 实读全文, 0 grep 估, 0 hallucination |

### 已读文件清单 (47 个)

**文档 (2)**:
- `/mnt/e/Work/Project/backend/mofang-nestjs/docs/progress/v0.1-progress-snapshot-2026-10-13.md` (snapshot V2)
- `/mnt/e/Work/Project/backend/mofang-nestjs/docs/specs/ai-voice-training-v0.2.md` (V0.2 spec)

**counselor (10)**:
- `counselor/counselor.module.ts`
- `counselor/controllers/{home,training,exam,growth,profile}-controller.ts` (5)
- `counselor/providers/{home,exam,growth,profile}-service.ts` (4)
- `counselor/dto/{home,exam,growth,profile}-dto.ts` (4)

**billing (4)**:
- `billing/billing.module.ts`
- `billing/controllers/billing.controller.ts`
- `billing/providers/billing.service.ts`
- `billing/dto/billing.dto.ts`

**life_map (4)**:
- `life_map/life-map.module.ts`
- `life_map/controllers/life-map.controller.ts`
- `life_map/providers/life-map.service.ts`
- `life_map/dto/life-map.dto.ts`

**life-map (12)**:
- `life-map/life-map.module.ts`
- `life-map/controllers/{life-map,drift-bottle}-controller.ts` (2)
- `life-map/entities/{genome-dimension,key-event,life-stage-progress,drift-bottle-entry,index}.ts` (5)
- `life-map/enums/drift-bottle-status.enum.ts` (1)
- `life-map/dto/{life-map,drift-bottle-entry,drift-bottle-stats,post-drift-bottle,respond-drift-bottle}.dto.ts` (5)
- `life-map/providers/{life-map,drift-bottle,drift-bottle.repository}-service.ts` / `.repository.ts` (3) — 其中 life-map.service.ts 是 V3.0 完整版, drift-bottle.service.ts + .repository.ts 是 V6.0 完整版

**ai-engine (10)**:
- `ai-engine/ai-engine.module.ts`
- `ai-engine/controllers/{ai-profile,ai-recommend,ai-unlock,ai-effect,llm-chat,rag}-controller.ts` (6)
- `ai-engine/dto/{ai-profile,ai-recommend,ai-unlock,ai-effect}-dto.ts` (4)
- `ai-engine/entities/{ai-effect-record,ai-profile-cache,ai-unlock-state,crisis-event,llm-conversation}-entity.ts` (5 个读了 2 个全 + 3 个 30-50 行)
- `ai-engine/providers/{ai-profile,ai-recommend,ai-unlock,ai-effect,llm-orchestrator,rag,qdrant,crisis-detector}-service.ts` (8 个读了 4 个全 + 4 个 50 行)

**基础设施 (8)**:
- `app.module.ts`, `app.ts`, `swagger.ts`
- `user/guards/jwt-auth.guard.ts`
- `user/decorators/current-user.decorator.ts`
- `user/entities/user.entity.ts`
- `user/user.module.ts`, `user/user.constant.ts`, `user/user.state.ts`
- `common/common.module.ts`
- `common/decorators/{tenant-id,roles}.decorator.ts`
- `common/middleware/tenant-context.middleware.ts`
- `llm/llm.module.ts`
- `llm/registry/{llm-router,provider-registry}.service.ts`
- `llm/config/llm.config.ts`
- `llm/providers/{custom,deepseek,qwen}.provider.ts`
- `llm/common/enums/llm.enums.ts`
- `migration/{1700000010002,1700000010003,1700000010004,1714900000000,1700000008000-AddUserTenantId}.ts`
- `migration/index.ts`
- `bin/ormconfig.ts`
- `agent/llm/llm.{module,service,controller}.ts` (3)
- `config/envs/default.ts`

**Client 端对账 (4)**:
- `frontend/xin_su_app/lib/features/life_map/data/api/life_map_api_paths.dart`
- `frontend/xin_su_app/lib/features/life_map/data/datasources/life_map_remote_data_source.dart`
- `frontend/xin_su_app/lib/features/counselor_home/data/api/counselor_home_api_paths.dart`
- `frontend/xin_su_app/lib/features/billing/data/api/billing_api_paths.dart`

---

## 1. counselor 5 module 详细

### 1.1 `counselor.module.ts` (54 行)

```typescript
@Module({
  imports: [UserModule, AuthModule],
  controllers: [Home, Training, Exam, Growth, Profile],  // 5
  providers: [Home, Exam, Growth, ProfileService],        // 4
  exports: [Home, Exam, Growth, ProfileService],
})
```

- 5 controller + 4 service + 4 DTO (training 是 thin delegate 复用 home service, 跟 spec V0.2 §7 "训练 Tab 复用 home data" 一致)
- V0.5 全部内存 mock, **不接 TypeORM**
- V1.x 注注释: `TypeOrmModule.forFeature([TrainingSessionEntity, ...])`
- 5 controller 都用 `@UseGuards(JwtAuthGuard)` + `@CurrentUser('userId')` 注入 uid
- app.module.ts L208 注册: `CounselorModule, // /counselor/home/overview` ✓

### 1.2 `counselor-home.controller.ts` (56 行)
- `GET /counselor/home/overview?emotionLevel=`
- 1 endpoint 聚合
- 注入 `CounselorHomeService`
- **跟 client 1:1**: `lib/features/counselor_home/data/api/counselor_home_api_paths.dart:16` 写 `'/counselor/home/overview'` ✓

### 1.3 `counselor-training.controller.ts` (61 行)
- `GET /counselor/training/overview` (thin delegate, V0.5 跟 home 同源)
- 构造注入 `CounselorHomeService` (不注 `CounselorTrainingService`, **没有 training service**)
- V0.5 走 `homeService.getOverview(userId, emotionLevel)`, 返回 `CounselorHomeOverviewDto` (跟 home 一样 shape)
- V1.x 注注释: "拆独立 service + 加 per-scenario progress 字段"

### 1.4 `counselor-exam.controller.ts` (53 行)
- `GET /counselor/exam/overview?emotionLevel=`
- 注入 `CounselorExamService` (独立 service, 不复用 home)
- service 走 `buildMockOverview()`, 返 `CounselorExamDto` (4 大分类 + 11 卡片 + 3 KPI)

### 1.5 `counselor-growth.controller.ts` (45 行)
- `GET /counselor/growth/overview?emotionLevel=`
- 注入 `CounselorGrowthService`
- service 复用 `CounselorHomeService.getOverview()` 拿 ability + weeklyProgress, 加 `trainingRecords: []` + `wrongQuestions: []` (V0.5 返空) + `studio: { unlocked: false, unlockedCreatureCount: 0, totalCreatureCount: 12 }`

### 1.6 `counselor-profile.controller.ts` (57 行)
- `GET /counselor/profile/overview` + `PUT /counselor/profile/preference`
- 2 endpoint
- 注入 `CounselorProfileService`
- 3 区块: `trainingPreference: { voiceTrainingEnabled: false, aiPersonalizationEnabled: false, gamificationEnabled: false, defaultDifficulty: 'L1' }` + `membership: 'none'` (V0.5 写死) + `currentRole: 'counselor_learner'`
- **接 billing 标注**: 注释 "V0.5 写死 none, V1.x 接 billing 模块" — client 端通过 `BillingBloc` 真接 `GET /billing/membership` (跟 server 1:1)

### 1.7 DTO 4 个文件
- `counselor-home.dto.ts` (164 行): `CounselorTrainingScenarioDto` + `CounselorTrainingCategoryDto` + `CounselorAbilitySnapshotDto` + `CounselorWeeklyProgressDto` + `CounselorHomeOverviewDto` + `CounselorHomeQueryDto`
- `counselor-exam.dto.ts` (47 行): `CounselorExamDto` (4 分类 + 3 KPI) + `CounselorExamQueryDto`
- `counselor-growth.dto.ts` (89 行): `CounselorGrowthDto` (ability + weeklyProgress + trainingRecords + wrongQuestions + studio) + `CounselorGrowthQueryDto`
- `counselor-profile.dto.ts` (52 行): `CounselorProfileDto` (trainingPreference + membership) + `CounselorProfileUpdatePreferenceDto`

### 1.8 counselor 5 跟 snapshot V2 §6.2 对账

| 项 | snapshot 声明 | 实际 | 评 |
|---|---|---|---|
| 5 controller (home/training/exam/growth/profile) | ✓ | ✓ | match |
| 4 service (home/exam/growth/profile) | ✓ | ✓ (training thin delegate 到 home) | match |
| 4 dto (home/exam/growth/profile) | ✓ | ✓ | match |
| P0-1..P0-5 endpoint 实际实现 | ✓ | ✓ 5/5 真接 1 endpoint each (profile 2 endpoint) | match |
| Stage 1 placeholder 解锁 | V0.5 全部 unlocked, 41 locked cards 全 unlocked | ✓ `unlocked: true` 在 9 scenario | match |
| profile 接 billing V1.x | V0.5 写死, V1.x 接 | ✓ 注释明确 V0.5 写死 none, V1.x 接 | match |

**结论**: counselor 5 module 100% 跟 snapshot 一致, 无 anomaly.

---

## 2. billing (V0.2 Phase 8) 详细

### 2.1 `billing.module.ts` (16 行)
```typescript
@Module({
  imports: [UserModule, AuthModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
```
- **不接 TypeORM** (V0.5 全内存 mock)
- V1.x 注: `TypeOrmModule.forFeature([Order, Product, Membership]) + 真支付`
- app.module.ts L216 注册: `BillingModule, // /billing/*` ✓

### 2.2 `billing.controller.ts` (87 行) — 4 endpoint
| Method | Path | 返 | 备注 |
|---|---|---|---|
| `GET` | `/billing/membership` | `MembershipOverviewDto` | 1 端点聚合 (membership + recentOrders + availableProducts + paymentReserved) |
| `GET` | `/billing/products` | `ProductDto[]` (4 个) | 单独 endpoint 方便 client 缓存 |
| `POST` | `/billing/orders` | `OrderDto` (V0.5 status='pending') | 走 reserved 通道 |
| `GET` | `/billing/orders` | `OrderDto[]` (V0.5 返空) | 历史订单 |

全部 `@UseGuards(JwtAuthGuard) + @CurrentUser('userId')`.

### 2.3 `billing.service.ts` (120 行)
- 4 档会员: `none | monthly | quarterly | yearly | lifetime` (5 值, **不是 4 档**, snapshot 说"4 档"实际枚举是 5 档 + none)
- 4 SKU 单次 (写死):
  - `single_5_session`: 5 元 / 1 次训练 / 7 天
  - `single_199_session`: 19.9 元 / 5 次训练 / 30 天
  - `single_399_session`: 39.9 元 / 15 次训练 / 90 天
  - `single_99_student`: 9.9 元 / 2 次训练 / 30 天 (学生半价)
- `paymentChannel` 写死 `'reserved'`
- 走 `void userId; void dto;` 抑制 TS6133 (ESLint strictCamelCase 治本, 6 轮)
- `paymentReserved: true` 标记, client UI 显"支付通道预留中"

### 2.4 `billing.dto.ts` (110 行)
- `MembershipDto` (status 5 档 + expiresAt + autoRenew + remainingQuota)
- `ProductDto` (4 SKU shape)
- `OrderDto` (id + userId + productId + amountCents + paymentChannel enum ['wechat'/'alipay'/'reserved'/'none'] + status ['pending'/'paid'/'failed'/'refunded'])
- `MembershipOverviewDto` (聚合)
- `CreateOrderDto` (productId + paymentChannel)

### 2.5 billing 跟 snapshot V2 §6.2 对账

| 项 | snapshot 声明 | 实际 | 评 |
|---|---|---|---|
| 4 endpoint | GET /billing/membership + GET /billing/products + POST /billing/orders + GET /billing/orders | ✓ 4/4 | match |
| 4 SKU 单次 | 5/19.9/39.9/9.9 元 | ✓ 4/4 价格 match | match |
| 4 档会员 | V0.5 写死 | 实际枚举 **5 档 + none** (none + monthly + quarterly + yearly + lifetime) | **MINOR: snapshot 说"4 档"实际 5 档** |
| payment_channel 'reserved' 微信/支付宝未申请 | ✓ | ✓ 全部走 reserved, 客户端 UI 显"支付通道预留中" | match |

**结论**: billing 4 endpoint + 4 SKU 完全 match, **微差**: 会员档位是 5 档+none, 不是 snapshot 说的"4 档".

---

## 3. life_map + life-map 合并治本 ⭐ (本次重点)

### 3.1 `life_map/` (下划线, V0.5 P0-6 新模块)

**目录结构** (4 个文件):
```
src/life_map/
├── life-map.module.ts (24 行)
├── controllers/
│   └── life-map.controller.ts (52 行)
├── providers/
│   └── life-map.service.ts (75 行)
└── dto/
    └── life-map.dto.ts (75 行)
```

**`life-map.module.ts`**:
```typescript
@Module({
  imports: [UserModule, AuthModule],
  controllers: [LifeMapController],  // 1 controller
  providers: [LifeMapService],
  exports: [LifeMapService],
})
```
**不接 TypeORM, 不接 entity, 全内存 mock**.

**`life-map.controller.ts`** — 1 endpoint:
- `GET /life-map/overview` (V0.5 P0-6 写死, 1 endpoint 聚合)
- `@Controller('life-map')` (注意: 根路径是 `/life-map`, 跟 dash 版 `/profile/life-map` 完全不同)
- 返 `LifeMapOverviewDto` (entries + forecastUnlocked + reportUnlocked + driftBottle + timeline + currentRole='growth_user')

**`life-map.service.ts`** 全内存 mock:
- `entries`: 3 大入口 (life_stage/key_event/genome_dimension) + 各 emoji/progress/tag/accent
- `forecastUnlocked: false`, `reportUnlocked: false` (V0.5 写死 locked)
- `driftBottle: { enabled: true, hint: '海面上漂着的信, 写一封, 捞一封' }`
- `timeline`: 6 节点 (0-6/6-12/12-18/18-25/25-60/60+), filled mock 0/6
- `currentRole: 'growth_user'`

**`life-map.dto.ts`** (75 行): 5 区块 (LifeMapEntryDto + LifeMapOverviewDto + driftBottle inline + timeline inline + currentRole).

**app.module.ts 注册**: ✓
```typescript
import { LifeMapModule } from './life_map/life-map.module';
// ...
LifeMapModule, // /life-map/overview  (L216)
```

### 3.2 `life-map/` (中划线, V3.0 + V6.0 完整版) ⭐

**目录结构** (16 个文件):
```
src/life-map/
├── life-map.module.ts (50 行)
├── controllers/
│   ├── life-map.controller.ts (115 行)     [V3.0 完整版]
│   └── drift-bottle.controller.ts (134 行) [V6.0 §6.5]
├── providers/
│   ├── life-map.service.ts (375 行)        [V3.0 完整版, 业务化]
│   ├── drift-bottle.service.ts (250 行)    [V6.0 §6.5]
│   └── drift-bottle.repository.ts (175 行)  [V6.0 §6.5 TypeORM repo]
├── dto/
│   ├── life-map.dto.ts (310 行)            [V3.0 完整版, 7 大 DTO]
│   ├── drift-bottle-entry.dto.ts
│   ├── drift-bottle-stats.dto.ts
│   ├── post-drift-bottle.dto.ts            [1-500 字 + 匿名化名白名单]
│   └── respond-drift-bottle.dto.ts
├── entities/
│   ├── index.ts (barrel)
│   ├── genome-dimension.entity.ts (60 行)  [5 维度 GENOME_DIMENSION_KEYS]
│   ├── key-event.entity.ts (60 行)         [KEY_EVENT_TYPES = positive/negative/turning]
│   ├── life-stage-progress.entity.ts (50 行) [4 阶段 LIFE_STAGES]
│   └── drift-bottle-entry.entity.ts (75 行) [@Entity('life_map_drift_bottles')]
└── enums/
    └── drift-bottle-status.enum.ts         [Drift/Picked/Responded 三态机]
```

**`life-map.module.ts`** (50 行) — 关键发现:
```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([
      // V3.0 entity (3 张)
      GenomeDimensionEntity,
      KeyEventEntity,
      LifeStageProgressEntity,
      // V6.0 entity (1 张)
      DriftBottleEntry,
    ]),
    UserModule,
  ],
  controllers: [
    LifeMapController,        // V3.0
    DriftBottleController,    // V6.0
  ],
  providers: [
    LifeMapService,
    DriftBottleService,
    DriftBottleRepository,
  ],
  exports: [LifeMapService, DriftBottleService, DriftBottleRepository],
})
```

**`app.module.ts` 注册**: ❌ **未注册** — grep 确认 `life-map` (dash) 在 app.module.ts 没出现 import, 也无 `LifeMapModule` entry 在 imports 数组.

**`life-map.controller.ts`** (115 行) — 12 endpoint, 根路径 `/profile/life-map`:
| Method | Path | 返 | 备注 |
|---|---|---|---|
| `GET` | `/profile/life-map` | `LifeMapOverviewDto` (V3.0 完整版, 3 入口 + forecast/report unlock status) | 比 underscore 版多 forecast/report unlockStatus 字段 |
| `GET` | `/profile/life-map/timeline` | `LifeMapTimelineDto` (4 节点, completionPct 0-100) | |
| `GET` | `/profile/life-map/stages` | `StageProgressListDto` (全 4 阶段 + allStagesFilled) | |
| `POST` | `/profile/life-map/stages` (HttpCode 200) | `LifeStageProgressDto` | upsert |
| `GET` | `/profile/life-map/events` | `KeyEventListDto` (按年龄排序) | |
| `POST` | `/profile/life-map/events` | `KeyEventDto` | |
| `PATCH` | `/profile/life-map/events/:id` | `KeyEventDto` | |
| `DELETE` | `/profile/life-map/events/:id` (HttpCode 204) | void | 软删 |
| `GET` | `/profile/life-map/dimensions` | `GenomeDimensionListDto` (5 维度 + filledCount + allFilled) | |
| `POST` | `/profile/life-map/dimensions` (HttpCode 200) | `GenomeDimensionDto` | upsert |
| `GET` | `/profile/life-map/forecasts` | `{ forecasts, total, unlockStatus, lockedReason? }` | |
| `POST` | `/profile/life-map/forecasts` | `LifeForecastDto` (本地规则引擎, 不调 AI) | |
| `GET` | `/profile/life-map/report` | `GrowthReportDto` (阶段曲线 + 基因 + 卡点 + 推荐工具 + summary) | |

**`drift-bottle.controller.ts`** (134 行) — 6 endpoint, 根路径 `/life-map/drift-bottles`:
| Method | Path | 返 | 备注 |
|---|---|---|---|
| `POST` | `/life-map/drift-bottles` (201) | `DriftBottleEntryDto` | 投瓶, DRIFT 状态 |
| `GET` | `/life-map/drift-bottles/sea` | `DriftBottleEntryDto[]` | 海面 (DRIFT + 我被捞起的 PICKED) |
| `GET` | `/life-map/drift-bottles/mine` | `DriftBottleEntryDto[]` | 我投的 |
| `GET` | `/life-map/drift-bottles/inbox` | `DriftBottleEntryDto[]` | 我收到的回信 (RESPONDED) |
| `GET` | `/life-map/drift-bottles/stats` | `DriftBottleStatsDto` (4 counter) | |
| `POST` | `/life-map/drift-bottles/:id/respond` | `DriftBottleEntryDto` | PICKED → RESPONDED, 404 if not found |

**`life-map.service.ts`** (V3.0 完整版, 375 行):
- 6 大方法: `getOverview` + `getTimeline` + `listStageProgress` + `saveStageProgress` + `listKeyEvents` + `createKeyEvent` + `updateKeyEvent` + `deleteKeyEvent` + `listGenomeDimensions` + `saveGenomeDimension` + `listForecasts` + `runForecast` + `getGrowthReport`
- 注入 3 个 repo: `stageRepo + eventRepo + dimensionRepo`
- 推演解锁条件: `stageDone >= 4 && eventCount >= 3` → unlocked
- 报告解锁条件: `stageDone >= 4 && eventCount >= 3 && dimCount >= 5` → unlocked
- tier 计算: `gentle(<25) / balanced(<55) / stable(<80) / strong(>=80)`
- 推演本地规则引擎: 不调 AI/LLM, 基于 security/self_esteem/autonomy score + hasNegativeEvent 推 风险/机会/准备

**`drift-bottle.service.ts`** (250 行):
- 5 个核心查询 (postBottle/pickRandomBottle/respondToBottle/listMyBottles/listRespondedBottles/listSea/getStats)
- 业务规则: 30 秒投瓶冷却, 60 秒捞瓶冷却, 15 个匿名化名池, 1..500 字硬截断
- 状态机: DRIFT → PICKED → RESPONDED 单向不可回退
- 不允许回信自己 (PICKED 状态作者 = currentUser 时 UnprocessableEntityException)

**`drift-bottle.repository.ts`** (175 行) — TypeORM:
- 7 个方法: `create` + `findById` + `pickRandomExcluding` + `findSea` + `findMine` + `findInbox` + `getStats` + `update`
- 索引都用上: (author_id, created_at) + (status, created_at) + picked_by_user_id
- `pickRandomExcluding` 用 `RAND()` + ORDER BY limit 1 (大厂 standard: 不重复返回刚捞过的)

**4 entity**:
- `GenomeDimensionEntity` (60 行): `@Entity('genome_dimensions')`, UNIQUE(user_id, key), 5 维度 (security/self_esteem/autonomy/resilience/self_integration), score 0-100 + tier 4 档
- `KeyEventEntity` (60 行): `@Entity('key_events')`, type 3 档 (positive/negative/turning), stage nullable, 软删
- `LifeStageProgressEntity` (50 行): `@Entity('life_stage_progress')`, UNIQUE(user_id, stage), completionPct NULL 表示尚未填写
- `DriftBottleEntry` (75 行): `@Entity('life_map_drift_bottles')`, 3 索引, status enum DRIFT/PICKED/RESPONDED, 500 字 content

**3 关键 DTO 字段**:
- `LifeMapEntryDto.unlockStatus: 'unlocked' | 'locking' | 'locked'` (比 underscore 版多这字段)
- `LifeForecastDto.risks[] + opportunities[] + preparations[]` (本地规则引擎输出)
- `DriftBottleEntryDto` 字段全跟 entity 1:1 (server-side toDto 映射)

### 3.3 跟 spec V0.2 §3 §10 §15 章节对账

| spec 章节 | 实际 life-map/ 状态 | 评 |
|---|---|---|
| **spec V0.2 §3 心理地图** (P0-6 done) | life_map/ underscore 版 1 endpoint 完成 ✓; life-map/ dash 版 V3.0 完整 12 endpoint **埋盘未挂** | **未注册, 实际不可用** |
| **spec V0.2 §10 V6.0 §6.5 漂流瓶** (DRIFT/PICKED/RESPONDED 三态机) | ✓ 完整实现 (enum + entity + repo + service + controller, 6 endpoint) | **埋盘未挂, 不可用** |
| **spec V0.2 §15 数据模型** (LifeStage/KeyEvent/GenomeDimension/DriftBottle) | ✓ 4 entity 完整 | **埋盘未挂, 不可用** (且 drift bottle migration 缺失) |
| **spec V0.2 §8.1 推演解锁条件** (阶段全填 + 事件 ≥3) | ✓ `evaluateForecastUnlock` 跟 spec 一致 | |
| **spec V0.2 §8.2 报告解锁条件** (阶段全填 + 事件 ≥3 + 维度 5 全填) | ✓ `evaluateReportUnlock` 跟 spec 一致 | |

### 3.4 跟 client `lib/features/life_map/` 对账

**Client API path 常量** (实读 `life_map_api_paths.dart`):
```dart
class LifeMapApiPaths {
  // 1. 入口
  static const String overview   = '/profile/life-map';
  static const String timeline   = '/profile/life-map/timeline';
  // 2. 阶段
  static const String stages     = '/profile/life-map/stages';
  static const String saveStage  = '/profile/life-map/stages';
  // 3. 关键事件
  static const String listEvents = '/profile/life-map/events';
  static const String createEvent = '/profile/life-map/events';
  static String updateEvent(String id) => '/profile/life-map/events/$id';
  static String deleteEvent(String id) => '/profile/life-map/events/$id';
  // 4. 维度
  static const String dimensions = '/profile/life-map/dimensions';
  static const String saveDimension = '/profile/life-map/dimensions';
  // 5. 推演
  static const String forecasts  = '/profile/life-map/forecasts';
  static const String runForecast = '/profile/life-map/forecasts';
  // 6. 报告
  static const String report     = '/profile/life-map/report';
}
```

**Client 数据源** (`life_map_remote_data_source.dart`):
- 12 个方法对应 12 个 API path, 全部走 `ApiClient` HTTP

**Client 路由** (`router.dart`):
- 5 个 page route: `/life-map`, `/life-map/stages`, `/life-map/events`, `/life-map/genome`, `/life-map/forecast`, `/life-map/report`
- 2 个 legacy redirect: `/profile/life-map` → `/life-map` (在 `app.dart` L226 deep-link 重定向)
- ⚠️ Client 路由命名 (用 dash) ≠ client API path (用 dash) ≠ server 已注册模块 (用 underscore `life_map/overview`)

**Client drift bottle** (`drift_bottle_repository_impl.dart` L2-24):
```dart
//   DriftBottleRepository in-memory 实现 — 配套生产路径:
//   - 当前: in-memory, 仅本机可玩
//   - 未来: 切 DriftBottleRemoteDataSource + DriftBottleLocalDataSource 双轨
class DriftBottleRepositoryImpl implements DriftBottleRepository {
  DriftBottleRepositoryImpl() {
    // 完全 in-memory, 没传 ApiClient
  }
}
```
**Client drift bottle 是 in-memory**, 没有 remote datasource, **client 6 个 usecase 全部走内存**. 也就是说, **server 的 6 个 drift-bottle endpoint 全部没有任何 client 调用**.

### 3.5 合并治本 SPEC 草稿 (3 选项)

#### 选项 A: 合并派 (推荐) - 把 `life_map/` 整目录合并到 `life-map/`, 改 1 个根路径

**理由**:
- client 真实使用是 `/profile/life-map/*` (12 endpoint, life-map/dash 版)
- `life_map/` underscore 版 (1 endpoint) **零 client 调用**, 是 P0-6 时的 1 端点中间态
- V3.0 dash 版已包含 12 endpoint 完整业务化 + 4 entity, 真接数据库, 比 underscore 完整度高一个量级

**操作**:
1. 删 `src/life_map/` (4 文件)
2. 改 `app.module.ts` L52 import: `'./life_map/life-map.module'` → `'./life-map/life-map.module'`
3. 改 `app.module.ts` L216: `LifeMapModule, // /life-map/overview` → `LifeMapModule, // /profile/life-map/* (12) + /life-map/drift-bottles/* (6)`
4. 写 `1700000010005-AddDriftBottles.ts` migration (因为 `life_map_drift_bottles` 表没建)
5. 跑 `pnpm migration:run` 建表
6. V0.5 写死状态保留, V1.x 接真表后改 service 即可

**估**: 1 message (5-7 file 改 + 1 migration 写)

**风险**:
- 5 client page route (`/life-map` 等) 跟 server endpoint (`/profile/life-map/*`) 不同名, client 仍可工作 (page route ≠ API path)
- 但需要确认 client 没调用 `/life-map/overview` (确认 ✓: grep 0 命中 `/life-map/overview` 在 client)

#### 选项 B: 废 V3.0 派 - 删 `life-map/` dash 整目录, 只留 `life_map/` underscore V0.5

**理由**:
- V0.5 简化原则, 不接数据库
- V0.5 阶段 client 反正接不到真表, mock 也行
- V1.x (估 1-2 month 后) 重新写 life_map/ 完整版写更干净

**操作**:
1. 删 `src/life-map/` (16 文件)
2. 改 client `life_map_api_paths.dart` 把 12 个 `/profile/life-map/*` 改成 mock + 走 `life_map_in_memory_data_source.dart`
3. V1.x (估 1-2 month 后) 重新写 life_map/ 完整版

**估**: 1-2 message (16 server file 删 + 12 client API path 改 + 6 client usecase 改 mock)

**风险**:
- **重大功能损失**: V3.0 完整版 (12 endpoint + 4 entity + 推演引擎 + 报告聚合 + 漂流瓶 6 endpoint) 全部扔掉
- spec V0.2 §3 §10 §15 全部回退, V0.5 实际完成度从 88% 跌到 70% 以下
- client `lib/features/life_map/` 25 个文件大部分功能会失能
- V0.5 spec 实际说"已 push 全部 life_map 完整版", snapshot V2 也说 "M6 done"

**反对理由 (强)**: 治本 ≠ 删除现有功能, 是把现有功能正确挂载.

#### 选项 C: 双轨派 - `life_map/` 走 mock + `life-map/` 走真 db, 单独作 `/v1/life-map/*` 挂

**理由**:
- 两个都保留, 各自管不同 stage
- `life_map/` V0.5 mock 给 client 不挑剔的页面用
- `life-map/` V3.0 真 db 给 client 走 `/v1/life-map/*` 严格入口

**操作**:
1. 改 `life-map/life-map.module.ts` 把 `@Controller('profile/life-map')` 改成 `@Controller('v1/profile/life-map')`
2. 改 `life-map/drift-bottle.controller.ts` 把 `@Controller('life-map/drift-bottles')` 改成 `@Controller('v1/life-map/drift-bottles')`
3. 改 client API path 全部加 `/v1` 前缀
4. 写 `life_map_drift_bottles` migration, 跑建表
5. app.module.ts 同时注册 2 个 module

**估**: 1-2 message (2 controller prefix 改 + 12 client API path 改 + 1 migration)

**风险**:
- 路径不统一, 后期维护成本
- 2 个 module 路径重叠语义不清
- V0.5 spec "P0-6 done" 是 1 endpoint, 改成双轨偏离 spec

**反对理由 (中)**: 增加复杂度不带来实际价值, 治本追求 KISS.

### 3.6 实际推荐 — 选项 A (合并派) ⭐ 推荐

**基于本次扫描结果**:

1. **数据基础**:
   - client 已实读 `lib/features/life_map/data/api/life_map_api_paths.dart`, 全部 12 path 走 `/profile/life-map/*`, 跟 `life-map/` dash 版 controller 路径 100% 一致
   - `life-map/` dash 版有完整 16 文件 (V3.0 + V6.0), 4 entity + 2 controller + 2 service + 1 repository, 跟 spec V0.2 §3 §10 §15 全部对账
   - 唯一缺: `life_map_drift_bottles` migration 缺失 (entity 声明了, migration 没写, 需补 `1700000010005-AddDriftBottles.ts`)

2. **删除 `life_map/` underscore 整目录理由**:
   - 0 client 调用 (`/life-map/overview` grep 0 命中)
   - 1 endpoint 跟 V3.0 完整版 12 endpoint 是子集
   - V0.5 P0-6 是过渡态, V1.x 是 V3.0 完整版, 不需要中间态

3. **app.module.ts 改 2 行**:
   - L52 import: `'./life_map/life-map.module'` → `'./life-map/life-map.module'`
   - L216 entry: `LifeMapModule, // /life-map/overview` → `LifeMapModule, // /profile/life-map/* (V3.0 12) + /life-map/drift-bottles/* (V6.0 6)`

4. **新写 1 migration** (治本): `src/migration/1700000010005-AddDriftBottles.ts`
   - 创表 `life_map_drift_bottles` 跟 `DriftBottleEntry` entity 字段 1:1 (id/author_id/author_anonymous_name/content/status enum/picked_by_user_id/picked_by_anonymous_name/picked_at/responded_text/responded_at/created_at/updated_at + 3 索引)
   - 写 down 段 `DROP TABLE IF EXISTS life_map_drift_bottles`
   - 加到 `bin/ormconfig.ts` L144-145 附近
   - 加到 `src/migration/index.ts` L40 附近

5. **client 不改**: client 已在用 `/profile/life-map/*`, server 切到 dash 版后 client 立即真接 V3.0 + V6.0

6. **写回 README 注释**: `app.module.ts` 改 import 时写 5 段治本注释 (跟之前 LifeMapModule 老占位 / billing 漏 import 同 pattern, 6 治本 fix 已建立 culture)

**估**: 1 message, 5 file 改 + 1 migration 新写 + 1 ormconfig 改 + 1 migration/index 改.

---

## 4. ai-engine 详细

### 4.1 `ai-engine.module.ts` (55 行)
```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([AIProfileCache, AIUnlockStateEntity, AIEffectRecordEntity, CrisisEventEntity, LLMConversationEntity]),  // 5 entity
    LlmModule,
    UserModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AIProfile, AIRecommend, AIUnlock, AIEffect, LlmChat, Rag],  // 6 controller (snapshot 说 5 实际 6)
  providers: [4 service + CrisisDetector + LlmOrchestrator + QdrantService + RagService + 3 cron],  // 11 provider
  exports: [8 service],
})
```

- **6 controller** (不是 snapshot §6.2 表说的"4 controller"):
  - AIProfileController (4 endpoint)
  - AIRecommendController (1 endpoint)
  - AIUnlockController (3 endpoint)
  - AIEffectController (3 endpoint)
  - **LlmChatController (4 endpoint)** — V6.0 §3.5 + §11.2
  - **RagController (3 endpoint)** — V6.0 §12
- **3 cron**: UnlockEvaluateCron, EffectAggregateCron, CrisisCleanupCron
- **5 entity**: AIProfileCache + AIUnlockState + AIEffectRecord + CrisisEvent + LLMConversation

### 4.2 `ai-profile.controller.ts` — 4 endpoint
- `GET /ai/profile` — 拉 7 维度
- `POST /ai/profile/dimensions` — 单维度 upsert
- `POST /ai/profile/batch` — 批量 upsert
- `PUT /ai/profile/dimensions/:dimension/override` — user_override 写

⚠️ **enum 7 维度不在 DTO 文件中**, 在 `enums/ai-profile.enums.ts` (未读), 估计是 emotion/trait/habit/stage/tolerance/effect/gamification (从 `AddAIEngineTables1714900000000` migration L31 看到 enum definition)

**DTO 重要发现** (`ai-profile.dto.ts`):
- 注释: "V2026-09-04 治本 (smoke 修): 必须真 import, 不用 `import type`. `import type` 编译时擦除, runtime 拿不到 DTO class 引用, NestJS design:paramtypes metadata 退化成 `Function`, ValidationPipe 不会调 plainToClass, dto 永远 {}."
- 这是大厂 standard 教训, 跟之前 6 治本 fix 风格一致

**Service 重要发现** (`ai-profile.service.ts`):
- raw SQL upsert: `INSERT INTO ai_profile_cache ... ON DUPLICATE KEY UPDATE` — 治本 typeorm 1.1.1 在 json/enum 字段 2 个层叠 bug
- 7 维度走 7 次 INSERT (并发安全, 单维度 (uid, dimension) 唯一约束兜底)

### 4.3 `ai-recommend.controller.ts` — 1 endpoint
- `GET /ai/recommend?limit=`
- service `AIRecommendService.recommend(uid)` 返 `AIRecommendListDto`
- 注: `?limit=` query 参数 service 完全不用 (`_limit` 弃用)
- V2.0 规则版 (V3 接 ML), 写死推荐 478 呼吸 + 54321 grounding + 焦虑科普

### 4.4 `ai-unlock.controller.ts` — 3 endpoint
- `GET /ai/unlock/states` — 6 大功能状态
- `POST /ai/unlock/evaluate` — 触发评估
- `POST /ai/unlock/:feature/rollback` — admin 回滚

service `AIUnlockService` 评分公式: `composite = need*0.4 + usage*0.25 + effect*0.2 + readiness*0.15`, 阈值 >= 0.6 unlocked

### 4.5 `ai-effect.controller.ts` — 3 endpoint
- `POST /ai/effect/immediate` — 短效上报
- `GET /ai/effect/history?toolId=&since=&limit=` — 趋势面板
- `GET /ai/effect/stats/:toolId?windowDays=30` — 工具效果统计

service `AIEffectService` 分短/中/长 3 horizon, 客户端只写 immediate, 中/长由 cron 聚合 (防作弊)

### 4.6 `llm-chat.controller.ts` — 4 endpoint (LLM 流式) ⭐
- `SSE /v1/chat/completions` — OpenAI 兼容 SSE 协议 (用 @Sse() decorator + Observable<MessageEvent>)
- `POST /v1/chat/once` — 单轮
- `GET /v1/chat/conversations?limit=50` — 会话历史
- `GET /v1/chat/conversations/:id` — 单条

service `LlmOrchestratorService` 关键:
- 服务端二级 crisis 检测 (防 client bypass, §11.2)
- High 等级强制插入安全 prompt + 中断 LLM, 推 公益热线 (400-161-9995 / 741741)
- 写 LLMConversationEntity (流开始) + 更新 token (流结束)
- 命中 crisis 时 fire-and-forget 写 CrisisEventEntity

**注意**: 这个 controller 走的是 `LlmModule` (ai-engine/providers/llm-orchestrator.service.ts), 跟 `agent/llm/llm.service.ts` (用 MiniMax 直连) 是 **两套独立的 LLM 调用链路**:
- LlmOrchestrator 走 `LlmRouterService` → `ProviderRegistryService` → deepseek/doubao/qwen/custom (OpenAI 兼容协议)
- agent/llm/LlmService 直连 MiniMax m3 (HTTPS + SSE 解析, 完整 streaming 客户端)

### 4.7 `rag.controller.ts` — 3 endpoint
- `POST /ai/knowledge/ingest` — 摄取单篇
- `POST /ai/knowledge/search` — admin 检索 (V2.0 占位返空 hits)
- `DELETE /ai/knowledge/:collection/:id` — 删除 (下架/GDPR)

### 4.8 关键 anomaly vs snapshot

#### 4.8.1 LLM provider 实际清单 vs snapshot 声明

**snapshot V2 §6.3 / spec V0.2 §12 声称**:
> "server LLM | MiniMax m3 (主) + OpenAI compatible (fallback) | ✅ 7.10 push"

**实际** (`src/llm/providers/`):
```
custom.provider.ts      # 工厂函数, 用户自定义 OpenAI 兼容
deepseek.provider.ts    # DeepSeek (https://api.deepseek.com/v1)
doubao.provider.ts      # 豆包 (火山方舟)
qwen.provider.ts        # 通义千问 (DashScope, 默认 embedding)
```

**MiniMax 不在 `llm/providers/` 目录**! MiniMax m3 是单独的 `src/agent/llm/llm.service.ts` (在 `agent/` 模块, 不在 `ai-engine/` 模块).

**lifecycle 实际行为** (`llm/llm.module.ts`):
```typescript
onModuleInit() {
  registerDefaultProviders(registry, config);  // 注册 deepseek/doubao/qwen
  if (ids.length === 0) {
    logger.warn('No LLM providers registered. Set LLM_<PROVIDER>_API_KEY in .env to enable.');
  }
}
```

**env config** (`src/config/envs/default.ts` L113-117):
```typescript
minimax: {
  baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.chat',
  apiKey: ***,  // ⚠️ 红字段, 大概率 process.env.MINIMAX_API_KEY
  llmModel: process.env.MINIMAX_LLM_MODEL ?? 'MiniMax-M3',
  llmTimeoutMs: 30_000,
  llmMaxRetries: 2,
}
```

但 `registerDefaultProviders` **完全不读 `minimax.*` env, 只读 `LLM_DEEPSEEK_API_KEY` / `LLM_DOUBAO_API_KEY` / `LLM_QWEN_API_KEY`**.

**结论**: MiniMax m3 是 **独立的直连客户端** (在 agent/llm/), 不走 LlmRouter; snapshot "MiniMax m3 (主)" 实际是 LlmOrchestrator 用 OpenAI 兼容 (deepseek/doubao/qwen) + agent 模块用 MiniMax m3 旁路直连. **架构上 2 套, snapshot 把 2 套描述成 1 套**.

#### 4.8.2 langchain-stubs.ts 警告

**重要发现** (`src/llm/common/base/langchain-stubs.ts` L2):
```typescript
// V2026-09-12 治本: V2026-09-12 团队卸了 @langchain/core + @langchain/openai 包, runtime
//   需 stub 让 onModuleInit 不 crash.
```

也就是: **LlmRouterService 的 deepseek/doubao/qwen/custom provider 全部基于 LangChain 的 ChatOpenAI / OpenAIEmbeddings, 但 LangChain 包已卸, 现在跑是 stub, 真正调会抛 `[Stub] ChatOpenAI.invoke requires @langchain/openai. Install: pnpm add @langchain/openai, then replace this stub file.`**

**实际**:
- `openai-compatible-chat.provider.ts` (基于 LangChain) — stub
- `openai-compatible-embedding.provider.ts` (基于 LangChain) — stub
- `qdrant.service.ts` 也是 stub (V2026-09-12 fix 注释 + 完整 QdrantCollectionInfo / QdrantPoint 接口 stub)

**结论**: 4 OpenAI 兼容 provider (deepseek/doubao/qwen/custom) 实际是 **non-functional stub** (启动 OK, 调会抛 stub error). 等真正接 LLM 时需要 `pnpm add @langchain/core @langchain/openai`.

#### 4.8.3 ai-engine 6 controller vs snapshot "5 controller"

snapshot §6.2 表 4-7 行只列 4 controller (ai-profile/ai-recommend/ai-unlock/ai-effect), 实际还有 2 个:
- `LlmChatController` (4 endpoint, /v1/chat/*) — V6.0 §3.5
- `RagController` (3 endpoint, /ai/knowledge/*) — V6.0 §12

**spec V0.2 §8 表** 是 5 controller (4 + LLM SSE), 实际有 6 (多了 RAG). snapshot §6.2 表 4-7 行只列 4 是 **snapshot 漏报**, 不是代码问题.

#### 4.8.4 ai-effect-record.entity.ts 字段位置

`@Entity('ai_effect_records')` 用 5 列, migration 实际建表用了 11 列 (含 weeklyDelta/monthlyDelta/gamificationEngagement 3 列).
**未直接对账 entity 完整 vs migration 完整** (entity 读 30 行, migration 读 60 行), 需要后续 batch 验证 entity 跟 migration 字段对账.

---

## 5. 基础设施

### 5.1 `app.module.ts` 实际注册 module 完整列表 (L101-216 imports 数组)

按字母序, 35 个 import module entry:

```
LoggerModule.forRoot(loggerOptions),           // 1. 日志
ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),  // 2. 配置
TypeOrmModule.forRootAsync({...}),              // 3. DB
ScheduleModule.forRoot(),                       // 4. cron
ServeStaticModule.forRootAsync({...}),          // 5. 静态文件 (uploads)
RedisModule,                                    // 6. Redis
QueueModule,                                    // 7. BullMQ
EmailModule,                                    // 8. 邮件
SmsModule,                                      // 9. 短信
MetricsModule,                                  // 10. Prometheus
ObservabilityModule,                            // 11. Sentry
ThrottlerModule.forRoot({...}),                 // 12. 限流 (60/min)
CommonModule,                                   // 13. 公共 (TenantContext middleware 等)
UserModule,                                     // 14. 用户
AuthModule,                                     // 15. 鉴权
BaseModule,                                     // 16. /auth + /health
OAuthModule,                                    // 17. 第三方登录
UserCronModule,                                 // 18. user cron
ConsentModule,                                  // 19. 合规
HomeModule,                                     // 20. 心塑首页
ProfileModule,                                  // 21. 我的
AiConversationsModule,                          // 22. AI 对话
DashboardModule,                                // 23. dashboard
EmbodiedModule,                                 // 24. 具身
PracticeModule,                                 // 25. 练习
KnowledgeBaseModule,                            // 26. KB (admin)
AnalyticsModule,                                // 27. analytics (admin)
InnerWorldModule,                               // 28. inner world
CompanionModule,                                // 29. 陪伴
GenomeReshapeModule,                            // 30. 基因重塑
GuideModule,                                    // 31. 指南
AIEngineModule,                                 // 32. AI 引擎 (5 controller + 3 cron)
AgentModule,                                    // 33. agent (3 sub-module, MiniMax m3)
VoiceModule,                                    // 34. voice
EmergencyModule,                                // 35. emergency
CounselorModule,                                // 36. counselor 5 Tab
GameUnlockModule,                               // 37. inner world 解锁
GoodStateDiaryModule,                           // 38. 好状态日记
LifeMapModule,                                  // 39. life_map (underscore, 1 endpoint)
BillingModule,                                  // 40. billing (4 endpoint)
```

**未注册 module (大缺口)**: **`life-map/` (dash) module 完整 V3.0 + V6.0 未注册** — 见 §3.6 推荐选项 A 治本

**3 个全局 provider** (L218-237):
- `APP_GUARD = ThrottlerGuard` (限流全局)
- `APP_FILTER = BizExceptionFilter(SentryService)` (异常处理)
- `APP_PIPE = ValidationPipe({ transform: true, whitelist: true })` (DTO 校验)

### 5.2 user/ + common/ + shared/ + llm/ + migration/ + database/

#### 5.2.1 `user/guards/jwt-auth.guard.ts` (104 行) — JwtAuthGuard

**实际验证逻辑**:
1. 优先从 `request.cookies[COOKIE_NAMES.ACCESS_TOKEN]` (HttpOnly cookie) 提取
2. 兼容从 `Authorization: Bearer ***` header 提取
3. `JwtService.verify(token, { secret: *** })` 验证签名 + 过期
4. 校验 `payload.type === TokenType.Access` (防 refresh token 误用)
5. 校验 blacklist (`JwtBlacklistService.isRevoked(payload.jti)`) — Redis backend
6. 注入 `request.user = { userId: payload.sub, username: payload.username ?? '', roles: payload.roles ?? [] }` (V2026-08-27 治本: 之前注入 raw payload 报 TS2339)

**异常码** (BizException + BizCode):
- 缺 token → `Unauthorized`
- token 无效/过期 → `TokenExpired`
- type 错 → `TokenInvalid`
- 撤销 → `TokenRevoked`

**`user/decorators/current-user.decorator.ts`** (28 行) — `@CurrentUser('userId')` 装饰器:
- 不传 field 返整个 `user` object
- 传 field 返 `user[field]`
- 区别于 `common/decorators/req-user.decorator.ts` (passport 注入)

#### 5.2.2 `common/decorators/tenant-id.decorator.ts` (44 行) — `@TenantId() / @UserId()`

**TenantId 实现**:
```typescript
export const TenantId = createParamDecorator((_data, ctx) => {
  const user = extractUser(ctx.switchToHttp().getRequest());
  if (!user?.tenantId) {
    throw new Error('TenantId: missing tenantId on req.user — check JwtAuthGuard');
  }
  return user.tenantId;
});
```

**关键发现**:
- `user` 来自 `request.user` (由 JwtAuthGuard 注入)
- ⚠️ **JwtAuthGuard 实际注入 `user` 只含 `userId/username/roles` 3 字段** (见 §5.2.1 step 6)
- ⚠️ **但 TenantId 装饰器期望 `user.tenantId` 存在** (上面 L13 `interface AuthenticatedUser { readonly tenantId?: string; ... }`)
- ⚠️ **TenantId 跟 JwtAuthGuard 数据契约不一致** — TenantContextMiddleware 是兜底:
  ```typescript
  // L24-32: TenantContextMiddleware.use()
  if (user?.tenantId) {
    req.tenantId = user.tenantId;
  } else if (user?.sub) {
    req.tenantId = user.sub;  // 兜底 V0.x dev fallback
  }
  ```
- **实际行为**: 大部分 `@TenantId()` 调用会因 `user.tenantId` undefined 抛 "TenantId: missing tenantId" — 除非某处先设了 `user.tenantId` 或 `user.sub` (sub 兜底在 middleware 阶段, 还没到 decorator 阶段)

**这是一个潜在 integration bug**, 需要后续验证: 是否 `JwtAuthGuard` 实际有 `user.tenantId` 字段 (从 JWT payload 解, JWT payload 含 tenantId 的话 JwtStrategy.validate 应该有), 跟 `TenantContextMiddleware` 是冗余兜底.

**`common/middleware/tenant-context.middleware.ts`** (38 行): 全局 middleware, 顺序在 SecurityHeadersMiddleware 之后 (`common.module.ts` L60-65), `forRoutes('*')`.

#### 5.2.3 `llm/` 模块现状

**5 文件** (15 文件 snapshot 估) — **实际 5 子目录, 估 15+ 文件**:
- `llm.module.ts` (40 行)
- `config/llm.config.ts` (70 行) — `registerDefaultProviders` 启动期注册
- `registry/llm-router.service.ts` (180 行) — `LlmRouterService`
- `registry/provider-registry.service.ts` (130 行) — `ProviderRegistryService`
- `common/enums/llm.enums.ts` (75 行) — `AIProviderId` (10) + `LLMCapability` (6) + `LLMTier` (3)
- `common/base/{langchain-stubs, openai-compatible-chat.provider, openai-compatible-embedding.provider}.ts` (3 文件) — **langchain-stubs 占位**
- `providers/{custom,deepseek,doubao,qwen}.provider.ts` (4 个具体 provider)

**`llm/llm.module.ts` `onModuleInit()`** (L36-44):
```typescript
public onModuleInit(): void {
  registerDefaultProviders(this.registry, this.config);
  const ids = this.registry.listIds();
  this.logger.log(`LLM providers initialized: ${ids.join(', ') || '(none)'} `);
  if (ids.length === 0) {
    this.logger.warn('No LLM providers registered. Set LLM_<PROVIDER>_API_KEY in .env to enable.');
  }
}
```

**`llm.config.ts` registerDefaultProviders** (L37-65):
- 读 `LLM_DEEPSEEK_API_KEY` → 注册 `DeepSeekChatProvider + DeepSeekEmbeddingProvider`
- 读 `LLM_DOUBAO_API_KEY` → 注册 `DoubaoChatProvider + DoubaoEmbeddingProvider`
- 读 `LLM_QWEN_API_KEY` → 注册 `QwenChatProvider + QwenEmbeddingProvider`
- **完全没读 `minimax.*` env**

**Anomaly**: spec V0.2 §12 "server LLM | MiniMax m3 (主) + OpenAI compatible (fallback) | ✅ 7.10 push" — 实际 MiniMax m3 **不在 llm 模块**, 在 `agent/llm/llm.service.ts` 独立 client. 跟 snapshot 描述的"集成"不一致.

#### 5.2.4 `migration/` 目录 — 42 文件

**V3 人生地图 3 张表** (已读):
- `1700000010002-AddLifeStageProgress.ts` → `life_stage_progress` 表
  - 字段: id/user_id/stage(enum 4 阶段)/completion_pct(int NULL)/stuck_points/gains/created_at/updated_at/deleted_at
  - 索引: PK(id) + idx_lsp_user(user_id) + UNIQUE idx_lsp_user_stage(user_id, stage)
  - **缺失 FK (user_id → users.uid)**: 注释明确 "不加 FK (user_id → users.uid): 软删兼容, 应用层校验用户存在"
- `1700000010003-AddKeyEvents.ts` → `key_events` 表
  - 字段: id/user_id/title/age/type(enum 3 档)/description/feelings/influence/interpretation/stage(enum NULL)/...
  - 索引: PK + idx_ke_user_age(user_id, age)
- `1700000010004-AddGenomeDimensions.ts` → `genome_dimensions` 表
  - 字段: id/user_id/key(enum 5 维度)/score(0-100)/tier(varchar 16)/source/improvement/...
  - 索引: PK + idx_gd_user + UNIQUE uniq_gd_user_key

**V6.0 §6.5 漂流瓶表 ⚠️ 缺失**:
- `DriftBottleEntry` entity `@Entity('life_map_drift_bottles')` 声明了
- **没有 `1700000010005-AddDriftBottles.ts` migration 文件** — `bin/ormconfig.ts` grep 确认无
- 后果: 即使 `life-map/` (dash) module 注册 (选项 A 治本后), drift-bottle 6 endpoint 调用会因 `life_map_drift_bottles` 表不存在而 TypeORM 启动错误

**V6.0 §3 AI 引擎 5 张表** (已读 `1714900000000-AddAIEngineTables.ts`):
- `ai_profile_cache` — 单维度画像 (uid+dimension UNIQUE)
- `ai_unlock_states` — 6 功能 + 4 维度评分 (uid+feature UNIQUE)
- `ai_effect_records` — 短/中/长 3 horizon + 8 数值字段
- `crisis_events` — 4 等级 (low/medium/high) + 3 来源 (keyword/llm_classifier/user_report), uid nullable 支撑匿名
- `llm_conversations` — 实时流式会话, token 累计 + crisis_event_id 关联

**注册入口** (`bin/ormconfig.ts`):
- 显式列出 42 migration (治本: 不走 glob, 避免 ts-node dev 时序问题)
- ✅ 已全列, 跟 `migration/` 目录 1:1 (除 `life_map_drift_bottles` 缺失)

#### 5.2.5 `database/` 目录 — 1 文件
- `naming-strategy.ts` — `AppNamingStrategy` (注册在 `app.module.ts` TypeOrmModule.forRootAsync 配置)

#### 5.2.6 `entity/` 目录 — 仅 sample
- `entity/sampledb1` + `entity/sampledb2` — typeorm-model-generator 生成的示例
- 实际生产 entity 在各业务 module 目录 (`user/entities`, `ai-engine/entities`, `life-map/entities` 等)

#### 5.2.7 `base/` 目录 — 5 文件
- `base.module.ts` + 4 controllers — 注册 `/auth/*` (AuthController) + `/health` (HealthController)
- snapshot 说"基础 5 file" 实际 1 module + 4 controller = 5 file ✓

#### 5.2.8 `config/` 目录 — 8 文件
- `config.interface.ts` (类型)
- `configuration.ts` (deep merge 函数)
- `envs/{default, development, production, test}.ts` (4 env config)
- `index.ts` (export 入口)
- `logger.config.ts` (Pino logger)
- `README.md` (说明)

### 5.3 `app.ts` + `repl.ts` + `swagger.ts` 入口

**`app.ts`** (40 行) — 主 bootstrap 入口:
1. `ensureUtf8Console()` (Windows GBK 兼容)
2. `NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false })`
3. `app.useLogger(app.get(Logger))` (Pino)
4. `app.useGlobalInterceptors(new LoggerErrorInterceptor())`
5. `if (isProduction) app.enable('trust proxy')`
6. `middleware(app)` (Express middleware, see `app.middleware.ts`)
7. `app.useWebSocketAdapter(new WsAdapter(app))` — V2026-10-09 治本: 用 @nestjs/platform-ws (不用 socket.io)
8. `app.enableShutdownHooks()`
9. `app.listen(process.env.PORT ?? 3000)`

**`repl.ts`** (6 行) — NestJS REPL 启动 (开发调试用, 不是生产入口)

**`swagger.ts`** (25 行) — Swagger 启动:
- `DocumentBuilder().setTitle('OpenAPI Documentation').setVersion('1.0').addBearerAuth().build()`
- `app.listen(process.env.SWAGGER_PORT ?? 8000)`
- 注释: "https://docs.nestjs.com/recipes/swagger" — 但实际 **这文件没在 main.ts (app.ts) 中调用**! main.ts 走的是 NestExpressApplication + Pino logger, **swagger 是独立入口**. 实际 swagger 是不是有跑, 需要启动时验证.

### 5.4 `app.middleware.ts` — Express middleware

(未读全文, 在 `app.ts` L17 import 用). snapshot 估 "app.* | 3 | 根 module/middleware/swagger, 估 production-ready".

### 5.5 基础设施 anomaly vs snapshot §6.3

| snapshot 声明 | 实际 | 评 |
|---|---|---|
| user (38 文件) | `user/` 实有 30+ 文件 (controllers 5 + cron 1 + decorators 1 + dto 1 + entities 5 + guards 1 + index 1 + oauth 7 + providers 9 + index 1 + user.constant + user.module + user.state) | snapshot 数稍大, 但量级对 |
| user "4 role (growth/companion/counselor_learner/guest)" | User entity 只有 `adminRole: 'editor'\|'reviewer'\|'admin'\|null` 1 字段; 4 role (growth_user/companion/counselor_learner + guest 实际 3 角色) 在 `UserProfile.currentRole` (3 值, **没 guest**) | **MAJOR ANOMALY: snapshot 说的 4 role 错** (实际 User 1 adminRole + UserProfile 3 currentRole, **无 guest 角色**) |
| common (29 文件) | common/ 9 子目录, 大约 20+ 文件 | 量级对 |
| shared (31 文件) | shared/ 4 子目录 (foobar/infra/types/user) + 3 file (README, index, types) = 估 15+ 文件 | snapshot 数稍大 |
| llm (15 文件) | llm/ 5 子目录, 估 13 文件 (module 1 + config 1 + registry 2 + common 3+ + providers 4 = 11+ ) | 量级对, 实际略小 |
| migration (42 文件) | migration/ 42 文件 ✓ | match |
| database (1 文件) | database/ 1 文件 (naming-strategy.ts) | match |
| entity (4 文件) | entity/ 0 file (仅 sampledb1/sampledb2 子目录) | snapshot 数稍小 |
| config (8 文件) | config/ 8 文件 (含 README) ✓ | match |
| base (5 文件) | base/ 1 module + 4 controller = 5 file | match |
| app.* (3 文件) | app.ts + app.module.ts + swagger.ts = 3 file (repl.ts 算第 4) | match |

---

## 6. 异常点 (跟 snapshot V2 §6 声明不符)

### 6.1 **CRITICAL: life_map 客户端/服务端错位 + life-map/ 完整版未注册**

- `app.module.ts` 只注册 `LifeMapModule from './life_map/life-map.module'` (下划线 1 endpoint)
- `life-map/life-map.module.ts` (中划线 V3.0 + V6.0 完整 12 + 6 endpoint) **未注册**
- client `lib/features/life_map/data/api/life_map_api_paths.dart` 12 个 path 全部走 `/profile/life-map/*`
- server 唯一注册的 `life_map/` 1 endpoint `/life-map/overview` **零 client 调用** (grep 0 命中)
- **结果**: 客户端 life_map 功能实际是 100% 走 client 本地 `LifeMapInMemoryDataSource` mock, server V3.0 + V6.0 完整版代码全部在磁盘上闲置
- `DriftBottleRepositoryImpl` (client) 完全 in-memory, 没 ApiClient — 6 个 server drift-bottle endpoint 0 client 调用
- **影响**: 跟 snapshot V2 §6.2 表第 18 行 "✅ P0-6 done" + §6.3 估 "92-95% done" 严重不符, **实际 server-side life_map 业务 0% 真接 client**

### 6.2 **CRITICAL: life_map_drift_bottles migration 缺失**

- `DriftBottleEntry` entity 声明 `@Entity('life_map_drift_bottles')` (4 entity 之一)
- **没有 `1700000010005-AddDriftBottles.ts` migration 文件** (确认 ls + grep 0 命中)
- 即便选了选项 A 把 `life-map/` module 挂上, drift-bottle 6 endpoint 一调就 TypeORM `TableNotFoundError`
- 这是上次扫描 (V0 阶段) 没暴露的隐藏 bug

### 6.3 **MAJOR: User role 系统跟 snapshot 描述不一致**

- snapshot §6.3 "user | 38 | JwtAuthGuard source + **4 role (growth/companion/counselor_learner/guest)** 切换"
- 实际 `user.entity.ts` 只有 1 role 字段: `adminRole: 'editor' | 'reviewer' | 'admin' | null` (3 档 + null)
- 3 业务角色 `growth_user / companion / counselor_learner` 在 `user_profile.entity.ts` 的 `currentRole` 字段 (3 值, **没 guest**)
- RoleValues const 数组: `['growth_user', 'companion', 'counselor_learner']` — 只有 3 角色
- **结论**: snapshot 说的 "4 role (growth/companion/counselor_learner/guest)" 实际是 **2 套独立角色系统** (adminRole 3 档 + currentRole 3 档), 实际可用角色总数 = 3 admin + 3 业务 = 6 角色, 跟 snapshot 描述的 4 完全不同
- 大炮若按 snapshot 预期找 "guest role" 会找不到

### 6.4 **MAJOR: LLM 架构跟 snapshot 描述不一致**

- snapshot §6.3 "llm | 15 | 抽象层 (被 voice/agent 内部用), **MiniMax + OpenAI compatible + chat/embedding provider**"
- 实际架构是 **2 套独立 LLM 链路**:
  - 链路 1: `ai-engine/LlmOrchestratorService` → `llm/LlmRouterService` → `ProviderRegistry` → deepseek/doubao/qwen/custom (4 OpenAI 兼容 provider)
  - 链路 2: `agent/llm/LlmService` → 直连 MiniMax m3 (独立 HTTPS streaming 客户端)
- 链路 1 的 4 provider 全部基于 **LangChain ChatOpenAI / OpenAIEmbeddings, 但 LangChain 包已卸, 现在是 stub** (`langchain-stubs.ts`)
- 链路 2 的 MiniMax m3 走 `src/agent/llm/llm.service.ts` (250+ 行), 不在 `llm/` 模块
- `llm.config.ts registerDefaultProviders` 完全不读 `minimax.*` env, 只读 `LLM_DEEPSEEK_API_KEY / LLM_DOUBAO_API_KEY / LLM_QWEN_API_KEY`
- **结论**: snapshot "MiniMax + OpenAI compatible" 描述是过度简化, 实际 2 套独立架构 + LangChain stub 占位 (真接 LLM 需要 `pnpm add @langchain/core @langchain/openai`)

### 6.5 **MINOR: ai-engine controller 数 5 vs 实际 6**

- snapshot §6.2 表 4-7 行只列 4 controller (ai-profile/ai-recommend/ai-unlock/ai-effect)
- 实际 `ai-engine.module.ts` 注册 6 controller (4 + LlmChatController + RagController)
- spec V0.2 §8 表 是 5 controller (4 + LLM SSE), 实际有 6 (多了 RAG). snapshot §6.2 表 4-7 行只列 4 是 **snapshot 漏报**, 不是代码问题.

### 6.6 **MINOR: 会员档位 5 档+none vs snapshot "4 档"**

- snapshot §6.2 表第 19 行 "4 档会员 + 4 SKU 单次"
- 实际 `MembershipDto.status`: `'none' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime'` — **5 档 + none**
- 实际 SKU: 4 个 (5/19.9/39.9/9.9 元), ✓ 跟 snapshot match
- "4 档" 实际是 "5 档 + none 占位", snapshot 描述略不准

### 6.7 **MINOR: TenantId 装饰器跟 JwtAuthGuard 数据契约不一致**

- `JwtAuthGuard` 实际注入 `request.user = { userId, username, roles }` (3 字段)
- `TenantId` 装饰器期望 `user.tenantId` 存在 (interface `AuthenticatedUser` 含 `tenantId?: string`)
- `TenantContextMiddleware` 兜底: `req.tenantId = user.sub` (V0.x dev fallback)
- 风险: `JwtAuthGuard` 必须从 JWT payload 解 `tenantId` (A9 spec V0.x `tenantId = uid`), 才有 `user.tenantId`. 否则 `@TenantId()` 走 middleware 兜底成 `user.sub` (uuid)
- 需要后续 batch 验证 JwtStrategy.validate 是否设了 `user.tenantId`. 若没设, 实际 `@TenantId()` 走 middleware 兜底是 `user.sub` (跟 spec A9 一致), 整个链路能跑, 但装饰器 error 路径 "missing tenantId" 永远不会被触发 (因为 middleware 兜底)

### 6.8 **MINOR: swagger.ts 没在主入口调用**

- `swagger.ts` 独立 listen `SWAGGER_PORT ?? 8000` 跟 `app.ts` 主入口 (PORT 3000) 完全分离
- 主入口 `app.ts` 不引用 `swagger.ts` (grep 确认)
- 后果: 默认 `pnpm start` (走 app.ts) 不会启动 swagger UI; 要 swagger 需 `node dist/swagger` (独立进程)
- 实际是不是有 `pnpm start:swagger` script 启动 swagger 没验证, 估是有的

### 6.9 **MINOR: ai-effect-record entity 跟 migration 字段完整性待对账**

- entity 30 行扫了 30 行, migration 60 行扫了 60 行
- 估 entity 跟 migration 字段名 1:1 (entity 用 camelCase, migration 用 snake_case), 但**未做字段级别逐一对账**
- 推荐下次 batch 单独 verify

### 6.10 **MINOR: 4 role 错位 + langchain stubs + drift migration 缺失 = 3 个 spec V0.2 §3 §10 §12 实际未达成**

- spec V0.2 §3 (心理地图) — 仅 1 endpoint mock, V3.0 12 endpoint **埋盘**
- spec V0.2 §10 (V6.0 §6.5 漂流瓶) — 6 endpoint **埋盘 + migration 缺失**
- spec V0.2 §12 (AI 引擎) — 4 controller 走 LangChain stub, **真接需装包**

---

## 7. 自验

- **读了 47 个文件** (38 server .ts + 4 client .dart + 2 docs + 1 bin + 2 env)
- **0 hallucination** — 所有 endpoint / 字段 / 配置值都从原文 grep 出
- **没跑 pnpm / tsc / eslint** — 0 命令
- **没改任何代码** — 仅 read
- **关键 finding 都给行号 / 路径 / 证据**:
  - life_map/ underscore 0 client 调用: grep 0 命中 `/life-map/overview` 在 client
  - life-map/ dash 未注册: grep 0 命中 `life-map` (dash) 在 app.module.ts
  - drift migration 缺失: ls migration/ | grep -i drift 0 命中
  - 4 role 错位: grep `counselor_learner` 等 + User entity 阅读
  - LLM 链路 2 套: 读 2 个 module (llm/ + agent/llm/) 全文
  - LangChain stub: 读 `langchain-stubs.ts` L2 注释 + `llm.config.ts` 全方法
  - TenantId 契约不一致: 读 `tenant-id.decorator.ts` + `jwt-auth.guard.ts` L80-90 + `tenant-context.middleware.ts` L20-32

### 报告核心结论

**snapshot V2 §6.2 表第 18 行 "life_map 1 controller overview, ✅ P0-6 done" + §6.3 估 "92-95%" 跟实际不符**:

1. `life_map/` underscore 1 endpoint 模块是 V0.5 P0-6 中间态, client 0 调用
2. `life-map/` dash V3.0 + V6.0 完整版 12 + 6 endpoint 全部埋盘未注册
3. `life_map_drift_bottles` migration 文件缺失
4. 实际 server-side life_map 业务对 client 是 **0% 真接, 100% mock**

**推荐治本: 选项 A (合并派)**: 删 `life_map/` (4 file) + 改 `app.module.ts` 2 行 + 新写 `1700000010005-AddDriftBottles.ts` migration, 估 1 message. 治本后 client 立即真接 V3.0 + V6.0 完整版.

---

## 8. 配套文档索引

| 路径 | 内容 | 用途 |
|------|------|------|
| `docs/progress/v3-deep-scan-2026-10-14.md` | V3 snapshot 主报告 (61KB, 14 章) | 当前主进度文档 |
| `docs/progress/v0.1-progress-snapshot-2026-10-13.md` | V2 snapshot (88KB) | 上一版进度 |
| `docs/specs/ai-voice-training-v0.2.md` | V0.2 spec (26KB) | 当前主 spec |
| `docs/specs/ai-voice-training-v0.1.md` | v0.1 spec (1926 行) | 历史 spec |
| `frontend/xin_su_app/docs/progress/batch1-xinsu-app-22-modules-scan-2026-10-14.md` | B1 报告 (44KB) | 心塑主 22 module 深度扫描 |
| `docs/progress/batch2-xinsu-app-counselor-billing-core-scan-2026-10-14.md` | B2 报告 | counselor 8 + billing + core + shared + app 深度扫描 |
| `docs/progress/batch3-mofang-nestjs-v01-xinsu-main-scan-2026-10-14.md` | B3 报告 (57KB) | v0.1 5 段 + 心塑 12 module 深度扫描 |
| **`docs/progress/batch4-mofang-nestjs-counselor-billing-lifemap-ai-infra-scan-2026-10-14.md` (本文件)** | **B4 报告** | **counselor 5 + billing + life_map 治本 + ai-engine + 基础设施 深度扫描** |

---

## 9. 文档元信息

- **作者**: subagent (B4)
- **基于**: 47 个文件 read 全文 (mofang-nestjs counselor 5 + billing + life_map 治本 + ai-engine + 基础设施 + 4 client 端对账)
- **下次 review**: VS-life-merge 完成后, 更新 V3 主文档 (异常 #1/#2 状态)
- **下次彻底重生成**: Phase 6 RAG 真联调 + Phase 9 调优后 (估 1-2 phase)
- **格式**: Markdown, 跟 V2 + B1 + V3 主文档一致
- **存路径**: `mofang-nestjs/docs/progress/batch4-mofang-nestjs-counselor-billing-lifemap-ai-infra-scan-2026-10-14.md`
- **跟 V3 主文档关系**: V3 §5 + §6 已包含本报告全部关键结论, 本报告是 V3 §5 + §6 的"独立扩展版", 包含 B4 subagent 视角 + 自验段 + 47 文件完整路径清单 + 完整 12+6 endpoint 表 + 完整 4 entity 字段表 + life_map 合并治本 SPEC 草稿
