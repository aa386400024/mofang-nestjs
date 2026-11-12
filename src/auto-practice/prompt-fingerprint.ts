// V2026-11-10 治本 (Phase2.5 WP-B · prompt 模板版本指纹):
//   职责: 算出"这一版 prompt 模板"的版本号, 随每场自动对练落库 ——
//         批次对比时能一眼看出"这批和上批的 prompt 是不是同一版".
//
// ── 为什么要有这个 (为什么 engine_version 不够) ─────────────────────────────
//   engine_version 记的是**代码版本** (git describe --dirty). 它能回答
//   "这批数据是哪份代码跑的", 但回答不了 "**prompt 文案**变没变":
//     ① 改 prompt 文案必然改代码 → engine_version 也会变, 但 engine_version
//        同时会因为**改任何无关文件**而变 —— 批次对比时无法区分
//        "prompt 变了" 与 "只是别处动了";
//     ② 更要紧的是**工作区改了还没 commit** 的场景: git sha 不变, 但 prompt
//        文案已经变了 —— engine_version 此刻**说谎** (它只带 -dirty 标记).
//   prompt_version 补的就是这一格: 它只看 prompt 模板文件本身.
//
// ── 算法: 关键 prompt 模板文件的 sha256 (取前 16 位 hex) ───────────────────
//   为什么不用 git sha:
//     ① 未提交的改动体现不出来 —— 而 prompt 文案恰恰经常是"改完先跑一批看效果",
//        那一刻它还没进 git;
//     ② 反过来, 改了**无关文件**也会让 git sha 变 —— "prompt 没变但版本变了",
//        批次对比时是误导;
//     ③ 生产容器**不保留 .git** (见 docs/runbooks/docker-deploy.md: 服务器不保留
//        源码 / node_modules / git) → git sha 在生产恒为 unknown, 等于没做.
//   为什么不用"文案语义哈希" (把文案抽成常量再 hash):
//     那样更精确 (只有文案变了才变), 但要动渲染层把散落的内联文案抽成常量 ——
//     改动面大、且将来新增文案**忘了登记**就会静默漏报. 宁可保守, 不可漏报:
//     prompt 文案就在这些文件里, 文件内容变 → 指纹必变.
//   已知取舍 (诚实写明, 别假装没有):
//     · 同一文件里的**非文案**改动 (加日志 / 改逻辑) 也会改变指纹 —— 这是
//       **保守方向**: 宁可多报"变了", 不可漏报"没变";
//     · 指纹统一按 **构建产物 dist/*.js** 口径计算 (见 resolveFingerprintSource).
//       2026-11-12 之前这里取的是"当前进程实际加载的那份代码"的扩展名:
//       CLI (tsx 跑 src) 读 .ts, 服务端 (node dist/app.js) 读 .js —— 两侧
//       **按设计永不相等**, 跨来源指纹比对必然报"全段变化" (TD-4). 现在两侧
//       都读 dist, 对同一份构建产物算出同一个指纹.
//
// ── 覆盖范围 (边界写清楚, 别让人误以为覆盖了全部 prompt) ───────────────────
//   覆盖: 自动对练路径上**代码里写死**的 prompt 模板 ——
//     ① 访客者 system prompt (渲染层; P1d 改的 INFO_INCREMENT_INSTRUCTION 与
//        ATTACHMENT_BEHAVIOR_INSTRUCTION 就在这个文件里);
//     ② 审议 prompt (deliberation);
//     ③ 咨询师 prompt 的代码部分 (输出纪律 / 收尾纪律 / 危机协议).
//   **不覆盖** (它们是**数据**, 不是代码里的模板):
//     · 咨询师模式的人设 (`counselor_modes.system_prompt`, 存在 DB 里) ——
//       它变了要靠内容比对, 不是靠版本号;
//     · 角色基线里的 5Ps / 核心信念 / `verbal_voice` —— 它们由角色 semver
//       (`character_version`) 覆盖.
//
// ── 失败方向: fail-closed ──────────────────────────────────────────────────
//   任何一个模板文件读不到 → 整个指纹返回 'unknown', **不返回**"只算了
//   一半"的值 —— 半个指纹比没有指纹更坏 (它看起来像个正常的版本号).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
// node:path 没有 default export —— unicorn/import-style 对 node: 内置模块误报, 忽略.
// eslint-disable-next-line unicorn/import-style
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 版本号兜底值: 取不到任何模板文件时的唯一答案.
 *
 * 与 `ENGINE_VERSION_UNKNOWN` 同款语义 —— 'unknown' 的含义明确:
 * "这批数据的 prompt 模板版本**不明**", 不能拿它做跨批次对比.
 */
export const PROMPT_VERSION_UNKNOWN = 'unknown';

/**
 * 指纹长度 (hex 字符数).
 *
 * 为什么是 16: sha256 前 64 位 (256 bit) 足够 —— 碰撞概率在"人眼可见的批次
 * 数量"面前可以忽略; 再长只会让 DB 列变宽, 没有任何实际收益.
 */
export const PROMPT_VERSION_LENGTH = 16;

/**
 * prompt 模板文件清单 (**相对本模块所在目录**, 不含扩展名).
 *
 * 为什么相对路径 + 不写扩展名: 源码态是 .ts, 产物态是 .js —— 扩展名由本模块
 * **自己**的扩展名推导 (见 resolveTemplatePaths), 一份清单两处都能用.
 *
 * ⚠️ 增删清单里的文件 = 改变 prompt_version 口径 —— 那是**有意的**:
 *   覆盖范围变了, 指纹当然该变.
 */
export const PROMPT_TEMPLATE_FILES: readonly string[] = [
  // 访客者 system prompt (渲染层) —— 自动对练的"来访者"是怎么说话的.
  '../engine-adapters/rendering/turn-render-orchestrator',
  // 审议 prompt —— 审议开启时会影响模型看到的 system.
  '../engine-adapters/deliberation/deliberation-prompt',
  // 咨询师 prompt 的代码部分 (输出纪律 / 收尾纪律 / 危机协议).
  'counselor-agent.service',
];

/**
 * 模板文件内容 → 指纹 (纯函数; 可单测).
 *
 * @param entries (相对路径, 文件内容) 列表
 * @returns 指纹 (前 16 位 hex)
 */
export function hashPromptTemplates(entries: readonly { readonly path: string; readonly content: string }[]): string {
  const hash = createHash('sha256');
  for (const entry of entries) {
    // 路径也进哈希: 两个文件内容互换不该算出同一个值.
    hash.update(entry.path);
    hash.update('\u0000');
    hash.update(entry.content, 'utf8');
    hash.update('\u0000');
  }
  return hash.digest('hex').slice(0, PROMPT_VERSION_LENGTH);
}

/**
 * 指纹读取口径.
 *
 * · baseDir   = 读文件的基准目录;
 * · extension = 文件扩展名 (含点);
 * · mode      = 口径标识 (审计用): dist = 统一按构建产物; source = 回退当前进程源码.
 */
export interface FingerprintSourceTarget {
  readonly baseDir: string;
  readonly extension: string;
  readonly mode: 'dist' | 'source';
}

/**
 * 找最近的含 package.json 的祖先目录 (包根).
 *
 * @param startDir 起点目录
 * @returns 包根; 找不到返回 null
 */
function findPackageRoot(startDir: string): string | null {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 把源码树里的路径映射到 dist 产物里的对应路径 (去掉 src/dist 前导段).
 *
 * 例: <root>/src/auto-practice → <root>/dist/auto-practice;
 *     <root>/dist/auto-practice → <root>/dist/auto-practice (幂等).
 *
 * @param sourcePath 源码树里的路径
 * @param packageRoot 包根
 * @returns dist 路径; 不在 src/dist 树下返回 null
 */
export function resolveDistArtifactPath(sourcePath: string, packageRoot: string): string | null {
  const relativePath = relative(packageRoot, sourcePath);
  if (relativePath.length === 0 || relativePath.startsWith('..')) return null;
  const segments = relativePath.split(sep);
  const head = segments[0];
  if (head !== 'src' && head !== 'dist') return null;
  return join(packageRoot, 'dist', ...segments.slice(1));
}

/**
 * 解析指纹读取口径 (TD-4: 统一按 dist/*.js).
 *
 * 为什么统一到 dist:
 *   扩展名原先取自 import.meta.url —— CLI (tsx 跑 src) 读 .ts, 服务端 (node
 *   dist/app.js) 读 .js, 两侧**按设计永不相等**; 指纹要回答的是"这批数据是在
 *   **哪份构建产物**的配置下跑的", 因此两侧都读 dist.
 *
 * 回退条件 (唯一): 包根下**没有**构建产物 —— 按当前进程源码口径算 (本地只跑
 *   nest start 没 build 的场景). 服务端本来就跑 dist, 不会进这条分支;
 *   两侧的判断依据是同一个 (dist 产物在不在), 所以不会各走各的.
 *
 * @param currentModulePath 当前模块自身路径 (单测可注入)
 * @returns 读取口径
 */
export function resolveFingerprintSource(currentModulePath: string = fileURLToPath(import.meta.url)): FingerprintSourceTarget {
  const currentDir = dirname(currentModulePath);
  const currentExtension = extname(currentModulePath);
  const packageRoot = findPackageRoot(currentDir);
  if (packageRoot) {
    const distDir = resolveDistArtifactPath(currentDir, packageRoot);
    if (distDir) {
      const distSelf = join(distDir, `${basename(currentModulePath, currentExtension)}.js`);
      if (existsSync(distSelf)) {
        return { baseDir: distDir, extension: '.js', mode: 'dist' };
      }
    }
  }
  return { baseDir: currentDir, extension: currentExtension, mode: 'source' };
}

/**
 * 解析模板文件的真实路径 (按统一后的指纹口径).
 *
 * @param baseDir 基准目录 (缺省 = 按 resolveFingerprintSource 解析)
 * @param extension 扩展名 (缺省 = 按 resolveFingerprintSource 解析)
 * @param files 清单 (缺省 = PROMPT_TEMPLATE_FILES)
 * @returns 绝对路径列表
 */
export function resolveTemplatePaths(baseDir?: string, extension?: string, files: readonly string[] = PROMPT_TEMPLATE_FILES): string[] {
  const target = resolveFingerprintSource();
  const dir = baseDir ?? target.baseDir;
  const ext = extension ?? target.extension;
  return files.map((file) => resolve(dir, join(file + ext)));
}

/**
 * 算 prompt 模板版本号 (读文件; 读不到任何一个 → 'unknown').
 *
 * @param options.baseDir 基准目录 (单测用)
 * @param options.extension 扩展名 (单测用)
 * @param options.files 清单 (单测用)
 * @returns 指纹 (16 位 hex) 或 'unknown'
 */
export function computePromptVersion(
  options: { readonly baseDir?: string; readonly extension?: string; readonly files?: readonly string[] } = {},
): string {
  const target = options.baseDir ? { baseDir: options.baseDir, extension: options.extension ?? '.js' } : resolveFingerprintSource();
  const files = options.files ?? PROMPT_TEMPLATE_FILES;
  const entries: { path: string; content: string }[] = [];
  for (const name of files) {
    const file = resolve(target.baseDir, join(name + target.extension));
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      // fail-closed: 少一个文件就算不出可信的"模板版本" —— 返回 unknown,
      // 而不是返回一个"看起来正常"的半截指纹.
      return PROMPT_VERSION_UNKNOWN;
    }
    entries.push({ path: name, content });
  }
  if (entries.length === 0) return PROMPT_VERSION_UNKNOWN;
  return hashPromptTemplates(entries);
}

/**
 * 解析 prompt 模板版本号 (纯函数; 便于单测).
 *
 * 口径 (优先级从高到低):
 *   ① PROMPT_VERSION env (显式覆盖 —— 部署方知道自己发的是哪版 prompt);
 *   ② 模板文件指纹;
 *   ③ 'unknown'.
 *
 * 与 `resolveEngineVersion` 同款结构 —— 两个版本号同一套优先级, 读的人不用记两遍.
 *
 * @param envValue PROMPT_VERSION 的 env 原值
 * @param compute 算指纹的函数 (注入, 便于单测)
 * @returns prompt 模板版本号
 */
export function resolvePromptVersion(envValue: string | undefined, compute: () => string): string {
  const trimmed = (envValue ?? '').trim();
  if (trimmed.length > 0) return trimmed;
  const computed = compute().trim();
  return computed.length > 0 ? computed : PROMPT_VERSION_UNKNOWN;
}
