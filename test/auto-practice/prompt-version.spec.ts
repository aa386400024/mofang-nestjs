// V2026-11-10 建立 (Phase2.5 WP-B · prompt 模板版本指纹 · 单测):
//   覆盖交付记录 §三 的验收:
//     ① **稳定性**: 同一份内容 → 同一个指纹 (两次算一样);
//     ② **格式**: 16 位 hex (与 engine_version 同口径的短标识);
//     ③ **敏感性**: 模板内容改一个字 → 指纹变 (这是这个字段存在的全部理由);
//     ④ **路径参与**: 两个文件内容互换 → 指纹变 (不能只 hash 内容);
//     ⑤ **fail-closed**: 文件读不到 → 'unknown' (不返回"半截指纹");
//     ⑥ **env 覆盖**: PROMPT_VERSION 显式指定时优先 (与 ENGINE_VERSION 同款);
//     ⑦ **清单非空**: 模板清单不能被清空 (清空了指纹就成了常量, 失去意义);
//     ⑧ **接线**: 指纹服务把 promptVersion 放进 InferenceFingerprint.
//
//   真实仓库里算一次 (证明清单里的文件都找得到, 且算出的是真值):
//     ① computePromptVersion() 不是 'unknown' → 清单里的文件路径全对;
//     ② 长度 16 且是 hex → 口径对.
//
//   全 mock, 不起 NestJS, 不发网络, 不连 DB.
//
//   验证: npx vitest run test/auto-practice/prompt-version.spec.ts
//   时间戳: 2026-11-10

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { InferenceFingerprintService } from '../../src/auto-practice/inference-fingerprint.service.js';
import {
  computePromptVersion,
  hashPromptTemplates,
  PROMPT_TEMPLATE_FILES,
  PROMPT_VERSION_LENGTH,
  PROMPT_VERSION_UNKNOWN,
  resolvePromptVersion,
} from '../../src/auto-practice/prompt-fingerprint.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/**
 * 造一个临时目录当"模板目录", 里面放若干文件.
 *
 * @param files 文件名 → 内容
 * @returns 临时目录路径
 */
function makeTemplateDir(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-version-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

describe('WP-B · prompt 模板版本指纹', () => {
  describe('① 纯函数: hashPromptTemplates', () => {
    it('同一份内容 → 同一个指纹 (稳定性)', () => {
      const entries = [
        { path: 'a.ts', content: '你是来访者。' },
        { path: 'b.ts', content: '输出纪律。' },
      ];
      expect(hashPromptTemplates(entries)).toBe(hashPromptTemplates(entries));
    });

    it('格式 = 16 位 hex', () => {
      const version = hashPromptTemplates([{ path: 'a.ts', content: 'x' }]);
      expect(version).toHaveLength(PROMPT_VERSION_LENGTH);
      expect(version).toMatch(/^[0-9a-f]{16}$/);
    });

    it('内容改一个字 → 指纹变 (这个字段存在的全部理由)', () => {
      const before = hashPromptTemplates([{ path: 'a.ts', content: '每说两三轮带出���个新细节。' }]);
      const after = hashPromptTemplates([{ path: 'a.ts', content: '每说两三轮带出一个新细节。' }]);
      expect(before).not.toBe(after);
    });

    it('路径也参与哈希: 两个文件内容互换 → 指纹变', () => {
      const a = hashPromptTemplates([
        { path: 'a.ts', content: '甲' },
        { path: 'b.ts', content: '乙' },
      ]);
      const b = hashPromptTemplates([
        { path: 'a.ts', content: '乙' },
        { path: 'b.ts', content: '甲' },
      ]);
      expect(a).not.toBe(b);
    });
  });

  describe('② 读文件: computePromptVersion', () => {
    it('真实仓库里算得出 (清单里的文件路径全对)', () => {
      const version = computePromptVersion();
      expect(version).not.toBe(PROMPT_VERSION_UNKNOWN);
      expect(version).toHaveLength(PROMPT_VERSION_LENGTH);
      expect(version).toMatch(/^[0-9a-f]{16}$/);
    });

    it('文件读不到 → fail-closed 返回 unknown (不返回半截指纹)', () => {
      const dir = makeTemplateDir({ 'present.ts': '有' });
      try {
        // 清单里有一个不存在的文件 → 整体算不出.
        const version = computePromptVersion({ baseDir: dir, extension: '.ts', files: ['present', 'missing'] });
        expect(version).toBe(PROMPT_VERSION_UNKNOWN);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('清单为空 → unknown (而不是空串指纹)', () => {
      const dir = makeTemplateDir({});
      try {
        expect(computePromptVersion({ baseDir: dir, extension: '.ts', files: [] })).toBe(PROMPT_VERSION_UNKNOWN);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('改了模板文件 → 指纹变 (端到端: 读文件 → hash)', () => {
      const dir = makeTemplateDir({ 'a.ts': '旧文案' });
      try {
        const before = computePromptVersion({ baseDir: dir, extension: '.ts', files: ['a'] });
        writeFileSync(join(dir, 'a.ts'), '新文案', 'utf8');
        const after = computePromptVersion({ baseDir: dir, extension: '.ts', files: ['a'] });
        expect(before).not.toBe(after);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('③ env 覆盖 (与 ENGINE_VERSION 同款优先级)', () => {
    it('env 有值 → 用 env 的', () => {
      expect(resolvePromptVersion('p-2026-11-10', () => 'computed')).toBe('p-2026-11-10');
    });

    it('env 空 → 用算出来的', () => {
      expect(resolvePromptVersion(undefined, () => 'computed')).toBe('computed');
      expect(resolvePromptVersion(' '.repeat(3), () => 'computed')).toBe('computed');
    });

    it('算出来也是空 → unknown', () => {
      expect(resolvePromptVersion(undefined, () => '')).toBe(PROMPT_VERSION_UNKNOWN);
    });
  });

  describe('④ 清单与接线', () => {
    it('模板清单非空 (清空了指纹就成了常量)', () => {
      expect(PROMPT_TEMPLATE_FILES.length).toBeGreaterThan(0);
    });

    it('指纹服务把 promptVersion 放进指纹 (落库链路的前提)', async () => {
      const config = { get: (key: string): string | undefined => (key === 'MINIMAX_LLM_MODEL' ? 'test-model' : undefined) };
      const registry = { resolve: async (): Promise<string | null> => '1.0.0' };
      const service = new InferenceFingerprintService(config as never, registry as never);

      const fingerprint = await service.build('vpt_test', 'expert', 'full_simulation', null, 'session-1');

      expect(fingerprint.promptVersion).toHaveLength(PROMPT_VERSION_LENGTH);
      expect(fingerprint.promptVersion).not.toBe(PROMPT_VERSION_UNKNOWN);
      expect(fingerprint.engineVersion.length).toBeGreaterThan(0);
    });
  });
});
