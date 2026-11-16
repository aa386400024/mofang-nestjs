// V2026-11-06 治本 (WP69 · env 盲区扩面 · 单测):
//   WP48 把「读进 config 命名空间却没人消费」这一类单列成了守卫用例⑤, 但当时只登记了
//   2 个已知键 (QDRANT_COLLECTION / VOICE_SESSION_IDLE_TIMEOUT_MS). 全量扫描挖出来的另外
//   14 个键里 —— **12 个已经处理** (SMS_* 5 + METRICS_PATH 挪进预留区; EMBEDDING_* 7 个死遗产
//   直接删), 剩下 2 个 (CONSENT_CURRENT_VERSION / 其余) 按任务单 §2.3 走「修路径」而不是
//   「挪预留区」—— 修好之后它就**真的有人消费**了, 不再是盲区.
//
//   本单守三件事 (用例⑤ 守的是"标记 ↔ 预留区 ↔ 无人消费"的通用不变量, 这里守的是**具体名单**):
//     ① 扩面名单必须**落在预留区** —— 留在生效区 = 运维照抄模板就会配上, 配了不生效;
//     ② **不能误伤**仍在生效的邻居 (SMS_ENABLED / SMS_PROVIDER 有人消费, 不许被一起挪走);
//     ③ EMBEDDING_* 7 个死遗产不许复活 (读进 config 却没人用, 还会让运维以为要自建 bge);
//     ④ CONSENT_CURRENT_VERSION 修好路径后**留在生效区** (它现在真的被消费了).
//
//   边界: 只读文件 + 静态断言, 不起 Nest 容器, 不连 DB, 不发网络.
//
//   验证: npx vitest run test/config/wp69-env-blindspot-expansion.spec.ts

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');
const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');
const DEFAULT_TS = path.join(REPO_ROOT, 'src/config/envs/default.ts');
const CONSENT_SERVICE = path.join(REPO_ROOT, 'src/consent/providers/consent.service.ts');
const PROFILE_CONSENT_SERVICE = path.join(REPO_ROOT, 'src/profile/providers/consent.service.ts');

/**
 * 本单扩面的 6 个键 (SMS 5 + METRICS_PATH 1).
 *
 * 为什么点名: 用例⑤ 守的是"凡标了 @unused-read 的键都必须在预留区"这条**通用**不变量,
 * 它不保证"这 6 个键被处理过" —— 名单漂了它照样绿. 这里把名单钉死.
 */
const EXPANDED_BLANK_SPOT_KEYS: readonly string[] = [
  'SMS_ACCESS_KEY',
  'SMS_ACCESS_SECRET',
  'SMS_SIGN_NAME',
  'SMS_TEMPLATE_CODE',
  'SMS_REGION',
  'METRICS_PATH',
];

/**
 * 仍有人消费、**不许**被挪走的邻居键 (防误伤).
 *
 * `sms.enabled` / `sms.provider` 被 shared/infra/sms/sms.service.ts 消费 ——
 * 把它们一起挪进预留区 = 把一个能用的开关改成"配了不生效".
 */
const KEPT_EFFECTIVE_KEYS: readonly string[] = ['SMS_ENABLED', 'SMS_PROVIDER'];

/**
 * 死遗产键 (bge 自托管 / chatanywhere 老方案) —— 必须**彻底消失**.
 */
const DEAD_EMBEDDING_KEYS: readonly string[] = [
  'EMBEDDING_PROVIDER_DEV',
  'EMBEDDING_PROVIDER_PROD',
  'EMBEDDING_API_KEY',
  'EMBEDDING_API_KEY_MPLAN',
  'EMBEDDING_BGE_URL',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIM',
];

/**
 * `.env.example` 的两段: 生效区 (预留区之前) 与预留区 (读得到但未消费).
 *
 * @returns 两段各自的生效键
 */
function splitEnvExampleSections(): { readonly effective: Set<string>; readonly reserved: Set<string> } {
  const lines = readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/);
  const headerIndex = lines.findIndex((raw) => /^#\s*预留键.*读得到/.test(raw.trim()));
  expect(headerIndex, '.env.example 里必须有「预留键 (读得到但未消费)」区').toBeGreaterThan(-1);

  const effective = new Set<string>();
  const reserved = new Set<string>();
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match?.[1]) continue;
    (index < headerIndex ? effective : reserved).add(match[1]);
  }
  return { effective, reserved };
}

describe('WP69 · env 盲区扩面', () => {
  it('① 扩面的 6 个键 (SMS_* 5 + METRICS_PATH) 落在 .env.example 预留区, 不在生效区', () => {
    const { effective, reserved } = splitEnvExampleSections();

    const stillEffective = EXPANDED_BLANK_SPOT_KEYS.filter((key) => effective.has(key)).sort();
    expect(stillEffective, `以下键仍留在生效区 —— 运维照抄模板就会配上, 配了不生效:\n${stillEffective.join('\n')}`).toEqual([]);

    const notReserved = EXPANDED_BLANK_SPOT_KEYS.filter((key) => !reserved.has(key)).sort();
    expect(notReserved, `以下键没进预留区 —— 运维看不到"配了不生效":\n${notReserved.join('\n')}`).toEqual([]);
  });

  it('② 扩面的 6 个键在 default.ts 里仍被读取 (挪的是位置, 不是删功能)', () => {
    const source = readFileSync(DEFAULT_TS, 'utf8');
    const missing = EXPANDED_BLANK_SPOT_KEYS.filter((key) => !source.includes(`process.env.${key}`)).sort();
    expect(missing, `以下键在 default.ts 里已经读不到了 (不该删, 只该挪位置):\n${missing.join('\n')}`).toEqual([]);
  });

  it('③ 防误伤: SMS_ENABLED / SMS_PROVIDER 仍在生效区 (它们有人消费)', () => {
    const { effective, reserved } = splitEnvExampleSections();
    for (const key of KEPT_EFFECTIVE_KEYS) {
      expect(effective.has(key), `${key} 仍有人消费, 必须留在生效区`).toBe(true);
      expect(reserved.has(key), `${key} 仍有人消费, 不该进预留区`).toBe(false);
    }
  });

  it('④ EMBEDDING_* 7 个死遗产键彻底消失 (default.ts 不读 + .env.example 不配)', () => {
    const defaultSource = readFileSync(DEFAULT_TS, 'utf8');
    const exampleLines = readFileSync(ENV_EXAMPLE, 'utf8')
      .split(/\r?\n/)
      .map((raw) => raw.trim());
    // 只看**生效行**与**代码读取** —— 注释里提到某个键名是允许的 (要留"为什么删了"的说明).
    const liveExampleKeys = new Set<string>();
    for (const line of exampleLines) {
      if (line === '' || line.startsWith('#')) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match?.[1]) liveExampleKeys.add(match[1]);
    }

    const resurrected: string[] = [];
    for (const key of DEAD_EMBEDDING_KEYS) {
      if (defaultSource.includes(`process.env.${key}`)) resurrected.push(`${key} (default.ts 又读了)`);
      if (liveExampleKeys.has(key)) resurrected.push(`${key} (.env.example 又配了)`);
    }
    expect(resurrected, `死遗产键复活了 (B 方案已废, bge 自托管不再走):\n${resurrected.join('\n')}`).toEqual([]);
  });

  it('⑤ CONSENT_CURRENT_VERSION 留在生效区 (路径修好后它真的有人消费)', () => {
    const { effective, reserved } = splitEnvExampleSections();
    // 修好路径 = 它不再是盲区 —— 挪进预留区反而是错的 (会告诉运维"配了不生效").
    expect(effective.has('CONSENT_CURRENT_VERSION')).toBe(true);
    expect(reserved.has('CONSENT_CURRENT_VERSION')).toBe(false);
  });

  it('⑥ 两个 consent service 都读 consent.currentVersion (防路径回退)', () => {
    for (const file of [CONSENT_SERVICE, PROFILE_CONSENT_SERVICE]) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${path.basename(file)} 必须读 'consent' 命名空间下的 currentVersion`).toContain(
        "get<{ currentVersion?: string }>('consent')",
      );
      // 旧的平铺键名一旦被**读**回来, 配了就不生效 —— 这是本单修掉的原始 bug.
      // 只认"读取调用"形态 (get(...)), 注释里提到旧键名是允许的 (要留"为什么改"的说明).
      expect(source, `${path.basename(file)} 里不该再读平铺键 'consentCurrentVersion'`).not.toMatch(
        /get[^)]*\(\s*'consentCurrentVersion'\s*\)/,
      );
    }
  });
});
