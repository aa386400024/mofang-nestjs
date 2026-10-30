// V2026-10-29 治本 (WP9-B · B 层 · 角色资产池管理端单测):
//   覆盖任务单 §7 C.10:
//     · admin 可创建 / 编辑 / disable 角色
//     · disable 后该 slug 下一场即回退中性 (与 DB resolver 联动断言)
//     · 审核状态流转 (draft → approved 才可被引擎命中)
//     · 软删后不可再命中, 且管理端仍能看见 (可恢复)
//   另附护栏:
//     · 重复 templateId → 明确报错 (不静默覆盖旧行)
//     · 不存在 → 404 级业务码
//     · 未提供的字段原样保留 (不把没传的键写成 undefined)
//     · 内容版本号随编辑递增
//
//   全 mock: 仓储用内存 stub (管理服务与 DB resolver 共用同一份数据 —— 联动断言才成立),
//             不起容器、不连 DB、不发网络.
//
//   为什么"下架后回退中性"要在这里断言 (而不是只在 resolver 那边测):
//     这一条是**跨层契约**: 运营在管理端把角色下架, 下一场会话必须立刻回退中性.
//     单测任一侧都证明不了 —— 只有让管理服务改同一份数据, 再让 resolver 读它,
//     才算真的验到了这条链路.
//
//   验证: npx jest test/engine-adapters/wp9b-character-admin.spec.ts
//   时间戳: 2026-10-29

import { FindOperator } from 'typeorm';

import { BizCode } from '../../src/common/exceptions/biz-code.enum';
import { BizException } from '../../src/common/exceptions/biz.exception';
import { CharacterProfileAdminService } from '../../src/engine-adapters/wiring/character/character-profile.admin.service';
import type {
  CreateCharacterProfileDto,
  UpdateCharacterProfileDto,
} from '../../src/engine-adapters/wiring/character/character-profile.dto';
import { CharacterProfileEntity } from '../../src/engine-adapters/wiring/character/character-profile.entity';
import { deriveCharacterProfileId } from '../../src/engine-adapters/wiring/character/character-profile.seed';
import { DbCharacterProfileResolver } from '../../src/engine-adapters/wiring/character/db-character-profile.resolver';

const TEMPLATE_ID = 'vpt_test_role_l1';

/**
 * 内存仓储 stub: 管理服务与 resolver 共用同一份数据.
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
 *
 * 为什么单独一个 builder: 编辑面是**部分更新**语义 —— 只传的字段被改, 没传的
 * 字段必须原样保留. 把入参固定成"一个 builder + overrides", 用例就不会
 * 出现"某个用例忘了传某字段, 于是断言的是 undefined 而不是默认值"这种噪音.
 *
 * @param overrides 覆盖字段
 * @returns 编辑入参
 */
function buildUpdateDto(overrides: Partial<UpdateCharacterProfileDto> = {}): UpdateCharacterProfileDto {
  return {
    baselineTrust: 0.4,
    displayName: '改名了',
    ...overrides,
  };
}

/**
 * 装配管理服务 + resolver (共用同一份仓储).
 */
function buildHarness(): {
  readonly service: CharacterProfileAdminService;
  readonly resolver: DbCharacterProfileResolver;
  readonly repo: FakeCharacterProfileRepo;
} {
  const repo = new FakeCharacterProfileRepo();
  const service = new CharacterProfileAdminService(repo as never);
  const resolver = new DbCharacterProfileResolver(repo as never);
  return { service, resolver, repo };
}

describe('WP9-B · 角色资产池管理端 (CRUD / 上下架 / 过审)', () => {
  describe('⑩ 新建', () => {
    it('创建后落库, 缺省 draft + 在架, 出参完整', async () => {
      const { service, repo } = buildHarness();

      const created = await service.create(buildCreateDto());

      expect(repo.rows).toHaveLength(1);
      expect(created.templateId).toBe(TEMPLATE_ID);
      expect(created.displayName).toBe('试角色');
      expect(created.auditStatus).toBe('draft');
      expect(created.enabled).toBe(true);
      expect(created.version).toBe(1);
      expect(created.coreBeliefs).toHaveLength(1);
      expect(created.fivePs.presenting).toBe('主诉');
    });

    it('templateId 重复 → 明确报错, 不覆盖旧行', async () => {
      const { service, repo } = buildHarness();
      await service.create(buildCreateDto());

      await expect(service.create(buildCreateDto({ displayName: '另一个' }))).rejects.toBeInstanceOf(BizException);
      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0]?.displayName).toBe('试角色');
    });

    it('显式指定 approved 时按指定写入', async () => {
      const { service } = buildHarness();
      const created = await service.create(buildCreateDto({ auditStatus: 'approved' }));
      expect(created.auditStatus).toBe('approved');
    });
  });

  describe('⑩ 查询', () => {
    it('列表可按审核状态 / 上下架 / templateId 过滤', async () => {
      const { service } = buildHarness();
      await service.create(buildCreateDto({ templateId: 'vpt_a' }));
      await service.create(buildCreateDto({ templateId: 'vpt_b', auditStatus: 'approved' }));
      await service.create(buildCreateDto({ templateId: 'vpt_c', enabled: false }));

      expect((await service.list({})).total).toBe(3);
      expect((await service.list({ auditStatus: 'approved' })).total).toBe(1);
      expect((await service.list({ enabled: 'false' })).total).toBe(1);
      expect((await service.list({ templateId: 'vpt_a' })).total).toBe(1);
    });

    it('详情不存在 → ResourceNotFound', async () => {
      const { service } = buildHarness();
      await expect(service.get('vpt_missing')).rejects.toMatchObject({ code: BizCode.ResourceNotFound });
    });

    it('详情返回完整内容 (含 5Ps 与信念)', async () => {
      const { service } = buildHarness();
      await service.create(buildCreateDto());
      const detail = await service.get(TEMPLATE_ID);
      expect(detail.fivePs.protective).toBe('保护');
      expect(detail.coreBeliefs[0]?.statement).toBe('我没什么用。');
    });
  });

  describe('⑩ 编辑', () => {
    it('改内容字段 + 版本号递增; 未提供的字段原样保留', async () => {
      const { service } = buildHarness();
      await service.create(buildCreateDto());

      const updated = await service.update(TEMPLATE_ID, buildUpdateDto());

      expect(updated.baselineTrust).toBeCloseTo(0.4);
      expect(updated.displayName).toBe('改名了');
      expect(updated.version).toBe(2);
      // 没传的字段原样保留 (不是 undefined).
      expect(updated.baselineResistanceDepth).toBe(0.5);
      expect(updated.coreBeliefs).toHaveLength(1);
      expect(updated.auditStatus).toBe('draft');
    });

    it('编辑不存在 → ResourceNotFound', async () => {
      const { service } = buildHarness();
      await expect(service.update('vpt_missing', { baselineTrust: 0.4 })).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });
  });

  describe('⑩ 上下架 / 过审 与引擎命中的联动', () => {
    it('draft 角色 → 引擎不命中 (回退中性)', async () => {
      const { service, resolver } = buildHarness();
      await service.create(buildCreateDto());

      await expect(resolver.resolve({ templateId: TEMPLATE_ID })).resolves.toBeNull();
    });

    it('过审 (approved) → 引擎命中, 注入非中性基线', async () => {
      const { service, resolver } = buildHarness();
      await service.create(buildCreateDto());

      await service.update(TEMPLATE_ID, { auditStatus: 'approved' });

      const resolved = await resolver.resolve({ templateId: TEMPLATE_ID });
      expect(resolved).not.toBeNull();
      expect(resolved?.characterProfile.coreBeliefs.length ?? 0).toBeGreaterThan(0);
      expect(resolved?.characterProfile.baseline?.trust).toBeCloseTo(0.28);
      expect(resolved?.displayName).toBe('试角色');
    });

    it('下架 (enabled=false) → 下一场即回退中性', async () => {
      const { service, resolver } = buildHarness();
      await service.create(buildCreateDto({ auditStatus: 'approved' }));
      expect(await resolver.resolve({ templateId: TEMPLATE_ID })).not.toBeNull();

      await service.update(TEMPLATE_ID, { enabled: false });

      await expect(resolver.resolve({ templateId: TEMPLATE_ID })).resolves.toBeNull();
    });

    it('软删 → 引擎不再命中, 但管理端仍能看见该行 (可恢复)', async () => {
      const { service, resolver } = buildHarness();
      await service.create(buildCreateDto({ auditStatus: 'approved' }));

      const removed = await service.remove(TEMPLATE_ID);
      expect(removed).toEqual({ templateId: TEMPLATE_ID, deleted: true });

      await expect(resolver.resolve({ templateId: TEMPLATE_ID })).resolves.toBeNull();
      // 管理端按 id 查 (不按 enabled/audit 过滤) → 仍可见.
      const detail = await service.get(TEMPLATE_ID);
      expect(detail.enabled).toBe(false);
    });

    it('软删的行 id 由 template_id 派生 (内容派生, 可对照)', async () => {
      const { service, repo } = buildHarness();
      await service.create(buildCreateDto());
      expect(repo.rows[0]?.id).toBe(deriveCharacterProfileId(TEMPLATE_ID));
    });
  });
});
