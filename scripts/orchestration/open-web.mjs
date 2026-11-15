/**
 * 在系统默认浏览器打开编排看板（web/orchestration/index.html）。
 * 纯静态只读视图；数据来自 data.js（CLI 自动刷新），页面按 config.web.refresh 间隔轮询重载。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const indexHtml = join(scriptDir, '..', '..', 'web', 'orchestration', 'index.html');

if (!existsSync(indexHtml)) {
  console.error(`未找到编排看板页面：${indexHtml}`);
  process.exit(1);
}

if (process.platform === 'win32') {
  // `start` 为 cmd 内建，需 shell；首参空串占位为窗口标题。
  spawn('start', ['', indexHtml], { detached: true, stdio: 'ignore', shell: true });
} else if (process.platform === 'darwin') {
  spawn('open', [indexHtml], { detached: true, stdio: 'ignore' });
} else {
  spawn('xdg-open', [indexHtml], { detached: true, stdio: 'ignore' });
}

console.log(`已在默认浏览器打开编排看板：${indexHtml}`);
console.log('提示：run / watch / pack / 台账变更后 CLI 自动刷新 data.js；页面按 web.refresh 间隔轮询重载，无需手动 F5。');
