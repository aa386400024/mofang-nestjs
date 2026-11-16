// V2026-11-15 治本 (TD-20 · C2 第四批仓储端口化 · home 域 · P-DEBT-11 / L-1):
//   抽象: `HomeMessagesService` 不再注入 typeorm 的泛型仓储对象, 只依赖本端口
//     interface + `HOME_MESSAGE_REPOSITORY` DI token —— TypeORM 实现收进
//     `data/home-message.repository.typeorm.ts`, 未读计数与已读标记的查询口径
//     全封在实现里, service 只看到业务语义的方法.
//
//   模板先例: `src/emergency/domain/repositories/emergency-session.repository.ts`
//     (TD-19 · 单端口 + Row 出参) + `src/life-map/domain/repositories/`
//     (TD-16 · **同域多端口按实体划分** —— 本批端口粒度先例) +
//     `src/consent/domain/repositories/consent.repository.ts` (TD-17 · 最小单端口) +
//     `src/good_state_diary/domain/repositories/diary-entry.repository.ts` (TD-18) +
//     `src/analytics/domain/repositories/` (TD-13).
//
//   端口划分粒度 (TD-20 判定): **按实体分端口** —— home 域本批切两张表, 消息表与
//     打卡表的查询口径完全不同 (计数 + 标记 vs 写入 + 两个时间窗查询 + 物理删除),
//     合一会让两套口径互相污染 (对齐 TD-16 life-map 同域多端口先例).
//
//   关键方法 (方法面只收 service 现有的 3 处调用, 不泛化成通用代理):
//     - countUnread(uid): 未读计数 (uid + 未读条件), 两处同口径调用合并成一个方法
//     - markRead(uid, messageIds?): 标记已读, 返回本次标记条数
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 —— 那等于把 typeorm 的 API 面原样漏给业务层
//     - 不暴露 typeorm 的管理句柄 / 查询选项 / 操作符 —— 只允许出现在实现文件内
//     - 不写 SQL —— 端口只说「要什么」, 怎么说由实现决定
//     - 不暴露 entity 类 —— service 完全不碰实体
//
//   **本端口无 Row 出参**: 该 service 没有 entity 回读路径 (只计数 + 更新),
//     不硬造一个用不到的 Row 类型 —— 与 TD-17 ~ TD-19 先例的结构差异, 登记偏差.
//
//   **已读标记不是软删列**: `readAt` 只是「已读 / 未读」标记 (保留审计, 没有恢复 /
//     擦除路径), 口径描述不得写成软删 —— 与 TD-18 diary 的 deletedAt 语义完全不同.
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service
//        (test/home/td20-home-messages-moodlog-port-c2-batch4.spec.ts),
//        不起真 TypeORM / 不连 DB / 不 vi.mock('typeorm')
//     2. grep 复核: 端口 / service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-15 GMT+8

/**
 * 首页消息仓储契约 —— home 域消息存储的唯一真相源.
 *
 * 唯一调用方: `HomeMessagesService` (providers/home-messages.service.ts).
 */
export interface HomeMessageRepository {
  /**
   * 统计未读消息数 (uid + 未读条件).
   *
   * @param uid 用户 id
   * @returns 未读条数
   */
  countUnread(uid: string): Promise<number>;

  /**
   * 标记消息已读 —— 返回本次标记的条数.
   *
   * @param uid 用户 id
   * @param messageIds 指定消息 id 列表 (不传 / 空数组 = 标记该用户全部未读)
   * @returns 本次标记条数
   */
  markRead(uid: string, messageIds: string[] | undefined): Promise<number>;
}

/** DI token —— NestJS 注入用. */
export const HOME_MESSAGE_REPOSITORY = Symbol('HOME_MESSAGE_REPOSITORY');
