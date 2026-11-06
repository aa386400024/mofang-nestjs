// V2026-11-06 治本 (WP38 · 角色版本 semver 纯工具):
//   职责: semver 三元组的格式化 / 解析 / 递增 —— 一份纯函数, 零 IO.
//   边界: 纯 TS; 不 import 任何框架 / ORM / 内核.
//
//   为什么单独成文件 (而不是塞进管理服务):
//     三处要用同一份口径 —— 管理服务递增版本、版本服务回读版本号、快照落库时的标签.
//     口径散在三个地方 = 迟早漂 (一处 major+1 后 minor 没归零, 版本号就乱了).
//
//   反双胞胎:
//     - 不自己定义一套 semver 解析: 只支持 "M.m.p" 三段数字 (够用且无歧义);
//       解析失败返回 null, **不抛错** (脏数据不该把管理面板整页打挂).
//     - 不在这里判定"能不能改 major": 那是管理服务的职责 (要查活跃会话),
//       本文件只管数字怎么算.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp38-character-version-semver.spec.ts 覆盖格式化/解析/递增
//
//   时间戳: 2026-11-06

/**
 * 版本递增档位 (与 semver 三段一一对应).
 *
 * - major —— 角色定位大改 (依恋风格变了 / 核心信念变了): 进行中锁定;
 * - minor —— 参数调整 (信任基线微调 / 阻抗档位调整): 平滑, 新会话用新版本;
 * - patch —— 文案错别字 / 小参数微调: 实时生效.
 */
export type CharacterVersionBump = 'major' | 'minor' | 'patch';

/**
 * 历史版本记录的变更类型.
 *
 * 多了 create 一档: 新建角色的那一版也要留痕 (否则第一版无从追溯).
 */
export type CharacterVersionChangeType = CharacterVersionBump | 'create';

/**
 * 角色版本三元组.
 */
export interface CharacterVersionTriple {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * 格式化版本三元组 → "M.m.p".
 *
 * @param version 三元组
 * @returns 版本号字符串
 */
export function formatCharacterVersion(version: CharacterVersionTriple): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * 解析 "M.m.p" 版本号.
 *
 * 解析失败 (脏数据 / 不是三段) → null, **不抛错**.
 *
 * @param label 版本号字符串
 * @returns 三元组; null = 解析失败
 */
export function parseCharacterVersion(label: string): CharacterVersionTriple | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(label.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * 按档位递增版本号 (semver 归零规则).
 *
 * - major → (M+1).0.0
 * - minor → M.(m+1).0
 * - patch → M.m.(p+1)
 *
 * @param current 当前三元组
 * @param bump 递增档位
 * @returns 递增后的三元组
 */
export function bumpCharacterVersion(current: CharacterVersionTriple, bump: CharacterVersionBump): CharacterVersionTriple {
  if (bump === 'major') {
    return { major: current.major + 1, minor: 0, patch: 0 };
  }
  if (bump === 'minor') {
    return { major: current.major, minor: current.minor + 1, patch: 0 };
  }
  return { major: current.major, minor: current.minor, patch: current.patch + 1 };
}
