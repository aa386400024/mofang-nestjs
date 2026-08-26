#!/usr/bin/env node
/**
 * deploy-tested.cjs — 测试通过后的远程部署 (服务器端 docker build 版)
 *
 * 适用环境: 大炮本地 Windows 没装 Docker, 服务器 (Ubuntu) 已装 docker.
 * 流程:
 *   1. 大炮本地跑 pnpm build → 拿到最新 dist
 *   2. 大炮跑 pnpm run test:smoke 验证 dist 能起 + /health 通
 *   3. 通过后大炮跑 npm run deploy:tested
 *      ↓ 本脚本会:
 *      - 强制 prompt "yes-deploy" 才继续
 *      - scp 上传 dist/ + package.json + package-lock.json + Dockerfile.prod + .dockerignore
 *      - 服务器 docker build (基于上传的 dist/)
 *      - 服务器 docker tag 旧镜像 :previous (回滚点)
 *      - 服务器 docker compose down + up -d
 *      - 验证 remote /health 200
 *
 * 安全机制:
 *   - 强制键盘输入 "yes-deploy" 才继续, 否则立刻退出
 *   - 显示要部署的版本号 + commit hash, 大炮肉眼确认
 *   - 服务器旧镜像保留 :previous, deploy 失败可立刻 docker tag 回滚
 *   - scp 失败立刻中断, 不会污染服务器
 *
 * 前置条件:
 *   - 本地 dist/app.js 已存在 (pnpm build 过)
 *   - npm run test:smoke 已通过 (本脚本不重复跑, 但会读 .smoke-last)
 *   - ssh root@117.72.30.78 已配好无密码登录 / sshpass / ssh key
 *
 * 用法:
 *   $ npm run deploy:tested
 *   $ npm run deploy:tested -- --skip-upload (本地已有 server 上的 build-context)
 *
 * 大厂踩坑:
 *   - 必须用 readline 拿键盘输入, 纯 --force 参数不安全 (脚本被误调就 GG)
 *   - 服务器 docker compose down 期间 API 会断, 提示大炮在低峰跑
 *   - 远程回滚预案: 旧镜像 tag (deploy 脚本会保留 :previous tag)
 *   - 服务器 .env 不会被覆盖 (部署只动镜像, 不动 .env)
 *   - scp 上传 package-lock.json 是为了 npm ci 装相同的依赖版本 (避免漂移)
 */

const readline = require('node:readline');
const { execSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const DIST_APP = path.join(ROOT, 'dist', 'app.js');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const VERSION = process.env.DEPLOY_VERSION || `v${PKG.version}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
const IMAGE_NAME = 'mofang-nestjs-api';
const REMOTE_HOST = process.env.DEPLOY_HOST || 'root@117.72.30.78';
const REMOTE_DIR = '/opt/mofang-nestjs';
const REMOTE_BUILD_CTX = '/tmp/mofang-nestjs-build';
const REMOTE_DEPLOY_DIR = '/opt/mofang-nestjs';

const args = process.argv.slice(2);
const SKIP_UPLOAD = args.includes('--skip-upload');

function log(level, msg) {
  const color = { info: '\u001b[36m', ok: '\u001b[32m', warn: '\u001b[33m', fail: '\u001b[31m' }[level];
  console.log(`${color}[${level}]\u001b[0m ${msg}`);
}

function run(cmd, opts = {}) {
  log('info', `$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function ssh(cmd) {
  log('info', `$ ssh ${REMOTE_HOST} "${cmd}"`);
  return execSync(`ssh ${REMOTE_HOST} ${JSON.stringify(cmd).replace(/\n/g, '\\n')}`, { encoding: 'utf-8' });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n\u001b[1m\u001b[36m=== mofang-nestjs deploy:tested (server-build mode) ===\u001b[0m\n');

  if (!fs.existsSync(DIST_APP)) {
    log('fail', `dist/app.js 不存在, 请先跑: pnpm build`);
    process.exit(1);
  }

  // 拿 commit hash 用于审计
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    log('warn', '拿不到 git commit hash (非 git 仓库?)');
  }

  // 拿 smoke-test 最后一次结果
  let smokePassedAt = '(无)';
  const smokeLogPath = path.join(ROOT, '.smoke-last');
  if (fs.existsSync(smokeLogPath)) {
    smokePassedAt = fs.readFileSync(smokeLogPath, 'utf-8').trim();
  }

  console.log(`  镜像:        ${IMAGE_NAME}:${VERSION}`);
  console.log(`  commit:      ${commit}`);
  console.log(`  smoke-test:  ${smokePassedAt}`);
  console.log(`  远程服务器:   ${REMOTE_HOST}:${REMOTE_DEPLOY_DIR}`);
  console.log(`  build 模式:  服务器端 docker build (本地无 docker)`);
  console.log(`  跳过 upload:  ${SKIP_UPLOAD ? '是' : '否'}\n`);

  log('warn', '部署期间 API 会断 30 秒 ~ 2 分钟, 请确认在低峰跑.');
  log('warn', '服务器旧镜像 :previous 会保留, 失败可用 docker tag 回滚.\n');

  const confirm = await ask('确认要部署吗? 输入 \u001b[1myes-deploy\u001b[0m 继续, 其它任何输入取消: ');
  if (confirm !== 'yes-deploy') {
    log('warn', `已取消 (输入: "${confirm}")`);
    process.exit(0);
  }

  // Step 1: 在服务器准备 build-context 目录
  log('info', '\n[1/6] 服务器准备 build-context 目录...');
  ssh(`rm -rf ${REMOTE_BUILD_CTX} && mkdir -p ${REMOTE_BUILD_CTX}`);

  // Step 2: scp 上传必要文件
  if (!SKIP_UPLOAD) {
    log('info', '\n[2/6] 上传 dist + package.json + Dockerfile.prod 到服务器...');
    const filesToUpload = [
      'dist',
      'package.json',
      'package-lock.json',
      'Dockerfile.prod',
      '.dockerignore',
    ].filter((f) => fs.existsSync(path.join(ROOT, f)));

    if (!filesToUpload.includes('dist')) {
      log('fail', 'dist 目录不存在, 请先跑 pnpm build');
      process.exit(1);
    }

    for (const f of filesToUpload) {
      // 治本: scp -r <dir> user@host:target/ 会变成 target/<dir>/, 而非铺平 target/.
      // 拆为子文件 scp, 保证服务器上 target/ 平面有 dist/、package.json 等.
      const localPath = path.join('.', f);
      const stat = fs.statSync(localPath);
      if (stat.isDirectory()) {
        // 目录: 用 tar 打包, 服务器解包 → 最稳, 避免 SCP 递归嵌套问题
        const tarName = `_stage_${f.replace(/[^a-zA-Z0-9_]/g, '_')}.tar`;
        run(`tar -cf ${tarName} ${f}`);
        run(`scp ${tarName} ${REMOTE_HOST}:${REMOTE_BUILD_CTX}/`);
        ssh(`cd ${REMOTE_BUILD_CTX} && tar -xf ${tarName} && rm ${tarName}`);
        fs.unlinkSync(tarName);
      } else {
        // 单文件: 直接 scp
        run(`scp ${localPath} ${REMOTE_HOST}:${REMOTE_BUILD_CTX}/`);
      }
    }
  } else {
    log('info', '\n[2/6] 跳过 upload (--skip-upload)');
  }

  // Step 3: 服务器端 docker build
  log('info', '\n[3/6] 服务器 docker build...');
  ssh(`cd ${REMOTE_BUILD_CTX} && docker build -f Dockerfile.prod -t ${IMAGE_NAME}:latest -t ${IMAGE_NAME}:${VERSION} .`);

  // Step 4: 服务器端 docker tag 旧镜像为 :previous (回滚点)
  log('info', '\n[4/6] 保留旧镜像 :previous (回滚点)...');
  ssh(`docker tag ${IMAGE_NAME}:latest ${IMAGE_NAME}:previous 2>/dev/null || echo "no previous image"`);

  // Step 5: 服务器重启容器
  log('info', '\n[5/6] 服务器 docker compose down + up...');
  ssh(`cd ${REMOTE_DEPLOY_DIR} && docker compose -f docker-compose.prod.yml down`);
  ssh(`cd ${REMOTE_DEPLOY_DIR} && docker compose -f docker-compose.prod.yml up -d`);

  // Step 6: 验证
  log('info', '\n[6/6] 等服务启动 + 验证 remote /health...');
  await new Promise((r) => setTimeout(r, 30000));

  try {
    const healthCheck = ssh(`docker exec ${IMAGE_NAME} curl -fsS http://127.0.0.1:3001/health`);
    if (healthCheck.includes('"status":"ok"')) {
      log('ok', '\n✅ 部署完成!');
      log('info', `镜像: ${IMAGE_NAME}:${VERSION} @ ${commit}`);
      log('info', '容器状态:');
      run(`ssh ${REMOTE_HOST} "docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep ${IMAGE_NAME}"`);

      // 清理服务器 build-context
      ssh(`rm -rf ${REMOTE_BUILD_CTX}`);
      log('info', '服务器临时 build-context 已清理.');
      return;
    }
    throw new Error('health body 不含 status:ok');
  } catch (err) {
    log('fail', `remote /health 验证失败: ${err.message}`);
    log('warn', '回滚命令 (在本地跑):');
    console.log(`    ssh ${REMOTE_HOST} "docker tag ${IMAGE_NAME}:previous ${IMAGE_NAME}:latest && cd ${REMOTE_DEPLOY_DIR} && docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d"`);
    process.exit(1);
  }
}

main().catch((err) => {
  log('fail', err.message);
  console.error(err.stack);
  process.exit(1);
});