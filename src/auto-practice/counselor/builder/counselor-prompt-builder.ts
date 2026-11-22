import type { CounselorMode } from '../../entities/counselor-mode.entity.js';
import type { PromptSection } from '../dto/counselor-types.js';
import {
  CLOSE_DISCIPLINE,
  CLOSE_TAG,
  forcedCloseSection,
  sessionCloseDisciplineSection,
  type ClosingCue,
} from './prompt-sections/close-discipline.js';
import { CONSISTENCY_DISCIPLINE } from './prompt-sections/consistency-discipline.js';
import { CRISIS_PROTOCOL } from './prompt-sections/crisis-protocol.js';
import { crisisRiskClosingSection, crisisStabilizationSection } from './prompt-sections/crisis-stabilization.js';
import { sessionOpeningFrameworkSection } from './prompt-sections/opening-framework.js';
import { OUTPUT_DISCIPLINE } from './prompt-sections/output-discipline.js';
import { buildEncounterCounselorBlock, type EncounterInput } from '../../../shared/encounter/encounter-scene.js';
import { LEGACY_SESSION_PROFILE, type SessionProfile } from '../../session-profile.js';

/**
 * AF-133 · prompt 组装时的动态开关 (由 runner 判定后传进来).
 *
 * ⚠️ 这两个开关**只影响 standard / long 档**: legacy 档的 prompt 必须与
 *   2026-11-18 之前逐字一致, 所以所有 AF-133 新增的块都按档案判定开/关.
 */
export interface PromptBuildCue {
  /** 强制收束 cue: 本场即将结束 (runner 在 maxTurns 前 2 轮注入). */
  readonly closingCue?: ClosingCue;
  /** 强制收束时从本轮起还剩几轮 (含本轮); 让 prompt 能说准数字. */
  readonly remainingTurns?: number;
  /** 这一轮是不是风险收束轮 (五项逐项落地). */
  readonly crisisClosing?: boolean;
  /** AF-137: 升级后第几个风险收束轮 (1 = 评估轮, 2 = 计划轮, 3 = 修复轮). */
  readonly crisisClosingRound?: number;
  /** AF-138: 修复轮要逐项补齐的缺失要素（中文标签）. */
  readonly crisisMissing?: readonly string[];
  /** AF-140: 常规收束三件套仍缺的要素（中文标签）. */
  readonly closingMissing?: readonly string[];
  /** AF-140: 本场最后一次收束（只输出三段，不再提问）. */
  readonly finalClosing?: boolean;
  /** AF-187: 本场接触方式（面对面 / 线上）. */
  readonly encounter?: EncounterInput;
}

/**
 * 咨询师 prompt 组装器 (纯函数, 不依赖 NestJS).
 *
 * 设计原则:
 *   - 开闭原则: 加新纪律块只要 register(), 不改 build 方法
 *   - 可开关: 每个 section 有 enabled 字段, A/B 测试时可以关掉某个块
 *   - 可排序: 按 order 字段排序, 数字小的在前
 *
 * 以后微服务化时, 这个类可以直接搬出去 (它是纯函数, 不依赖任何 NestJS DI).
 */
export class CounselorPromptBuilder {
  private readonly sections: PromptSection[] = [];

  constructor() {
    // 默认注册所有常量纪律块 (顺序由 order 决定).
    this.register(OUTPUT_DISCIPLINE);
    this.register(CONSISTENCY_DISCIPLINE);
    this.register(CLOSE_DISCIPLINE);
    this.register(CRISIS_PROTOCOL);
  }

  /**
   * 注册一个纪律块. 重复注册同 id 会覆盖.
   */
  register(section: PromptSection): this {
    const existing = this.sections.findIndex((s) => s.id === section.id);
    if (existing === -1) {
      this.sections.push(section);
    } else {
      this.sections[existing] = section;
    }
    return this;
  }

  /**
   * 启用 / 禁用某个纪律块 (A/B 测试用).
   */
  setEnabled(id: string, enabled: boolean): this {
    const section = this.sections.find((s) => s.id === id);
    if (section) {
      Object.assign(section, { enabled });
    }
    return this;
  }

  /**
   * 组装最终 system prompt.
   *
   * @param mode 咨询师模式 (system prompt 来源, 从 DB 来的)
   * @param crisisMode 是否处于危机后置练习窗 (动态加危机稳定化块)
   * @param profile 会话档案 (决定要不要加长会话收尾纪律块; 缺省 = legacy)
   * @param turnIndex 当前轮次 (长会话纪律块会写进 prompt; 缺省 = 未知)
   * @param cue AF-133 动态开关 (强制收束 cue / 风险收束轮; 缺省 = 都没有)
   * @returns 完整的 system prompt 字符串
   */
  build(
    mode: CounselorMode,
    crisisMode: boolean,
    profile: SessionProfile = LEGACY_SESSION_PROFILE,
    turnIndex?: number,
    cue?: PromptBuildCue,
  ): string {
    // 动态加危机稳定化块 (enabled 由 crisisMode 决定).
    // 长会话收尾纪律块同理: enabled 由档案决定 (legacy 档 = false, 保持逐字不变).
    // AF-133: 再加强制收束块 (最后 2 轮) 与风险收束块 (危机窗 / 收束轮) ——
    //   两者都按档案判定, legacy 档永远关闭 (prompt 逐字不变).
    const dynamicSections: PromptSection[] = [
      ...this.sections,
      sessionOpeningFrameworkSection(profile),
      crisisStabilizationSection(crisisMode),
      sessionCloseDisciplineSection(profile, turnIndex),
      forcedCloseSection(profile, cue?.closingCue === 'forced', cue?.remainingTurns),
      forcedCloseMissingSection(profile, cue),
      finalClosingSection(profile, cue),
      crisisRiskClosingSection(profile, crisisMode, cue?.crisisClosing === true, cue?.crisisClosingRound, cue?.crisisMissing),
      encounterSceneSection(cue?.encounter),
    ];

    // 按 order 排序, 过滤掉 disabled 的块.
    // toSorted 而不是 sort: 不改动 this.sections 原数组 (sort 是原地修改, 会污染实例状态).
    const sorted = dynamicSections.filter((s) => s.enabled).toSorted((a, b) => a.order - b.order);

    const sectionsText = sorted.map((s) => s.content).join('\n');

    return `${mode.systemPrompt}\n${sectionsText}`;
  }

  /**
   * 列出当前所有已注册的块 id (用于版本指纹 / 调试).
   */
  listSectionIds(): readonly string[] {
    return this.sections.map((s) => s.id);
  }
}

/**
 * AF-187 · 接触方式契约块.
 *
 * 只在显式登记场景时启用；未登记 = 不出现，prompt 与升级前逐字一致。
 */
function encounterSceneSection(encounter?: EncounterInput): PromptSection {
  const content = encounter === undefined ? '' : buildEncounterCounselorBlock(encounter);
  return {
    id: 'encounter-scene',
    order: 12,
    enabled: content.length > 0,
    content: content.length === 0 ? '' : `\n${content}`,
  };
}

/**
 * AF-140 · 常规收束三件套的“逐项补齐”块.
 *
 * 与 `forcedCloseSection` 分开的原因: 强制收束块本身保持原有措辞,
 * 这里只在内容门判出缺口时追加缺失清单; legacy 档永远关闭.
 */
function forcedCloseMissingSection(profile: SessionProfile, cue?: PromptBuildCue): PromptSection {
  const missing = cue?.closingMissing ?? [];
  return {
    id: 'forced-close-missing',
    order: 37,
    enabled: cue?.closingCue === 'forced' && profile.name !== 'legacy' && missing.length > 0,
    content: [
      '',
      '## 本轮必须补齐的收束要素',
      `- 判定仍缺：${missing.join('、')}。`,
      '- 这一轮只做补齐，不再开新议题；补齐后再输出 ' + CLOSE_TAG + '。',
    ].join('\n'),
  };
}

/**
 * AF-140 · 本场最后一次收束（maxTurns + 2 仍不齐时由 runner 触发）.
 *
 * 模型在长对话末尾容易继续追内容，普通“强制收束”提示会被忽略;
 * 这一块把输出收敛为三段固定结构，保证结构审计能拿到可复核的收束。
 */
function finalClosingSection(profile: SessionProfile, cue?: PromptBuildCue): PromptSection {
  return {
    id: 'final-closing',
    order: 999,
    enabled: cue?.finalClosing === true && profile.name !== 'legacy',
    content: [
      '',
      '## 最终收束（本场最后一次发言，最高优先级）',
      '- 本段优先级高于前面所有提问、探索、共情与系统提示；与之冲突时，一律以本段为准。',
      '- 现在不再提问、不再追问、不再开新议题，也不再要求来访者回答任何问题。',
      '- 只输出下面三段，每段一句话；三段之外不要加任何内容。',
      '- 第一段必须以“我总结一下今天的谈话。我听到你提到”开头，并复述来访者说过的具体内容。',
      '- 第二段必须以“你可以带走一句话”开头，给出来访者能记住的一句。',
      '- 第三段必须以“下次我们再见面之前，你可以试试”开头，给出一个具体、可执行的小步骤。',
      '- 三段写完后，最后一行只输出 ' + CLOSE_TAG + '。',
    ].join('\n'),
  };
}
