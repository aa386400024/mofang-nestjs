// V2026-10-29 治本 (WP9-B · 引擎版对话后端的工厂装配 + 启动炸弹护栏):
//   职责: 钉死「EngineStreamBackend 必须由工厂装配, 不能当类 provider」这条装配纪律,
//         并验证工厂真的把角色解析端口接进了后端.
//   边界: 全 mock; 不起 Nest 容器; 不连 DB / 不发网络.
//
//   背景 (为什么有这条护栏 —— WP8-B 遗留的启动炸弹):
//     `engine-stream-backend.adapter.ts` 里 EngineTurnService 是 **type-only 导入**
//     (`import type { EngineTurnService }`). TypeScript 的 emitDecoratorMetadata
//     遇到 type-only 导入的类类型产不出值引用, 只能降级成 `Function` ——
//     编译产物 `design:paramtypes = [Function, Object]`.
//     而 Nest 靠 design:paramtypes 决定构造参数注入什么: 它去容器里找一个 token
//     叫 `Function` 的 provider —— 不存在 → 启动直接抛
//     `UnknownDependenciesException: ... the argument Function at index [0]`.
//     即: 把 EngineStreamBackend 当类 provider 注册, 应用就起不来.
//     (WP8-B 起就是这个写法; WP8-A/8-B 的闸门只跑 tsc/eslint/jest, 从没真起过服务,
//      所以这个雷一直没暴露 —— 直到 WP9-B 拆模块后真的启动了一次.)
//
//   为什么修在装配层而不是改 adapter:
//     ① 任务单对 WP9-B 的硬约束是「EngineStreamBackend 零改动」(换数据源不该动注入点);
//     ② 仓库自己的架构原则就是「构造逻辑归 engine.providers.ts 的纯工厂, @Module 只
//        声明 token ↔ 工厂的映射」—— 走工厂是回到既定原则, 不是绕过它;
//     ③ 工厂是**纯函数**, 接线正确性能被单测直接覆盖 (起容器才能验的那类问题正是
//        WP8-B 拖了很久的原因).
//
//   验证: npx jest test/engine-adapters/wp9b-engine-stream-backend-wiring.spec.ts
//   时间戳: 2026-10-29

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { CharacterProfileResolver } from '../../src/engine-adapters/wiring/character/character-profile.resolver';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service';
import { createEngineStreamBackend } from '../../src/engine-adapters/wiring/engine.providers';

/**
 * 引擎门面 stub (只提供 openSession 走到的 open / close).
 */
function buildEngineStub(): EngineTurnService {
  return {
    open: () => ({ handleId: 'handle-1', sessionId: 'session-1' }),
    close: () => {},
  } as unknown as EngineTurnService;
}

/**
 * 装配层源码 (engine.module.ts).
 */
function readEngineModuleSource(): string {
  return readFileSync(path.join(__dirname, '..', '..', 'src', 'engine-adapters', 'wiring', 'engine.module.ts'), 'utf8');
}

describe('WP9-B · 引擎版对话后端的工厂装配 (启动炸弹护栏)', () => {
  it('工厂把角色解析端口装进后端 —— 解析请求真的被转发出去', async () => {
    const requests: unknown[] = [];
    const resolver: CharacterProfileResolver = {
      resolve: async (request) => {
        requests.push(request);
        return null;
      },
    };

    const backend = createEngineStreamBackend({ engine: buildEngineStub(), resolver });
    await backend.openSession({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      personaId: 'vpt_intimate_avoidance_l1',
      templateId: 'vpt_intimate_avoidance_l1',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ templateId: 'vpt_intimate_avoidance_l1' });
  });

  it('不传解析端口 → 走中性基线, 不抛 (角色是可选增强, 不是硬依赖)', async () => {
    const backend = createEngineStreamBackend({ engine: buildEngineStub() });

    const persona = await backend.openSession({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      personaId: 'vpt_intimate_avoidance_l1',
      templateId: 'vpt_intimate_avoidance_l1',
    });

    expect(persona.name).toBe('来访者');
  });

  it('engine.module.ts 必须用工厂注册它 (不能当裸类 provider —— 那会让应用起不来)', () => {
    const source = readEngineModuleSource();
    const start = source.indexOf('provide: EngineStreamBackend');

    expect(start).toBeGreaterThan(-1);
    // 工厂绑定: 紧跟 provide 之后不远处必须是 useFactory.
    expect(source.slice(start, start + 400)).toContain('useFactory');
    // 裸类 provider 写法 (providers 数组里单独一行 EngineStreamBackend) 必须不存在:
    //   那会让 Nest 按 design:paramtypes 解析构造参数 → token `Function` → 启动即炸.
    const providerLines = source.split('\n').map((line) => line.trim());
    expect(providerLines).not.toContain('EngineStreamBackend,');
  });

  it('工厂的 inject 显式带上角色解析端口 (WP9-B 的 DB resolver 真的接上了)', () => {
    const source = readEngineModuleSource();
    const start = source.indexOf('provide: EngineStreamBackend');
    const block = source.slice(start, start + 600);
    const injectStart = block.indexOf('inject:');
    const injectSegment = injectStart === -1 ? '' : block.slice(injectStart, injectStart + 200);

    expect(injectSegment).toContain('EngineTurnService');
    expect(injectSegment).toContain('CHARACTER_PROFILE_RESOLVER');
  });
});
