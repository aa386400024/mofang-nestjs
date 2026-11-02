// V2026-10-30 治本 (WP10 · B 层 · 轨迹剧本解析端口):
//   职责: 定义"scriptId → 内核 TrajectoryScript"这条解析链的**可替换端口** ——
//         请求 (剧本 key) / 结果 (内核纯对象) / 一个静态实现 (内存查表).
//   边界: 纯类型 + 一个 Symbol token + 一个零 IO 的查表实现; 不进 engine-core
//         (内核零剧本实体、零 IO 是本期红线).
//
//   为什么要有这个端口 (而不是把剧本表直接写进 EngineStreamBackend):
//     WP10 的数据源是**内置静态剧本** (10 个伦理盲盒). Phase2 的 UGC 剧本池
//     (落库 + 审核流 + 版本管理) 的差别只在"剧本定义从哪来", 其余
//     (怎么映射成内核对象 / 怎么注入内核 / 解析不到怎么办) 完全一样.
//     把"从哪来"抽成端口, Phase2 就只新增一个 `DbTrajectoryScriptResolver`
//     实现 + 改一行绑定, **注入点与 EngineStreamBackend 零改动** ——
//     这正是 WP9-A 角色解析端口立下的承诺, 剧本解析照抄同一套结构.
//
//   为什么解析结果可以是 undefined (而不是抛错):
//     "查不到剧本"在 WP10 是**常态**而不是异常 (客户端传了个不存在的 scriptId,
//     或者剧本资产还没接上). 抛错会把"没有剧本"升级成"会话开不起来",
//     让一个可选增强变成硬依赖. undefined = "本场无剧本约束", 会话照常 BDI 自由运行.
//     这与 `CharacterProfileResolver` 解析不到角色返回 null 是**同款语义**.
//
//   反双胞胎:
//     - 不把"剧本"塞进内核: 内核只认 `TrajectoryScript` 这一个纯对象, 不感知
//       伦理盲盒 / 静态资产 / 未来的数据库表 —— 端口是**适配层**的东西.
//     - 不用 interface 当 Nest 的 provider token: interface 编译后没有运行时值,
//       必须有真实 token (这里用 Symbol; 字符串 token 撞名时 Nest 不报错而是
//       静默注入错东西).
//     - 不在端口上声明"怎么查": 端口只说"给我一个剧本 key, 你给我一个内核剧本",
//       查询方式 (内存 Map / MySQL / 缓存) 由实现决定.
//     - 不在校验层写第二份形状检查: 校验只有内核 `validateTrajectoryScript` 一份,
//       适配层不复制它的逻辑 (复制 = 两份真相, 迟早漂移).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. npx jest test/engine-adapters/wp10-ethical-scripts.spec.ts 覆盖解析/未命中/空白输入
//     3. npx jest test/engine-adapters/wp10-trajectory-injection.spec.ts 覆盖注入与回退

import { ETHICAL_TRAJECTORY_SCRIPT_MAP } from './ethical-scripts';
import type { TrajectoryScript } from '../../../engine-core';

/**
 * 轨迹剧本解析端口 (可替换数据源).
 */
export interface TrajectoryScriptResolver {
  /**
   * 解析一份轨迹剧本.
   *
   * @param scriptId 剧本 key (握手透传); 缺省 / 查不到 → undefined (**不抛错**)
   * @returns 内核剧本纯对象; 本场无可用剧本 → undefined
   */
  resolve(scriptId: string | undefined): TrajectoryScript | undefined;
}

/**
 * 轨迹剧本解析端口的依赖注入 token.
 */
export const TRAJECTORY_SCRIPT_RESOLVER = Symbol('TRAJECTORY_SCRIPT_RESOLVER');

/**
 * 静态实现: 内存查内置伦理盲盒剧本表.
 *
 * 为什么用同步接口 (而不是角色解析那样的 Promise):
 *   剧本是**进程内常量**, 查表没有 IO —— 用 Promise 会凭空多一轮 microtask,
 *   并让装配层与调用点都以为自己要等一个外部系统. 同步接口让"查不到"这条
 *   路径在类型上就是**立即**可判定的.
 *
 * 为什么查不到就返回 undefined (而不是抛错或回退某个默认剧本):
 *   回退到"随便挑一个剧本"会让一场没指定剧本的会话被**悄悄**套上强覆盖 ——
 *   来访者会突然按别人设计的剧情走, 而督导侧毫无线索. 宁可不约束.
 */
export class StaticTrajectoryScriptResolver implements TrajectoryScriptResolver {
  /**
   * 查一份剧本.
   *
   * @param scriptId 剧本 key
   * @returns 剧本; 缺省 / 未知 key → undefined
   */
  resolve(scriptId: string | undefined): TrajectoryScript | undefined {
    const key = scriptId?.trim() ?? '';
    if (key.length === 0) return undefined;
    return ETHICAL_TRAJECTORY_SCRIPT_MAP[key];
  }
}
