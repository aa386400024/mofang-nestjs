// V2026-10-29 治本 (WP9-A · B 层 · 角色解析端口):
//   职责: 定义"角色定义 → 内核 CharacterProfile"这条解析链的**可替换端口** ——
//         解析请求 (角色 key + 临场参数) / 解析结果 (角色内核 + 可复现种子 + 展示名).
//   边界: 纯类型 + 一个 Symbol token, 零 IO / 零 @nestjs 逻辑; **不进 engine-core**
//         (内核零角色实体、零 IO 是本期红线).
//
//   为什么要有这个端口 (而不是直接把种子写进 EngineStreamBackend):
//     WP9-A 的数据源是**内置硬编码种子**, WP9-B 的数据源是 **MySQL 角色池**
//     (5Ps 长文本 + 审核状态 + 版本). 两者的差别只在"角色定义从哪来", 其余
//     (怎么映射成 CharacterProfile / 怎么注入内核 / 解析不到怎么办) 完全一样.
//     所以把"从哪来"抽成端口, WP9-B 就只新增一个 `DbCharacterProfileResolver`
//     实现 + 改一行绑定, **注入点与 EngineStreamBackend 零改动** ——
//     这正是任务单 §0 "先做 A、避免边建表边改装配导致返工" 的落点.
//
//   为什么解析结果可以是 null (而不是抛错):
//     "查不到角色"在 WP9-A 是**常态**而不是异常 (DB 角色池未接, 握手带来的
//     templateId 大概率不在内置注册表里). 抛错会把"没有角色"升级成"会话开不起来",
//     让一个可选增强变成硬依赖. null = "本场无角色, 走中性基线", 会话照常进行.
//
//   反双胞胎:
//     - 不把"角色"塞进内核: 内核只认 `CharacterProfile` 这一个纯对象, 不感知
//       5Ps / persona 实体 / 数据库表 —— 端口是**适配层**的东西.
//     - 不用 interface 当 Nest 的 provider token: interface 编译后没有运行时值,
//       必须有真实 token (这里用 Symbol; 字符串 token 撞名时 Nest 不报错而是
//       静默注入错东西).
//     - 不在端口上声明"怎么查": 端口只说"给我一个角色 key, 你给我一个内核基线",
//       查询方式 (内存 Map / MySQL / 缓存) 由实现决定.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9a-character-resolver.spec.ts 覆盖解析/可复现/可区分/回退/clamp
//     3. test/engine-adapters/wp9a-open-profile.spec.ts 覆盖 openSession 注入与中性回退

import type { CharacterProfile } from '../../../engine-core';

/**
 * 临场参数 (握手已解析) —— 影响本场基线的**叠加项**.
 *
 * 全部可选: 缺省 = "这一场没有临场调整", 走角色种子自己的基线.
 */
export interface CharacterPresetInput {
  /** 难度档 (L1 / L2 / L3); 越高阻抗基线越高. */
  readonly difficulty?: string;
  /** 配合风格 (cooperative / mixed / resistant / avoidant / defensive). */
  readonly style?: string;
  /** 情绪基线 0..1 (内在空洞感起点). */
  readonly emotionBaseline?: number;
  /** 防御水平 0..1 (对"被看穿"的警觉度). */
  readonly defenseLevel?: number;
}

/**
 * 角色解析请求.
 */
export interface CharacterResolveRequest {
  /** 角色 key (公共人物模板 id / 内置种子 key). 缺省 = 本场无角色. */
  readonly templateId?: string;
  /** 专项训练技巧码 (仅作日志/观测, 不参与基线映射). */
  readonly skillCode?: string;
  /** 临场参数 (叠加在角色种子基线之上). */
  readonly preset?: CharacterPresetInput;
}

/**
 * 角色解析结果.
 */
export interface ResolvedCharacter {
  /** 内核角色基线 (纯对象; 内核只消费它, 不感知角色实体). */
  readonly characterProfile: CharacterProfile;
  /**
   * 确定性可复现种子 (由角色 key 稳定派生); 省略则由内核自行生成.
   *
   * 存在的意义: "同一角色 + 同一行为序列 → 同一 BDI 轨迹" (WP1/WP3 伦理盲盒
   * 可复现的前置条件). 种子必须**确定性派生** —— 用随机数等于把可复现性扔掉.
   */
  readonly seed?: number;
  /** 展示用角色名 (供 persona 快照 / 报告 / 日志; 不进决策). */
  readonly displayName: string;
}

/**
 * 角色解析端口 (可替换数据源).
 */
export interface CharacterProfileResolver {
  /**
   * 解析一个角色.
   *
   * @param request 解析请求
   * @returns 解析结果; 本场无可用角色 → null (**不抛错**)
   */
  resolve(request: CharacterResolveRequest): Promise<ResolvedCharacter | null>;
}

/**
 * 角色解析端口的依赖注入 token.
 */
export const CHARACTER_PROFILE_RESOLVER = Symbol('CHARACTER_PROFILE_RESOLVER');
