# 首页金句（每日一句）· 后端接口落地 (2026-10-22)

> **范围**: `xin_su_app/docs/product/home-quote-backend-api.md` §2.1 / §2.2 / §2.3 → `mofang-nestjs`
> **红线**: 未装依赖 / 未改 SDK 配置 / 未构建 / 未启动 / 未跑 migration. 仅产出源码 + migration + 文档
> **零压红线**: 不下发全站 likeCount / 不做排行 / 收藏仅本人可见
> **合规红线**: 署名真实可考, 不伪造名言归属

---

## 一、契约映射

| spec | 端点 | 出参 |
|---|---|---|
| §2.1 | `GET /counselor/quotes/today` | `QuoteDto` |
| §2.2 | `GET /counselor/quotes?cursor=<id>&limit=10` | `QuoteListDto`（`items` + `nextCursor`） |
| §2.3 | `POST /counselor/quotes/:id/favorite` | `QuoteFavoriteResultDto` |
| §2.3 | `DELETE /counselor/quotes/:id/favorite` | `QuoteFavoriteResultDto` |
| **补充** | `GET /counselor/quotes/favorites` | `QuoteListDto` |

`QuoteDto` 字段与 spec §3 逐字对齐：`id` / `text` / `author` / `category` / `backgroundUrl` / `publishedAt`，
另加两个：

- `sourceWork`（string | null）—— 出处，**合规核对用**。spec §3 只说「author 须真实可考」，
  但不给出处就无法核对。标「心塑」原创时为 null。
- `favorited`（boolean）—— **本人**是否已收藏。这是本人状态不是社交数据，
  客户端用它渲染心形实心态，不含任何他人信息，零压红线不适用。

### 为什么补 `GET /quotes/favorites`

spec §5 写「本地收藏 `_liked` 改为远端 2.3 接口」，但 §2.3 只给了 POST/DELETE 两个**开关**。
只有开关的话，客户端**冷启动后无从知道**哪些句子被收藏过（本地集合在内存里，重启即丢），
「我的收藏」跨设备就断了。故补这一个**读**端点。

---

## 二、关键设计决策

### 2.1 「今日金句」= 本地自然日序号 % 内容库大小

同一天内**恒定**（所有人、多次刷新同一句），跨天自动轮换，且**只要库非空就永远有内容**
（不会像「排期制」那样过了发布日期就断更）。

- 定位键用**本地**午夜而非 UTC 午夜：用户看到「今天」是本地日历的一天。
- 不用前端本地种子的「距当年 1 月 1 日的天数」口径：那样每年元旦会重置轮换，
  元旦当天可能又轮到同一条，显得像「没换」。
- 池顺序 = feed 顺序（`published_at DESC, id DESC`），所以「今日那一句」在沉浸页里的位置可预期。

**已知取舍**：内容库新增条目会改变池长度 → 当天轮换位次会位移。内容库是低频更新
（人工改文案/加条目，一次位移无伤大雅）。若日后要绝对稳定，改成「排期制 + 固定窗口」即可，
定位键逻辑在 `quoteDayIndexOf()` 一处。

### 2.2 金句流用 keyset 游标，不用 OFFSET

游标是**金句 id**（spec §2.2 的 `cursor=<id>` / `nextCursor: "q_xxx"`），服务端拿它换出
`(published_at, id)` 锚点，再按 `(published_at < T) OR (published_at = T AND id < I)` 推进。

沉浸页是无限滑动的：滑动过程中若运营新增了金句，**OFFSET 会漏条/重条**，keyset 不会。
用 `LIMIT n+1` 判 `hasMore`，不额外打一次 COUNT。

游标解析不到 → 400 `QuoteCursorInvalid`（客户端应重置分页从头开始），不静默从头返回。

### 2.3 收藏走**硬删**（与项目其它软删表故意不同）

`UNIQUE (user_id, quote_id)` 不含 `deleted_at`，软删会让「取消收藏后再收藏同一句」撞唯一键。
硬删让出唯一键，再收藏必然成功。收藏是可再生的个人标记，留痕价值低，而「可再收藏」是硬需求。

### 2.4 零压红线的结构性保证

- **出参 DTO 里没有任何计数字段**（`likeCount` / `favoriteCount` / `viewCount` / `rank` …）。
  契约里没有这个字段，客户端就不可能渲染出「42 人收藏」。
- **两张表都没有计数字段**。列都不存在 = 物理上不可能下发。
- 金句流只按发布日排序，**不掺任何热度信号**（「全站最热」这类排序维度会让情绪陪伴位变攀比位）。
- 错误码（46xxx）也不带「有多少人收藏了这类内容」的信息，只描述**当前用户自己的操作**是否成立。

单测 `test/counselor/quote-engine.spec.ts` 把这条锁死：故意给 DTO 加计数字段 → 用例变红。

### 2.5 合规：署名真实可考

16 条内容里：

- **12 条**标真实作者 + 出处（心理学科普读物里的公认表述）：维克多·弗兰克尔、卡尔·罗杰斯、
  卡尔·荣格、威廉·詹姆斯、埃里希·弗洛姆、阿尔伯特·埃利斯、罗洛·梅。
- **4 条**标「**心塑**」（产品原创，即前端本地种子里的原创句）——**不冒名任何真人**。

绝不出现「用泛化词（如『心理成长』）冒充作者」的情况：那是把一句没人说过的话挂在某个
心理学家名下，属伪造归属。自检函数 `validateQuoteSeeds()` 会拒绝「真实作者但缺出处」。

---

## 三、数据层

| 表 | 列 | 索引 |
|---|---|---|
| `quotes` | 11（`id` 为 `VARCHAR(64)` 稳定 slug `q_YYYYMMDD_<slug>`） | PK + `idx_q_published(published_at, id)` |
| `user_quote_favorites` | 5（**无 `deleted_at`**，硬删表） | PK + UNIQUE `(user_id, quote_id)` + `(user_id, created_at)` |

- `quotes.id` 故意**不用**项目默认的 CHAR(36) UUID：它是 spec §2.2 的游标值与 §2.3 的收藏路径参数，
  必须是**内容方可复现的稳定 slug**，否则运营/知识库侧无法做幂等同步。
- 迁移 `1714900000017-AddQuotes.ts`。
- 内容**不进 migration**（金句是持续演进的内容，改一句文案就要加一条 migration，迁移历史会被
  业务内容淹没）→ 独立脚本 `npm run seed:quotes`（`bin/seed-quotes.ts`）按稳定 id 幂等 upsert，
  语义与 `training-exercises` / `practice-scenarios` 一致。
- 背景图完整地址 = `QUOTE_CDN_BASE_URL`（env，缺省 `https://cdn.xinsu.app/quote/`）+ 文件名。
  换 CDN 供应商时改 env 后**重跑 seed** 即可（upsert 会刷 `background_url`）。

---

## 四、文件清单

### 新增 (10)
```
src/counselor/entities/quote.entity.ts               金句内容库 entity
src/counselor/entities/user-quote-favorite.entity.ts  收藏关系 entity
src/counselor/config/quote-seeds.ts                   内容库基线 (16 条) + 运行参数 + 轮换键 + 自检函数
src/counselor/dto/quote.dto.ts                        3 组端点的入参/出参契约
src/counselor/providers/quote.service.ts              今日轮换 / keyset 游标分页 / 收藏幂等
src/counselor/controllers/quote.controller.ts         5 端点
src/counselor/seeds/quotes.seed.ts                    幂等 upsert (按稳定 id)
bin/seed-quotes.ts                                    seed 执行入口 (npm run seed:quotes)
src/migration/1714900000017-AddQuotes.ts              2 张新表
test/counselor/quote-engine.spec.ts                   内容库不变量 + 轮换键 + 零压结构锁 (13 用例)
```

### 改动 (6)
```
src/counselor/counselor.module.ts        +2 entity / +1 controller / +1 service
src/common/exceptions/biz-code.enum.ts   +46xxx 金句错误码 (3 个)
src/common/exceptions/biz.exception.ts   +46xxx HTTP 映射与文案
src/migration/index.ts                    +新 migration 注册
bin/ormconfig.ts                          +新 migration 注册
package.json                              +seed:quotes 脚本
```

---

## 五、前端切换点（对齐 spec §5）

| 前端 | 现状 | 切远端后 |
|---|---|---|
| `quote_seed.dart` → `localQuotes` / `quoteOfTheDay()` | 本地 8 条种子 + 按天轮换 | 换 `GET /quotes/today`（保留本地种子做降级兜底） |
| `quote_gallery_page.dart` → `PageView.builder` | 按本地列表长度 | 改游标分页：触底拿 `nextCursor` 请求 `GET /quotes?cursor=` |
| `quote_gallery_page.dart` → `_liked` (`Set<int>`) | 内存集合，重启丢 | 换 `GET /quotes/favorites` 回填 + `POST/DELETE /quotes/:id/favorite` 切换 |
| `quote_card.dart` / `_QuotePage` → `quote.backgroundAsset` | 本地 asset 路径 | 换 `backgroundUrl` 网络地址 |

**两个必须注意的点**：

1. **背景图需要真的传到 CDN**。后端下发的是 `https://cdn.xinsu.app/quote/quote_dawn_lake.jpg`
   这类地址，但两个 jpg 目前只在客户端 `assets/images/` 里。**在图片上传到该 CDN 之前**，
   沉浸页会拿到 404 —— 前端需要保留本地 asset 作为 `backgroundUrl` 加载失败时的兜底
   （spec §4「远端不可达时前端回退本地种子，不得白屏或报错」）。
   或者：把 `QUOTE_CDN_BASE_URL` 指向已有图片服务的对应路径。
2. **`_liked` 的索引语义变了**。现在是 `Set<int>`（本地列表下标），切远端后要改成
   `Set<String>`（金句 id）—— 游标分页下「下标」本来就不稳定。

---

## 六、待大炮手动验证（本轮未执行任何环境侧操作）

1. `pnpm migration:run` → `quotes` + `user_quote_favorites` 建表
2. `npm run seed:quotes` → 输出「新增 16」；**连跑两次** → 第二次「未变 16」（幂等）
3. `SELECT id, published_at FROM quotes ORDER BY published_at DESC` → 16 行，id 形如 `q_20261022_xinshu_slow_down`
4. `GET /counselor/quotes/today` → 200，返回 `id/text/author/category/backgroundUrl/publishedAt/sourceWork/favorited`
5. **同一天再调一次 `/quotes/today`** → `id` 相同（恒定）
6. `GET /counselor/quotes?limit=10` → `items` 10 条 + `nextCursor` 非 null；`items[0].publishedAt` 是最新的
7. `GET /counselor/quotes?cursor=<nextCursor>&limit=10` → 接着往下翻，**与第 6 步无重复**
8. 一直翻到末页 → `nextCursor` 为 `null`
9. `GET /counselor/quotes?cursor=不存在的id` → 400 `QuoteCursorInvalid`
10. `POST /counselor/quotes/<id>/favorite` → `{quoteId, favorited:true}`；**再调一次** → 仍是 true，且 `SELECT COUNT(*) FROM user_quote_favorites WHERE user_id=...` = 1
11. `GET /counselor/quotes/favorites` → 1 条
12. `DELETE /counselor/quotes/<id>/favorite` → `{favorited:false}`；**再收藏一次** → 成功（硬删让出了唯一键）
13. `GET /counselor/quotes/today` → `favorited` 变 true（本人状态回填）
14. 换另一个用户 token 调 `/quotes/today` → `favorited` 为 false，**看不到** A 用户的任何信息
15. `GET /counselor/billing/membership` → `quotas` 数组仍是 3 项（金句配额不混入会员权益，本轮也未引入任何配额）
16. 任意响应体里 grep `likeCount|favoriteCount|viewCount` → **0 命中**（零压红线物理校验）
17. `npx jest test/counselor/quote-engine.spec.ts` → 全绿

---

## 七、已知环境问题（非本轮引入）

`npx jest` 在当前环境**跑不起来**：

```
● Validation Error:
  Preset ts-jest not found relative to rootDir /mnt/e/Work/Project/backend/mofang-nestjs.
```

这是仓库既有的 jest 30 + ts-jest 29 预设解析问题 —— **本轮之前就存在的测试
`test/counselor/practice-engine.spec.ts` 报完全相同的错**，与本轮新增文件无关。
`ts-jest@29.4.14` 与 `jest-preset.js` 确实在 `node_modules` 里，是 jest 30 侧的解析行为变化。
修它需要动依赖版本或 jest 配置，属环境侧改动，本轮按红线**未动**。

本轮新增的 `test/counselor/quote-engine.spec.ts` **已通过 `tsc --noEmit` 类型校验**
（`tsconfig.json` 的 `include` 含 `test/**/*`），逻辑正确性待大炮在能跑通 jest 的环境里复验。
