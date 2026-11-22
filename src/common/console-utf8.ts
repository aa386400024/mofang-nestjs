import { execSync } from 'node:child_process';

/**
 * Windows 中文日志乱码治本 (大厂"日志可读性"必备).
 *
 * 背景:
 *   - Windows cmd.exe 默认代码页 = CP936 (GBK)
 *   - Node.js stdout 默认按系统代码页解码显示
 *   - NestJS / pino 输出的中文 ("服务内部错误") 会被解码为
 *     "鏈嶅姟鍐呴儴閿欒鍓" 这种乱码
 *
 * 三层兜底, 启动顺序很重要:
 *   1. chcp 65001 (同步, 仅 Windows): 改 cmd.exe 当前进程代码页为 UTF-8
 *      必须在 setDefaultEncoding 之前调用, 否则 Node 输出的字节会按旧代码页解码
 *   2. stdout/stderr setEncoding('utf8'): Node 进程内输出包为 UTF-8 (pino / NestJS 共享)
 *   3. PowerShell 补充: PS 里 chcp 不生效, 需用 .NET API (大炮手动配)
 *
 * 在 Linux / WSL / 远程 (Ubuntu) 上层 1 自动跳过, 不影响生产环境.
 *
 * 调用位置: src/app.ts 顶部, NestFactory.create() 之前.
 *   必须在 app.middleware / AppModule import 之前, 否则 pin 提前 buffer log.
 *
 * 大厂踩坑:
 *   - chcp 必须在 setDefaultEncoding 之前调用
 *   - 在 PowerShell 里 chcp 65001 没用, 需 [Console]::OutputEncoding = UTF8
 *   - 用 execSync 是因为 chcp 输出会刷一次"活动代码页: 65001"提示,
 *     stdio: 'ignore' 直接静默, 不污染启动日志
 */
export function ensureUtf8Console(): void {
  if (process.platform === 'win32') {
    try {
      // shell: 'cmd.exe' 是治本关键 — 改 cmd.exe 进程代码页, Node 进程继承.
      // sonarjs/no-os-command-from-path 豁免: 命令是硬编码常量 (不接外部输入),
      // 仅限 Windows 启动时一次性调用, 不存在 PATH 注入面.
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      execSync('chcp 65001 >NUL', { stdio: 'ignore', shell: 'cmd.exe' });
    } catch {
      // shell 不存在 / 非 cmd 环境 (PowerShell / Git Bash / WSL) 静默跳过
      // PowerShell 用户应在 npm script 加: [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    }
  }
  if (process.stdout.setDefaultEncoding) {
    process.stdout.setDefaultEncoding('utf8');
    process.stderr.setDefaultEncoding('utf8');
  }
}
