// V2026-11-14 治本 (TD-17 · C2 第一批仓储端口化 · consent 域 · P-DEBT-11 / L-1):
//   抽象: $ConsentService$ 不再注入 typeorm 的泛型仓储对象, 只依赖本端口
//     interface + $CONSENT_REPOSITORY$ DI token —— TypeORM 实现收进
//     $data/consent.repository.typeorm.ts$, 查询口径 (幂等四元组查重 /
//     acceptedAt 倒序取最新一条 / QB 批量回填 user_id) 全部封在实现里,
//     service 只看到业务语义的方法.
//
//   模板先例: $src/life-map/domain/repositories/$ (TD-16 · 4 端口 · 域级模板)
//     + $src/analytics/domain/repositories/analytics-event.repository.ts$ (TD-13).
//
//   端口划分粒度 (TD-17 判定): **单端口** —— consent 域只有 1 张表 / 1 个 service /
//     5 处仓储调用, 全部落在同一张表上; 拆成多端口只会把同一张表的查询口径切碎,
//     面反而变宽 (对齐 TD-13 D-2「面窄才守得住」).
//
//   关键方法 (方法面只收 service 现有的 5 处调用, 不泛化成通用代理):
//     - findByIdempotentKey(key): 幂等四元组 (deviceId + consentVersion +
//       consentType + appId) 查重 —— 与唯一索引口径一致
//     - findLatestByDevice(deviceId, consentType, appId): 任意版本最新一条
//       (acceptedAt 倒序)
//     - save(input): 写入 —— 带 id = 更新既有行 (幂等命中), 缺省 = 新增行;
//       **行由 service 以纯对象构造**, 不依赖仓储工厂方法
//     - bindDeviceToUser(deviceId, userId): 游客 → 用户批量回填, 返回受影响行数
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 —— 那等于把 typeorm 的 API 面原样漏给业务层,
//       端口会退化成"换个名字的仓储代理"; 方法按业务面命名, 面窄才守得住
//     - 不暴露 typeorm 的管理句柄 / 查询选项 / 操作符 —— 这些是 typeorm 值符号,
//       只允许出现在 TypeORM 实现文件内
//     - 不写 SQL —— 端口只说"要什么", 怎么说由实现决定 (批量回填的 QB 只在实现内)
//     - 不暴露 entity 类 —— 出参用 Row 领域类型, 业务层不碰实体
//     - **行不由仓储工厂方法构造** —— 仓储侧工厂方法的依赖在 service 侧移除,
//       行以纯对象在 service 内构造后交给端口落库
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service (test/consent/td17-consent-port-c2-batch1.spec.ts),
//        不起真 TypeORM / 不连 DB / 不 vi.mock('typeorm')
//     2. grep 复核: 端口 / service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-14 GMT+8

/**
 * 同意记录行 —— 端口出参 (窄领域类型, 不含 entity 类).
 *
 * 无软删列 (entity 本身没有 deleted_at), 故不涉及"软删过滤后剔除字段"的取舍.
 */
export interface ConsentRow {
  id: string;
  /** 游客态为 null, 登录后由 bindDeviceToUser 回填. */
  userId: string | null;
  deviceId: string;
  consentVersion: string;
  consentType: string;
  platform: string;
  appId: string;
  /** 首次同意时间 (幂等更新时保留原值). */
  acceptedAt: Date;
  /** 最近一次更新时间. */
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * 幂等四元组 —— 幂等查重键 (与 entity 唯一索引口径一致).
 */
export interface ConsentIdempotentKey {
  deviceId: string;
  consentVersion: string;
  consentType: string;
  appId: string;
}

/**
 * 同意记录写入入参 —— 行纯对象 (由 service 构造, 不依赖仓储工厂方法).
 *
 * - $id$ 缺省 = 新增行 (首次写入); 带 $id$ = 更新既有行 (幂等命中)
 * - $acceptedAt$ / $updatedAt$ 缺省 = 由落库时生成; 幂等更新时 service 带原值,
 *   保证「首写 acceptedAt 保留」语义逐字不变
 */
export interface SaveConsentInput {
  id?: string;
  userId: string | null;
  deviceId: string;
  consentVersion: string;
  consentType: string;
  platform: string;
  appId: string;
  acceptedAt?: Date;
  updatedAt?: Date;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

/** 仓储接口契约 —— consent 域同意记录存储的唯一真相源. */
export interface ConsentRepository {
  /**
   * 按幂等四元组查重.
   *
   * @param key deviceId + consentVersion + consentType + appId
   * @returns 行 (无命中返 null)
   */
  findByIdempotentKey(key: ConsentIdempotentKey): Promise<ConsentRow | null>;

  /**
   * 取该设备该协议类型的**最新一条**同意记录 (任意版本, 按同意时间倒序).
   *
   * @param deviceId 设备指纹
   * @param consentType 协议类型
   * @param appId 应用 id
   * @returns 行 (无命中返 null)
   */
  findLatestByDevice(deviceId: string, consentType: string, appId: string): Promise<ConsentRow | null>;

  /**
   * 写入一行 —— 带 id = 更新既有行, 缺省 = 新增行.
   *
   * @param input 行纯对象 (service 内构造)
   * @returns 落库后的行
   */
  save(input: SaveConsentInput): Promise<ConsentRow>;

  /**
   * 游客 → 用户批量回填 —— 只回填**尚未绑定用户**的设备行.
   *
   * @param deviceId 设备指纹
   * @param userId 目标用户 id
   * @returns 受影响行数 (无命中返 0)
   */
  bindDeviceToUser(deviceId: string, userId: string): Promise<number>;
}

/** DI token —— NestJS 注入用. */
export const CONSENT_REPOSITORY = Symbol('CONSENT_REPOSITORY');
