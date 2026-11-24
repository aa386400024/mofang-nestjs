// AF-462: 引擎链路可选透传 — 不登记语域时规格键集合不变; 登记后才进 prompt.
import { buildRenderSpec } from '../../src/engine-adapters/rendering/spec-assembler.js';
import { buildVisitorMessages } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { createEmptyBdiSnapshot } from '../../src/engine-core/index.js';
import { getVisitorSpeechRegister } from '../../src/shared/speech-register/index.js';

const OUTPUT = {
  reply: '',
  snapshot: createEmptyBdiSnapshot(),
  turnIndex: 1,
};
const BUDGET = { maxCompletionTokens: 160, contextTokens: 512 };

describe('AF-462 · engine speech register passthrough', () => {
  it('未传语域时规格里没有 speechRegister 键 (零回归)', () => {
    const spec = buildRenderSpec({ output: OUTPUT, recentTurns: [], tokenBudget: BUDGET });
    expect(Object.hasOwn(spec, 'speechRegister')).toBe(false);
    expect(Object.hasOwn(spec, 'speechRegisterAudit')).toBe(false);
  });

  it('传语域时规格带字段, 系统 prompt 多出"你说话的样子"块', () => {
    const speechRegister = getVisitorSpeechRegister('vpt_grief_avoidance_l1');
    expect(speechRegister).toBeDefined();
    const plain = buildRenderSpec({ output: OUTPUT, recentTurns: [], tokenBudget: BUDGET });
    const withRegister = buildRenderSpec({
      output: OUTPUT,
      recentTurns: [],
      tokenBudget: BUDGET,
      speechRegister,
    });
    const plainText = (buildVisitorMessages(plain)[0]?.content ?? '') as string;
    const registerText = (buildVisitorMessages(withRegister)[0]?.content ?? '') as string;

    expect(plainText).not.toContain('你说话的样子');
    expect(registerText).toContain('你说话的样子（只影响用词，不改内容和情绪）');
    expect(registerText).not.toContain('vpt_grief_avoidance_l1');
    // 除新增块外, 原有 prompt 行保持同一份 (不删减): 原 prompt 的每个非空行都还在.
    for (const line of plainText.split('\n')) {
      if (line.trim().length > 0) expect(registerText).toContain(line);
    }
  });
});
