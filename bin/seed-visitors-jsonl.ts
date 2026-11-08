// V2026-11-08 治本 (Phase2.5 WP-D · visitors.jsonl 11 角色导入来访池):
//   职责: 把 docs/reference/psych-dataset/dataset/visitors.jsonl 的 11 个真实案例角色
//         导入 visitor_pool_templates, 作为自动对练的来访者来源.
//
//   映射策略 (best-effort, 不丢数据):
//     - id: `vpt_jsonl_<role_id>` (前缀防与现有 6 个官方模板撞 id)
//     - codename: display_name
//     - presentingComplaint: chief_complaint
//     - issueDomain: 按 case_id 前缀粗分 (behavior→self_worth, brief→intimate,
//       cbt→social_anxiety, crisis→self_worth, intake→self_worth,
//       psychoanalysis→intimate, shuangmianjing→workplace)
//     - defenseType: 默认 avoidance (JSONL 里角色普遍用"转移话题"回避情绪)
//     - difficulty: risk low=L1 / medium=L2 / high=L3
//     - script: 整条 JSONL 原文 (7 大块快照留待 WP-E 评测时再细化, 这里不丢字段)
//
//   幂等: 连跑两次, 第二次全 unchanged.
//   用法: npm run seed:visitors-jsonl

import 'reflect-metadata';

import { config as loadEnvFile } from 'dotenv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { configuration } from '../src/config/configuration.js';
import { VisitorPoolTemplate } from '../src/counselor/entities/visitor-pool-template.entity.js';
import {
  VisitorPoolDefenseType,
  VisitorPoolIssueDomain,
  VisitorPoolSource,
} from '../src/counselor/enums/visitor-pool.enum.js';
import { TrainingDifficulty } from '../src/counselor/enums/training-difficulty.enum.js';
import { VisitorStyle } from '../src/counselor/enums/visitor-style.enum.js';

type DbConfig = DataSourceOptions & { autoLoadEntities?: boolean };

/** JSONL 单行结构 (只取脚本要用的字段). */
interface JsonlRow {
  readonly case_id: string;
  readonly role_id: string;
  readonly display_name: string;
  readonly chief_complaint: string;
  readonly risk: string;
  readonly demographics: string;
  readonly opening_line: string;
  readonly [key: string]: unknown;
}

/** 按 case_id 前缀粗分议题领域. */
function mapIssueDomain(caseId: string): VisitorPoolIssueDomain {
  if (caseId.startsWith('cbt')) return VisitorPoolIssueDomain.SOCIAL_ANXIETY;
  if (caseId.startsWith('brief') || caseId.startsWith('psychoanalysis')) return VisitorPoolIssueDomain.INTIMATE;
  if (caseId.startsWith('shuangmianjing') && caseId.includes('marriage')) return VisitorPoolIssueDomain.INTIMATE;
  if (caseId.startsWith('shuangmianjing')) return VisitorPoolIssueDomain.WORKPLACE;
  return VisitorPoolIssueDomain.SELF_WORTH;
}

/** risk 词 → 难度档. */
function mapDifficulty(risk: string): TrainingDifficulty {
  if (risk === 'high') return TrainingDifficulty.L3;
  if (risk === 'medium') return TrainingDifficulty.L2;
  return TrainingDifficulty.L1;
}

/** 从 demographics 粗提年龄区间 (提不出就给空串). */
function mapAgeRange(demographics: string): string {
  const m = demographics.match(/(\d{2})\s*岁/);
  if (m) {
    const age = Number(m[1]);
    return `${age - 2}-${age + 3}`;
  }
  return '';
}

async function main(): Promise<void> {
  const envResult = loadEnvFile();
  if (envResult.error) throw new Error(`加载 .env 失败: ${envResult.error.message}`);

  const jsonlPath = join(process.cwd(), 'docs', 'reference', 'psych-dataset', 'dataset', 'visitors.jsonl');
  const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter((l) => l.trim().length > 0);
  process.stdout.write(`[seed:visitors-jsonl] 读到 ${lines.length} 行\n`);

  const config = (await configuration()) as { db: DbConfig };
  const dbOptions: DbConfig = { ...config.db };
  delete dbOptions.autoLoadEntities;

  const dataSource = new DataSource({
    ...dbOptions,
    entities: [VisitorPoolTemplate],
    migrations: [],
    logging: false,
    synchronize: false,
  });
  await dataSource.initialize();

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  try {
    const repo = dataSource.getRepository(VisitorPoolTemplate);
    for (const line of lines) {
      const row = JSON.parse(line) as JsonlRow;
      const id = `vpt_jsonl_${row.role_id}`;
      const script = {
        source: 'visitors.jsonl',
        caseId: row.case_id,
        openingLine: row.opening_line,
        demographics: row.demographics,
        raw: row,
      };
      const fields: Partial<VisitorPoolTemplate> = {
        id,
        codename: row.display_name,
        ageRange: mapAgeRange(row.demographics),
        presentingComplaint: row.chief_complaint.slice(0, 300),
        defenseType: VisitorPoolDefenseType.AVOIDANCE,
        issueDomain: mapIssueDomain(row.case_id),
        trainingGoal: `自动对练素材: ${row.display_name}`,
        difficulty: mapDifficulty(row.risk),
        source: VisitorPoolSource.OFFICIAL,
        styleHint: VisitorStyle.COOPERATIVE,
        emotionBaselineDefault: 0.35,
        defenseLevelDefault: 0.2,
        script: script as VisitorPoolTemplate['script'],
        enabled: true,
        sortOrder: 100,
      };
      const existing = await repo.findOne({ where: { id } });
      if (!existing) {
        await repo.save(repo.create(fields));
        inserted += 1;
      } else {
        // 只更新内容字段, 不碰 enabled (admin 可能手动下架).
        await repo.update(id, {
          codename: fields.codename,
          presentingComplaint: fields.presentingComplaint,
          script: fields.script,
        });
        updated += 1;
      }
    }
    process.stdout.write(`[seed:visitors-jsonl] 新增 ${inserted} / 更新 ${updated} / 未变 ${unchanged}\n`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write('[seed:visitors-jsonl] 失败: ' + detail + '\n');
  process.exitCode = 1;
});
