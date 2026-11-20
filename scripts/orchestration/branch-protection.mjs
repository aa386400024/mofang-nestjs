#!/usr/bin/env node
/** AF-056 · integrate 分支保护的声明式 dry-run / apply / verify。 */
import { pathToFileURL } from 'node:url';
import { githubRequest, unwrapGithub } from './github-api.mjs';

export const INTEGRATE_REQUIRED_CONTEXTS = [
  'Orchestration Gate',
  'Contracts (framework 2.0.0)',
  'Lint + Typecheck',
  'E2E',
  'Coverage Gate',
  'Build (Docker)',
  'Security Audit',
  'Unit (shard 1/3)',
  'Unit (shard 2/3)',
  'Unit (shard 3/3)',
  'Coverage (shard 1/3)',
  'Coverage (shard 2/3)',
  'Coverage (shard 3/3)',
];

export function buildIntegrateProtection(contexts = INTEGRATE_REQUIRED_CONTEXTS) {
  return {
    required_status_checks: { strict: true, contexts: [...contexts] },
    enforce_admins: true,
    required_pull_request_reviews: {
      required_approving_review_count: 0,
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      require_last_push_approval: false,
    },
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    lock_branch: false,
    allow_fork_syncing: false,
  };
}

export function verifyIntegrateProtection(actual, expectedContexts = INTEGRATE_REQUIRED_CONTEXTS) {
  const contexts = actual?.required_status_checks?.contexts ?? [];
  const missing = expectedContexts.filter((context) => !contexts.includes(context));
  const unexpected = contexts.filter((context) => !expectedContexts.includes(context));
  const flags = {
    strict: actual?.required_status_checks?.strict === true,
    enforceAdmins: actual?.enforce_admins?.enabled === true,
    linearHistory: actual?.required_linear_history?.enabled === true,
    forcePushDisabled: actual?.allow_force_pushes?.enabled === false,
    deletionDisabled: actual?.allow_deletions?.enabled === false,
    conversationResolution: actual?.required_conversation_resolution?.enabled === true,
    pullRequestRequired: actual?.required_pull_request_reviews?.required_approving_review_count === 0,
  };
  return {
    pass: missing.length === 0 && unexpected.length === 0 && Object.values(flags).every(Boolean),
    missing,
    unexpected,
    contexts,
    flags,
  };
}

async function readProtection(repo, branch) {
  return githubRequest({ path: `/repos/${repo}/branches/${branch}/protection` });
}

async function main(argv) {
  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const valueAfter = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const repo = valueAfter('--repo', 'aa386400024/mofang-nestjs');
  const branch = valueAfter('--branch', 'integrate');
  const payload = buildIntegrateProtection();
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', repo, branch, payload }, null, 2));
    return;
  }
  const updated = await githubRequest({
    method: 'PUT',
    path: `/repos/${repo}/branches/${branch}/protection`,
    body: payload,
  });
  unwrapGithub(updated);
  const current = unwrapGithub(await readProtection(repo, branch));
  const verification = verifyIntegrateProtection(current);
  const output = { mode: 'applied', repo, branch, verification };
  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(JSON.stringify(output, null, 2));
  if (!verification.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[ORCH-PROTECTION] ${error.message}`);
    process.exitCode = 1;
  });
}
