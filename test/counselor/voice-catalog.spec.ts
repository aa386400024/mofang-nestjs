// V2026-10-26 治本 (官方音色目录 + 专项聚焦 — 纯函数单测):
//   原因: 本轮新增了两处"一旦错了后果很大、但靠运行很难发现"的不变量:
//     ① **音色类型归一** (counselor/config/voices.config.ts):
//        `type` 参数只接受 `system`; 传其他值 / 缺省按 `system` 处理. 若归一写错
//        (例: 缺省时返回 undefined), 上游会收到 `voice_type: undefined` → 2013 参数非法,
//        端点直接挂掉 —— 而这条路径只有真打上游才看得出来.
//     ② **专项聚焦渲染** (counselor/config/skill-focus.config.ts):
//        无 skillCode 时必须返回 null (调用方按"不追加"处理) —— 若返回空串以外的
//        东西, 全流程 / 个案会谈的 prompt 会被塞进一段无意义的聚焦指令, 让 AI 来访者
//        演成"专项场", 把完整咨询做窄.
//     两者都是**纯函数** (无 DI / 无 DB / 不发网络), 因此不需要起应用就能测.
//
//   范围说明: 带 DI 的部分 (WS 握手真连 / get_voice 真连上游 / 缓存 TTL) 不在本文件覆盖
//     范围 —— 那些依赖真实环境与账号, 按项目惯例走人工联调.
//
//   验证:
//     1. npx jest test/counselor/voice-catalog.spec.ts 全绿
//     2. 故意把 resolveVoiceCatalogType 的缺省分支改成 return undefined → "缺省按 system"用例变红
//     3. 故意让 renderVisitorSkillFocus 在无技巧码时返回 '' → "无技巧码不渲染"用例变红
//
//   时间戳: 2026-10-26

import { renderVisitorSkillFocus } from '../../src/counselor/config/skill-focus.config';
import { resolveVoiceCatalogType } from '../../src/counselor/config/voices.config';
import { VOICE_SKILL_LABELS, toVoiceSkillCode } from '../../src/shared/types/voice-skill.types';

describe('音色类型归一 · 上游 get_voice 的 voice_type', () => {
  it('显式传 system → system', () => {
    expect(resolveVoiceCatalogType('system')).toBe('system');
  });

  it('大小写不敏感 + 去空白', () => {
    expect(resolveVoiceCatalogType('  SYSTEM  ')).toBe('system');
  });

  it('缺省 / 空串 → system (缺省必须有值, 不能是 undefined —— 上游会判 2013)', () => {
    expect(resolveVoiceCatalogType(undefined)).toBe('system');
    expect(resolveVoiceCatalogType(null)).toBe('system');
    expect(resolveVoiceCatalogType('')).toBe('system');
    expect(resolveVoiceCatalogType('   ')).toBe('system');
  });

  it('未知值 → system (本期只开放系统音色, 不因前端传错值就 400)', () => {
    expect(resolveVoiceCatalogType('bogus')).toBe('system');
    expect(resolveVoiceCatalogType('clone')).toBe('system');
  });

  it('官方枚举内的其他类型原样保留 (后期开克隆 / 文生列表时直接可用)', () => {
    expect(resolveVoiceCatalogType('voice_cloning')).toBe('voice_cloning');
    expect(resolveVoiceCatalogType('voice_generation')).toBe('voice_generation');
    expect(resolveVoiceCatalogType('all')).toBe('all');
  });
});

describe('专项技巧码 · 合法性与标签', () => {
  it.each(['listening', 'questioning', 'voice'] as const)('合法码 %s 解析到位', (code) => {
    expect(toVoiceSkillCode(code)).toBe(code);
  });

  it('非法码 → undefined (忽略, 不报错)', () => {
    expect(toVoiceSkillCode('bogus')).toBeUndefined();
    expect(toVoiceSkillCode('')).toBeUndefined();
    expect(toVoiceSkillCode(null)).toBeUndefined();
    expect(toVoiceSkillCode(undefined)).toBeUndefined();
  });

  it('三个码都有中文标签 (来访者聚焦 / 督导聚焦共用这一份)', () => {
    expect(VOICE_SKILL_LABELS.listening).toBe('倾听');
    expect(VOICE_SKILL_LABELS.questioning).toBe('提问');
    expect(VOICE_SKILL_LABELS.voice).toBe('表达');
  });
});

describe('专项聚焦指令 · 来访者侧渲染', () => {
  it('无技巧码 → null (调用方不追加, 全流程 / 个案 prompt 与改前一致)', () => {
    expect(renderVisitorSkillFocus(null)).toBeNull();
    expect(renderVisitorSkillFocus(undefined)).toBeNull();
  });

  it('有技巧码 → 渲染出对应标签与聚焦段', () => {
    const focus = renderVisitorSkillFocus('listening');

    expect(focus).toContain('倾听');
    expect(focus).toContain('专项训练');
  });

  it('三个技巧码各渲染出各的聚焦内容 (不串台)', () => {
    expect(renderVisitorSkillFocus('questioning')).toContain('提问');
    expect(renderVisitorSkillFocus('voice')).toContain('表达');
    expect(renderVisitorSkillFocus('questioning')).not.toContain('倾听');
  });

  it('聚焦指令不让来访者意识到自己在被评估 (不出现"考核"等字样)', () => {
    const focus = renderVisitorSkillFocus('listening') ?? '';

    expect(focus).not.toContain('考核');
    expect(focus).toContain('不要提及');
  });
});
