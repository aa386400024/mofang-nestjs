// V2026-10-29 治本 (WP9-B · B 层 · MySQL 角色解析器单测):
//   覆盖任务单 §7 A/B 段:
//     A.1 命中 → 非 null, coreBeliefs 非空, baseline 数值在 [0,1]/[-1,1], transference 全零,
//         displayName = 模板 codename
//     A.2 同一 approved slug 连续两次 resolve 深相等 (含 seed)
//     A.3 未知 slug / draft / rejected / disabled / 无 templateId → 一律 null (不抛)
//     A.4 resolver 抛错 → 调用方 (EngineStreamBackend) 回退中性, 会话不开天窗
//     B.5 真实 InMemoryEngineSession: 命中角色开场 → 初始快照带该角色 coreBeliefs 与非中性基线;
//         换角色 → 基线明显不同
//     B.6 resume 接续 → 快照里仍是上一场角色的 coreBeliefs/基线
//     B.7 preset 叠加生效 (同角色不同难度/防御 → 不同 resistance); 越界 preset 被 clamp
//   另附 (口径护栏):
//     C. 映射公式只有一份: DB 路径与内置种子路径产出逐字一致; 叠加系数符合任务单 §4
//     D. 内容基线自检: 首批 4 个 slug 与来访池内容对齐 (coreBeliefs 逐字取自 script)
//
//   全 mock: 仓储用内存 stub, 内核用真实 InMemoryEngineSession (内存实现, 不连 DB),
//             不起容器、不发网络、不连上游.
//
//   为什么"两条数据源产出必须逐字一致"要单测:
//     任务单 §4 的硬要求是"映射公式只存在一份". 若有人在 DB resolver 里另写一份
//     系数, 症状是"同一个角色, 内置种子档和 DB 档的阻抗不一样" —— 而这种差异
//     **没有任何报错**, 只会在真实会话里表现为"换了个数据源, 角色味道变了".
//
//   验证: npx jest test/engine-adapters/wp9b-db-character-resolver.spec.ts
//   时间戳: 2026-10-29

import { FindOperator } from 'typeorm';

import { VISITOR_POOL_TEMPLATE_SEEDS } from '../../src/counselor/config/visitor-pool-seed';
import {
  BUILTIN_AVOIDANT_L1,
  BUILTIN_ANXIOUS_LOW_MOOD_L1,
  BuiltinCharacterProfileResolver,
  type BuiltinCharacterSeed,
} from '../../src/engine-adapters/wiring/character';
import { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity';
import type { ResolvedCharacter } from '../../src/engine-adapters/wiring/character/character-profile.resolver';
import {
  buildCharacterProfileSeeds,
  CHARACTER_PROFILE_SEED_SPECS,
  deriveCharacterProfileId,
  validateCharacterProfileSeedSpecs,
  type CharacterProfileSeed,
  type CharacterProfileSeedSpec,
} from '../../src/engine-adapters/wiring/character/character-profile.seed';
import { DbCharacterProfileResolver, toCharacterSeed } from '../../src/engine-adapters/wiring/character/db-character-profile.resolver';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';

const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';
const CLOCK = 1_700_000_000_000;

/**
 * 中性咨询师文本.
 *
 * 必须不命中规则词典 (empathy/acceptance/... ) 也不命中角色敏感议题 —— 否则事件
 * delta 会改动信任/阻抗/情绪, 断言到的就不是"开场基线"了.
 */
const NEUTRAL_TEXT = '我们开始吧。';

/** 首批 4 个 slug (任务单 §6 拍板). */
const EXPECTED_TEMPLATE_IDS = [
  'vpt_intimate_avoidance_l1',
  'vpt_self_worth_intellectualization_l1',
  'vpt_workplace_intellectualization_l1',
  'vpt_grief_avoidance_l1',
] as const;

/**
 * 内存仓储 stub: 按 where 条件过滤行.
 *
 * 只实现 resolver 用到的 `findOne`; 条件语义 (等值 + IsNull) 与 TypeORM 一致.
 */
class FakeCharacterProfileRepo {
  readonly rows: CharacterProfileEntity[] = [];
  readonly findOneCalls: Record<string, unknown>[] = [];
  /** 抛错开关 (模拟 DB 短暂不可用). */
  failWith?: Error;

  async findOne(options: { where: Record<string, unknown> }): Promise<CharacterProfileEntity | null> {
    if (this.failWith) throw this.failWith;
    this.findOneCalls.push(options.where);
    return this.rows.find((row) => matchesWhere(row, options.where)) ?? null;
  }
}

/**
 * where 条件匹配 (等值 + IsNull).
 */
function matchesWhere(row: CharacterProfileEntity, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (expected instanceof FindOperator) {
      if (expected.type === 'isNull' && actual !== null) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

/**
 * 种子行 → 实体行 (可覆盖任意列).
 */
function buildRow(seed: CharacterProfileSeed, overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
  return {
    id: seed.id,
    templateId: seed.templateId,
    displayName: seed.displayName,
    attachmentStyle: seed.attachmentStyle,
    fivePs: seed.fivePs,
    baselineTrust: seed.trust,
    baselineResistanceVerbal: seed.resistance.verbal,
    baselineResistanceDepth: seed.resistance.depth,
    baselineResistanceStyle: seed.resistance.style,
    baselineEmotionValence: seed.emotion.valence,
    baselineEmotionArousal: seed.emotion.arousal,
    coreBeliefs: seed.coreBeliefs.map((belief) => ({ ...belief, activationTags: [...belief.activationTags] })),
    underlyingDesires: seed.underlyingDesires.map((desire) => ({ ...desire })),
    forbiddenBehaviors: [...seed.forbiddenBehaviors],
    sensitiveTopics: [...seed.sensitiveTopics],
    auditStatus: 'approved',
    enabled: true,
    version: 1,
    createdAt: new Date(CLOCK),
    updatedAt: new Date(CLOCK),
    deletedAt: null,
    ...overrides,
  };
}

/** 首批 4 行 (由内容基线 + 来访池内容构建). */
const SEEDS: readonly CharacterProfileSeed[] = buildCharacterProfileSeeds(VISITOR_POOL_TEMPLATE_SEEDS);

/** 回避型行 (亦舟) 与焦虑型行 (晚晴). */
const AVOIDANT_SEED = SEEDS.find((seed) => seed.templateId === 'vpt_workplace_intellectualization_l1');
const ANXIOUS_SEED = SEEDS.find((seed) => seed.templateId === 'vpt_intimate_avoidance_l1');

/**
 * 装配一个带全部 4 行的 resolver.
 */
function buildResolver(rows: readonly CharacterProfileEntity[]): {
  readonly resolver: DbCharacterProfileResolver;
  readonly repo: FakeCharacterProfileRepo;
} {
  const repo = new FakeCharacterProfileRepo();
  repo.rows.push(...rows);
  const resolver = new DbCharacterProfileResolver(repo as never);
  return { resolver, repo };
}

/** 真实内核会话 (内存实现) + 确定性 id / 时钟. */
function buildKernelSession(): InMemoryEngineSession {
  const bdiStates = new InMemoryBdiStateRepository();
  let idSeq = 0;
  return new InMemoryEngineSession({
    bdiStates,
    memories: new InMemoryMemoryStore({ now: () => CLOCK }),
    idFactory: () => {
      idSeq += 1;
      return `wp9b-id-${idSeq}`;
    },
    now: () => CLOCK,
  });
}

/** 角色基线 (非空形态). */
type ProfileBaseline = NonNullable<ResolvedCharacter['characterProfile']['baseline']>;
/** 三维阻抗 (非空形态). */
interface ProfileResistance {
  readonly verbal: number;
  readonly depth: number;
  readonly style: number;
}
/** 情绪 (非空形态). */
interface ProfileEmotion {
  readonly valence: number;
  readonly arousal: number;
  readonly label?: string;
}

/**
 * 命中结果的非空版本 (未命中 → 用例当场失败).
 *
 * 为什么必须有它: 断言里写满 `?.` / `??` 有两个害处 ——
 *   ① 单测函数的复杂度会被可选链顶穿上限 (可读性灾难);
 *   ② 更要命的是 `?? 0` 会把"角色根本没命中"伪装成"数值是 0", 让失败现场失真.
 * 所以这里把"未命中"变成一次显式失败, 而不是被吞掉的兜底值.
 *
 * @param resolved 解析结果
 * @returns 非空的解析结果
 */
function expectResolved(resolved: ResolvedCharacter | null): ResolvedCharacter {
  expect(resolved).not.toBeNull();
  if (!resolved) throw new Error('角色未命中');
  return resolved;
}

/**
 * 取角色基线 (缺字段当场失败).
 *
 * @param resolved 解析结果
 * @returns 非空基线
 */
function expectBaseline(resolved: ResolvedCharacter): ProfileBaseline {
  const baseline = resolved.characterProfile.baseline;
  expect(baseline).toBeDefined();
  expect(baseline?.trust).toBeDefined();
  if (!baseline) throw new Error('角色基线缺失');
  return baseline;
}

/**
 * 取三维阻抗 (缺字段当场失败).
 *
 * @param baseline 角色基线
 * @returns 三维阻抗
 */
function expectResistance(baseline: ProfileBaseline): ProfileResistance {
  const resistance = baseline.resistance ?? {};
  expect(resistance.verbal).toBeDefined();
  expect(resistance.depth).toBeDefined();
  expect(resistance.style).toBeDefined();
  return { verbal: resistance.verbal ?? 0, depth: resistance.depth ?? 0, style: resistance.style ?? 0 };
}

/**
 * 取情绪基线 (缺字段当场失败).
 *
 * @param baseline 角色基线
 * @returns 情绪基线
 */
function expectEmotion(baseline: ProfileBaseline): ProfileEmotion {
  const emotion = baseline.emotion ?? {};
  expect(emotion.valence).toBeDefined();
  expect(emotion.arousal).toBeDefined();
  return { valence: emotion.valence ?? 0, arousal: emotion.arousal ?? 0, label: emotion.label };
}

/**
 * 取指定模板的内容基线 (缺失当场失败).
 *
 * @param templateId 公共模板 id
 * @returns 内容基线
 */
function seedOf(templateId: string): CharacterProfileSeed {
  const seed = SEEDS.find((item) => item.templateId === templateId);
  if (!seed) throw new Error(`内容基线缺失: ${templateId}`);
  return seed;
}

/**
 * 引擎门面 stub (只看 open 入参).
 */
class FakeEngineTurnService {
  readonly openCalls: { readonly characterProfile?: unknown; readonly seed?: number }[] = [];

  open(input: { readonly characterProfile?: unknown; readonly seed?: number }): { readonly handleId: string; readonly sessionId: string } {
    this.openCalls.push(input);
    return { handleId: `handle-${this.openCalls.length}`, sessionId: 'session-1' };
  }

  close(): void {
    // 关闭路径本用例不关心.
  }
}

describe('WP9-B · MySQL 角色解析器 (DB 数据源)', () => {
  describe('A.1 命中 → 完整角色基线', () => {
    it('返回非 null, coreBeliefs 非空, 数值在区间内, transference 全零, 展示名 = 模板代号', async () => {
      const { resolver } = buildResolver([buildRow(ANXIOUS_SEED!)]);

      const resolved = expectResolved(await resolver.resolve({ templateId: 'vpt_intimate_avoidance_l1' }));
      const profile = resolved.characterProfile;

      expect(profile.coreBeliefs.length).toBeGreaterThan(0);
      expect(profile.forbiddenBehaviors.length).toBeGreaterThan(0);
      expect(profile.sensitiveTopics.length).toBeGreaterThan(0);
      expect((profile.underlyingDesires ?? []).length).toBeGreaterThan(0);
      expect(profile.attachmentStyle).toBe('anxious');

      const baseline = expectBaseline(resolved);
      expect(baseline.trust).toBeGreaterThanOrEqual(0);
      expect(baseline.trust).toBeLessThanOrEqual(1);

      const resistance = expectResistance(baseline);
      for (const value of [resistance.verbal, resistance.depth, resistance.style]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }

      const emotion = expectEmotion(baseline);
      expect(emotion.valence).toBeGreaterThanOrEqual(-1);
      expect(emotion.valence).toBeLessThanOrEqual(1);
      expect(emotion.arousal).toBeGreaterThanOrEqual(0);
      expect(emotion.arousal).toBeLessThanOrEqual(1);
      // 移情固定全零 (开场不预设正负).
      expect(baseline.transference).toEqual({ positive: 0, negative: 0, dependency: 0 });
      // 情绪标签不手填 (由内核重算).
      expect(emotion.label).toBeUndefined();

      // 展示名 = 模板代号 (与速查卡一致).
      expect(resolved.displayName).toBe('晚晴');
    });
  });

  describe('A.2 可复现', () => {
    it('同一 slug 连续两次 resolve 深相等 (含 seed 与基线数值)', async () => {
      const { resolver } = buildResolver([buildRow(ANXIOUS_SEED!)]);

      const first = await resolver.resolve({ templateId: 'vpt_intimate_avoidance_l1', preset: { difficulty: 'L2' } });
      const second = await resolver.resolve({ templateId: 'vpt_intimate_avoidance_l1', preset: { difficulty: 'L2' } });

      expect(second).toEqual(first);
      expect(second?.seed).toBe(first?.seed);
      expect(typeof second?.seed).toBe('number');
    });
  });

  describe('A.3 未命中一律 null (不抛, 不造默认角色)', () => {
    it('未知 slug → null', async () => {
      const { resolver } = buildResolver([buildRow(ANXIOUS_SEED!)]);
      await expect(resolver.resolve({ templateId: 'vpt_not_exists' })).resolves.toBeNull();
    });

    it('draft 行 → null', async () => {
      const { resolver } = buildResolver([buildRow(ANXIOUS_SEED!, { auditStatus: 'draft' })]);
      await expect(resolver.resolve({ templateId: 'vpt_intimate_avoidance_l1' })).resolves.toBeNull();
    });

    it('rejected 行 → null', async () => {
      const { resolver } = buildResolver([buildRow(ANXIOUS_SEED!, { auditStatus: 'rejected' })]);
      await expect(resolver.resolve({ templateId: 'vpt_intimate_avoidance_l1' })).resolves.toBeNull();
    });

    it('已下架行 → null', async () => {
      const { resolver } = buildResolver([buildRow(ANXIOUS_SEED!, { enabled: false })]);
      await expect(resolver.resolve({ templateId: 'vpt_intimate_avoidance_l1' })).resolves.toBeNull();
    });

    it('已软删行 → null', async () => {
      const { resolver } = buildResolver([buildRow(ANXIOUS_SEED!, { deletedAt: new Date(CLOCK) })]);
      await expect(resolver.resolve({ templateId: 'vpt_intimate_avoidance_l1' })).resolves.toBeNull();
    });

    it('无 templateId → null (不查库)', async () => {
      const { resolver, repo } = buildResolver([buildRow(ANXIOUS_SEED!)]);
      await expect(resolver.resolve({})).resolves.toBeNull();
      expect(repo.findOneCalls).toHaveLength(0);
    });
  });

  describe('A.4 DB 抛错 → 调用方回退中性 (会话不开天窗)', () => {
    it('resolver 把 DB 异常冒泡给调用方', async () => {
      const { resolver, repo } = buildResolver([buildRow(ANXIOUS_SEED!)]);
      repo.failWith = new Error('db down');

      await expect(resolver.resolve({ templateId: 'vpt_intimate_avoidance_l1' })).rejects.toThrow('db down');
    });

    it('EngineStreamBackend 捕到异常 → 不带 characterProfile, 回退中性, 不抛', async () => {
      const { resolver, repo } = buildResolver([buildRow(ANXIOUS_SEED!)]);
      repo.failWith = new Error('db down');
      const engine = new FakeEngineTurnService();
      const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, resolver);

      const persona = await backend.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        personaId: VISITOR,
        templateId: 'vpt_intimate_avoidance_l1',
      });

      expect(engine.openCalls[0]?.characterProfile).toBeUndefined();
      expect(persona.name).toBe('来访者');
    });
  });

  describe('B.5 注入内核: 初始快照带该角色信念与非中性基线', () => {
    it('命中角色开场 → 快照带该角色 coreBeliefs 与基线数值', async () => {
      const { resolver } = buildResolver([buildRow(AVOIDANT_SEED!)]);
      const resolved = await resolver.resolve({ templateId: 'vpt_workplace_intellectualization_l1' });
      const session = buildKernelSession();

      const handle = session.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        visitorId: VISITOR,
        characterProfile: resolved?.characterProfile,
        seed: resolved?.seed,
      });
      const output = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

      expect(output.snapshot.coreBeliefs.map((belief) => belief.statement)).toEqual(
        AVOIDANT_SEED?.coreBeliefs.map((belief) => belief.statement),
      );
      expect(output.snapshot.trust).toBe(AVOIDANT_SEED?.trust);
      expect(output.snapshot.resistance).toEqual({
        verbal: AVOIDANT_SEED?.resistance.verbal,
        depth: AVOIDANT_SEED?.resistance.depth,
        style: AVOIDANT_SEED?.resistance.style,
      });
      expect(output.snapshot.underlyingDesires.map((desire) => desire.key)).toEqual(
        AVOIDANT_SEED?.underlyingDesires.map((desire) => desire.key),
      );
    });

    it('换角色 → 初始快照基线明显不同', async () => {
      const { resolver } = buildResolver([buildRow(AVOIDANT_SEED!), buildRow(ANXIOUS_SEED!)]);

      const snapshotOf = async (templateId: string): Promise<{ trust: number; resistance: unknown; beliefs: string[] }> => {
        const resolved = await resolver.resolve({ templateId });
        const session = buildKernelSession();
        const handle = session.openSession({
          sessionId: `session-${templateId}`,
          tenantId: TENANT,
          visitorId: VISITOR,
          characterProfile: resolved?.characterProfile,
          seed: resolved?.seed,
        });
        const output = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });
        return {
          trust: output.snapshot.trust,
          resistance: output.snapshot.resistance,
          beliefs: output.snapshot.coreBeliefs.map((belief) => belief.statement),
        };
      };

      const avoidant = await snapshotOf('vpt_workplace_intellectualization_l1');
      const anxious = await snapshotOf('vpt_intimate_avoidance_l1');

      expect(avoidant.trust).not.toBe(anxious.trust);
      expect(avoidant.resistance).not.toEqual(anxious.resistance);
      expect(avoidant.beliefs).not.toEqual(anxious.beliefs);
    });
  });

  describe('B.6 resume 接续不丢角色', () => {
    it('上一场角色的 coreBeliefs/基线在接续场里原样保留 (不被默认值覆盖)', async () => {
      const { resolver } = buildResolver([buildRow(AVOIDANT_SEED!)]);
      const session = buildKernelSession();

      const first = await resolver.resolve({ templateId: 'vpt_workplace_intellectualization_l1' });
      const firstHandle = session.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        visitorId: VISITOR,
        characterProfile: first?.characterProfile,
        seed: first?.seed,
      });
      await session.turn(firstHandle.handleId, { userText: NEUTRAL_TEXT });

      // 接续场带**另一个**角色, 内核契约要求不覆盖上一场状态.
      const second = await resolver.resolve({ templateId: 'vpt_intimate_avoidance_l1' });
      const secondHandle = session.openSession({
        sessionId: 'session-2',
        tenantId: TENANT,
        visitorId: VISITOR,
        resumeFromSessionId: 'session-1',
        characterProfile: second?.characterProfile,
        seed: second?.seed,
      });
      const output = await session.turn(secondHandle.handleId, { userText: NEUTRAL_TEXT });

      expect(output.snapshot.trust).toBe(AVOIDANT_SEED?.trust);
      expect(output.snapshot.trust).not.toBe(ANXIOUS_SEED?.trust);
      expect(output.snapshot.coreBeliefs.map((belief) => belief.statement)).toEqual(
        AVOIDANT_SEED?.coreBeliefs.map((belief) => belief.statement),
      );
    });
  });

  describe('B.7 preset 叠加生效 + 越界 clamp', () => {
    it('同角色不同难度/防御 → resistance 不同 (临场叠加生效)', async () => {
      const { resolver } = buildResolver([buildRow(AVOIDANT_SEED!)]);

      const easy = await resolver.resolve({
        templateId: 'vpt_workplace_intellectualization_l1',
        preset: { difficulty: 'L1', defenseLevel: 0 },
      });
      const hard = await resolver.resolve({
        templateId: 'vpt_workplace_intellectualization_l1',
        preset: { difficulty: 'L3', defenseLevel: 0.8 },
      });

      expect(hard?.characterProfile.baseline?.resistance?.depth ?? 0).toBeGreaterThan(
        easy?.characterProfile.baseline?.resistance?.depth ?? 0,
      );
    });

    it('越界 preset 被 clamp (不抛, 不出 NaN, 不越界)', async () => {
      const { resolver } = buildResolver([buildRow(AVOIDANT_SEED!)]);

      const resolved = await resolver.resolve({
        templateId: 'vpt_workplace_intellectualization_l1',
        preset: { emotionBaseline: 1.9, defenseLevel: -0.2, difficulty: 'L3', style: 'resistant' },
      });

      const baseline = resolved?.characterProfile.baseline;
      expect(baseline?.emotion?.arousal).toBe(1);
      for (const value of [baseline?.resistance?.verbal, baseline?.resistance?.depth, baseline?.resistance?.style]) {
        expect(Number.isNaN(value)).toBe(false);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('C. 映射公式只有一份 (口径护栏)', () => {
    it('DB 路径与内置种子路径产出逐字一致 (同角色同 preset)', async () => {
      const preset = { difficulty: 'L3', style: 'resistant', emotionBaseline: 0.5, defenseLevel: 0.5 };
      const row = buildRow(AVOIDANT_SEED!);
      const { resolver } = buildResolver([row]);

      const viaDb = await resolver.resolve({ templateId: row.templateId, preset });

      // 等价的"内置种子"形态 (同一角色, 只是数据源不同).
      const equivalentSeed: BuiltinCharacterSeed = {
        key: row.templateId,
        displayName: row.displayName,
        attachmentStyle: row.attachmentStyle,
        coreBeliefs: row.coreBeliefs,
        underlyingDesires: row.underlyingDesires,
        forbiddenBehaviors: row.forbiddenBehaviors,
        sensitiveTopics: row.sensitiveTopics,
        baseline: {
          trust: row.baselineTrust,
          resistance: {
            verbal: row.baselineResistanceVerbal,
            depth: row.baselineResistanceDepth,
            style: row.baselineResistanceStyle,
          },
          emotion: { valence: row.baselineEmotionValence, arousal: row.baselineEmotionArousal },
        },
      };
      const viaBuiltin = await new BuiltinCharacterProfileResolver([equivalentSeed]).resolve({
        templateId: row.templateId,
        preset,
      });

      expect(viaDb?.characterProfile).toEqual(viaBuiltin?.characterProfile);
      expect(viaDb?.seed).toBe(viaBuiltin?.seed);
    });

    it('叠加系数符合任务单 §4 (防御×0.35 + 难度系数 + 风格微调, 全部 clamp01)', async () => {
      const { resolver } = buildResolver([buildRow(AVOIDANT_SEED!)]);
      const base = seedOf('vpt_workplace_intellectualization_l1');

      const resolved = expectResolved(
        await resolver.resolve({
          templateId: 'vpt_workplace_intellectualization_l1',
          preset: { difficulty: 'L3', style: 'resistant', emotionBaseline: 0.5, defenseLevel: 0.5 },
        }),
      );

      const baseline = expectBaseline(resolved);
      const resistance = expectResistance(baseline);
      const common = 0.5 * 0.35 + 0.16; // 防御水平×权重 + L3 难度系数
      expect(resistance.verbal).toBeCloseTo(Math.min(1, base.resistance.verbal + common), 6);
      expect(resistance.depth).toBeCloseTo(Math.min(1, base.resistance.depth + common), 6);
      // style 维再受风格微调 (+0.15 resistant).
      expect(resistance.style).toBeCloseTo(Math.min(1, base.resistance.style + common + 0.15), 6);
      // 信任由种子给, 临场不覆盖.
      expect(baseline.trust).toBeCloseTo(base.trust, 6);
      // valence 由种子给; arousal 由临场 emotionBaseline 决定.
      const emotion = expectEmotion(baseline);
      expect(emotion.valence).toBeCloseTo(base.emotion.valence, 6);
      expect(emotion.arousal).toBeCloseTo(0.5, 6);
    });

    it('toCharacterSeed 只转形状, 不改数值 (与行逐字段一致)', () => {
      const row = buildRow(ANXIOUS_SEED!);
      const seed = toCharacterSeed(row);

      expect(seed.key).toBe(row.templateId);
      expect(seed.displayName).toBe(row.displayName);
      expect(seed.attachmentStyle).toBe(row.attachmentStyle);
      expect(seed.baseline.trust).toBe(row.baselineTrust);
      expect(seed.baseline.resistance.verbal).toBe(row.baselineResistanceVerbal);
      expect(seed.baseline.resistance.depth).toBe(row.baselineResistanceDepth);
      expect(seed.baseline.resistance.style).toBe(row.baselineResistanceStyle);
      expect(seed.baseline.emotion.valence).toBe(row.baselineEmotionValence);
      expect(seed.baseline.emotion.arousal).toBe(row.baselineEmotionArousal);
      expect(seed.coreBeliefs).toEqual(row.coreBeliefs);
      expect(seed.underlyingDesires).toEqual(row.underlyingDesires);
      // 拷贝而非共享引用.
      expect(seed.coreBeliefs).not.toBe(row.coreBeliefs);
    });
  });

  describe('D. 首批内容基线与来访池对齐', () => {
    it('恰好 4 个 slug, 且全部来自已存在的公共模板', () => {
      expect(SEEDS.map((seed) => seed.templateId)).toEqual([...EXPECTED_TEMPLATE_IDS]);
      const visitorIds = new Set(VISITOR_POOL_TEMPLATE_SEEDS.map((seed) => seed.id));
      for (const seed of SEEDS) {
        expect(visitorIds.has(seed.templateId)).toBe(true);
      }
    });

    it('coreBeliefs 逐字取自 visitor_pool_templates.script.innerWorkingModel.coreBeliefs', () => {
      for (const seed of SEEDS) {
        const visitor = VISITOR_POOL_TEMPLATE_SEEDS.find((item) => item.id === seed.templateId);
        expect(seed.coreBeliefs.map((belief) => belief.statement)).toEqual(visitor?.script.innerWorkingModel.coreBeliefs);
        // 展示名 = 模板代号.
        expect(seed.displayName).toBe(visitor?.codename);
      }
    });

    it('依恋风格与公共模板的 innerWorkingModel.attachmentType 一致', () => {
      for (const seed of SEEDS) {
        const visitor = VISITOR_POOL_TEMPLATE_SEEDS.find((item) => item.id === seed.templateId);
        expect(seed.attachmentStyle).toBe(visitor?.script.innerWorkingModel.attachmentType);
      }
    });

    it('内容基线自检通过; 模板缺失时报错而不是静默', () => {
      expect(validateCharacterProfileSeedSpecs(VISITOR_POOL_TEMPLATE_SEEDS)).toBeNull();
      expect(validateCharacterProfileSeedSpecs([])).toContain('找不到对应模板');
      // 自检不通过时 build 必须炸 (不产出半截内容).
      expect(() => buildCharacterProfileSeeds([])).toThrow('内容基线自检失败');
    });

    it('两档基线可区分 (回避型阻抗高于焦虑型; 信任低于焦虑型)', () => {
      const avoidant = SEEDS.find((seed) => seed.templateId === 'vpt_workplace_intellectualization_l1');
      const anxious = SEEDS.find((seed) => seed.templateId === 'vpt_intimate_avoidance_l1');

      expect(avoidant?.resistance.depth ?? 0).toBeGreaterThan(anxious?.resistance.depth ?? 0);
      expect(avoidant?.trust ?? 1).toBeLessThan(anxious?.trust ?? 0);
      expect(avoidant?.attachmentStyle).toBe('avoidant');
      expect(anxious?.attachmentStyle).toBe('anxious');
    });

    it('内部主键由 template_id 内容派生 (同一模板永远同一个 id)', () => {
      expect(deriveCharacterProfileId('vpt_intimate_avoidance_l1')).toBe(deriveCharacterProfileId('vpt_intimate_avoidance_l1'));
      expect(deriveCharacterProfileId('vpt_intimate_avoidance_l1')).not.toBe(deriveCharacterProfileId('vpt_grief_avoidance_l1'));
      expect(deriveCharacterProfileId('vpt_intimate_avoidance_l1')).toHaveLength(36);
    });
  });

  describe('E. 与 WP9-A 内置种子的档位口径一致', () => {
    it('焦虑型行抄 WP9-A anxious 档, 回避型行抄 avoidant 档', () => {
      const anxiousSpec = seedSpecByStyle('anxious');
      expect(anxiousSpec.trust).toBeCloseTo(0.28);
      expect(anxiousSpec.resistance.verbal).toBe(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.resistance.verbal);
      expect(anxiousSpec.resistance.depth).toBe(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.resistance.depth);
      expect(anxiousSpec.resistance.style).toBe(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.resistance.style);
      expect(anxiousSpec.emotion.valence).toBe(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.emotion.valence);
      expect(anxiousSpec.emotion.arousal).toBe(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.emotion.arousal);

      const avoidantSpec = seedSpecByStyle('avoidant');
      expect(avoidantSpec.trust).toBe(BUILTIN_AVOIDANT_L1.baseline.trust);
      expect(avoidantSpec.resistance.verbal).toBe(BUILTIN_AVOIDANT_L1.baseline.resistance.verbal);
      expect(avoidantSpec.resistance.depth).toBe(BUILTIN_AVOIDANT_L1.baseline.resistance.depth);
      expect(avoidantSpec.resistance.style).toBe(BUILTIN_AVOIDANT_L1.baseline.resistance.style);
      expect(avoidantSpec.emotion.valence).toBe(BUILTIN_AVOIDANT_L1.baseline.emotion.valence);
      expect(avoidantSpec.emotion.arousal).toBe(BUILTIN_AVOIDANT_L1.baseline.emotion.arousal);
    });
  });
});

/**
 * 取某一档的首个内容基线 (用于口径对照).
 *
 * @param style 依恋风格
 * @returns 该档的内容基线
 */
function seedSpecByStyle(style: string): CharacterProfileSeedSpec {
  const spec = CHARACTER_PROFILE_SEED_SPECS.find((item) => item.attachmentStyle === style);
  if (!spec) throw new Error(`没有 ${style} 档的内容基线`);
  return spec;
}
