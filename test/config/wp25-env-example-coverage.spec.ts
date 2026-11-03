// V2026-11-03 治本 (WP25 · Phase1 封版审查 · env 覆盖一致性):
//   目的: 把任务单 §5 验收 #3「`.env.example` 与代码 `process.env.*` 一一对应」
//         从"人工比对"变成**机器断言** ——
//           ① 代码里读的每个 env 键, 都必须在 `.env.example` 里有**生效行**
//              (漏了 = 运维照抄模板时根本不知道有这个键, 配不了);
//           ② `.env.example` 里的每个**生效行**, 都必须在代码里被读到
//              (留了却没人读 = 骗人的配置项, 运维改了以为生效了).
//
//   为什么必须是断言而不是注释:
//     `.env.example` 是**部署契约**: 它是运维和内测操作者唯一能看到的"这个服务
//     能配什么"的清单. 两头漂移的代价不对称 ——
//       · 漏键: 键存在但模板里没有 → 部署时配不上, 功能默默用默认值;
//       · 多键: 模板里配了但代码不读 → 改了半天不生效, 排查成本极高.
//     这两类漂移都不会报错, 只会静默, 所以只能靠机器守住.
//
//   为什么用 TypeScript 编译器 API 而不是正则:
//     正则抽 env 读取有三个必然翻车的点:
//       - 注释里的示例 (本仓库注释密度极高) 会被误判成读取点;
//       - 多行写法 (process.env\n  .FOO) 会漏;
//       - bracket / dot / 计算键三种访问形态要各写一条规则.
//     走 AST 是**精确**的: 注释根本不存在于 AST 里.
//
//   派生键 (计算键) 的处理:
//     有两族 env 键在代码里是**计算出来**的, AST 只能看到模板字符串:
//       · LLM_<PROVIDER>_API_KEY  (src/llm/config/provider-env.ts:59 的规律)
//       · ENGINE_CAP_<DIM>_<UP|DOWN> (WP15 时代在 src/engine-core/cognition/
//         state-transition.ts 里用计算键读 —— **WP26 P2-14 已改掉**)
//     它们按"键名规律"存在, 不在源码里逐个写出来 —— 所以在下面显式登记,
//     **登记项必须与代码里的推导口径一致**, 否则断言就形同虚设.
//
//   V2026-11-03 治本 (WP26 · P2-13/P2-14 — ENGINE_CAP_* 族退役):
//     内核不再读 env (cap 参数改注入), 18 个 `ENGINE_CAP_*` 键改由适配层
//     (src/engine-adapters/wiring/delta-cap.config.ts) **逐个字面量**读 ——
//     字面量读取能被本文件的 AST 抽取直接看到, 于是"漏写一个键"这条缺口
//     由断言① (代码读的键必须有生效行) 反向守住, 不再需要派生族登记.
//     用例③ 相应拆成: ③ 校验**仍在派生**的 LLM 族; ③b 校验 18 个 cap 键
//     已是字面量、且内核树里**不再有**任何 ENGINE_CAP_* 字符串.
//
//   边界: 只读文件; 不改任何代码 / 不改 .env.example; 不起 Nest 容器.
//
//   验证: npx vitest run test/config/wp25-env-example-coverage.spec.ts
//   时间戳: 2026-11-03 GMT+8

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

import ts from 'typescript';

/** 仓库根目录. */
const REPO_ROOT = path.join(__dirname, '../..');
/** 源码根目录. */
const SRC_ROOT = path.join(REPO_ROOT, 'src');
/** env 模板. */
const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');

/** env 键名形状 (大写 + 下划线). */
const ENV_KEY_SHAPE = /^[A-Z][A-Z0-9_]*$/;

/**
 * 派生族登记: 计算出来的 env 键.
 *
 * 每个条目都必须写清**推导口径的出处** —— 口径变了这里要跟着改,
 * 否则断言会替代码的漂移背书 (比没有断言更糟).
 */
const DERIVED_ENV_KEYS: Readonly<Record<string, readonly string[]>> = {
  // src/llm/config/provider-env.ts:59 —— `LLM_${providerId.toUpperCase()}_API_KEY`
  //   (MiniMax 例外: 它走历史命名 MINIMAX_API_KEY, 不在本族里).
  'LLM_<PROVIDER>_API_KEY': ['LLM_OPENAI_API_KEY', 'LLM_DEEPSEEK_API_KEY', 'LLM_DOUBAO_API_KEY', 'LLM_QWEN_API_KEY', 'LLM_CUSTOM_API_KEY'],
};

/**
 * 单回合 delta cap 的 18 个 env 键 (WP26 · P2-13/P2-14).
 *
 * 这族**不再是派生键**: 内核不再读 env, 适配层逐个字面量读 → 已被 AST 抽取覆盖.
 * 这里留一份清单, 是为了断言"18 个键一个不多一个不少" —— 少一个 = 那个维度的 cap
 * 永远配不上 (静默失效); 多一个 = 模板里躺着一条没人读的键 (骗人的配置项).
 */
const DELTA_CAP_ENV_KEYS: readonly string[] = [
  'ENGINE_CAP_TRUST_UP',
  'ENGINE_CAP_TRUST_DOWN',
  'ENGINE_CAP_VALENCE_UP',
  'ENGINE_CAP_VALENCE_DOWN',
  'ENGINE_CAP_AROUSAL_UP',
  'ENGINE_CAP_AROUSAL_DOWN',
  'ENGINE_CAP_VERBAL_UP',
  'ENGINE_CAP_VERBAL_DOWN',
  'ENGINE_CAP_DEPTH_UP',
  'ENGINE_CAP_DEPTH_DOWN',
  'ENGINE_CAP_STYLE_UP',
  'ENGINE_CAP_STYLE_DOWN',
  'ENGINE_CAP_POSITIVE_UP',
  'ENGINE_CAP_POSITIVE_DOWN',
  'ENGINE_CAP_NEGATIVE_UP',
  'ENGINE_CAP_NEGATIVE_DOWN',
  'ENGINE_CAP_DEPENDENCY_UP',
  'ENGINE_CAP_DEPENDENCY_DOWN',
];

/**
 * 递归收集目录下的 .ts 文件.
 */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) files.push(fullPath);
  }
  return files;
}

/**
 * 全仓的 `export const NAME = '字面量'` 索引 (常量 → 字面量).
 *
 * 为什么需要: 有些 env 键名是**用常量传进去**的, AST 里看到的是标识符而不是字符串:
 *   src/counselor/providers/llm-json.client.ts → this.config.get<string>(COUNSELOR_LLM_MODEL_ENV_KEY)
 *   src/counselor/config/counselor-llm.config.ts:40 → export const COUNSELOR_LLM_MODEL_ENV_KEY = 'MINIMAX_COUNSELOR_LLM_MODEL'
 * 不解析常量就会把它误判成"代码没读这个键" → 模板里那行被当成孤儿 → 断言报错.
 */
const CONST_LITERALS = new Map<string, string>();

/** 扫一遍全仓, 收集 `export const NAME = '字面量'`. */
function collectConstLiterals(files: readonly string[]): void {
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (declaration.initializer === undefined || !ts.isStringLiteral(declaration.initializer)) continue;
        CONST_LITERALS.set(declaration.name.text, declaration.initializer.text);
      }
    }
  }
}

/** 这个表达式是不是 `process.env`. */
function isProcessEnv(node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node)) return false;
  return node.name.text === 'env' && ts.isIdentifier(node.expression) && node.expression.text === 'process';
}

/**
 * AST 级抽取: 一个文件里真实存在的 env 键读取点.
 *
 * 三种读取形态:
 *   ① process.env.FOO              (点访问)
 *   ② process.env['FOO']           (静态 bracket 访问)
 *   ③ config.get('FOO')            (ConfigService 读 env 直键 —— 上游键名是大写的)
 *      ③ 的参数也可能是**常量标识符** (见 CONST_LITERALS 的说明), 一并解析.
 */
function extractEnvKeys(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    // ① process.env.FOO
    if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
      keys.add(node.name.text);
    }
    // ② process.env['FOO']
    if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression) && ts.isStringLiteral(node.argumentExpression)) {
      keys.add(node.argumentExpression.text);
    }
    // ③ config.get('FOO') / config.getOrThrow('FOO')
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === 'get' || method === 'getOrThrow') {
        const args = node.arguments;
        if (args.length > 0) {
          const firstArg = args[0];
          if (ts.isStringLiteral(firstArg) && ENV_KEY_SHAPE.test(firstArg.text)) {
            keys.add(firstArg.text);
          } else if (ts.isIdentifier(firstArg)) {
            const literal = CONST_LITERALS.get(firstArg.text);
            if (literal !== undefined && ENV_KEY_SHAPE.test(literal)) keys.add(literal);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...keys];
}

/** 代码里读到的全部 env 键 (含登记的派生族). */
function collectCodeEnvKeys(): Set<string> {
  const files = collectTsFiles(SRC_ROOT);
  collectConstLiterals(files);
  const keys = new Set<string>();
  for (const file of files) {
    for (const key of extractEnvKeys(file)) keys.add(key);
  }
  for (const family of Object.values(DERIVED_ENV_KEYS)) {
    for (const key of family) keys.add(key);
  }
  return keys;
}

/**
 * 读 `.env.example` 里的**生效行** (未注释的 `KEY=`).
 *
 * 为什么只认生效行:
 *   注释行是"说明 / 预留 / 可选提示", 不是配置项 —— 拿它当契约等于把
 *   "这里将来会有个键" 也算进"现在配得上", 断言就失去意义了.
 */
function collectEffectiveEnvKeys(): Set<string> {
  const keys = new Set<string>();
  const lines = readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

describe('WP25 · .env.example 与代码 env 读取点一一对应', () => {
  const codeKeys = collectCodeEnvKeys();
  const exampleKeys = collectEffectiveEnvKeys();

  it('① 代码里读的每个 env 键, .env.example 都有生效行', () => {
    // NODE_ENV 例外: 代码读它, 但模板里**必须**是注释行 (见用例④) ——
    //   本地照抄模板不能开 production 模式, 所以它不该进"生效行"契约.
    const missing = [...codeKeys].filter((key) => key !== 'NODE_ENV' && !exampleKeys.has(key)).sort();
    expect(missing, `以下 env 键被代码读取, 但 .env.example 里没有生效行:\n${missing.join('\n')}`).toEqual([]);
  });

  it('② .env.example 的每个生效行, 代码里都真的读它', () => {
    const orphans = [...exampleKeys].filter((key) => !codeKeys.has(key)).sort();
    expect(orphans, `以下 .env.example 生效行在代码里查无读取点 (配了也不生效):\n${orphans.join('\n')}`).toEqual([]);
  });

  it('③ 派生族登记与代码推导口径一致 (5 个 LLM_*_API_KEY)', () => {
    // 防"登记表自己漂了": 登记的族名必须与源码里出现的模板字符串对得上.
    const providerEnv = readFileSync(path.join(SRC_ROOT, 'llm/config/provider-env.ts'), 'utf8');
    expect(providerEnv).toContain(`LLM_\${providerId.toUpperCase()}_API_KEY`);
    // 登记的键数不能比推导口径少 (少一个 = 漏登记 = 断言放行了一个真实缺口).
    expect(DERIVED_ENV_KEYS['LLM_<PROVIDER>_API_KEY']).toHaveLength(5);
  });

  it('③b 18 个 ENGINE_CAP_* 键已改字面量读取, 内核树不再有 cap 键 (WP26 · P2-13/P2-14)', () => {
    // 适配层逐个字面量读 → AST 抽取看得到 → 少写一个键, 断言① 立刻变红.
    const deltaCapConfigFile = path.join(SRC_ROOT, 'engine-adapters/wiring/delta-cap.config.ts');
    expect(existsSync(deltaCapConfigFile)).toBe(true);
    const literalKeys = extractEnvKeys(deltaCapConfigFile).filter((key) => key.startsWith('ENGINE_CAP_'));
    expect([...literalKeys].sort()).toEqual([...DELTA_CAP_ENV_KEYS].sort());

    // 内核树里**不许**再出现任何 ENGINE_CAP_* 字符串 (计算键也算): 内核零 env 读取.
    const kernelRoot = path.join(SRC_ROOT, 'engine-core');
    const kernelCapKeys: string[] = [];
    for (const file of collectTsFiles(kernelRoot)) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('ENGINE_CAP_')) {
        kernelCapKeys.push(path.relative(kernelRoot, file).replaceAll('\\', '/'));
      }
    }
    expect(kernelCapKeys).toEqual([]);
  });

  it('④ NODE_ENV 必须被注释掉 (本地照抄模板不能开 production 模式)', () => {
    const lines = readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/);
    const effective = lines.filter((raw) => {
      const line = raw.trim();
      return line !== '' && !line.startsWith('#') && /^NODE_ENV\s*=/.test(line);
    });
    expect(effective, 'NODE_ENV 在 .env.example 里必须是注释行').toEqual([]);
    // 但它得**看得见** —— 注释行里必须提到它, 否则运维不知道这个开关存在.
    const mentioned = lines.some((raw) => raw.trim().startsWith('#') && raw.includes('NODE_ENV'));
    expect(mentioned, 'NODE_ENV 必须在 .env.example 的注释里出现 (可发现性)').toBe(true);
  });
});
