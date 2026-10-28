# AI 模拟来访池 · 后端落地 (V2026-10-23)

> 规范: `docs/specs/counselor-visitor-pool.md` v1.0 (后端) + `xin_su_app/docs/product/visitor-pool-design.md` (前端契约)
> 范围: **只做后端** (`mofang-nestjs`); 前端 `xin_su_app` 0 改动 (只读对照契约)
> 红线: 不装依赖 / 不构建 / 不启动 / 不跑迁移与 seed —— 环境侧操作与运行验证均由作者手动执行
> 本文随实现同步更新, 含**两轮修复记录** (§0) 与**化名命名规则** (§0.2)

---

## 0. 修复记录 (2026-10-23 晚)

### 0.1 id 列宽 / 主键方案错配

**现象**: 作者在 dev 库跑 `npm run seed:visitor-pool` → `QueryFailedError: Data too long for column 'id' at row 1`.

**根因** (不是"某个 id 写长了", 是两处设计错配):

1. **列宽不匹配 id 方案**: 模板 id 是**内容 slug** (形如 `vpt_self_worth_intellectualization_l1` = 37 字符, 未来组合如 `vpt_social_anxiety_intellectualization_l1` 可达 40), 而建表时照抄 UUID 的 `CHAR(36)`. 仓库既有的 `quotes.id` 早就是 `varchar(64)` —— 同一个坑.
2. **主键声明与写入方式矛盾**: entity 写 `@PrimaryGeneratedColumn('uuid')`, 而 seed 显式写 slug id. 后果比第 1 条更隐蔽: **任何不传 id 的 insert 会静默拿到随机 UUID** —— 而 AI 生成端点 (`visitor-pool-admin.service.ts`) 正是那样的路径, 库里会混入"内容派生但 id 随机"的行, 破坏"id 可由内容复现"这一不变量.
3. **同一 id 在 3 张表里流转, 只建表不动引用列** → `visitor_pool_favorites.template_id` / `visitor_full_personas.source_template_id` 同为 `CHAR(36)`, 收藏路径会以同样方式炸.

**修法** (治本, 不做"缩短一个 id"的补丁):

| 改动 | 说明 |
|---|---|
| 迁移 `1714900000019` (新增) | 3 列一起放宽到 `VARCHAR(64)`; 幂等 (先 `SHOW COLUMNS` 读类型再 ALTER); **不改已执行的 0018** —— 迁移只增不改, 否则新库与老库结构分叉 |
| `visitor-pool-template.entity.ts` | `@PrimaryGeneratedColumn('uuid')` → `@PrimaryColumn({ type: 'varchar', length: 64 })` (对齐 `quotes`) |
| `visitor-pool-favorite.entity.ts` / `visitor-full-persona.entity.ts` | 引用列同步改 `varchar(64)` |
| `visitor-pool-admin.service.ts` | AI 生成路径显式给 id `vpt_gen_<uuid32>` (主键不再自增, 写入方必须给) |
| `visitor-pool.config.ts` | 新增单一真值 `VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH = 64` (entity 装饰器 / 迁移 DDL / seed 自检三处引用) |
| `visitor-pool-seed.ts` | 基线自检新增 **id 长度断言** → 超长 id 在连库之前就炸, 不再出现"前 4 条已入库、第 5 条炸"的半截状态 |

**遗留**: 修复**未在真实 MySQL 上执行过** —— 迁移 0019 与 seed 重跑需作者手动跑 (§6).

### 0.2 化名 (codename) 命名规则 — 后端落地

**作者定的规则 (第二版修订)**: 化名要像**现实里一个普通自然的称呼**, 有人味、不违和, 又不构成可识别的真实人; 规则**由后端维护** (前端只渲染字符串).

| 规则条 | 后端落点 |
|---|---|
| 贴合真实社会: 常见、普通、不出挑, **不象征、不剧透性格** | 词库换成「常见中性称呼」扁平池 (35 词: 小满/一一/豆豆/念念/晚晴 …), 去掉寓意型词 (初霁/见微/知遥) |
| **不配性格**: 不按防御类型/阻抗强度/难度"配气质" | **删掉** 6 个气质桶 + 议题→气质映射; 名字与人物设定解耦 |
| 只避明显违和: 名字与外在第一印象不打架 | 字级禁令: 性格评价字 (强/倔/傲/烈) + 明显刚硬字 (刚/铁/钢/锋/戈/剑/刃) 出现即拒 (**避冲突, 不按性格匹配**) |
| 形态: 2–3 字为主, 可叠字/单字, 不带姓、不用法律式全名 | 1–3 字; 首字是常见姓氏即拒 (判为"像真实姓名") |
| 中性: 不用强性别字 | 强性别字黑名单 (婷/丽/伟/强/芳/娜/敏/静 …) |
| 不撞真实人 | 后端从常见中性称呼词库组合 + 查重; 词库为人工审核过的单一真值源 |
| 去重兜底: 撞名挂灰色极小尾号 | 「晚晴 · 02」形态, 两位数字零填充; 词库与组合空间都耗尽才出现 |
| 禁止: 真实姓名/性格形容词/名人角色/地域单位/**系统视角标签** | 三组合并为一个禁用词表: 系统标签 (来访者/来访/咨询者/患者…) + 称谓 + 广为人知的角色名 (悟空/黛玉/武松/岳飞) |

**落地文件**: `src/counselor/config/visitor-pool-codename.ts` —— 命名规则的**唯一真值源** (判据 + 词库 + 组合 + 查重 + 自检).

**与 LLM 的分工**: 创意给模型, 正确性归后端 ——

1. LLM 提的代号必须过命名规则闸门 (`visitor-pool.validator.ts` 引用**同一套**判据), 否则拒收重来;
2. 合规但**已占用** → 挂去重尾号 (「晚晴 · 02」);
3. **不合规** → 后端从词库另配一个 (词库与组合空间都挤不下时同样退到尾号形态).

**6 个初始人物的代号** (作者指定, 写进 seed 内容基线): 亲密关系「晚晴」· 职场「亦舟」· 亲子「阿禾」· 哀伤「念安」· 自我价值「小满」· 社交焦虑「小舟」.

> 库表里已有的 4 条 (旧代号 `来访者 · X`) **重跑 seed 即更新** (upsert by id, codename 参与漂移判定), 不需要数据迁移.

**本轮附带清掉的两处孪生**:

- validator 原本自带一套"像不像真名"的判据 (称谓黑名单 + 姓氏表 + 裸姓名识别), 与新规则是两套口径 → 改为引用命名模块同一套判据;
- `validateVisitorPoolTemplateSeeds` 认知复杂度 31 (上限 25) → 拆成 3 个单职责 check + 1 个覆盖度 check, 语义不变.

**自检**: 词库自检 PASS (35 词) · seed 自检 PASS (6 代号: 互不重复 + 合规 + 在词库) · 闸门 6/6 PASS · 规则负向 13/13 REJECT · 正向 11/11 ACCEPT · 查重尾号验证通过.

---

## 1. 一句话

公共供给层落地: 新增 **1 张公共模板表 + 1 张收藏关系表**, 给 `visitor_full_personas` 加 **1 列来源标注**,
对外开 **6 个公共端点** (图鉴/详情/克隆/收藏), 对内开 **6 个管理端点** (AI 生成 + 模板治理),
配套 **6 个官方人物** 的确定性内容基线 (seed) 与一套**后端维护的化名命名规则** (词库 + 组合 + 查重).

## 2. 交付物清单

### 2.1 新增文件 (20)

| 文件 | 职责 |
|---|---|
| `src/counselor/enums/visitor-pool.enum.ts` | 议题领域 / 防御类型 / 案例来源 / 上架状态 4 组枚举 |
| `src/counselor/domain/visitor-pool/visitor-pool.types.ts` | 表层卡片 / 临场参数 / 实例化产物 / LLM 产出 4 个领域契约 |
| `src/counselor/domain/struct-guards.ts` | counselor 端**唯一**的原始值守卫 (readString / readEnum / collectStrings …) |
| `src/counselor/entities/visitor-pool-template.entity.ts` | `visitor_pool_templates` 公共模板 |
| `src/counselor/entities/visitor-pool-favorite.entity.ts` | `visitor_pool_favorites` 收藏关系 |
| `src/counselor/dto/visitor-pool.dto.ts` | 全部端点的入参/出参契约 (14 个 DTO) |
| `src/counselor/config/visitor-pool.config.ts` | 运行参数 (分页上限 / 生成条数上限 / 内容排除词表 / id 列宽上限) |
| `src/counselor/config/visitor-pool-codename.ts` | **化名命名规则唯一真值源** (判据 + 词库 + 组合 + 查重 + 自检) |
| `src/counselor/config/visitor-pool-prompts.ts` | 内部 AI 生成的 system prompt + `{card, script}` 输出契约 |
| `src/counselor/config/visitor-pool-seed.ts` | 6 个官方人物的内容基线 + 基线自检 |
| `src/counselor/providers/visitor-pool.validator.ts` | 结构化产出的**校验闸门** (4 条校验清单) |
| `src/counselor/providers/visitor-pool.service.ts` | 公共面 service (图鉴/详情/克隆/收藏) |
| `src/counselor/providers/visitor-pool-admin.service.ts` | 内部面 service (AI 生成 + 模板治理 + 代号归口) |
| `src/counselor/guards/admin-role.guard.ts` | 内部角色守卫 (读 `users.admin_role`) |
| `src/counselor/controllers/visitor-pool.controller.ts` | 公共 6 端点 |
| `src/counselor/controllers/visitor-pool-admin.controller.ts` | 内部 6 端点 |
| `src/counselor/seeds/visitor-pool-templates.seed.ts` | 幂等 upsert (insert / update / no-op) |
| `src/migration/1714900000018-AddVisitorPoolTemplates.ts` | 2 张新表 + 1 列 ALTER (手写 DDL) |
| `src/migration/1714900000019-WidenVisitorPoolIdColumns.ts` | 3 个 id 列放宽到 VARCHAR(64) (修 id 列宽错配) |
| `bin/seed-visitor-pool-templates.ts` | seed 执行入口 (`npm run seed:visitor-pool`) |

### 2.2 修改文件 (8)

| 文件 | 改动 |
|---|---|
| `src/counselor/entities/visitor-full-persona.entity.ts` | 加 `sourceTemplateId` 列 (标注副本来源) |
| `src/counselor/providers/visitor-persona.service.ts` | 3 个私有守卫上提到 `domain/struct-guards.ts` (消除孪生) |
| `src/counselor/counselor.module.ts` | 注册 2 entity / 2 controller / 2 service / 1 guard |
| `src/migration/index.ts` + `bin/ormconfig.ts` | 迁移**双注册** (漏注册 = 静默不建表) |
| `src/common/exceptions/biz-code.enum.ts` + `biz.exception.ts` | 新增 5 个业务码 (47xxx) + HTTP 映射 (顺带把 status 映射改成"分组 Set", 复杂度与业务码数量解耦) |
| `package.json` | 新增 `seed:visitor-pool` 脚本 |

## 3. 关键设计决策 (与「反双胞胎」对账)

### 3.1 两层模型严格分离

| 层 | 落点 | 不变量 |
|---|---|---|
| ① 人物内容层 | `visitor_pool_templates` (公共只读) → 克隆进 `visitor_full_personas` (私有副本) | 模板**永不被回写**; 每人一份独立副本 |
| ② 临场参数层 | **不建表**, 随会话启动参数透传 | 只作用本场; 不回写人物 |

- 公共模板表**没有** `tenant_id` / `user_id` (spec §2.1: system 级), 也没有 `trust_level` / 任何计数字段.
- 私有副本复用现有 `visitor_full_personas`, 现有 6 个 visitor-persona 端点 **0 改动**继续生效.

### 3.2 不造孪生 (逐条对账)

| 概念 | 既有 | 本次做法 |
|---|---|---|
| 难度 L1/L2/L3 | `TrainingDifficulty` | **复用** (不新建 `VisitorPoolDifficulty`) |
| 配合风格 5 档 | `VisitorStyle` | **复用** (不新建 `VisitorPoolStyle`) |
| 训练模式 | `VisitorMode` | **复用** |
| 7 大块剧本结构 | `visitor-persona.types.ts` | **复用**; 7 大块 DTO 直接复用 `visitor-persona.dto.ts` 的类 |
| 7 大块结构校验 | `validateFullPersona` | **复用** (spec §3.5.1 明确要求) |
| 原始值守卫 | 只有 `visitor-persona.service.ts` 私有一份 | 上提到 `domain/struct-guards.ts` 共用 |
| LLM 场景 profile | `personaGeneration` (同为"写出一整套人生剧本") | **复用** (不新建参数几乎相同的孪生档位) |
| 收藏关系表 | `user_quote_favorites` | 同范式新建 (表不同, 不可能合表) |
| 副本表 | `visitor_full_personas` | **复用** (不新建 `visitor_pool_copies`) |
| 命名判据 ("像不像真名") | validator 自带一份 + 命名模块一份 | **上提到 `config/visitor-pool-codename.ts`**, validator 改为引用 (§0.2) |
| 6 个初始代号 | seed 内容一份 + 命名模块一份 | **只在 seed 一份**; 命名模块只提供词库, 靠"seed 代号必须在词库中"的交叉自检挂钩 |

### 3.3 零压红线的结构性保证

- 公共 DTO 里**没有** `likeCount` / `favoriteCount` / `useCount` —— 契约里没有, 客户端就渲染不出来.
- 两张表**都没有**计数字段 —— 列都不存在 = 物理上不可能下发.
- 公共接口**永不下发** `script` (7 大块剧本): `VisitorPoolService.toCard()` 是**唯一**的模板出参转换口, 只挑表层字段.
- 人物不可被打分: 表里无分数/评级/通过率字段.

### 3.4 内容边界 (普通池不收危机内容)

三层防护, 缺一不可:

1. **prompt 内置硬约束** (劝模型别写)
2. **校验闸门** (`visitor-pool.validator.ts`): 排除词命中 / 自述风险 > medium → 拒收
3. **seed 基线自检** (`validateVisitorPoolTemplateSeeds`): 结构/边界有问题就在灌库前炸

拒收时**带原因重生成** (spec §3.5.1「命中即拒收重生成」): 原因回喂给模型, 上限 2 次; 仍不过 → 明确报错, **不落半成品**.

### 3.5 化名归口 (命名规则 vs 人物设定)

- 名字**不表达**人物性格/防御方式/难度 —— 性格只由会谈里的对话与行为体现.
- 名字与人物设定**解耦**: 词库里不按议题分桶, 也不按防御类型挑词.
- 代号**由后端分配** (§0.2), 模型只提供创意输入; 落库前的合规与查重由后端兜底.

## 4. API 契约

### 4.1 公共 (JWT, 前缀 `/counselor/visitor-pool`)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/counselor/visitor-pool` | 图鉴列表; 筛选 `issueDomain/difficulty/defenseType/trainingGoal/source`; 游标 `cursor` + `limit`(默认 20) |
| GET | `/counselor/visitor-pool/favorites` | 我的收藏 (表层卡片) |
| GET | `/counselor/visitor-pool/:templateId` | 模板表层详情 |
| POST | `/counselor/visitor-pool/:templateId/instantiate` | 克隆私有副本 (可覆盖临场参数) |
| POST | `/counselor/visitor-pool/:templateId/favorite` | 收藏 (幂等) |
| DELETE | `/counselor/visitor-pool/:templateId/favorite` | 取消收藏 (幂等) |

> **路由顺序**: `favorites` 注册在 `:templateId` **之前** —— Express 按注册顺序匹配, 反了会被参数路由吃掉.
>
> **空库口径**: 无筛选 + 无游标 + 结果为空时会再查一次全库计数; 全库也空 → 404 (`VisitorPoolLibraryEmpty`),
> 前端据此回退本地种子; 仅"筛选无匹配" → 正常返回空数组 (空态, 不是错误).

### 4.2 内部 (JWT + 内部角色, 前缀 `/counselor/admin/visitor-pool`)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/generate` | 内部 AI 生成 (默认落草稿 `enabled=0`) |
| GET | `/` | 管理列表 (含草稿/下架; `status=draft\|enabled\|off`) |
| GET | `/:id` | 管理详情 (**含 7 大块剧本**) |
| PATCH | `/:id` | 编辑表层字段 / 上下架 / 排序 |
| POST | `/:id/restore` | 软删恢复 (恢复后仍为下架) |
| DELETE | `/:id` | 软删 (不物理删除) |

> **角色判定**: 直读 `users.admin_role` ∈ {editor, reviewer, admin}; 普通用户 → 403 (`BizCode.VisitorPoolForbidden`).
> 不复用 `common/guards/roles.guard.ts`: 它依赖 `request.user.adminRole` / `user.roles`, 而本仓当前注入
> `request.user` 的 `JwtAuthGuard` 并不注入 `adminRole`, 且 `users` 表没有 `roles` 列 → 恒不放行.

## 5. 与前端契约的接线说明

- 准备页的「临场微调」滑杆初值 = 实例化响应的 `defaultPreset` (人物默认值 + 本次覆盖的生效值).
- 「开始本次会谈」= 现有 `POST /counselor/training-sessions`; 其入参**已有** `emotionBaseline` / `defenseLevel` /
  `difficulty` / `mode` 4 个临场参数位 (spec §2.3「不建表, 随会话启动参数传递」在本仓**已落地**), 本次**无需改动**该 DTO.
- `defaultPreset.randomSeed` 为服务端生成的种子, 前端「换一组」可在完全真实模式下重置后再调实例化.
- 公共响应体无 `script` → 前端拿不到创伤/核心信念/家庭史, 满足「锁定边界」.
- 人物卡上的 `codename` 是**普通称呼字符串** (如「晚晴」) —— 前端**只渲染**, 不需要为化名做任何特殊逻辑
  (撞名时后端已挂好去重尾号, 前端原样显示即可).

## 6. 验证步骤 (由作者手动执行; 顺序不可颠倒)

```bash
# 1. 迁移: 0018 建表 + 0019 放宽 id 列宽 (0019 必须跟上, 否则 seed 仍会报 "Data too long")
pnpm migration:run
#    SHOW TABLES LIKE 'visitor_pool_templates';   -- 1 张
#    SHOW TABLES LIKE 'visitor_pool_favorites';   -- 1 张
#    SHOW COLUMNS FROM visitor_pool_templates LIKE 'id';             -- varchar(64)
#    SHOW COLUMNS FROM visitor_pool_favorites LIKE 'template_id';    -- varchar(64)
#    SHOW COLUMNS FROM visitor_full_personas LIKE 'source_template_id'; -- varchar(64)
#    全表 grep 'trust_level|favorite_count|use_count|score' 列名 → 0 命中

# 2. 初始官方库 (6 个 L1 人物)
npm run seed:visitor-pool
#    预期「新增 2 / 更新 4 / 未变 0」:
#      - 库里已有 4 条 (上次失败前已 insert 的), 代号仍是旧的「来访者 · X」→ 本次被 UPDATE
#      - 剩下 2 条 (self_worth / social_anxiety) 本次 INSERT
#    再跑一次 → 应「新增 0 / 更新 0 / 未变 6」(幂等)
#    SELECT codename FROM visitor_pool_templates;  -- 晚晴/亦舟/阿禾/念安/小满/小舟

# 3. 公共端点
curl -H "Cookie: access_token=..." \
  "http://localhost:3000/counselor/visitor-pool?issueDomain=intimate&difficulty=L1"
#    → items[] 只含表层字段, 无 script, 无任何计数字段, codename 为「晚晴」这类普通称呼
curl -H "Cookie: access_token=..." \
  -X POST "http://localhost:3000/counselor/visitor-pool/vpt_intimate_avoidance_l1/instantiate" \
  -H 'Content-Type: application/json' -d '{"emotionBaseline":0.4,"difficulty":"L1"}'
#    → personaId + card + defaultPreset; 再次调用 → 第二条独立副本, 模板不变

# 4. 隔离与幂等
#    - 改副本的表层字段 → 模板与他人副本不受影响
#    - 重复收藏 → 仍 1 行; 取消后再收藏 → 成功

# 5. 内部端点 (403)
curl -H "Cookie: access_token=<普通用户>" \
  "http://localhost:3000/counselor/admin/visitor-pool"
#    → 403 (BizCode.VisitorPoolForbidden)
```

## 7. 已完成的自检 (作者侧无需重复)

| 项 | 结果 |
|---|---|
| `tsc --noEmit` (build scope) | 0 错 |
| eslint (全部改动文件) | 0 error (warning 均为仓库级环境问题: 缺 `unrs-resolver` 可选原生绑定) |
| 校验闸门 正向 / 负向 | 6/6 PASS · 6/6 REJECT (危机词/防御矛盾/年龄越界/代号像真名/目标超长/议题错配) |
| 词库自检 / seed 自检 | PASS (35 词; 6 代号互不重复 + 合规 + 在词库) |
| 命名规则 负向 / 正向 | 13/13 REJECT · 11/11 ACCEPT |
| 查重尾号 | 「晚晴」+「晚晴 · 02」+「晚晴 · 03」→ 「晚晴 · 04」 |

> **未验证**: 迁移 0019 与 seed 重跑**未在真实 MySQL 上执行过**; 表结构、唯一键、403 拦截、
> 12 个端点的真实 HTTP 行为均待作者按 §6 手动确认.

## 8. 本期不做 (与 spec §8 非目标一致)

- 不做公共投稿 / 专家共建审核流 (不做用户上传/生成入口)
- 不做管理可视化页面 (只交付管理端点契约)
- 不做弱项智能推荐 / 本周训练清单
- 不在公共表放危机 / 重度精神障碍 / 人格障碍内容
- 不把自由练习 B 的碎片场景接入本池
- 不改 `training-sessions` 的现有 DTO (临场参数位已存在)
- 不做化名的**自动名人/角色名校验** (无可靠名录; 靠词库人工审核 + 上架前人工复核)
- 不做「按人物性格配名字」的机制 (作者明令禁止, 见 §0.2)
