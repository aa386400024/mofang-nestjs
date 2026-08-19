/**
 * 用户状态机 (大厂标准).
 *
 * 状态流转图:
 *
 *   PendingVerification ──verify──▶ Active
 *           │                          │
 *           └──delete──▶ Deleted       ├──suspend──▶ Suspended
 *                                      │                │
 *                                      │                └──reactivate──▶ Active
 *                                      │
 *                                      └──ban──▶ Banned
 *                                                  │
 *                                                  └──delete──▶ Deleted
 *
 * 状态说明:
 *   - PendingVerification: 已注册但未验证 (邮箱/手机号), 不能登录
 *   - Active: 正常活跃
 *   - Suspended: 临时禁用 (比如违规警告), 可恢复
 *   - Banned: 永久禁用 (严重违规), 不可恢复
 *   - Deleted: 已软删 (30 天后真删, GDPR 友好)
 *
 * 大厂做法:
 *   - 状态机集中在 service 层管理 (UserService.transition)
 *   - 不允许业务代码直接改 state 字段 (走 transition)
 *   - V2 加 audit log 记录每次状态转换
 */
export enum UserState {
  /** 已注册但未验证 (邮箱/手机号) */
  PendingVerification = 'pending_verification',
  /** 正常活跃 */
  Active = 'active',
  /** 临时禁用 (可恢复) */
  Suspended = 'suspended',
  /** 永久禁用 (不可恢复, 只可软删) */
  Banned = 'banned',
  /** 已软删 (30 天后真删) */
  Deleted = 'deleted',
}

/**
 * 状态转换白名单 (防御性: 只允许定义内的转换).
 *
 * 用法:
 *   if (!canTransition(from, to)) throw ...
 */
const transitions: Record<UserState, UserState[]> = {
  [UserState.PendingVerification]: [UserState.Active, UserState.Deleted],
  [UserState.Active]: [UserState.Suspended, UserState.Banned, UserState.Deleted],
  [UserState.Suspended]: [UserState.Active, UserState.Banned, UserState.Deleted],
  [UserState.Banned]: [UserState.Deleted],
  [UserState.Deleted]: [], // 终态, 不可再转
};

export function canTransition(from: UserState, to: UserState): boolean {
  return transitions[from]?.includes(to) ?? false;
}

/**
 * 状态是否可登录.
 * Deleted / Banned / PendingVerification 都不可登录.
 */
export function isLoginAllowed(state: UserState): boolean {
  return state === UserState.Active || state === UserState.Suspended;
}
