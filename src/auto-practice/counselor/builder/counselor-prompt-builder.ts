import type { CounselorMode } from '../../entities/counselor-mode.entity.js';
import type { PromptSection } from '../dto/counselor-types.js';
import { CLOSE_DISCIPLINE } from './prompt-sections/close-discipline.js';
import { CONSISTENCY_DISCIPLINE } from './prompt-sections/consistency-discipline.js';
import { CRISIS_PROTOCOL } from './prompt-sections/crisis-protocol.js';
import { crisisStabilizationSection } from './prompt-sections/crisis-stabilization.js';
import { OUTPUT_DISCIPLINE } from './prompt-sections/output-discipline.js';

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
   * @returns 完整的 system prompt 字符串
   */
  build(mode: CounselorMode, crisisMode: boolean): string {
    // 动态加危机稳定化块 (enabled 由 crisisMode 决定).
    const dynamicSections: PromptSection[] = [...this.sections, crisisStabilizationSection(crisisMode)];

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
