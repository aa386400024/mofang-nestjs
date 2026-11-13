// V2026-11-06 治本 (WP38 · 角色版本 semver + 会话绑定版本 · 单测):
//   覆盖任务单 §2.1 的验收:
//     ① character_profiles 有 major / minor / patch 三列 (出参可见);
//     ② 有会话正在用某角色时, 改 major 被拒绝 (409);
//     ③ character_profile_versions 存历史版本 (每次更新都存一份);
//     ④ 会话创建时绑定当时的角色版本 (vpt 落库桥写入 training_sessions);
//     ⑤ 版本语义: major 锁定 / minor 平滑 / patch 实时.
//   另附护栏:
//     · semver 递增口径 (major 归零 / minor 归零) —— 口径散了, 版本号会乱;
//     · 快照存的是"变更后"的内容 (回溯要看到当时怎么配的);
//     · 插槽语义: "查不到" ≠ "0 场" (混起来主版本锁定会静默失效).
//
//   全 mock: 仓储用内存 stub, 插槽用真注册表 + 假解析器 —— 不起容器、不连 DB、不发网络.
//
//   验证: npx vitest run test/engine-adapters/wp38-character-version-semver.spec.ts
//
//   时间戳: 2026-11-06

import { describe, expect, it } from 'vitest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import type { TrainingSession } from '../../src/counselor/entities/training-session.entity.js';
import { VptSessionBridgeService } from '../../src/counselor/providers/vpt-session-bridge.service.js';
import { CharacterProfileVersionEntity } from '../../src/engine-adapters/wiring/character/character-profile-version.entity.js';
import { CharacterProfileAdminService } from '../../src/engine-adapters/wiring/character/character-profile.admin.service.js';
import type {
  CreateCharacterProfileDto,
  UpdateCharacterProfileDto,
} from '../../src/engine-adapters/wiring/character/character-profile.dto.js';
import { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity.js';
import {
  bumpCharacterVersion,
  formatCharacterVersion,
  parseCharacterVersion,
} from '../../src/engine-adapters/wiring/character/character-version.js';
import { CharacterUsageRegistry } from '../../src/voice/character-usage-slot.js';
import { CharacterVersionRegistry } from '../../src/voice/character-version-slot.js';
import { VoiceSessionBridgeRegistry } from '../../src/voice/voice-session-bridge.js';
import type { VoiceSessionOpenInput } from '../../src/voice/voice-session-bridge.js';

const TEMPLATE_ID = 'vpt_test_role_l1';

/**
 * 内存仓储 stub: 角色主表.
 */
class FakeCharacterProfileRepo {
  readonly rows: CharacterProfileEntity[] = [];

  async findOne(options: { where: Record<string, unknown> }): Promise<CharacterProfileEntity | null> {
    return this.rows.find((row) => matchesWhere(row, options.where)) ?? null;
  }

  async findAndCount(options: { where?: Record<string, unknown> }): Promise<[CharacterProfileEntity[], number]> {
    const where = options.where;
    const filtered = where ? this.rows.filter((row) => matchesWhere(row, where)) : [...this.rows];
    return [filtered, filtered.length];
  }

  create(entity: Partial<CharacterProfileEntity>): CharacterProfileEntity {
    return { ...entity } as CharacterProfileEntity;
  }

  async save(entity: CharacterProfileEntity): Promise<CharacterProfileEntity> {
    const index = this.rows.findIndex((row) => row.id === entity.id);
    if (index === -1) {
      this.rows.push(entity);
    } else {
      this.rows[index] = entity;
    }
    return entity;
  }
}

/**
 * 内存仓储 stub: 历史版本快照表.
 */
class FakeCharacterProfileVersionRepo {
  readonly rows: CharacterProfileVersionEntity[] = [];

  async findOne(options: { where: Record<string, unknown> }): Promise<CharacterProfileVersionEntity | null> {
    return this.rows.find((row) => matchesWhere(row, options.where)) ?? null;
  }

  async find(options: { where: Record<string, unknown> }): Promise<CharacterProfileVersionEntity[]> {
    const rows = this.rows.filter((row) => matchesWhere(row, options.where));
    // 服务端按版本号倒序取 —— stub 也照这个口径排 (否则测的就不是真实顺序).
    return rows.sort((a, b) => b.versionMajor - a.versionMajor || b.versionMinor - a.versionMinor || b.versionPatch - a.versionPatch);
  }

  create(entity: Partial<CharacterProfileVersionEntity>): CharacterProfileVersionEntity {
    return { ...entity } as CharacterProfileVersionEntity;
  }

  async save(entity: CharacterProfileVersionEntity): Promise<CharacterProfileVersionEntity> {
    const index = this.rows.findIndex((row) => row.id === entity.id);
    if (index === -1) {
      this.rows.push(entity);
    } else {
      this.rows[index] = entity;
    }
    return entity;
  }
}

/**
 * where 条件匹配 (等值).
 */
function matchesWhere(row: object, where: Record<string, unknown>): boolean {
  const values = row as Record<string, unknown>;
  for (const [key, expected] of Object.entries(where)) {
    if (values[key] !== expected) return false;
  }
  return true;
}

/**
 * 新建角色的入参 (最小完整).
 */
function buildCreateDto(overrides: Partial<CreateCharacterProfileDto> = {}): CreateCharacterProfileDto {
  return {
    templateId: TEMPLATE_ID,
    displayName: '试角色',
    attachmentStyle: 'anxious',
    fivePs: {
      presenting: '主诉',
      precipitating: '诱发',
      maintaining: '维持',
      protective: '保护',
      vulnerability: '易感',
    },
    baselineTrust: 0.28,
    baselineResistanceVerbal: 0.42,
    baselineResistanceDepth: 0.5,
    baselineResistanceStyle: 0.38,
    baselineEmotionValence: -0.45,
    baselineEmotionArousal: 0.62,
    coreBeliefs: [{ theme: 'worthlessness', statement: '我没什么用。', activationTags: ['failure'] }],
    underlyingDesires: [{ key: 'acceptance', label: '被接纳', baselineWeight: 0.7 }],
    forbiddenBehaviors: ['主动给出解决方案'],
    sensitiveTopics: ['失败'],
    ...overrides,
  };
}

/**
 * 编辑角色的入参 (最小完整).
 */
function buildUpdateDto(overrides: Partial<UpdateCharacterProfileDto> = {}): UpdateCharacterProfileDto {
  return {
    baselineTrust: 0.4,
    displayName: '改名了',
    ...overrides,
  };
}

/**
 * 装配管理服务 (含历史版本仓储 + 角色占用插槽).
 *
 * @param activeSessions 活跃会话数 (null = 插槽判不出来)
 * @returns 服务 + 两个仓储
 */
function buildHarness(activeSessions: number | null = 0): {
  readonly service: CharacterProfileAdminService;
  readonly repo: FakeCharacterProfileRepo;
  readonly versionRepo: FakeCharacterProfileVersionRepo;
} {
  const repo = new FakeCharacterProfileRepo();
  const versionRepo = new FakeCharacterProfileVersionRepo();
  const usage = new CharacterUsageRegistry();
  if (activeSessions !== null) {
    usage.register({
      name: 'test-usage',
      countActiveSessions: async () => activeSessions,
    });
  }
  const service = new CharacterProfileAdminService(repo as never, versionRepo as never, usage);
  return { service, repo, versionRepo };
}

describe('WP38 · 角色版本 semver', () => {
  describe('① semver 工具口径', () => {
    it('格式化 / 解析往返一致', () => {
      expect(formatCharacterVersion({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
      expect(parseCharacterVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('解析非法版本号 → null (不抛错)', () => {
      expect(parseCharacterVersion('1.2')).toBeNull();
      expect(parseCharacterVersion('abc')).toBeNull();
      expect(parseCharacterVersion('')).toBeNull();
    });

    it('递增按 semver 归零: major → M+1.0.0 / minor → M.m+1.0 / patch → M.m.p+1', () => {
      const current = { major: 1, minor: 2, patch: 3 };
      expect(bumpCharacterVersion(current, 'major')).toEqual({ major: 2, minor: 0, patch: 0 });
      expect(bumpCharacterVersion(current, 'minor')).toEqual({ major: 1, minor: 3, patch: 0 });
      expect(bumpCharacterVersion(current, 'patch')).toEqual({ major: 1, minor: 2, patch: 4 });
    });
  });

  describe('② 新建角色 → 1.0.0 + 首版快照', () => {
    it('出参带三列与版本号字符串', async () => {
      const { service } = buildHarness();
      const created = await service.create(buildCreateDto());

      expect(created.versionMajor).toBe(1);
      expect(created.versionMinor).toBe(0);
      expect(created.versionPatch).toBe(0);
      expect(created.versionLabel).toBe('1.0.0');
    });

    it('首版进历史表 (change_type=create)', async () => {
      const { service, versionRepo } = buildHarness();
      await service.create(buildCreateDto());

      expect(versionRepo.rows).toHaveLength(1);
      expect(versionRepo.rows[0]?.changeType).toBe('create');
      expect(versionRepo.rows[0]?.versionMajor).toBe(1);
      expect(versionRepo.rows[0]?.snapshot.displayName).toBe('试角色');
    });
  });

  describe('③ 每次更新 → 版本递增 + 快照留痕', () => {
    it('缺省按 patch 递增 (1.0.0 → 1.0.1)', async () => {
      const { service, versionRepo } = buildHarness();
      await service.create(buildCreateDto());
      const updated = await service.update(TEMPLATE_ID, buildUpdateDto());

      expect(updated.versionLabel).toBe('1.0.1');
      expect(versionRepo.rows).toHaveLength(2);
      expect(versionRepo.rows[1]?.changeType).toBe('patch');
    });

    it('显式 minor → 1.1.0 (patch 归零)', async () => {
      const { service } = buildHarness();
      await service.create(buildCreateDto());
      await service.update(TEMPLATE_ID, buildUpdateDto({ versionBump: 'minor' }));
      const updated = await service.update(TEMPLATE_ID, buildUpdateDto({ versionBump: 'patch' }));

      expect(updated.versionLabel).toBe('1.1.1');
    });

    it('快照存的是变更后的内容 (回溯要看到当时怎么配的)', async () => {
      const { service, versionRepo } = buildHarness();
      await service.create(buildCreateDto());
      await service.update(TEMPLATE_ID, buildUpdateDto({ baselineTrust: 0.77 }));

      const latest = versionRepo.rows.at(-1);
      expect(latest?.snapshot.baselineTrust).toBe(0.77);
      expect(latest?.snapshot.versionMajor).toBe(1);
      expect(latest?.snapshot.versionPatch).toBe(1);
    });

    it('变更人 id 记进快照 (谁改的要看得见)', async () => {
      const { service, versionRepo } = buildHarness();
      await service.create(buildCreateDto());
      await service.update(TEMPLATE_ID, buildUpdateDto(), 'admin-007');

      expect(versionRepo.rows[1]?.changedBy).toBe('admin-007');
    });
  });

  describe('④ 主版本锁定 (有活跃会话 → 409)', () => {
    it('无活跃会话 → 允许改 major (2.0.0)', async () => {
      const { service } = buildHarness(0);
      await service.create(buildCreateDto());
      const updated = await service.update(TEMPLATE_ID, buildUpdateDto({ versionBump: 'major' }));

      expect(updated.versionLabel).toBe('2.0.0');
    });

    it('有活跃会话 → 拒绝改 major (409 / CharacterVersionLocked)', async () => {
      const { service, versionRepo } = buildHarness(2);
      await service.create(buildCreateDto());

      await expect(service.update(TEMPLATE_ID, buildUpdateDto({ versionBump: 'major' }))).rejects.toBeInstanceOf(BizException);
      await expect(service.update(TEMPLATE_ID, buildUpdateDto({ versionBump: 'major' }))).rejects.toMatchObject({
        code: BizCode.CharacterVersionLocked,
      });
      // 被拒的改动不应留下版本痕迹.
      expect(versionRepo.rows).toHaveLength(1);
    });

    it('有活跃会话时改 minor 照常放行 (锁定只针对主版本)', async () => {
      const { service } = buildHarness(3);
      await service.create(buildCreateDto());
      const minor = await service.update(TEMPLATE_ID, buildUpdateDto({ versionBump: 'minor' }));

      expect(minor.versionLabel).toBe('1.1.0');
    });

    it('判不出来 (插槽没人应答) → 放行 + 不硬挡运营操作', async () => {
      const { service } = buildHarness(null);
      await service.create(buildCreateDto());
      const updated = await service.update(TEMPLATE_ID, buildUpdateDto({ versionBump: 'major' }));

      expect(updated.versionLabel).toBe('2.0.0');
    });
  });

  describe('⑤ 历史版本回溯', () => {
    it('列表按版本号从新到旧', async () => {
      const { service } = buildHarness();
      await service.create(buildCreateDto());
      await service.update(TEMPLATE_ID, buildUpdateDto());
      await service.update(TEMPLATE_ID, buildUpdateDto({ versionBump: 'minor' }));

      const list = await service.listVersions(TEMPLATE_ID);

      expect(list.total).toBe(3);
      expect(list.items.map((item) => item.versionLabel)).toEqual(['1.1.0', '1.0.1', '1.0.0']);
    });

    it('能取到某一版的完整快照', async () => {
      const { service } = buildHarness();
      await service.create(buildCreateDto());
      await service.update(TEMPLATE_ID, buildUpdateDto({ baselineTrust: 0.66 }));

      const detail = await service.getVersion(TEMPLATE_ID, 1, 0, 0);

      expect(detail.versionLabel).toBe('1.0.0');
      expect(detail.snapshot.baselineTrust).toBe(0.28);
    });

    it('不存在的版本 → 404 级业务码', async () => {
      const { service } = buildHarness();
      await service.create(buildCreateDto());

      await expect(service.getVersion(TEMPLATE_ID, 9, 9, 9)).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });
  });

  describe('⑥ 插槽语义 (voice 层全局注册表)', () => {
    it('角色版本插槽: 注册后可查, 未注册 → null', async () => {
      const registry = new CharacterVersionRegistry();

      expect(await registry.resolve(TEMPLATE_ID)).toBeNull();

      registry.register({ name: 'test', resolve: async () => '1.4.2' });
      expect(await registry.resolve(TEMPLATE_ID)).toBe('1.4.2');

      registry.unregister('test');
      expect(await registry.resolve(TEMPLATE_ID)).toBeNull();
    });

    it('角色占用插槽: 多个实现求和, 无人应答 → null (≠ 0)', async () => {
      const registry = new CharacterUsageRegistry();

      expect(await registry.countActiveSessions(TEMPLATE_ID)).toBeNull();

      registry.register({ name: 'a', countActiveSessions: async () => 2 });
      registry.register({ name: 'b', countActiveSessions: async () => 3 });
      expect(await registry.countActiveSessions(TEMPLATE_ID)).toBe(5);

      registry.register({ name: 'c', countActiveSessions: async () => null });
      expect(await registry.countActiveSessions(TEMPLATE_ID)).toBe(5);
    });
  });
});
/**
 * 内存仓储 stub: training_sessions (会话侧绑定角色版本).
 */
class FakeTrainingSessionRepo {
  readonly rows: TrainingSession[] = [];

  create(entity: Partial<TrainingSession>): TrainingSession {
    return { ...entity } as TrainingSession;
  }

  async save(entity: TrainingSession): Promise<TrainingSession> {
    this.rows.push(entity);
    return entity;
  }
}

/**
 * 造一份建连输入 (vpt 通道).
 *
 * @param templateId 公共模板 id (null = 兜底人设通道)
 * @returns 建连输入
 */
function buildOpenInput(templateId: string | null): VoiceSessionOpenInput {
  return {
    sessionId: 'ws-1',
    userId: 'u-1',
    tenantId: 't-1',
    templateId,
    visitor: {
      templateId: templateId ?? 'fallback',
      codename: '晚晴',
      ageRange: '28-35',
      ageLowerBound: 28,
      occupation: '编辑',
      presentingComplaint: '最近总是睡不好',
      riskTags: [],
    },
    preset: {
      difficulty: 'L1',
      style: 'mixed',
      emotionBaseline: 0.4,
      defenseLevel: 0.3,
      visitorMode: 'useMySettings',
    },
    skillCode: null,
  };
}

/**
 * 装配 vpt 落库桥 (只需要 open() 用到的那几个依赖).
 */
function buildBridge(sessionRepo: FakeTrainingSessionRepo, version: string | null): VptSessionBridgeService {
  const characterVersions = new CharacterVersionRegistry();
  if (version !== null) {
    characterVersions.register({ name: 'test', resolve: async () => version });
  }
  return new VptSessionBridgeService(sessionRepo as never, {} as never, {} as never, new VoiceSessionBridgeRegistry(), characterVersions, {
    get: () => {},
  } as never);
}

describe('WP38 · 会话绑定角色版本', () => {
  it('建会话时把角色与当时的版本写进 training_sessions', async () => {
    const sessionRepo = new FakeTrainingSessionRepo();
    const bridge = buildBridge(sessionRepo, '1.3.0');

    const opened = await bridge.open(buildOpenInput(TEMPLATE_ID));

    expect(opened.persisted).toBe(true);
    expect(sessionRepo.rows[0]?.characterTemplateId).toBe(TEMPLATE_ID);
    expect(sessionRepo.rows[0]?.characterVersion).toBe('1.3.0');
  });

  it('兜底通道 (无公共人物) → 两列都是 null, 不阻断建会话', async () => {
    const sessionRepo = new FakeTrainingSessionRepo();
    const bridge = buildBridge(sessionRepo, '1.3.0');

    const opened = await bridge.open(buildOpenInput(null));

    expect(opened.persisted).toBe(true);
    expect(sessionRepo.rows[0]?.characterTemplateId).toBeNull();
    expect(sessionRepo.rows[0]?.characterVersion).toBeNull();
  });

  it('查不到角色版本 (槽位无人应答) → 版本列 null, 会话照常建', async () => {
    const sessionRepo = new FakeTrainingSessionRepo();
    const bridge = buildBridge(sessionRepo, null);

    const opened = await bridge.open(buildOpenInput(TEMPLATE_ID));

    expect(opened.persisted).toBe(true);
    expect(sessionRepo.rows[0]?.characterTemplateId).toBe(TEMPLATE_ID);
    expect(sessionRepo.rows[0]?.characterVersion).toBeNull();
  });
});
