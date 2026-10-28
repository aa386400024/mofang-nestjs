// V2026-10-28 治本 (WP0 · 引擎内核 · 边界隔离不变量):
//   目的: 把任务单 §5 的验收条目从"人工 grep"变成**机器断言** ——
//         ① 内核子树零 @nestjs/* import;
//         ② 内核子树零 typeorm import;
//         ③ 内核子树零"逃出自身目录"的相对 import
//            (即不 import src/agent/visitor / src/voice / 任何 src 下的业务代码);
//         ④ 外部依赖白名单 = { nanoid } + node:* —— 除此之外一律不允许;
//         ⑤ 内核子树零 NestJS 装饰器;
//         ⑥ index.ts 不外露内存实现;
//         ⑦ 目录结构与任务单 §3.1 一致.
//
//   为什么必须是断言而不是注释:
//     这条边界是整个 Phase1 的地基 (roadmap 第 0 原则: 引擎未来独立成微服务).
//     边界一旦被悄悄打破 —— 某天有人 "就 import 一下 ConfigService 取个配置" ——
//     内核就和框架缠死了, 而这类改动在 review 里看着完全无害 (只多了一行 import).
//     唯一的可靠防线是: 违反即测试变红.
//
//   为什么用 TypeScript 编译器 API 而不是正则:
//     正则抽 import 说明符有三个必然翻车的点:
//       - 多行 import (import type {\n A,\n B,\n} from 'x') 会漏;
//       - 注释里的示例 import 会被误判;
//       - require / export from / import type 各种形态要各写一条规则, 漏一条就漏判.
//     走 AST 是**精确**的: 只有真正的 ImportDeclaration / ExportDeclaration /
//     require(...) 才会被计入, 注释根本不存在于 AST 里.
//
//   验证: npx jest test/engine-core/boundary.spec.ts
//   时间戳: 2026-10-28 GMT+8

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import ts from 'typescript';

/** 内核包根目录. */
const KERNEL_ROOT = join(__dirname, '../../src/engine-core');

/** 允许的外部包 (纯 TS 依赖; 标准库走 node: 前缀). */
const ALLOWED_EXTERNAL_PACKAGES = new Set(['nanoid']);

/** 禁止的包前缀 (框架与持久化实体). */
const FORBIDDEN_PACKAGE_PREFIXES = ['@nestjs/'];

/** 禁止的包名 (typeorm 及其子路径). */
const FORBIDDEN_PACKAGE_NAMES = ['typeorm'];

/** 递归收集目录下的 .ts 文件. */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

/** 文件相对内核根的路径 (统一用 / 分隔, 便于断言与报错可读). */
function relPath(file: string): string {
  return relative(KERNEL_ROOT, file).split('\\').join('/');
}

/**
 * AST 级抽取: 文件里真实存在的模块说明符.
 *
 * 扫描范围是**整棵内核子树** (含 adapters/), 不是"内核核心子集" ——
 * 任务单 §5 的验收条目原文是 `grep -rE "@nestjs|typeorm" src/engine-core/` 零命中,
 * 范围就是整棵树. 留一个"adapters/ 可以破例"的口子, 等于把验收标准改成
 * "大部分时候零命中", 而内核包将来是要整包搬走的 —— 破例会跟着一起搬.
 * 真正需要框架的适配器代码, 按 adapters/README.md 的约定放在内核包之外.
 */
function extractModuleSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) specifiers.push(specifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (ts.isStringLiteral(expression)) specifiers.push(expression.text);
    } else if (ts.isCallExpression(node) && node.expression.getText(source) === 'require') {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/** AST 级抽取: 文件里真实存在的装饰器名. */
function extractDecorators(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const decorators: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.Decorator) {
      decorators.push(node.getText(source).replace(/^@/, '').split('(')[0] ?? '');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return decorators;
}

/** 目标路径是否位于 root 之内. */
function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

describe('engine-core · 边界隔离不变量 (任务单 §5 验收机械化)', () => {
  const kernelFiles = collectTsFiles(KERNEL_ROOT);

  it('扫描到了内核源文件 (防止扫描逻辑本身写错而空转)', () => {
    expect(kernelFiles.length).toBeGreaterThan(0);
  });

  it('① 零 @nestjs/* import', () => {
    const violations: string[] = [];
    for (const file of kernelFiles) {
      for (const specifier of extractModuleSpecifiers(file)) {
        if (FORBIDDEN_PACKAGE_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
          violations.push(`${relPath(file)} → ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('② 零 typeorm import (含 typeorm/* 子路径)', () => {
    const violations: string[] = [];
    for (const file of kernelFiles) {
      for (const specifier of extractModuleSpecifiers(file)) {
        const isTypeorm = FORBIDDEN_PACKAGE_NAMES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
        if (isTypeorm) violations.push(`${relPath(file)} → ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('③ 零逃出 engine-core 目录的相对 import (不碰 src/agent/visitor、src/voice 等业务代码)', () => {
    const violations: string[] = [];
    for (const file of kernelFiles) {
      for (const specifier of extractModuleSpecifiers(file)) {
        if (!specifier.startsWith('.')) continue;
        const resolved = resolve(dirname(file), specifier);
        if (!isInside(KERNEL_ROOT, resolved)) {
          violations.push(`${relPath(file)} → ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('④ 外部依赖白名单 = { nanoid } + node:* (内核不得偷带其他第三方库)', () => {
    const violations: string[] = [];
    for (const file of kernelFiles) {
      for (const specifier of extractModuleSpecifiers(file)) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
        if (ALLOWED_EXTERNAL_PACKAGES.has(specifier)) continue;
        violations.push(`${relPath(file)} → ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('⑤ 内核子树零 NestJS 装饰器 (即便 import 被绕过, 装饰器也进不来)', () => {
    const violations: string[] = [];
    for (const file of kernelFiles) {
      for (const decorator of extractDecorators(file)) {
        violations.push(`${relPath(file)} → @${decorator}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('⑥ index.ts 只导出公开端口与模型, 内存实现不外露', () => {
    // 用 AST 看**真实导出**, 不用原始文本:
    //   index.ts 的注释里必然要解释"为什么不导出 InMemory*" —— 文本 grep 会把这段说明
    //   自己判成违规. 任务单验收条目的原话也是「注释里提到不算, import 必须为 0」.
    const indexFile = join(KERNEL_ROOT, 'index.ts');
    const source = ts.createSourceFile(indexFile, readFileSync(indexFile, 'utf8'), ts.ScriptTarget.Latest, true);
    const exportedNames: string[] = [];
    const exportedSpecifiers: string[] = [];

    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        exportedSpecifiers.push(statement.moduleSpecifier.text);
      }
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) exportedNames.push(element.name.text);
      }
    }

    // 内存实现不得出现在公开出口.
    expect(exportedNames.filter((name) => name.includes('InMemory'))).toEqual([]);
    expect(exportedSpecifiers.filter((specifier) => specifier.includes('in-memory'))).toEqual([]);

    // 反向兜底: 公开出口必须是**恰好**这份清单.
    //   白名单双向比对 = "公开 API 面"契约测试: 漏导出 (消费方 import 不到) 与
    //   多导出 (把内部实现泄进公开面) 都会变红.
    //   ⚠️ 后续 WP 若要往 barrel 加公开导出, 必须**显式**更新这份白名单 ——
    //   这是刻意的摩擦: 公开出口是契约, 变更要被看见, 而不是顺手就改了.
    const expectedPublic = [
      'BdiSnapshot',
      'BdiResistance',
      'createEmptyBdiSnapshot',
      'cloneBdiSnapshot',
      // 信念层
      'CoreBelief',
      'TemporaryBelief',
      'MemoryBelief',
      // 愿望层
      'UnderlyingDesire',
      'SituationalDesire',
      // 情绪 / 移情
      'EmotionLabel',
      'EmotionState',
      'TransferenceState',
      // 意图层
      'BehaviorStrategy',
      'Intention',
      // 角色内核
      'AttachmentStyle',
      'CharacterProfile',
      'UnderlyingDesireSeed',
      // 事件 / 分类器接口
      'ClassifyContext',
      'CounselorEventKind',
      'EventClassifier',
      'SessionEvent',
      // 错误 / DTO / 仓储 / 端口
      'EngineCoreError',
      'EngineErrorCode',
      'EngineSessionPort',
      'BdiStateRepository',
      'BdiStateRecord',
      'MemoryStore',
      'MemoryEntry',
      'MemoryHit',
      'MemoryRecallQuery',
      'MemoryTier',
      'MemorySource',
      'OpenEngineSessionInput',
      'EngineSessionHandle',
      'EngineTurnInput',
      'EngineTurnOutput',
    ];
    // 少导出
    expect(expectedPublic.filter((name) => !exportedNames.includes(name))).toEqual([]);
    // 多导出
    expect(exportedNames.filter((name) => !expectedPublic.includes(name))).toEqual([]);
  });

  it('⑦ 目录结构与任务单 §3.1 一致 (领域 / 端口 / 运行时 / 内存实现 / 适配器 五件套齐备)', () => {
    const expected = [
      'index.ts',
      'domain/bdi-snapshot.ts',
      'domain/engine-session.types.ts',
      'domain/engine-errors.ts',
      'domain/beliefs.ts',
      'domain/desires.ts',
      'domain/emotion.ts',
      'domain/transference.ts',
      'domain/intention.ts',
      'domain/character-profile.ts',
      'domain/bootstrap.ts',
      'domain/events/session-event.ts',
      'domain/events/event-lexicon.ts',
      'domain/ports/bdi-state.repository.ts',
      'domain/ports/memory.store.ts',
      'cognition/rule-based-classifier.ts',
      'cognition/state-transition.ts',
      'cognition/intention-planner.ts',
      'runtime/engine-session.port.ts',
      'in-memory/in-memory-bdi-state.repository.ts',
      'in-memory/in-memory-memory.store.ts',
      'in-memory/in-memory-engine-session.ts',
      'adapters/README.md',
    ];
    const missing = expected.filter((expectedPath) => !existsSync(join(KERNEL_ROOT, expectedPath)));
    expect(missing).toEqual([]);
  });

  it('⑧ 内核根目录无散落文件 (结构不漂移, 防止随手往内核根扔 service)', () => {
    const strays = readdirSync(KERNEL_ROOT).filter((name) => {
      const fullPath = join(KERNEL_ROOT, name);
      if (statSync(fullPath).isDirectory()) return false;
      return name !== 'index.ts' && !name.endsWith('.md');
    });
    expect(strays).toEqual([]);
  });
});
