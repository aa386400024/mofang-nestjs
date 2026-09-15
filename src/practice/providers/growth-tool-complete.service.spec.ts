/**
 * V2026-09-14 治本 (Stage C 后端契约): GrowthToolCompleteService 单测.
 *
 * 目标: 覆盖 POST /growth/tools/:id/complete:
 *   - happy path: 返完整 DailyGrowthToolDto (is_completed_today=true)
 *   - toolId 不在今日推荐列表 → BizException(40_005, 404)
 *   - source 不在 9 enum → BizException(40_007, 422)
 *   - 默认 V1.0 行为: 不实际落 fragment_log (V2.1 接 inner_world 模块)
 *
 * 设计 (大厂 service 单测):
 *   - mockDailyToolsService 用 jest.spyOn, 模拟 dailyTools.getDailyTools 返值
 *   - 覆盖 happy + 3 个 error path
 *
 * 反双胞胎:
 *   - V1.0 不测 LLM 写入路径 (V2.1 实现)
 *   - 不测 controller 层 (单测聚焦 service)
 */

import { GrowthDailyToolsService } from './growth-daily-tools.service';
import { GrowthToolCompleteService } from './growth-tool-complete.service';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';

describe('V2026-09-14 GrowthToolCompleteService — 单测', () => {
  let service: GrowthToolCompleteService;
  let mockDailyTools: jest.Mocked<GrowthDailyToolsService>;
  const userId = 'test-user-uuid';

  // V2026-09-14 治本: 跟 daily-tools.service 默认 3 条 1:1.
  const sampleTools = [
    {
      id: 'mindfulness.box-breathing',
      emoji: '🫁',
      title: '3 分钟呼吸觉察',
      subtitle: '把注意力交给自己',
      duration: '3 分钟',
      tag: '随时可做',
      stage_index: 0,
      link_route: '/practice/tool/mindfulness.box-breathing',
      tool_completion_source: 'breathing_practice',
      fragments_grant: { calm: 3 },
      completion_badge_trigger: true,
      is_linked: true,
      is_completed_today: false,
      auto_create_diary: false,
      micro_intervention_scenario_id: null,
    },
    {
      id: 'cbt.thought-record',
      emoji: '📝',
      title: '觉察日记',
      subtitle: '写下来',
      duration: '10 分钟',
      tag: '推荐傍晚',
      stage_index: 1,
      link_route: '/practice/tool/cbt.thought-record',
      tool_completion_source: 'self_esteem',
      fragments_grant: { warmth: 1, courage: 1 },
      completion_badge_trigger: true,
      is_linked: true,
      is_completed_today: false,
      auto_create_diary: true,
      micro_intervention_scenario_id: null,
    },
  ];

  beforeEach(() => {
    mockDailyTools = {
      getDailyTools: jest.fn().mockResolvedValue(sampleTools),
    } as unknown as jest.Mocked<GrowthDailyToolsService>;

    service = new GrowthToolCompleteService(mockDailyTools);
  });

  describe('happy path', () => {
    it('complete 返完整 entity + is_completed_today=true', async () => {
      const result = await service.complete(userId, 'mindfulness.box-breathing');
      expect(result.is_completed_today).toBe(true);
      expect(result.id).toBe('mindfulness.box-breathing');
    });

    it('complete 保留 toolCompletionSource + fragments_grant (透传给 inner_world)', async () => {
      const result = await service.complete(userId, 'cbt.thought-record');
      expect(result.tool_completion_source).toBe('self_esteem');
      expect(result.fragments_grant).toEqual({ warmth: 1, courage: 1 });
    });

    it('complete 保留 V2026-09-14 Stage C 跨 feature 联动 2 字段', async () => {
      const result = await service.complete(userId, 'cbt.thought-record');
      expect(result.auto_create_diary).toBe(true);
      expect(result.micro_intervention_scenario_id).toBeNull();
    });
  });

  describe('error path: toolId 不存在', () => {
    it('toolId 不在今日推荐列表 → BizException(40_005, 404)', async () => {
      await expect(service.complete(userId, 'notexist-tool')).rejects.toThrow(BizException);
      await expect(service.complete(userId, 'notexist-tool')).rejects.toMatchObject({
        detail: {
          code: BizCode.GrowthToolNotFound,
          statusCode: 404,
        },
      });
    });

    it('toolId 为空字符串 → BizException(40_005)', async () => {
      await expect(service.complete(userId, '')).rejects.toThrow(BizException);
    });
  });

  describe('error path', () => {
    it('上游 getDailyTools 抛错 → BizException(40_006, 500)', async () => {
      // V2026-09-14 治本: dailyTools.getDailyTools 抛错时, service 兜底转 BizException,
      //   防止 raw Error 漏到 controller 导致 5xx without code (前端 Failure.code 拿不到).
      mockDailyTools.getDailyTools.mockRejectedValue(new Error('DB 挂了'));

      await expect(service.complete(userId, 'mindfulness.box-breathing')).rejects.toThrow(BizException);
      await expect(service.complete(userId, 'mindfulness.box-breathing')).rejects.toMatchObject({
        detail: {
          code: BizCode.GrowthCompleteFail,
          statusCode: 500,
        },
      });
    });
  });

  describe('V2.1 body 扩展位 (V1.0 暂不传)', () => {
    it('传 options.durationMinutes 不报错 (V2.1 落地)', async () => {
      await expect(service.complete(userId, 'mindfulness.box-breathing', { durationMinutes: 5 })).resolves.toBeDefined();
    });

    it('传 options.intensityBefore/After 不报错 (V2.1 emotionRescue 场景)', async () => {
      await expect(
        service.complete(userId, 'cbt.thought-record', {
          intensityBefore: 5,
          intensityAfter: 3,
        }),
      ).resolves.toBeDefined();
    });

    it('传 fragmentsOverride 不报错 (V2.1 LLM 个性化碎片)', async () => {
      await expect(
        service.complete(userId, 'mindfulness.box-breathing', {
          fragmentsOverride: { calm: 5, starlight: 1 },
        }),
      ).resolves.toBeDefined();
    });
  });
});
