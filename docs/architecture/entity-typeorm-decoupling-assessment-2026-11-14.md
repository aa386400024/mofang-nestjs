# entity 装饰器运行时依赖消除 · 只读方案评估（P-DEBT-11 / 另案 H）

> 评估日期：2026-11-14　　评估方：MiniMax Code（只读方案评估，零 src / spec / migration 改动）
> 基线 HEAD：`20bbf53`（TD-13 已交付）
> 事实源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11（L-1）+ TD-11 交付记录 §5.4 + TD-13 交付记录 §5.4 / §七
> 文档性质：**评估备忘** —— 陈述可行性、改动面、成本量级与推荐路线；**不替代**未来实现单的设计决策；本单不落地任何改造

---

## 1. 现状事实与闭包根因

### 1.1 机制：三段链条

1. **加载期求值**：entity 文件顶层的 `@Entity` / `@Column` / `@Index` / 关系装饰器是 **TypeScript 装饰器**，在**模块加载期**求值并调用 typeorm 的元数据注册函数 —— 因此 entity 文件必然持有对 `typeorm` 的**运行时值依赖**。
2. **文件级连带**：只要**任何**模块 import 了该 entity 文件（哪怕只是 `import type` 一个类型，或值导入一个定义在该文件里的枚举），该文件就会被加载，顶层装饰器随之求值 ⇒ `typeorm` 进入该模块的**传递闭包**。
3. **加载图的现实**：TypeORM 包的加载成本 ≈ 100 ms 量级（TD-10 实测 80~657 ms/包区间），闭包每多一条 typeorm 边，就多一份加载与内存成本。

### 1.2 既往实测结论（复述）

| 单号              | 做法                                                                                        | 实测结果                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TD-11（L-1a）** | 48 个文件的 `Repository` 值导入 → `import type`                                             | **import 加载图逐字相同**（本地模块 7986 → 7986、包引用 673 → 673、触达重型 SDK 的 spec 58 → 58、**逐 spec 差异 0**）—— 消除的是 service → typeorm 的**顶层直接边**，entity 边未动 ⇒ 收益 0 |
| **TD-13（L-1b）** | analytics 域 service 改依赖仓储端口（interface + Symbol token），TypeORM 实现下沉到 `data/` | service → typeorm 的**直接边归零**；但 service 仍**值导入**定义在 entity 文件里的枚举 `AnalyticsEventType` ⇒ entity 文件仍被加载 ⇒ **传递闭包仍在**                                         |

### 1.3 本次取证的**决定性事实**（本次评估新增，直接改变路径排序）

**事实 ① · 闭包主因不是"枚举 / 类型混放"，而是"entity 类被当作 DI token 在值位置使用"。**

- 101 个真实 entity 文件中，**97 个**被至少一处**值位置**导入（`@InjectRepository(X)` / `TypeOrmModule.forFeature([X])` / `repo.create(X)`），**仅 4 个** entity 文件没有任何值位置引用（2 个 typeorm-model-generator 样品 + 3 个 life-map 实体中有 2 个无引用，合计 5 个零引用文件，其中 2 个为样品）。
- 逐文件定性：**没有任何一个 entity 文件是"只被类型位置引用"的**（type-only-only 命中 0）。

**事实 ② · 枚举混放的面比预期小一个数量级。**

- 全仓 82 个枚举中，**只有 3 个**定义在 entity 文件里：`AnalyticsEventType`（analytics）、`OAuthProvider`（user）、`AuditEvent`（user）；其余全部在独立 `enums/` 目录或 `*.types.ts`。
- ⇒ "把枚举从 entity 文件挪走"的改动面是 **3 个文件**，不是 102 个。

**事实 ③ · TD-13 的 analytics spec 闭包里**仍有** typeorm。**

- `test/analytics/td13-analytics-repository-port.spec.ts` 仍写着 **值位置**导入：`import { AnalyticsEventType } from '../../src/analytics/entities/analytics-event.entity.js';` ⇒ 该 spec 的 import 闭包仍含 typeorm。
- ⇒ **TD-13 解除了 service 源码层的直接边，没有解除测试闭包。** 这是本次评估发现的最重要的一条，对另案 G 的收益口径有直接影响（见 §5.3）。

**事实 ④ · CLI 生成链路事实上已废弃。**

- `bin/ormconfig.ts` 的 `entities` 只 glob `../src/entity/**/*.{js,ts}` —— 而 99 个真实业务 entity 全在各域 `entities/` 子目录 ⇒ **CLI 的 DataSource 根本看不到它们**。
- 87 个 migration 中 `new Table(` 命中 **0** ⇒ **全部手写 DDL**；`synchronize: true` 在代码里命中 **0**（5 处命中全是"不用"的注释）⇒ ADR-0003 纪律严格成立。
- ⇒ EntitySchema 化对 CLI **零影响**（因为 CLI 压根不读业务 entity 元数据）。

### 1.4 规模与分布实测（口径见 §4.1）

| 指标                            | 实测                                                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@Entity` 装饰器                | **102** 处 ⇒ **101** 个真实 entity 文件（第 102 处在 `src/migration/1700000010005-AddDriftBottles.ts` 的**注释**里，非实体）                                           |
| 关系面 entity（关系装饰器命中） | **18** 个（另有 1 处误命中 `src/database/naming-strategy.ts` —— 其**注释**含 `@ManyToOne` 示例）                                                                       |
| 扁平 entity                     | **83** 个                                                                                                                                                              |
| `@Column` / `@Index`            | **859** / **188**                                                                                                                                                      |
| 生命周期列                      | `@CreateDateColumn` **90**、`@UpdateDateColumn` **67**、`@DeleteDateColumn` **2**                                                                                      |
| 主键                            | `@PrimaryGeneratedColumn` **88**、`@PrimaryColumn` **22**                                                                                                              |
| 关系装饰器                      | `@ManyToOne` **10**、`@OneToOne` **6**、`@OneToMany` **3**、`@JoinColumn` **15**；**0** 个 `@ManyToMany` / `@JoinTable` / `@Unique` / `@RelationId` / `@VersionColumn` |
| `TypeOrmModule.forFeature`      | **40** 处**代码调用**（另 39 处是**注释**提及；注册 entity 类引用 83 处）                                                                                              |
| migration 文件                  | **87**（全手写 DDL）                                                                                                                                                   |

---

## 2. 候选路径对比

### 2.1 四条路径的 API 形态示意（**仅示意，不落源码树**）

**路径 A · 装饰器保留 + spec 侧隔离**

```ts
// spec 侧：把 typeorm 从 import 图里挡掉（不碰 src）
vi.mock('typeorm', async () => {
  const actual = await vi.importActual<typeof import('typeorm')>('typeorm');
  return { ...actual, getRepositoryToken: () => 'stub' };
});
// 或者：spec 根本不 import entity —— 只用端口替身（TD-13 analytics 域已验证可行）
```

**路径 B · 纯类 domain model + 外置 schema**

```ts
// domain/user.ts —— 纯类，零 typeorm 依赖
export class User {
  id!: string;
  tenantId!: string;
  createdAt!: Date;
}

// data/user.schema.ts —— 唯一持有 typeorm 运行时依赖的地方
import { EntitySchema } from 'typeorm';
import { User } from '../domain/user.js';

export const UserSchema = new EntitySchema<User>({
  name: 'User',
  tableName: 'users',
  target: User,
  columns: {
    id: { type: 'varchar', primary: true, generated: 'uuid' },
    tenantId: { type: 'varchar', name: 'tenant_id' },
    createdAt: { type: 'datetime', createDate: true, name: 'created_at' },
  },
  indices: [{ name: 'idx_users_tenant', columns: ['tenant_id'] }],
});

// module：注册 schema 而非装饰器类
TypeOrmModule.forFeature([UserSchema]);
```

**路径 C · Row 纯类型 + 持久化 entity 分层映射**（**TD-13 analytics 域已是此形态**）

```ts
// domain/repositories/user.repository.ts —— 端口（纯 interface + Symbol token）
export interface UserRepository {
  findById(tenantId: string, id: string): Promise<UserRow | null>;
}
// domain/user.types.ts —— Row 纯类型
export interface UserRow {
  id: string;
  tenantId: string;
  createdAt: number; // 毫秒
}
// data/user.repository.typeorm.ts —— 唯一 import typeorm + entity 的文件
@Injectable()
export class UserRepositoryTypeorm implements UserRepository {
  constructor(@InjectRepository(UserEntity) private readonly repo: Repository<UserEntity>) {}
  async findById(tenantId: string, id: string): Promise<UserRow | null> {
    const row = await this.repo.findOne({ where: { tenantId, id } });
    return row ? toRow(row) : null;
  }
}
```

**路径 D · 维持现状**：装饰器不动、service 继续直接注入 `Repository`。

### 2.2 对比表

| 维度                                                                                    | **A · 装饰器保留 + spec 侧隔离**                                         | **B · 纯类 + EntitySchema 外置**                                                                                           | **C · Row 纯类型 + 持久化分层映射**                                                                                                               | **D · 维持现状** |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 改动面 · entity                                                                         | 0                                                                        | **101 文件 × 2**（纯类 + schema）                                                                                          | 0（entity 保持装饰器）                                                                                                                            | 0                |
| 改动面 · service                                                                        | 0                                                                        | ~100（改 `@InjectRepository` 与仓储调用）                                                                                  | ~100（改依赖端口）                                                                                                                                | 0                |
| 改动面 · repository                                                                     | 0                                                                        | 0（但新增 schema 层）                                                                                                      | ~100（新增 data/ 实现）                                                                                                                           | 0                |
| 改动面 · spec                                                                           | ≤20（触达 entity 的）                                                    | ≤20                                                                                                                        | ≤20（改用端口替身）                                                                                                                               | 0                |
| 改动面 · module                                                                         | 0                                                                        | ~34（forFeature 改注册 schema）                                                                                            | ~34（加 provider 接线）                                                                                                                           | 0                |
| 改动面 · ormconfig / CLI                                                                | 0                                                                        | 需显式注册 entities（当前 glob 看不到业务 entity）                                                                         | 0                                                                                                                                                 | 0                |
| 改动面 · migration                                                                      | 0                                                                        | 0（DDL 仍手写）                                                                                                            | 0                                                                                                                                                 | 0                |
| **运行时闭包是否解除**                                                                  | ❌ **不解除**（运行时 ORM 仍绑 typeorm，这是应该的）；只可能解**测试侧** | ⚠️ **可以解除**（业务层零 schema import 时），但 schema 文件**必然** import typeorm ⇒ 需静态守护防误引                     | ✅ **可以解除"业务层 → entity 文件"的边** ⇒ typeorm 只留在 `data/` 仓储实现与 module 装配层 ⇒ **测试闭包实质解除**（前提：spec 零 entity import） | ❌ 不解除        |
| 测试隔离改善                                                                            | 有限：仅 20 个触达 entity 的 spec                                        | 彻底（若纪律守住）                                                                                                         | 彻底（若 spec 零 entity import）                                                                                                                  | 无               |
| 可测性                                                                                  | 不变                                                                     | 变好（纯类可独立单测）                                                                                                     | 变好（端口替身）                                                                                                                                  | 不变             |
| 主要风险                                                                                | **低**；但收益上限低，且只对"测试侧"有效                                 | **高**：① 关系映射（18 个文件）语义漂移风险；② `@InjectRepository` token 语义变更；③ schema 误引即闭包复活；④ CLI 依赖调整 | **中**：逐域可控、每批可回归；TD-13 已跑通模板                                                                                                    | 技术债累积       |
| 纪律兼容（engine-core 纯层 / 手写 DDL / `synchronize: false` / entity 纪律 / 隐私红线） | ✅ 全兼容                                                                | ✅ 兼容（DDL 仍手写），但**违背"entity 字段与装饰器 1:1 对应 DDL"的既有校验习惯**                                          | ✅ 全兼容（entity 不动、DDL 不动）                                                                                                                | ✅ 全兼容        |
| 成本量级                                                                                | **小**（≤20 spec + 少量 mock）                                           | **大**（数百文件；含关系重写与静态守护）                                                                                   | **中**（按域分批，每批 ~10-30 文件）                                                                                                              | **零**           |
| 风险等级                                                                                | 低                                                                       | 高                                                                                                                         | 中                                                                                                                                                | —                |

### 2.3 关键判别（为什么 C 优先于 B）

1. **B 解决的是"entity 类当 DI token"这个根因；但 C 已经用"仓储下沉"把业务层从 entity 类上摘掉了。** TD-13 的 analytics 域：service 只依赖端口 interface（`import type`），唯一残留是值导入一个枚举。⇒ **B 相对 C 的增量收益 = 3 个枚举的文件位置**，而 B 的代价是数百文件。
2. **B 引入一个新的纪律负担**：schema 文件必然 `import { EntitySchema } from 'typeorm'`（它是**值**，必须 `new EntitySchema({...})`）。任何一处业务代码误 import schema ⇒ 闭包立刻复活，且**没有任何自动机制能发现**（需自建 lint 规则 / 架构测试）。C 不产生这个面 —— typeorm 天然收敛在 `data/` 目录里。
3. **实测证据支持 C 可行**：TD-13 的 analytics 域已是 C 的形态（端口 + `data/` 实现 + module provider 接线），11 例端口替身 spec + 全量 3263 例全绿 + 运行时 DI 验证通过（`node dist/app` /health 200）。C 不是纸面方案，**仓内已有可复制的落地样本**。
4. **A 不该单独作为 H 的解法**：它的收益上限 = 20 个触达 entity 的 spec 文件（占 195 个 spec 的 10%），且 §1.3 事实 ③ 已证明"spec 零 entity import"才是真解法，A 的 mock 只是它的降级形态。

---

## 3. TypeORM 1.1.2 可行性核查（只读，基于仓内安装版本）

> 核查对象：`node_modules/typeorm@1.1.2` + `node_modules/@nestjs/typeorm@12.0.2`（实测安装版本，与 package.json 声明 `^1.1.1` / `^12.0.2` 一致）。证据路径见下表。

### 3.1 外置 schema（EntitySchema）能力面

| 装饰器能力                                                      | EntitySchema 对应 API（typeorm 1.1.2）                                                                                                                                                                               | 证据                                                          | 结论                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| `@Entity('table')`                                              | `EntitySchemaOptions.name / tableName`                                                                                                                                                                               | `node_modules/typeorm/entity-schema/EntitySchemaOptions.d.ts` | ✅ 覆盖                                     |
| `@Column({type, name, length, nullable, default, enum, ...})`   | `EntitySchemaColumnOptions`：`type` / `name` / `length` / `nullable` / `default` / `enum` / `enumName` / `unique` / `transformer` / `comment` / `precision` / `scale`                                                | 同上 + `EntitySchemaColumnOptions.d.ts`                       | ✅ 覆盖                                     |
| `@PrimaryGeneratedColumn('uuid')`                               | 列选项 `primary: true` + `generated: 'uuid'                                                                                                                                                                          | 'increment'                                                   | 'rowid'                                     | true` | `EntitySchemaColumnOptions.d.ts` | ✅ 覆盖 |
| `@PrimaryColumn`                                                | 列选项 `primary: true`                                                                                                                                                                                               | 同上                                                          | ✅ 覆盖                                     |
| `@CreateDateColumn` / `@UpdateDateColumn` / `@DeleteDateColumn` | 列选项 `createDate?: boolean` / `updateDate?: boolean` / `deleteDate?: boolean`（另有 `version?: boolean`）                                                                                                          | 同上                                                          | ✅ 覆盖                                     |
| `@Index('name', ['a','b'])`（复合）                             | `EntitySchemaOptions.indices: EntitySchemaIndexOptions[]`，每项含 `name` / `columns?: string[]` / `unique` / `synchronize`                                                                                           | `EntitySchemaIndexOptions.d.ts`                               | ✅ 覆盖                                     |
| `@ManyToOne` / `@OneToOne` / `@OneToMany`                       | `EntitySchemaOptions.relations`：`target: EntityTarget` / `type: RelationType` / `joinColumn` / `joinTable` / `inverseSide` / `lazy` / `eager` / `onDelete` / `onUpdate` / `createForeignKeyConstraints` / `primary` | `EntitySchemaRelationOptions.d.ts`                            | ✅ 覆盖                                     |
| `@JoinColumn({name})`                                           | 关系选项 `joinColumn?: boolean                                                                                                                                                                                       | JoinColumnOptions                                             | JoinColumnOptions[]`                        | 同上  | ✅ 覆盖                          |
| 纯类绑定（关键）                                                | `EntitySchemaOptions.target?: Function`                                                                                                                                                                              | `EntitySchemaOptions.d.ts`                                    | ✅ 覆盖 —— schema 可绑定纯类作为实体 target |

**结论**：TypeORM 1.1.2 的 EntitySchema 在**表达力上完整覆盖**仓内用到的全部装饰器（无缺口）。**但"能表达"不等于"该做"** —— 表达力不改变 §2.3 的成本 / 收益比。

### 3.2 Nest 侧装配（@nestjs/typeorm 12.0.2）

| 环节                        | 实测                                                                                                                                                                                                                                                                 | 结论                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forFeature` 的实体参数类型 | `EntityClassOrSchema = Function                                                                                                                                                                                                                                      | EntitySchema`（`dist/interfaces/entity-class-or-schema.type.d.ts`）；`TypeOrmModule.forFeature(entities?: EntityClassOrSchema[])`（`dist/typeorm.module.d.ts`）                 | ✅ **原生接受 EntitySchema** |
| 仓储注入 token              | `@InjectRepository(entity) = Inject(getRepositoryToken(entity))`（`dist/common/typeorm.decorators.js`）；`getRepositoryToken` 对 EntitySchema 分支取 `entity.options.target ? target.name : options.name`，拼 `"<name>Repository"`（`dist/common/typeorm.utils.js`） | ⚠️ **token 形状与装饰器类同形**（同名类 → 同一 token 字符串）⇒ 理论上 `@InjectRepository(UserPureClass)` 与 `forFeature([UserSchema])` 对得上；**端到端运行时行为需实现单验证** |
| 运行时 DataSource 收集      | `EntitiesMetadataStorage.addEntitiesByDataSource(dataSource, entities: EntityClassOrSchema[])`（`dist/entities-metadata.storage.d.ts`）                                                                                                                              | ✅ 接受 EntitySchema                                                                                                                                                            |
| 运行时连接                  | 三套 env（`development` / `production` / `test`）均 `synchronize: false` + `autoLoadEntities: true`（`src/config/envs/*.ts`）                                                                                                                                        | ✅ 纪律不变；autoLoad 走 forFeature 注册面                                                                                                                                      |
| 命名策略                    | `src/database/naming-strategy.ts` 的 `AppNamingStrategy` 覆写 `joinColumnName` / `joinTableColumnName` 为 snake_case                                                                                                                                                 | ⚠️ **EntitySchema 的关系 join 列名是否走同一策略需实现单验证**（18 个关系 entity 受影响）                                                                                       |

### 3.3 CLI（`migration:generate` / `schema:sync` / `bin/entity.ts`）

| 工具                                 | 实测现状                                                                                                                                                                                                       | 对路径 B 的影响                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `migration:generate` / `schema:sync` | `bin/ormconfig.ts` 的 `entities` 只 glob `src/entity/**/*.{js,ts}`（只命中 2 个 typeorm-model-generator 样品）⇒ **CLI 看不到 99 个业务 entity**；87 个 migration 中 `new Table(` 命中 **0** ⇒ **全部手写 DDL** | **零影响**（CLI 生成链路事实废弃）；但反过来说明**仓内已有一条独立既有债**：glob 口径与真实 entity 位置脱节          |
| `migration:run` / `revert` / `show`  | 只认 `bin/ormconfig.ts` 的**显式数组**（87 项）+ `src/migration/index.ts` 双登记点                                                                                                                             | 零影响（DDL 不动）                                                                                                   |
| `bin/entity.ts`                      | typeorm-model-generator 反向生成（DB → 装饰器 entity），产出落在 `src/entity/`                                                                                                                                 | ⚠️ 若将来用它生成新表，产物是**装饰器**而非 schema ⇒ **B 与该生成器不兼容**（需另写 schema 生成器或改人工写 schema） |

### 3.4 核查小结

- **技术上**：TypeORM 1.1.2 + @nestjs/typeorm 12.0.2 **完整支撑**路径 B 的 schema 表达与装配，**无 API 缺口**。
- **但有 3 个"需实现单验证"项**（不写确定结论）：
  1. EntitySchema + 纯类 target 的 `@InjectRepository` token 端到端行为（token 形状已核实同形，运行时未验证）；
  2. EntitySchema 关系映射是否走 `AppNamingStrategy` 的 snake_case join 列名；
  3. EntitySchema 下 `@CreateDateColumn` / `@UpdateDateColumn` 的自动赋值与装饰器版是否逐字等价（涉及 90 + 67 处）。
- **结论**：**能力面不是路径 B 的瓶颈；成本与纪律负担才是。** 本备忘不因"API 不支持"否决 B，也不因"API 支持"推荐 B。

---

## 4. 影响面清单

### 4.1 口径声明（本备忘所有计数口径）

- **entity 清单**：`src/**` 下含 `@Entity(` 的文件，按**出现次数**计（注释命中单列说明）。
- **引用分布口径**：**文件内出现 `entities?/` 路径段**即计入；区域归类 —— service = `providers/` 目录**或** `.service.ts` 后缀；controller / dto / types 按后缀；entity-self = 文件位于 `entities/` 目录内；test = `test/` 下。**该口径下实测与主控锚点 7 个数字逐字一致**（见 §4.2）。
- **值位置 / 类型位置**：import 语句带 `import type` 前缀 = 类型位置；否则 = 值位置（**含** `import { X } from '...entity.js'` 只用于泛型标注的情况）。

### 4.2 引用分布（锚点复核 —— **逐字一致**）

| 区域        | 主控锚点 | 实测    | 判定    |
| ----------- | -------- | ------- | ------- |
| service     | 98       | **98**  | ✅ 一致 |
| src-other   | 67       | **67**  | ✅ 一致 |
| test        | 20       | **20**  | ✅ 一致 |
| entity-self | 16       | **16**  | ✅ 一致 |
| controller  | 6        | **6**   | ✅ 一致 |
| dto         | 5        | **5**   | ✅ 一致 |
| types       | 2        | **2**   | ✅ 一致 |
| **合计**    | **214**  | **214** | ✅ 一致 |

> service 98 / src-other 67 的分界取决于 8 个文件的归类（`providers/` 目录下的 `.cron.ts` / `.processor.ts` / `.contributor.ts` / `.builder.ts` / `.resolver.ts` / `.repository.ts` / `.spec.ts`）—— 归入 service 才与锚点一致。

### 4.3 entity 分层（101 个真实 entity 文件）

| 域              | entity 数 | 关系面 | 扁平 | 域                   | entity 数 | 关系面 | 扁平   |
| --------------- | --------- | ------ | ---- | -------------------- | --------- | ------ | ------ |
| counselor       | 25        | 2      | 23   | life-map             | 4         | 0      | 4      |
| profile         | 10        | 6      | 4    | agent                | 2         | 1      | 1      |
| companion       | 10        | 2      | 8    | embodied             | 2         | 2      | 0      |
| inner_world     | 7         | 0      | 7    | entity（生成器样品） | 2         | 0      | 2      |
| ai-engine       | 5         | 0      | 5    | analytics            | 1         | 0      | 1      |
| engine-adapters | 5         | 0      | 5    | quality              | 1         | 0      | 1      |
| home            | 5         | 0      | 5    | good_state_diary     | 1         | 0      | 1      |
| practice        | 5         | 0      | 5    | consent              | 1         | 0      | 1      |
| user            | 5         | 4      | 1    | emergency            | 1         | 0      | 1      |
| auto-practice   | 4         | 0      | 4    | ai-companion         | 1         | 1      | 0      |
| knowledge-base  | 4         | 1      | 3    | **合计**             | **101**   | **18** | **83** |

> 关系面 18 个 = supervisor 报告 / ai-companion 会话 / companion-tree 2 个 / counselor 长案 2 个 / embodied 2 个 / KB item / profile 6 个 / user 4 个。**注**：`src/database/naming-strategy.ts` 命中关系装饰器是**注释示例**误命中，已剔除。

### 4.4 引用热度 Top（被引用文件数 = 引用它的模块数）

| entity                                                                                                                       | 引用数 | 其中值位置    | 类型位置      |
| ---------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | ------------- |
| `user.entity.ts`                                                                                                             | 41     | 41            | 0             |
| `training-session.entity.ts`                                                                                                 | 22     | 21            | 1             |
| `character-profile.entity.ts`                                                                                                | 21     | 15            | 6             |
| `counselor-mode.entity.ts`                                                                                                   | 13     | 10            | 3             |
| `practice-session.entity.ts`                                                                                                 | 11     | 11            | 0             |
| `audit-log.entity.ts`                                                                                                        | 9      | 9             | 0             |
| `persona.entity.ts`                                                                                                          | 9      | **1**         | 8             |
| `user-profile.entity.ts`                                                                                                     | 9      | 9             | 0             |
| `analytics-event.entity.ts`                                                                                                  | 7      | 6             | 1             |
| `session-evaluation.entity.ts` / `quality-annotation.entity.ts` / `companion-binding.entity.ts` / `knowledge-item.entity.ts` | 7 each | 7 / 6 / 7 / 7 | 0 / 1 / 0 / 0 |

**零值位置引用的 entity 文件（5 个）**：2 个生成器样品 + `life-stage-progress` / `key-event` / `genome-dimension`（life-map 域）。

### 4.5 20 个 test 文件定性（触达 entity 的 spec）

| 定性                                                         | 文件数 | 典型                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **值位置**（含 entity 类作构造参数 / 断言对象 / mock token） | **15** | `base/auth-reset-password`（`AuditEvent` / `User`）、`counselor/wp43`、`auto-practice/practice-runner`（`CounselorMode`）、`analytics/td13-...`（`AnalyticsEventType`）、`helpers/user-stub`      |
| **类型位置**（仅 `import type`）                             | **3**  | `agent/visitor-prompt-semantic-tags`（`Persona` / `PersonaDifficulty`）、`auto-practice/counselor-agent`（`CounselorMode`）、`engine-adapters/wp38-character-version-semver`（`TrainingSession`） |
| 未触达 entity 的 spec                                        | 175    | ——                                                                                                                                                                                                |

> 15 个值位置 spec 是"测试闭包"的实际承载面；**把其中 3 个枚举的 import 改成 type-only 不足以解决**（`AuditEvent` / `User` / `CounselorMode` 等是**类**，值位置使用是业务语义所需）⇒ 只能靠"spec 改用端口替身 / 纯类型"（路径 C 的配套）来根治。

### 4.6 枚举与自定义类型的拆分面

| 位置                                  | 数量  | 枚举清单                                                                                                                                                                         | 影响                                                                                                    |
| ------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **entity 文件内**                     | **3** | `AnalyticsEventType`（analytics）、`OAuthProvider`（user）、`AuditEvent`（user）                                                                                                 | 外移到 `enums/` 目录 = **3 个文件改动 + 引用点改 import 路径**；**零 schema 变更**（enum 列名与值不变） |
| 独立 `enums/` 目录 / `.types.ts`      | 82    | counselor 29 / inner_world 5 / ai-engine 5 / good_state_diary 4 / user 4 / knowledge-base 2 / life-map 1 / companion 1 / common 2 / emergency 1 / llm 1 / engine-core 2 / 其它 5 | 无需改动                                                                                                |
| entity 内的**自定义类型 / interface** | 0     | ——                                                                                                                                                                               | 无                                                                                                      |

### 4.7 先例（仓内已有的纯类型分层）

| 先例                                    | 位置                                                                                         | 可复用度                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| supervisor Row 类型 + 仓储 `toRow` 转换 | `src/agent/supervisor/supervisor.types.ts` + `data/supervision-report.repository.typeorm.ts` | ★★★ 端口 + Row 转换的**完整样板**，含 TypeORM 实现 |
| engine-core 纯类型 + 内存模型           | `src/engine-core/domain/` + `src/engine-core/in-memory/`                                     | ★★ 纯层纪律样板（但那是内核，不得混用）            |
| 共享纯类型                              | `src/shared/types/`                                                                          | ★ 命名与放置惯例                                   |
| **TD-13 analytics 端口**                | `src/analytics/domain/repositories/` + `data/`                                               | ★★★ **仓储下沉（路径 C）的端到端可运行样板**       |

---

## 5. 推荐结论

### 5.1 首选路径：**C · Row 纯类型 + 持久化分层映射**（含"枚举外移"配套）

**一句话理由**：仓内已有可运行样板（TD-13 analytics 域），零 schema / 零 DDL / 零 CLI 改动，能真正切断"业务层 → entity 文件"的边，且不引入 EntitySchema 那种"schema 文件必然带 typeorm、需静态守护"的长期负担。

**配套必做项（否则闭包不解）**：

1. **枚举外移**：3 个 entity 文件内枚举（`AnalyticsEventType` / `OAuthProvider` / `AuditEvent`）迁到独立纯类型文件 —— 这直接修掉 §1.3 事实 ③（TD-13 analytics spec 的残留闭包）。
2. **spec 零 entity import**：每批的验收项 —— 新增/改动的 spec 不得**值位置** import entity 类。

### 5.2 不推荐路径及原因

| 路径                        | 判定                                             | 原因                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B · 纯类 + EntitySchema** | ❌ **不推荐**（技术可行，但成本 / 收益比不成立） | ① 它解决"entity 类当 DI token"，而 C 已通过仓储下沉把业务层摘离 entity 类，**B 相对 C 的增量只剩 3 个枚举的位置**；② 代价是数百文件 + 18 个关系 entity 的映射重写 + token 语义变更 + CLI 生成器不兼容；③ schema 文件**必然** import typeorm（值），任何误引即闭包复活，需自建静态守护 —— 这是**长期**纪律成本；④ TypeORM 升级绑定更紧（schema 表达力随版本 API 变动） |
| **A · 单独作为 H 的解法**   | ⚠️ **降级为配套**                                | 收益上限 = 20 个触达 entity 的 spec（195 个中的 10%），且 §4.5 显示 15 个是**值位置**使用（mock token / 断言对象），mock typeorm 并不能消除"业务代码 import entity 类"这条边 —— 真正的解是路径 C 的 spec 端口替身                                                                                                                                                     |
| **D · 维持现状**            | ⚠️ **可接受但非最优**                            | 成本为零，代价是 P-DEBT-11 的 L-1 长期挂着；TD-13 已经证明"契约端口化"本身有独立价值（可测性 / 可替换性），**不依赖 H**                                                                                                                                                                                                                                               |

### 5.3 对另案 G 的收益口径影响（**这是本单对排期最直接的作用**）

| 收益项                                    | G 每批能否拿到  | 依据                                                                                                                                                                                                         |
| ----------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| service → typeorm 的**直接**导入边归零    | ✅ 能           | TD-13 analytics 域已验证（typeorm 值符号 0 命中）                                                                                                                                                            |
| service → entity 类的**值位置**导入边归零 | ✅ 能           | 端口化后 service 只 `import type` 端口 interface                                                                                                                                                             |
| **测试侧 import 闭包**减重                | ⚠️ **默认不能** | 路径 C 下 typeorm 仍经 `data/` 仓储实现与 module 装配进入**运行时**闭包（这是应该的）；spec 只有在**零 entity import**时才不触达 entity —— TD-13 的 analytics spec 就没做到（仍值导入 `AnalyticsEventType`） |
| 因此 G 每批的**正确验收口径**             | ——              | "service 源码层 typeorm 值符号 0 命中" ✅ + "**该批 spec 值位置 entity import = 0**" ✅；**不要**再以"加载图减重"作为 G 的 KPI（那是 H 的口径，且实测收益为 0）                                              |
| G 的排期建议                              | ——              | **继续推进**（G 本身有独立价值），但**收益预期从"加载图减重"改为"契约边界 + 可测性"**；加载图收益单独挂 H，且 H 的最小切口是 §6 的 C+                                                                        |

### 5.4 闭包是否真正解除（逐路径明确回答）

| 路径          | 运行时闭包                                                                      | 测试闭包                                                |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A             | ❌ 不解除（且这是**正确**的 —— 运行时本来就要 typeorm）                         | ⚠️ 部分（≤20 spec，且需逐个改法）                       |
| B             | ✅ 可解除（前提：业务层零 schema import + 静态守护）                            | ✅ 可解除                                               |
| **C（推荐）** | ✅ **解除"业务层 → entity 文件"这条边**；typeorm 收敛在 `data/` + module 装配层 | ✅ **可解除**（前提：spec 零 entity import + 枚举外移） |
| D             | ❌                                                                              | ❌                                                      |

---

## 6. 分期路线与试点标准

### 6.1 推荐路线（C + 配套，分三段）

| 段                           | 内容                                                                                                                           | 规模                                                                   | 前置        | 产出                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------- | -------------------------------------------------------- |
| **C+（最小切口，建议先做）** | **枚举外移**：3 个 entity 内枚举 → 独立纯类型文件；同步修 TD-13 analytics spec 的值位置 import                                 | **3 个 entity 文件 + 1 个 spec + 引用点**（约 15-25 处 import 改路径） | 无          | **TD-13 analytics 域测试闭包实测解除**（唯一残留边消失） |
| **C1（试点域）**             | 选 1 个**扁平、无跨模块仓储消费、entity 无枚举**的域，按 TD-13 四件套落地（端口 + `data/` 实现 + module 接线 + spec 端口替身） | 1 域 3-5 个 entity + 对应 service/spec                                 | C+ 完成     | 可复制的域级模板 + 第一个"spec 零 entity import"样板     |
| **C2（推广）**               | 按另案 G 分批推广，每批加"spec 零 entity import"验收                                                                           | 按域                                                                   | C1 验收通过 | 逐域解除业务层 → entity 边                               |

### 6.2 试点域选择标准（按优先级）

1. **扁平表优先**（无关系装饰器）—— 仓内 83/101 是扁平，关系面集中在 profile（6）/ user（4）/ counselor（2）/ companion（2）/ embodied（2）/ agent（1）/ KB（1）/ ai-companion（1）
2. **entity 文件内无枚举** —— 否则枚举外移要先做（analytics ✅ / quality ✅ / life-map ✅ / user ❌ / companion ❌）
3. **无跨模块仓储消费**（仓储只被本域 service 用）—— 避免端口 token 被外部依赖
4. **引用面小**（被引用模块少）+ **module forFeature 单点注册**
5. **已有等价端口先例可抄** —— 如 supervisor（Row + toRow）

**候选域排序（建议）**：**life-map**（4 entity、0 关系、0 枚举、引用面小）→ **quality**（1 entity、0 关系、0 枚举）→ **home / inner_world / ai-engine**（0 关系、无枚举）→ **companion**（有 2 个关系 + 枚举，后置）→ **profile / user / counselor**（关系面重、枚举混放，最后）。

### 6.3 路径 B 的分期（**仅在 C+ 与 C1 被否时才启动**）

| 段  | 内容                                                                                               | 规模        |
| --- | -------------------------------------------------------------------------------------------------- | ----------- |
| B0  | 先修 CLI 既有债：`bin/ormconfig.ts` 的 `entities` glob 口径（否则 CLI 连现装饰器 entity 都看不到） | 1 文件      |
| B1  | 选 **1 个扁平 entity** 做 EntitySchema 样板（不限域，只验机制），含 §3.4 的 3 个"需实现单验证"项   | 2-3 文件    |
| B2  | 关系 entity（18 个）逐一迁                                                                         | 18 × 2 文件 |
| B3  | 剩余扁平 entity 批量迁                                                                             | 81 × 2 文件 |

---

## 7. 风险与未决项

### 7.1 风险

| 风险                     | 说明                                                                                                                  | 缓解                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **TypeORM 版本升级绑定** | 装饰器 API 随版本变动；EntitySchema 表达力亦然（实测基线 typeorm 1.1.2）                                              | 路径 C 不改 schema 表达 ⇒ 升级只影响持久化层一个域；路径 B 会把 101 个 entity 的 schema 绑死在特定版本 API 上 |
| **关系字段后置迁移**     | 18 个关系 entity 的 join 列名依赖 `AppNamingStrategy` 的 snake_case 兜底 + 显式 `@JoinColumn`                         | 关系域（profile / user / counselor）排在最后；每批用真库对照列名                                              |
| **migration / CLI 适配** | 87 个 migration 全手写 DDL（DDL 不受 entity 表达影响）；但 CLI 的 `entities` glob 看不到业务 entity（**既有独立债**） | 路径 C 不触碰；B 需先修 glob（B0）                                                                            |
| **与 G 的先后依赖**      | G 是 C 的推广；C+ 是 G 的前置（枚举外移）                                                                             | 建议 C+ 先做，再启动 G 第一批                                                                                 |
| **端口化的隐性成本**     | 端口方法面设计不当会变成"通用代理"（TD-13 红线）                                                                      | 沿用 TD-13：方法面只收现有调用，不扩通用代理；每批用端口替身 spec 断言调用参数                                |
| **spec 替身语义漂移**    | 用端口替身替换真库语义时，可能掩盖真实 ORM 行为（如 N+1、软删口径）                                                   | 每批保留至少一个真库集成 spec（仓内已有 3 个例外登记先例）                                                    |

### 7.2 未决项（**需实现单验证**，本单不写确定结论）

1. EntitySchema + 纯类 target 的 `@InjectRepository` token **端到端**运行时行为（token 形状已核实同形，运行时未验证）。
2. EntitySchema 关系映射是否走 `AppNamingStrategy` 的 snake_case join 列名。
3. EntitySchema 下 `@CreateDateColumn` / `@UpdateDateColumn` 自动赋值与装饰器版是否**逐字等价**（涉 90 + 67 处）。
4. 装饰器计数口径差异（§4 与交付记录偏差表）：锚点与实测在 `@PrimaryGeneratedColumn` / `@PrimaryColumn` / `@JoinColumn` / `@ManyToOne` / `@Column` 上差 1~4 处，**不影响任何结论**，但**具体差异来源需一次对齐口径的复算**。
5. TD-13 analytics spec 是否可在枚举外移后**完全不 import entity 文件**（含 `TimeRange` DTO 侧的 `@nestjs/swagger` 引入成本是否值得一并评估）。

### 7.3 另案登记（本单不做）

| 编号        | 项                                                                                              | 状态                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **G**       | 其余 117 个 service 仓储端口化分批推广                                                          | 🟠 待排期 —— **收益口径按 §5.3 修正**（不再以"加载图减重"为 KPI）      |
| **I**       | 端口内存实现是否补                                                                              | 🟢 暂不补 —— analytics 无此需求                                        |
| **J**       | 混合形态 typeorm import 文件统一形态                                                            | 🟢 可读性向、零运行时收益 —— 另案批量处理                              |
| **K（新）** | `bin/ormconfig.ts` 的 `entities` glob 口径与真实 entity 位置脱节（CLI 看不到 99 个业务 entity） | 🟠 独立既有债 —— 只影响"想恢复 migration:generate"这一条路；本单不清理 |

---

_本备忘为**只读方案评估**：零 src / spec / migration 改动；TypeORM 能力面核查基于仓内安装版本（typeorm 1.1.2 / @nestjs/typeorm 12.0.2）的类型定义与实现源码；文中代码示例仅示意 API 形态，**不落源码树**；未新增依赖、未改 package.json / tsconfig / vitest 配置 / CI。_
