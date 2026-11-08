const fs = require("fs");
const path = require("path");
const groups = {
  A_audit: [
    "docs/worklog/audits/phase2-code-vs-blueprint-audit-2026-11-08.md",
    "docs/worklog/completed/phase2/phase2-code-vs-blueprint-audit-2026-11-08.md"
  ],
  B_tidy: [
    "docs/README.md",
    "docs/architecture/ai-engine-roadmap-v1.1.md",
    "docs/worklog/completed/phase2/phase2-docs-tidy-up-2026-11-08.md",
    "docs/worklog/completed/phase2/phase2-docs-tidy-up-implementation-2026-11-08.md"
  ],
  C_freeze: [
    "test/admin-debug/deliberation-stats.spec.ts",
    "test/admin-debug/wp38-debug-session-resume.spec.ts",
    "docs/worklog/completed/phase2/engine-wp47-supervision-report-typeorm-backfill-2026-11-08.md",
    "docs/worklog/pending/phase4-backlog-2026-11-08.md",
    "docs/worklog/completed/phase2/phase2-freeze-2026-11-08.md",
    "docs/worklog/completed/phase2/phase2-freeze-closeout-2026-11-08.md",
    "docs/worklog/completed/phase2/phase2-freeze-closeout-implementation-2026-11-08.md"
  ],
  S_shared: [
    "docs/worklog/README.md",
    "docs/worklog/pending/phase2-overview-2026-11-03.md",
    "docs/worklog/pending/phase2-wp-list-2026-11-03.md"
  ]
};
const owner = {};
for (const g of Object.keys(groups)) for (const f of groups[g]) owner[f] = g;
const re = /\]\(([^)]+)\)/g;
for (const g of Object.keys(groups)) {
  console.log("=== GROUP " + g + " ===");
  for (const f of groups[g]) {
    if (!fs.existsSync(f)) { console.log("  MISSINGFILE " + f); continue; }
    const c = fs.readFileSync(f, "utf8");
    const seen = new Set();
    let m;
    while ((m = re.exec(c)) !== null) {
      const t = m[1].trim();
      if (/^(https?:|#|mailto:)/.test(t)) continue;
      const p = path.resolve(path.dirname(f), t.split("#")[0]);
      if (!p.startsWith(path.resolve("."))) continue;
      const rel = path.relative(path.resolve("."), p).replace(/\\/g, "/");
      const og = owner[rel] || (fs.existsSync(p) ? "TRACKED_OR_OTHER" : "NOT_IN_WORKTREE");
      const key = og + "|" + rel;
      if (seen.has(key)) continue;
      seen.add(key);
      if (og !== g) console.log("  [" + og + "] " + f + "  ->  " + rel);
    }
  }
}