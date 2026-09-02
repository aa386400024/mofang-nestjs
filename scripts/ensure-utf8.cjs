#!/usr/bin/env node
/**
 * ensure-utf8.cjs — Windows 本地开发乱码治本
 *
 * 背景: Windows cmd.exe 默认代码页 CP936 (GBK),
 * Node 进程输出中文会变乱码 ("服务内部错误" → "鏈嶅姟鍐呴儴閿欒鍓").
 *
 * 在 npm script 启动前同步改 cmd.exe 代码页为 UTF-8.
 * Node 作为 cmd.exe 子进程 fork, 会继承父进程代码页.
 *
 * 用法 (package.json):
 *   "prestart": "node scripts/ensure-utf8.cjs && npm run build"
 *   "start:win": "node scripts/ensure-utf8.cjs && nest start --watch"
 *
 * 跨平台:
 *   - Linux / macOS / WSL: 直接跳过 (UTF-8 本来就是默认)
 *   - Windows cmd.exe: chcp 65001 >NUL (静默)
 *   - Windows PowerShell: chcp 不生效, 需手动加 [Console]::OutputEncoding = UTF8
 *
 * 治本 vs 治标:
 *   - 治本: 让整个启动链路 cmd.exe → npm → node 都 UTF-8
 *   - 治标: 仅在 Nest 进程内 setDefaultEncoding (cmd.exe 仍然 GBK, IDE 显示乱码)
 *
 * 大厂踩坑:
 *   - 必须用 stdio: 'ignore' 屏蔽 chcp 输出 "活动代码页: 65001" 提示
 *   - 必须 shell: 'cmd.exe' — Git Bash / PowerShell 里 chcp 不存在或行为不同
 *   - execSync 是同步的, 保证后续 npm script 在 UTF-8 环境下跑
 */

const { execSync } = require('node:child_process');

if (process.platform === 'win32') {
  try {
    execSync('chcp 65001 >NUL', { stdio: 'ignore', shell: 'cmd.exe' });
  } catch (err) {
    // PowerShell / Git Bash / WSL 桥接环境下 shell 不是 cmd.exe, 静默跳过
    // 提示用户手动设置
    process.stderr.write(
      '\n\u001b[33m[warn]\u001b[0m UTF-8 兜底失败 (非 cmd.exe 环境).\n' +
        '  PowerShell 用户请在 npm script 前加: [Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n' +
        '  Git Bash 用户请用 cmd.exe 执行 npm start.\n\n',
    );
  }
}
// Linux/macOS 已是 UTF-8, 直接通过.