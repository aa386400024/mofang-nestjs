// V2026-10-22 治本 (首页金句 · 每日一句 — quotes 内容库 entity):
//   原因: `xin_su_app/docs/product/home-quote-backend-api.md` §2 要求后端下发金句,
//     而金句是**会持续演进的内容** (运营改文案/加条目/换背景图), 不是一次性结构变更.
//     故按项目既有内容治理 pattern (training_exercises / practice_scenarios):
//     内容进独立表 + 独立 seed 脚本按稳定 id 幂等 upsert, 不进 migration.
//
//   修法 (跟 V1.3 §2.1 practice-scenario.entity.ts 风格一致):
//     - id varchar(64) PK (**稳定 slug, 不是 UUID**): 金句 id 同时是
//       spec §2.2 的游标值与 §2.3 的收藏路径参数, 必须是内容方可复现的稳定串
//       (形态 q_YYYYMMDD_<slug>), 否则知识库/运营侧无法做幂等同步.
//       —— 这条与项目"主键一律 UUID"的默认做法**故意不同**, 理由同上:
//          id 是对外契约的一部分, 不是数据库内部标识.
//     - tenant_id char(36) (A9 一人一租户; 全局共享内容库用系统租户哨兵值,
//       见 PRACTICE_SYSTEM_TENANT_ID)
//     - user_id char(36) NULL (内容库全局共享 → NULL; 预留"用户自建金句"扩展位,
//       可见性由 user_id 语义表达, 与 practice_scenarios 同口径)
//     - text text (引文正文)
//     - author varchar(100) (署名; 真实作者或"心塑"原创, **不伪造归属**)
//     - source_work varchar(200) NULL (出处; 标真实作者时必填 —— spec §4 真实可考)
//     - category varchar(50) (领域标签)
//     - background_url varchar(500) (满版背景图 CDN 完整地址)
//     - published_at datetime (发布日; feed 排序 + "今日"候选池的键)
//     - enabled tinyint (上下架开关; 下架后不下发, 但历史收藏仍可解析)
//     - 2 索引: PRIMARY + idx_q_published (published_at, id)
//     - 软删 deletedAt
//
//   反双胞胎:
//     - 不加 like_count / view_count / favorite_count 列: spec §2.3 + §4 的零压红线
//       明确「不下发、不展示全站 likeCount」. 列都不存在 = 物理上不可能下发.
//       "谁的收藏数最多"这种排行榜会直接把情绪陪伴位变成攀比位.
//     - 不加 user_id NOT NULL: 内容库是全局共享的
//     - 不加 DB-level FK: 跟 ADR-0003 一致 (跨表引用应用层校验)
//     - 不用 MySQL ENUM 列类型: 跟项目既有 pattern 一致 (varchar + 应用层校验);
//       category 是开放集合 (领域标签会随内容扩展), 更不该用 ENUM
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'quotes'; # 1 张表
//     2. SHOW INDEX FROM quotes; # 2 索引
//     3. DESCRIBE quotes; # 11 列
//     4. 全表 grep 'like_count\|favorite_count' 列名命中数 = 0 (零压红线物理校验)
//
//   时间戳: 2026-10-22
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * quotes 表 —— 首页金句内容库 (全局共享).
 *
 * spec `home-quote-backend-api.md` §2 / §3 / §4.
 */
@Entity('quotes')
@Index('idx_q_published', ['publishedAt', 'id'])
export class Quote {
  /**
   * 稳定 id (对外契约 + 游标 + 收藏路径参数).
   *
   * 形态 `q_YYYYMMDD_<slug>`, 由 seed 分配, **不可改为随机 UUID**.
   */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). 全局共享内容库用系统租户哨兵值.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // 内容库全局共享时为 NULL; 预留"用户自建金句"扩展位 (可见性按 user_id 语义).
  @Column({ type: 'char', length: 36, name: 'user_id', nullable: true })
  userId!: string | null;

  // 引文正文 (不做诊断、不做疗效承诺).
  @Column({ type: 'text' })
  text!: string;

  // 署名 (真实作者名, 或 "心塑" 表示产品原创; 不伪造名言归属).
  @Column({ type: 'varchar', length: 100 })
  author!: string;

  // 出处 (作品名); 产品原创为 NULL. 标真实作者时必填 (spec §4 真实可考).
  @Column({ type: 'varchar', length: 200, name: 'source_work', nullable: true })
  sourceWork!: string | null;

  // 领域标签 (心理成长 / 来访者中心 / 存在主义 / 情绪理解 / 自我接纳 / 积极倾听 / 意义疗法 / 分析心理学).
  @Column({ type: 'varchar', length: 50 })
  category!: string;

  // 满版背景图 CDN 完整地址 (竖版, 上中部留暗部便于压白字).
  @Column({ type: 'varchar', length: 500, name: 'background_url' })
  backgroundUrl!: string;

  // 发布日 (feed 排序键 + "今日"候选池的键).
  @Column({ type: 'datetime', name: 'published_at' })
  publishedAt!: Date;

  // 上下架开关. 下架后不再下发, 但历史收藏记录仍可解析 (收藏指向的是 id).
  @Column({ type: 'tinyint', default: 1 })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 V3 其他模块一致).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
