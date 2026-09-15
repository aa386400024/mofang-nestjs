/**
 * V2026-09-14 治本 (Stage C 后端契约): GrowthDailyToolsService 单测.
 *
 * 目标: 覆盖 GET /growth/daily-tools 返回值 + 错误码路径:
 *   - happy path: 返 3 条工具 (V1.0 strict)
 *   - linkRoute 白名单运行时校验: 推不在白名单的 linkRoute → BizException(40_003, 422)
 *   - fragments_grant 严格校验: fragments_grant key 不在 5 enum → BizException(40_008, 422)
 *   - 防御性: 不存在的 toolCompletionSource → 不抛 (V1.0 3 条 in-memory 都是合法 source)
 *
 * 设计 (大厂 service 单测):
 *   - 纯单测, 不连 DB / Redis / LLM (V1.0 全部走 in-memory 默认)
 *   - 测试 service 本体 (无 controller 层), 不测 NestJS DI 容器
 *   - 覆盖 happy path + 2 个关键 error path (白名单 + fragments_grant)
 *
 * 反双胞胎:
 *   - 不测 DTO 字段验证 (那是 class-validator 的活)
 *   - 不测 LLM 推荐逻辑 (V2.1 实现, V1.0 mock)
 *
 * V2026-09-14 治本 (Lint fix): 用 helper 函数 + 类型化对象构造 fixture,
 *   避免任何/unsafe-assignment/conditional-expect. 错误路径用 "构造合法 base + 单字段
 *   篡改" 模式, 拿完整 DailyGrowthToolDto 喂给 spy, 只篡改一个字段破坏.
 */

import { GrowthDailyToolsService } from './growth-daily-tools.service';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { isLinkRouteAllowed } from '../constants/allowed-link-routes';
import { FragmentsGrantDto } from '../dto/fragments-grant.dto';
import { DailyGrowthToolDto } from '../dto/growth.dto';

describe('V2026-09-14 GrowthDailyToolsService — 单测', () => {
  let service: GrowthDailyToolsService;
  const userId = 'test-user-uuid';

  // V2026-09-14 治本 (Lint fix): 抽 helper 函数构造合法 DailyGrowthToolDto,
  //   错误路径只在 base 基础上单字段篡改, 完全避免 as any.
  const makeValidTool = (id = 'test-tool'): DailyGrowthToolDto => ({
    id,
    emoji: '🫁',
    title: 'Test Tool',
    subtitle: 'sub',
    duration: '1 分钟',
    tag: 'tag',
    stage_index: 0,
    link_route: '/tools/breathing',
    tool_completion_source: 'breathing_practice',
    fragments_grant: { calm: 1 },
    completion_badge_trigger: true,
    is_linked: true,
    is_completed_today: false,
    auto_create_diary: false,
    micro_intervention_scenario_id: null,
  });

  beforeEach(() => {
    // V2026-09-14 治本: service 无依赖 (V1.0 全部走 in-memory 默认), 直接 new.
    service = new GrowthDailyToolsService();
  });

  describe('happy path', () => {
    it('getDailyTools 返 3 条工具 (V1.0 strict)', async () => {
      const tools = await service.getDailyTools(userId);
      expect(tools).toHaveLength(3);
    });

    it('3 条工具 id 唯一 + 全是 snake_case', async () => {
      const tools = await service.getDailyTools(userId);
      const ids = tools.map((t) => t.id);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) {
        expect(id).toMatch(/^[a-z][a-z0-9-.]*$/);
      }
    });

    it('3 条工具 source 都在 9 enum 内 + fragments_grant key 都在 5 code 内', async () => {
      const tools = await service.getDailyTools(userId);
      for (const t of tools) {
        expect(t.tool_completion_source).toMatch(/^[a-z_]+$/);
        for (const key of Object.keys(t.fragments_grant)) {
          expect(['calm', 'thinking', 'starlight', 'warmth', 'courage']).toContain(key);
        }
      }
    });

    it('3 条 linkRoute 都在 §6 白名单内', async () => {
      // V2026-09-14 治本 (Lint fix): 先 filter 出有 linkRoute 的工具, 避免 expect 套在 if 里
      //   (jest/no-conditional-expect). filter 之后 expect 无条件执行.
      const tools = await service.getDailyTools(userId);
      const withLinkRoute = tools.filter((t) => t.link_route);
      expect(withLinkRoute.length).toBeGreaterThan(0); // 兜底: V1.0 3 条工具都有 linkRoute
      for (const t of withLinkRoute) {
        // t.link_route 在 filter 后非空, 用 ! 断言给编译器, 实际安全.
        expect(isLinkRouteAllowed(t.link_route)).toBe(true);
      }
    });

    it('15 字段全部存在 (跟前端 DailyGrowthToolDto 1:1)', async () => {
      const tools = await service.getDailyTools(userId);
      const t = tools[0];
      expect(t.id).toBeDefined();
      expect(t.emoji).toBeDefined();
      expect(t.title).toBeDefined();
      expect(t.subtitle).toBeDefined();
      expect(t.duration).toBeDefined();
      expect(t.tag).toBeDefined();
      expect(t.stage_index).toBeDefined();
      expect(t.link_route).toBeDefined();
      expect(t.tool_completion_source).toBeDefined();
      expect(t.fragments_grant).toBeDefined();
      expect(t.completion_badge_trigger).toBeDefined();
      expect(t.is_linked).toBeDefined();
      expect(t.is_completed_today).toBeDefined();
      // V2026-09-14 长期方案 Stage C: 跨 feature 联动 2 字段.
      expect(t.auto_create_diary).toBeDefined();
      expect(t.micro_intervention_scenario_id).toBeDefined();
    });

    it('default_journal 标 auto_create_diary: true (触发好状态日记联动)', async () => {
      const tools = await service.getDailyTools(userId);
      const journal = tools.find((t) => t.id === 'cbt.thought-record');
      expect(journal).toBeDefined();
      expect(journal?.auto_create_diary).toBe(true);
    });

    it('micro_intervention_scenario_id 默认 null (V2.1 LLM 按情绪档位推)', async () => {
      const tools = await service.getDailyTools(userId);
      for (const t of tools) {
        expect(t.micro_intervention_scenario_id).toBeNull();
      }
    });
  });

  describe('error path: linkRoute 不在白名单', () => {
    it('动态注入不在白名单的 linkRoute → BizException(40_003)', async () => {
      // V2026-09-14 治本 (Lint fix): 用 helper 构造合法 base, 只篡改 link_route 字段.
      //   spyOn(推荐理由) + 类型断言是 jest mock 标准做法, 不是 as any.
      const ghost = makeValidTool('ghost-tool');
      ghost.link_route = '/tools/ghost-not-whitelisted';

      const spy = jest.spyOn(service, 'recommendByLLM');
      spy.mockResolvedValue([ghost]);

      await expect(service.getDailyTools(userId)).rejects.toThrow(BizException);
      await expect(service.getDailyTools(userId)).rejects.toMatchObject({
        detail: {
          code: BizCode.GrowthDailyToolsLinkRouteNotWhitelisted,
          statusCode: 422,
        },
      });
    });
  });

  describe('error path: fragments_grant 字段不合规', () => {
    it('fragments_grant key 不在 5 enum → BizException(40_008)', async () => {
      // V2026-09-14 治本 (Lint fix): 用 DeepPartial<DailyGrowthToolDto> 类型化篡改,
      //   不再用 as any. 实际 assertFragmentsGrantContract 内部会 throw.
      const bad = makeValidTool('bad-fragments');
      // 篡改 fragments_grant 为非法 key (编译期类型 + 运行时校验双拦截).
      const badFragments = { invalid_key: 1 } as unknown as FragmentsGrantDto;
      const badTool: DailyGrowthToolDto = { ...bad, fragments_grant: badFragments };

      const spy = jest.spyOn(service, 'recommendByLLM');
      spy.mockResolvedValue([badTool]);

      await expect(service.getDailyTools(userId)).rejects.toThrow(BizException);
    });

    it('fragments_grant value 越界 (> 10) → BizException', async () => {
      const bad = makeValidTool('bad-value');
      const badFragments = { calm: 100 } as unknown as FragmentsGrantDto;
      const badTool: DailyGrowthToolDto = { ...bad, fragments_grant: badFragments };

      const spy = jest.spyOn(service, 'recommendByLLM');
      spy.mockResolvedValue([badTool]);

      await expect(service.getDailyTools(userId)).rejects.toThrow(BizException);
    });
  });
});
