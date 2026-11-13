import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import { rimrafSync } from 'rimraf';

// V2026-11-02 ESM: __dirname 不可用.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  loadEnvFile();
} catch {}

if (!process.env.DB_HOST) {
  throw new Error('Create a .env file');
}

(async (): Promise<void> => {
  const response = await prompts([
    {
      type: 'text',
      name: 'db',
      message: 'Please enter a database name.',
      validate: (value: string): boolean => !!value,
    } /* {
    type: 'select',
    name: 'db',
    message: 'Please select a database name.',
    choices: [
      { title: 'db1' },
      { title: 'db2' },
    ],
  } */,
  ]);

  const { db } = <{ db: string }>response;
  const MODEL_DIR = path.join(__dirname, '../src/entity', db);
  rimrafSync(`${MODEL_DIR}/*`);

  const generatorConfig = [
    '--noConfig',
    '--cf none', // file names
    '--ce pascal', // class names
    '--cp none', // property names
    '--strictMode !', // strictPropertyInitialization
    // V2026-11-02 ESM: package.json type=module 后 .js 按 ESM 解析,
    //   typeorm-model-generator 仍是 CJS, 加载会失败. 改名 .cjs 强制 CJS.
    `--namingStrategy ${path.join(__dirname, 'NamingStrategy.cjs')}`,
    `-h ${process.env.DB_HOST}`,
    `-p ${process.env.DB_PORT}`,
    // https://github.com/Kononnable/typeorm-model-generator/issues/204#issuecomment-533709527
    // If you use multiple databases, add comma.
    `-d ${db}`, // `-d ${db},`,
    `-u ${process.env.DB_USER}`,
    `-x ${process.env.DB_PASSWORD}`,
    `-e ${process.env.DB_TYPE}`,
    `-o ${MODEL_DIR}`,
  ];

  try {
    spawnSync(`typeorm-model-generator ${generatorConfig.join(' ')}`, { stdio: 'pipe', shell: true });
  } catch (error) {
    console.error(`> Failed to load '${db}' database.`, error);
    return;
  }

  const files = [];
  for (const file of readdirSync(MODEL_DIR)) {
    // V2026-11-02 ESM: 生成的 index.ts 里 export 必须带 .js 扩展名 (NodeNext 强制).
    files.push(`export * from './${file.replace(/\.ts$/, '.js')}';`);
  }
  files.push('');
  // export entity db tables
  // AS-IS import { Tablename } from './entity/dbname/tablename.js';
  // TO-BE import { Tablename } from './entity/dbname.js';
  writeFileSync(path.join(MODEL_DIR, 'index.ts'), files.join('\n'));

  console.log(`> '${db}' database entities has been created: ${MODEL_DIR}`);
})().catch((error: unknown) => {
  console.error(error);
});
