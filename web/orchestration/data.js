// 由 orchestration CLI 生成，勿手改
window.ORCH_SNAPSHOT = {
  "generatedAt": "2026-11-15T18:34:04.363Z",
  "mode": {
    "autoLoopEnabled": false,
    "reworkLimit": 2
  },
  "counts": {
    "ready": 0,
    "submitted": 0,
    "working": 0,
    "completed": 0,
    "failed": 0,
    "canceled": 0,
    "rejected": 0,
    "input-required": 0,
    "deadLetter": 0
  },
  "tasks": [],
  "deadLetters": [],
  "reworkProposals": [],
  "pendingApprovals": [],
  "improvements": {
    "total": 19,
    "activeCount": 15,
    "byStatus": {
      "candidate": 13,
      "queued": 1,
      "accepted": 1,
      "done": 4,
      "wontfix": 0
    },
    "byType": {
      "gap": 9,
      "guardrail": 1,
      "tool": 0,
      "standard": 2,
      "performance": 0,
      "tech-debt": 7
    },
    "bySource": {
      "implementation": 11,
      "acceptance": 0,
      "rework": 0,
      "dead-letter": 0,
      "review": 8
    },
    "items": [
      {
        "improvementId": "IM-001",
        "title": "台账抽取通道仅识别快照遗留项，未直接解析回执文件正文",
        "status": "queued",
        "source": "implementation",
        "type": "gap",
        "layer": "adapter",
        "relatedTaskId": null,
        "evidence": [
          "scripts/orchestration/improvement-log.mjs#extractFromSnapshot"
        ],
        "impact": "回执正文中未进入快照遗留区的缺口不会被台账捕获，存在漏登记风险",
        "suggestion": "抽取通道增加回执文件正文解析，与快照遗留项双通道合并去重",
        "historyCount": 2,
        "lastTransition": {
          "at": "2026-11-15T13:30:32.466Z",
          "by": "orchestrator",
          "to": "queued",
          "note": "编排者评审立项，纳入演进 backlog 跟踪"
        }
      },
      {
        "improvementId": "IM-002",
        "title": "typeorm-model-generator 废弃工具链及其传递依赖存在未修复漏洞",
        "status": "accepted",
        "source": "review",
        "type": "tech-debt",
        "layer": "adapter",
        "relatedTaskId": null,
        "evidence": [
          "pnpm audit: . > typeorm-model-generator@0.4.6-no-engines > typeorm@0.2.45 / mysql2@2.3.3 / sqlite3@5.1.7"
        ],
        "impact": "该 dev 工具上游停更，拖入老 typeorm/mysql2/sqlite3/tar/tmp，贡献全部 4 条 critical 及多数 high/moderate 告警；仅开发期反向生成使用，不进生产运行时",
        "suggestion": "评估移除 typeorm-model-generator、bin/entity.ts、NamingStrategy.cjs 及样品 entity；移除前确认无 DB→装饰器反向生成需求",
        "historyCount": 3,
        "lastTransition": {
          "at": "2026-11-15T14:08:05.685Z",
          "by": "orchestrator",
          "to": "accepted",
          "note": "实现落地：移除 devDep typeorm-model-generator、bin/entity.ts、bin/NamingStrategy.cjs、entity:load 脚本；typecheck/lint/oxlint/21 例绿；待提交归档转 done"
        }
      },
      {
        "improvementId": "IM-003",
        "title": "运行时传递依赖 uuid/glob/minimatch 存在版本告警，须随主依赖升级治理",
        "status": "candidate",
        "source": "review",
        "type": "tech-debt",
        "layer": "adapter",
        "relatedTaskId": null,
        "evidence": [
          "pnpm audit: typeorm@1.1.2>mssql>tedious>@azure/ms-rest-js>uuid@8.3.2; @sentry/rimraf>glob@13.0.6; ts-morph/@sentry>minimatch@10.2.6"
        ],
        "impact": "间接依赖告警，非运行时直连路径；typeorm 的 mssql/tedious 为可选方言打包，本仓实际使用 mysql2",
        "suggestion": "随 typeorm/sentry/rimraf/ts-morph 主依赖升级带动传递版本；按 P-DEBT-4 纪律，版本变动须附全量绿跑与墙钟数字",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T13:43:09.887Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-004",
        "title": "任务交付归档后台账状态未自动回填，快照仍显示 backlog / 未验收",
        "status": "done",
        "source": "implementation",
        "type": "gap",
        "layer": "adapter",
        "relatedTaskId": null,
        "evidence": [
          "task-state-index.json: AF-005~008 交付后仍在 tasks 且 status=backlog",
          "taskSheet 指针指向已归档的 pending 路径（断链）"
        ],
        "impact": "任务实际已验收归档，但看板活跃列表仍显示待立项/未验收；台账状态与交付记录脱节，需人工回填，闭环未自动化",
        "suggestion": "交付包或验收落地后由编排链路自动把任务单元迁移到 archivedTasks 并写 status=completed 与工件指针；或 CLI 提供归档命令在交付记录落盘后回填索引",
        "historyCount": 4,
        "lastTransition": {
          "at": "2026-11-15T18:28:30.007Z",
          "by": "orchestrator-cli",
          "to": "done",
          "note": "AF-015回填机制已生效;索引与快照均显示AF-005~008completed"
        }
      },
      {
        "improvementId": "IM-005",
        "title": "交接契约校验枚举与 taskId 模式与框架 ajv schema 双源镜像",
        "status": "candidate",
        "source": "implementation",
        "type": "tech-debt",
        "layer": "adapter",
        "relatedTaskId": "AF-009",
        "evidence": [
          "handover-contract.mjs 手写 TASK_TYPES/TASK_STATUSES/TASK_ID_PATTERN",
          "validator.mjs 走框架 task-sheet.schema.json"
        ],
        "impact": "框架枚举或模式演进时两处需同步 存在口径漂移风险",
        "suggestion": "交接件校验复用框架 schema 同步封装 消除手写镜像",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T17:19:39.551Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-006",
        "title": "协商轮 review 交接件结构尚未进框架仓 schema 与模板",
        "status": "candidate",
        "source": "implementation",
        "type": "standard",
        "layer": "framework",
        "relatedTaskId": "AF-009",
        "evidence": [
          "autonomous-team-design.md 协商轮定义",
          "handover-contract.mjs review 字段为本仓适配层定义"
        ],
        "impact": "review 结构目前仅本仓定义 跨代理复用需框架层固化",
        "suggestion": "P1 评估将 review 交接件字段组上提框架仓 schema 与模板",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T17:19:40.999Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-007",
        "title": "回执幂等次键以交付记录路径代替独立工件版本号",
        "status": "candidate",
        "source": "implementation",
        "type": "tech-debt",
        "layer": "adapter",
        "relatedTaskId": "AF-010",
        "evidence": [
          "dispatch.mjs receiptFingerprint",
          "framework reliability.md §2"
        ],
        "impact": "同一 taskId 若交付记录路径不变而内容被覆盖，指纹无法区分版本；当前交接件不可变口径下风险可控",
        "suggestion": "后续在任务条目或交接件补独立工件版本号（revision/version），指纹以 taskId+version 为准",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T17:29:33.755Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-008",
        "title": "派发目标角色未按 Agent Card 能力声明匹配路由",
        "status": "candidate",
        "source": "implementation",
        "type": "gap",
        "layer": "adapter",
        "relatedTaskId": "AF-010",
        "evidence": [
          "dispatch.mjs targetRole 取 agentRole 兜底 executor",
          "framework autonomous-loop.md §100"
        ],
        "impact": "多执行代理并存时无法按能力与可用性路由；当前单 executor 角色无实际影响",
        "suggestion": "AF-013 演练阶段或 P1 接入 agent card 能力声明匹配，按 skills/tools/availability 选择目标代理",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T17:29:43.156Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-009",
        "title": "验收残留比对缺 git diff 变更清单采集器，V7 当前 skip",
        "status": "candidate",
        "source": "implementation",
        "type": "tech-debt",
        "layer": "adapter",
        "relatedTaskId": "AF-011",
        "evidence": [
          "acceptance-runner.mjs checkResidual opts.changedFiles scope-mutex.mjs detectResidualFiles"
        ],
        "impact": "纯函数模块无 git IO；变更清单须由调用方采集传入，未接入采集器前 V7 残留护栏记 skip，清单外文件不会被机读拦截",
        "suggestion": "后续在调度/验收入口采集 git diff --name-only（相对仓根）传入 runAcceptance opts.changedFiles，使 V7 残留比对生效",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T17:41:33.766Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-010",
        "title": "任务 scope 未与 Agent Card resources 角色资源域做越域校验",
        "status": "candidate",
        "source": "implementation",
        "type": "gap",
        "layer": "adapter",
        "relatedTaskId": "AF-011",
        "evidence": [
          "scope-mutex.mjs findScopeConflicts 仅做任务间互斥 agent-cards resources 字段未投影进校验"
        ],
        "impact": "本单只拦截在办任务间文件域冲突；任务 scope 越出角色声明资源域（如 executor 写编排目录）暂无前置机读校验",
        "suggestion": "P1 接入 Agent Card resources 投影，派发前校验任务 scope 落在目标角色资源域内；资源域真相源保持角色卡与框架 roles.md",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T17:41:34.843Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-011",
        "title": "scope 通配路径仅降级目录前缀，未做真实目录枚举 glob 展开",
        "status": "candidate",
        "source": "implementation",
        "type": "tech-debt",
        "layer": "adapter",
        "relatedTaskId": "AF-011",
        "evidence": [
          "scope-mutex.mjs normalizePath wildcard 截断 纯函数无 fs 列目录能力"
        ],
        "impact": "src/**/*.ts 类通配按 src/ 目录前缀近似判定；跨层通配与单段 * 的精确覆盖口径可能偏宽或偏窄",
        "suggestion": "P2 并行文件锁升级时引入只读路径匹配器（读目录或框架 glob 工具），在纯函数之外的采集层做展开",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T17:41:35.976Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-012",
        "title": "squash 合并后的提交动作未自动化，脚本仅做 squash 暂存与删除端口",
        "status": "candidate",
        "source": "implementation",
        "type": "tech-debt",
        "layer": "adapter",
        "relatedTaskId": "AF-012",
        "evidence": [
          "branch-workflow.mjs squashMerge 仅执行 git merge --squash cli.mjs cmdBranch merge 注明提交归编排者闸门"
        ],
        "impact": "合并链路停在暂存阶段；提交标题（conventional + taskId）与合并后远端分支清理需编排者手工闭合，未形成自动 L1 合并闭环",
        "suggestion": "L1 自动化阶段在闸门全绿后补提交动作（标题带 taskId），并在合并成功后串联本地/远端源分支清理",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T17:49:21.140Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-013",
        "title": "分支巡检未判定未合并分支是否落后 integrate（rebase 状态）",
        "status": "candidate",
        "source": "implementation",
        "type": "gap",
        "layer": "adapter",
        "relatedTaskId": "AF-012",
        "evidence": [
          "branch-workflow.mjs classifyBranches 仅按 merged/ageDays 分类 cli.mjs collectBranches 未采集 ahead/behind"
        ],
        "impact": "未合并分支可能已落后基线但巡检只标注超期天数，无法识别需先 rebase 的陈旧分支",
        "suggestion": "巡检采集 git status --branch ahead/behind 或 merge-base 差量，未合并且落后基线的分支单独标注待 rebase",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T17:49:22.354Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-014",
        "title": "通道层重试规则与失败终态未锚定 framework reliability §4（各自立法）",
        "status": "done",
        "source": "review",
        "type": "gap",
        "layer": "framework",
        "relatedTaskId": "AF-013",
        "evidence": [
          "docs/worklog/pending/archive/relay-response-af013-drill-20261116.md",
          "D-10",
          "D-2",
          "D-5",
          "D-7"
        ],
        "impact": "通道重试形态/数值（固定重试一次、无退避）与框架指数退避不一致；失败终态出口双轨（保持 ready+转人工 vs 直接 failed）；确定性缺陷在通道层缺终止规则。跨两仓文档修订时需统一权威终态出口与重试预算。",
        "suggestion": "在 design memo §3 补 framework §4 锚点；先定权威终态出口（ready vs failed），再统一任务级重试预算与退避；确定性缺陷直落 failed 不重试。",
        "historyCount": 4,
        "lastTransition": {
          "at": "2026-11-15T18:28:30.680Z",
          "by": "orchestrator-cli",
          "to": "done",
          "note": "已落地不可恢复四类终态任务级预算退避序列;备忘锚定§4"
        }
      },
      {
        "improvementId": "IM-015",
        "title": "派发审计缺逐次重试留痕载体与失败定性三分法字段",
        "status": "done",
        "source": "review",
        "type": "gap",
        "layer": "framework",
        "relatedTaskId": "AF-013",
        "evidence": [
          "docs/worklog/pending/archive/relay-response-af013-drill-20261116.md",
          "D-1",
          "D-3"
        ],
        "impact": "审计只留尝试次数聚合值，丢失逐次尝试的失败原因/所在层/退避时长，无法复原重试链；通道失败未纳入确定性/偶发/既有债定性三分法，框架要求的基线分栏在通道侧无载体。",
        "suggestion": "审计记录扩为逐次尝试条目（层、原因、退避、结果）；任务/通道失败补定性字段与既有债-本次改动分栏；通道演练基线来源另立只读核对单确认。",
        "historyCount": 4,
        "lastTransition": {
          "at": "2026-11-15T18:28:45.355Z",
          "by": "orchestrator-cli",
          "to": "done",
          "note": "已落地attempts逐次留痕定性三分法基线分栏;审计校验枚举"
        }
      },
      {
        "improvementId": "IM-016",
        "title": "conventions 与回执模板仍保留旧「不自动 commit/push」口径，未对齐 §6.1 分层",
        "status": "done",
        "source": "review",
        "type": "standard",
        "layer": "adapter",
        "relatedTaskId": "AF-014",
        "evidence": [
          "docs/team/conventions.md#132",
          "docs/team/agent-orchestration/relay-receipt-template.md#68"
        ],
        "impact": "两处活规范仍写「提交推送等用户指令」，与 README/角色卡/模板已落地的 L1–L3 自动 + L4 冻结口径并存，消费方可能读到旧口径造成边界漂移",
        "suggestion": "另开规范同步单：conventions §1.4 提交纪律与回执模板 commit 草稿条目改为引用设计备忘 §6.1 分层口径；executor 不提交口径保留，L1–L3 自动前置条件与 L4 冻结清单指向 §6.1",
        "historyCount": 4,
        "lastTransition": {
          "at": "2026-11-15T18:28:46.369Z",
          "by": "orchestrator-cli",
          "to": "done",
          "note": "conventions§132与回执模板§68已对齐§6.1分层口径"
        }
      },
      {
        "improvementId": "IM-017",
        "title": "熔断阈值参数化与通道独立计数预留(P2)",
        "status": "candidate",
        "source": "review",
        "type": "guardrail",
        "layer": "framework",
        "relatedTaskId": "AF-015",
        "evidence": [
          "reliability.md§5;design-memo§3.5"
        ],
        "impact": "框架§5熔断/死信为本版本预留位;通道侧不独立计数;接入通用阈值参数化归P2",
        "suggestion": "P2复用框架熔断扩展位,落地连续失败阈值与快速失败事件;不另立通道独立熔断",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T18:29:06.350Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-018",
        "title": "L3合并接远端CI状态门禁(无gh/token,P2)",
        "status": "candidate",
        "source": "review",
        "type": "gap",
        "layer": "adapter",
        "relatedTaskId": "AF-015",
        "evidence": [
          "design-memo§6.2"
        ],
        "impact": "本机无gh CLI与GITHUB_TOKEN,CI状态本机不可读;当前以本地等价闸门替代远端CI门禁,属过渡方案",
        "suggestion": "接入token/gh后改为以CI状态作为L3自动合并门禁;过渡口径标注目标态不固化为永久设计",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T18:29:06.582Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      },
      {
        "improvementId": "IM-019",
        "title": "development分支退役执行待人工拍板",
        "status": "candidate",
        "source": "review",
        "type": "gap",
        "layer": "adapter",
        "relatedTaskId": "AF-015",
        "evidence": [
          "design-memo§4.4"
        ],
        "impact": "退役需删除本地与远端development分支;高风险不可逆动作,须人工确认git-diff为空后执行",
        "suggestion": "人工拍板后按§4.4流程复核integrate..development为空再删除;本批不执行分支删除",
        "historyCount": 1,
        "lastTransition": {
          "at": "2026-11-15T18:29:06.841Z",
          "by": "orchestrator-cli",
          "to": "candidate",
          "note": "登记候选改进"
        }
      }
    ]
  },
  "deliveryPacks": [
    {
      "fileName": "pack-20261115-225603.json",
      "ref": "docs/team/agent-orchestration/delivery-packs/pack-20261115-225603.json",
      "generatedAt": "2026-11-15T14:56:03.135Z",
      "taskResults": 4,
      "deadLetters": 0,
      "openItems": 0,
      "pendingApprovals": 0
    }
  ],
  "agentCards": [
    {
      "agentId": "AGENT-EXEC-001",
      "role": "executor",
      "availability": "available",
      "skills": [
        "implementation",
        "gate-evidence",
        "deviation-reporting",
        "self-test"
      ],
      "tools": [
        "workspace-read",
        "workspace-write",
        "gate-execution"
      ],
      "note": "执行 AI（MiniMax Code）；researcher / critic 角色当前未启用，需要调研或独立评审任务时再绑定。本角色不进入分支与提交链路：L1 任务分支提交由验收后的 orchestrator 完成（设计备忘 §6.1）。"
    },
    {
      "agentId": "AGENT-HUMAN-001",
      "role": "human",
      "availability": "available",
      "skills": [
        "goal-setting",
        "policy-approval",
        "arbitration",
        "release-decision"
      ],
      "tools": [],
      "note": "本项目唯一人类角色（用户 / 大炮）；是 L4 冻结动作的审批节点，本身不进入工具白名单。L1 任务分支提交、L2 推任务分支、L3 合并进 integrate 在前置条件满足下由 orchestrator 自动，不依赖本角色批准（设计备忘 §6.1）。"
    },
    {
      "agentId": "AGENT-ORCH-001",
      "role": "orchestrator",
      "availability": "available",
      "skills": [
        "queue-management",
        "task-decomposition",
        "claim-management",
        "acceptance-organization",
        "index-maintenance",
        "evidence-review",
        "improvement-tracking"
      ],
      "tools": [
        "state-persistence",
        "queue-scheduler",
        "acceptance-gate",
        "delivery-packing",
        "knowledge-capture",
        "orchestration-cli"
      ],
      "note": "主控 AI（Doubao）；兼任 reviewer。制衡：验收结论只能基于工件证据与抽跑复现，不引用执行侧「已通过」的自述；验收与执行由不同执行方承担，兼任时以证据复核隔离。发布分层：L1–L3 在前置条件满足下由本角色自动，L4 转 Human 批准（设计备忘 §6.1）。"
    }
  ],
  "toolContracts": [
    {
      "toolId": "TOOL-STATE-STORE",
      "category": "state-persistence",
      "sideEffect": "restricted-write",
      "allowedRoles": [
        "orchestrator"
      ],
      "description": "状态索引与附加运行态的原子读写、租约字段管理；store 抽象隔离，后续可替换为 DB 持久化。"
    },
    {
      "toolId": "TOOL-ACCEPTANCE-RUNNER",
      "category": "acceptance-gate",
      "sideEffect": "read-only",
      "allowedRoles": [
        "orchestrator",
        "reviewer"
      ],
      "description": "V1–V6 机读护栏：工件存在性与非空、指针可达、链接可达、编码、结构断言；输出三级结论与人工复核清单。"
    },
    {
      "toolId": "TOOL-QUEUE-SCHEDULER",
      "category": "queue-scheduler",
      "sideEffect": "restricted-write",
      "allowedRoles": [
        "orchestrator"
      ],
      "description": "队列扫描、领单租约、超时释放、验收驱动状态迁移、返修提案与限次、死信隔离、队列快照生成。"
    },
    {
      "toolId": "TOOL-DELIVERY-PACK",
      "category": "delivery-packing",
      "sideEffect": "restricted-write",
      "allowedRoles": [
        "orchestrator"
      ],
      "description": "汇总夜间交付包：验收结论、证据指针、死信任务、遗留项与待人工批准动作。"
    },
    {
      "toolId": "TOOL-IMPROVEMENT-LOG",
      "category": "knowledge-capture",
      "sideEffect": "restricted-write",
      "allowedRoles": [
        "orchestrator"
      ],
      "description": "候选改进台账：实现 / 验收 / 返修 / 死信复盘 / 评审发现的缺口与架构提升点结构化登记、去重、状态流转与汇总；抽取只产生候选，立项与终态须人工闸门流转。"
    },
    {
      "toolId": "TOOL-ORCH-CLI",
      "category": "orchestration-cli",
      "sideEffect": "restricted-write",
      "allowedRoles": [
        "orchestrator"
      ],
      "description": "编排工具链命令入口：status / run-once / snapshot / pack / config；不直接操作桌面 GUI，桌面派发与回执衔接由执行代理单元在调度间隙完成。"
    }
  ],
  "toolAudits": [
    {
      "auditId": "AUD-010",
      "recordedAt": "2026-11-15T18:33:41.024Z",
      "actorRef": "orchestrator",
      "correlationId": "archive:AF-015",
      "toolId": "TOOL-QUEUE-SCHEDULER",
      "category": "queue-scheduler",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/task-state-index.json",
        "docs/team/agent-orchestration/orchestration-state.json",
        "docs/team/agent-orchestration/orchestration-snapshot.json"
      ]
    },
    {
      "auditId": "AUD-009",
      "recordedAt": "2026-11-15T18:14:37.253Z",
      "actorRef": "orchestrator",
      "correlationId": "archive:AF-014",
      "toolId": "TOOL-QUEUE-SCHEDULER",
      "category": "queue-scheduler",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/task-state-index.json",
        "docs/team/agent-orchestration/orchestration-state.json",
        "docs/team/agent-orchestration/orchestration-snapshot.json"
      ]
    },
    {
      "auditId": "AUD-008",
      "recordedAt": "2026-11-15T18:08:26.377Z",
      "actorRef": "orchestrator",
      "correlationId": "archive:AF-013",
      "toolId": "TOOL-QUEUE-SCHEDULER",
      "category": "queue-scheduler",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/task-state-index.json",
        "docs/team/agent-orchestration/orchestration-state.json",
        "docs/team/agent-orchestration/orchestration-snapshot.json"
      ]
    },
    {
      "auditId": "AUD-007",
      "recordedAt": "2026-11-15T17:50:02.805Z",
      "actorRef": "orchestrator",
      "correlationId": "archive:AF-012",
      "toolId": "TOOL-QUEUE-SCHEDULER",
      "category": "queue-scheduler",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/task-state-index.json",
        "docs/team/agent-orchestration/orchestration-state.json",
        "docs/team/agent-orchestration/orchestration-snapshot.json"
      ]
    },
    {
      "auditId": "AUD-006",
      "recordedAt": "2026-11-15T17:42:18.346Z",
      "actorRef": "orchestrator",
      "correlationId": "archive:AF-011",
      "toolId": "TOOL-QUEUE-SCHEDULER",
      "category": "queue-scheduler",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/task-state-index.json",
        "docs/team/agent-orchestration/orchestration-state.json",
        "docs/team/agent-orchestration/orchestration-snapshot.json"
      ]
    },
    {
      "auditId": "AUD-005",
      "recordedAt": "2026-11-15T17:31:16.686Z",
      "actorRef": "orchestrator",
      "correlationId": "archive:AF-010",
      "toolId": "TOOL-QUEUE-SCHEDULER",
      "category": "queue-scheduler",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/task-state-index.json",
        "docs/team/agent-orchestration/orchestration-state.json",
        "docs/team/agent-orchestration/orchestration-snapshot.json"
      ]
    },
    {
      "auditId": "AUD-004",
      "recordedAt": "2026-11-15T17:22:11.954Z",
      "actorRef": "orchestrator",
      "correlationId": "archive:AF-009",
      "toolId": "TOOL-QUEUE-SCHEDULER",
      "category": "queue-scheduler",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/task-state-index.json",
        "docs/team/agent-orchestration/orchestration-state.json",
        "docs/team/agent-orchestration/orchestration-snapshot.json"
      ]
    },
    {
      "auditId": "AUD-003",
      "recordedAt": "2026-11-15T16:06:25.786Z",
      "actorRef": "orchestrator",
      "correlationId": "run-once",
      "toolId": "TOOL-QUEUE-SCHEDULER",
      "category": "queue-scheduler",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/task-state-index.json",
        "docs/team/agent-orchestration/orchestration-state.json",
        "docs/team/agent-orchestration/orchestration-snapshot.json"
      ]
    },
    {
      "auditId": "AUD-002",
      "recordedAt": "2026-11-15T16:06:21.674Z",
      "actorRef": "orchestrator",
      "correlationId": "pack",
      "toolId": "TOOL-DELIVERY-PACK",
      "category": "delivery-packing",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/delivery-packs/"
      ]
    },
    {
      "auditId": "AUD-001",
      "recordedAt": "2026-11-15T15:09:17.483Z",
      "actorRef": "orchestrator",
      "correlationId": "snapshot",
      "toolId": "TOOL-STATE-STORE",
      "category": "state-persistence",
      "sideEffect": "restricted-write",
      "taskId": null,
      "result": "allowed",
      "reason": null,
      "resources": [
        "docs/team/agent-orchestration/task-state-index.json",
        "docs/team/agent-orchestration/orchestration-state.json"
      ]
    }
  ],
  "auditSummary": {
    "total": 10,
    "byResult": {
      "allowed": 10,
      "denied": 0
    },
    "byTool": {
      "TOOL-STATE-STORE": 1,
      "TOOL-DELIVERY-PACK": 1,
      "TOOL-QUEUE-SCHEDULER": 8
    },
    "byActor": {
      "orchestrator": 10
    }
  },
  "protocolView": {
    "tasks": [
      {
        "taskId": "TD-5",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td5-type-debt-clearing-task-2026-11-13.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td5-type-debt-clearing-implementation-2026-11-13.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-6",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td6-contract-evolution-review-task-2026-11-13.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td6-contract-evolution-review-implementation-2026-11-13.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-7",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td7-contract-drift-remediation-task-2026-11-13.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td7-contract-drift-remediation-implementation-2026-11-13.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-8",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-task-2026-11-13.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-9",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-task-2026-11-13.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-10",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td10-test-structure-debt-reduction-task-2026-11-13.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td10-test-structure-debt-reduction-implementation-2026-11-13.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-11",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-task-2026-11-14.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-12",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td12-coverage-threshold-gate-task-2026-11-14.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td12-coverage-threshold-gate-implementation-2026-11-14.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-13",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-task-2026-11-14.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-14",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-task-2026-11-14.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-implementation-2026-11-14.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-15",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td15-enum-extraction-cplus-task-2026-11-14.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td15-enum-extraction-cplus-implementation-2026-11-14.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-16",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-task-2026-11-14.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-20261114-1524.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-17",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-task-2026-11-14.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-implementation-2026-11-14.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-20261114-1719.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-18",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td18-good-state-diary-port-c2-batch2-task-2026-11-14.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td18-good-state-diary-port-c2-batch2-implementation-2026-11-14.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-20261114-1818.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-19",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-task-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-implementation-2026-11-15.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-20261115-0227.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-20",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td20-home-messages-moodlog-port-c2-batch4-task-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td20-home-messages-moodlog-port-c2-batch4-implementation-2026-11-15.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-20261115-0346.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "TD-21",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-task-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-implementation-2026-11-15.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-20261115-1211.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-001",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af001-framework-bootstrap-task-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af001-framework-bootstrap-implementation-2026-11-15.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-af001-20261115.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-002",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": null
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af002-framework-adapter-decoupling-implementation-2026-11-15.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-003",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af003-framework-finalization-task-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af003-framework-finalization-implementation-2026-11-15.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-20261115-1533.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-004",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af004-framework-hardening-task-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af004-framework-hardening-implementation-2026-11-15.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-20261115-1616.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-005",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af005-framework-evolution-watcher-state-machine-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-006",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af006-framework-evolution-validation-scripts-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-007",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af007-framework-evolution-tool-standardization-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-008",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af008-framework-evolution-agent-protocol-mapping-2026-11-15.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-009",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af009-handover-contract-schema-transport-2026-11-16.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af009-handover-contract-schema-transport-implementation-2026-11-16.md"
          },
          {
            "kind": "reply",
            "ref": null
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-010",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af010-dispatch-wiring-receipt-watcher-2026-11-16.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af010-dispatch-wiring-receipt-watcher-implementation-2026-11-16.md"
          },
          {
            "kind": "reply",
            "ref": null
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-011",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af011-file-scope-mutex-validation-2026-11-16.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af011-file-scope-mutex-validation-implementation-2026-11-16.md"
          },
          {
            "kind": "reply",
            "ref": null
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-012",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af012-task-branch-workflow-scripts-2026-11-16.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af012-task-branch-workflow-scripts-implementation-2026-11-16.md"
          },
          {
            "kind": "reply",
            "ref": null
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-013",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af013-gui-dispatch-readonly-drill-2026-11-16.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af013-gui-dispatch-readonly-drill-implementation-2026-11-16.md"
          },
          {
            "kind": "reply",
            "ref": "docs/worklog/pending/archive/relay-response-af013-drill-20261116.md"
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-014",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af014-release-layer-policy-doc-sync-2026-11-16.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af014-release-layer-policy-doc-sync-implementation-2026-11-16.md"
          },
          {
            "kind": "reply",
            "ref": null
          }
        ],
        "archived": true
      },
      {
        "taskId": "AF-015",
        "title": null,
        "type": null,
        "status": {
          "framework": "completed",
          "protocol": "COMPLETED",
          "stage": "terminal"
        },
        "groupId": null,
        "requiredSkills": [],
        "dependsOn": [],
        "agentRole": null,
        "artifactReferences": [
          {
            "kind": "taskSheet",
            "ref": "docs/worklog/completed/phase2.5/af015-channel-reliability-policy-anchor-2026-11-16.md"
          },
          {
            "kind": "deliveryRecord",
            "ref": "docs/worklog/completed/phase2.5/af015-channel-reliability-policy-anchor-implementation-2026-11-16.md"
          }
        ],
        "archived": true
      }
    ],
    "statusMap": {
      "backlog": "DRAFT",
      "ready": "QUEUED",
      "submitted": "SUBMITTED",
      "working": "WORKING",
      "input-required": "INPUT_REQUIRED",
      "auth-required": "AUTH_REQUIRED",
      "completed": "COMPLETED",
      "failed": "FAILED",
      "canceled": "CANCELED",
      "rejected": "REJECTED"
    },
    "artifacts": [
      {
        "taskId": "TD-5",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td5-type-debt-clearing-task-2026-11-13.md"
      },
      {
        "taskId": "TD-5",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td5-type-debt-clearing-implementation-2026-11-13.md"
      },
      {
        "taskId": "TD-6",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td6-contract-evolution-review-task-2026-11-13.md"
      },
      {
        "taskId": "TD-6",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td6-contract-evolution-review-implementation-2026-11-13.md"
      },
      {
        "taskId": "TD-7",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td7-contract-drift-remediation-task-2026-11-13.md"
      },
      {
        "taskId": "TD-7",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td7-contract-drift-remediation-implementation-2026-11-13.md"
      },
      {
        "taskId": "TD-8",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-task-2026-11-13.md"
      },
      {
        "taskId": "TD-8",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md"
      },
      {
        "taskId": "TD-9",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-task-2026-11-13.md"
      },
      {
        "taskId": "TD-9",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md"
      },
      {
        "taskId": "TD-10",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td10-test-structure-debt-reduction-task-2026-11-13.md"
      },
      {
        "taskId": "TD-10",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td10-test-structure-debt-reduction-implementation-2026-11-13.md"
      },
      {
        "taskId": "TD-11",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-task-2026-11-14.md"
      },
      {
        "taskId": "TD-11",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md"
      },
      {
        "taskId": "TD-12",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td12-coverage-threshold-gate-task-2026-11-14.md"
      },
      {
        "taskId": "TD-12",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td12-coverage-threshold-gate-implementation-2026-11-14.md"
      },
      {
        "taskId": "TD-13",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-task-2026-11-14.md"
      },
      {
        "taskId": "TD-13",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md"
      },
      {
        "taskId": "TD-14",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-task-2026-11-14.md"
      },
      {
        "taskId": "TD-14",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-implementation-2026-11-14.md"
      },
      {
        "taskId": "TD-15",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td15-enum-extraction-cplus-task-2026-11-14.md"
      },
      {
        "taskId": "TD-15",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td15-enum-extraction-cplus-implementation-2026-11-14.md"
      },
      {
        "taskId": "TD-16",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-task-2026-11-14.md"
      },
      {
        "taskId": "TD-16",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md"
      },
      {
        "taskId": "TD-16",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-20261114-1524.md"
      },
      {
        "taskId": "TD-17",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-task-2026-11-14.md"
      },
      {
        "taskId": "TD-17",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-implementation-2026-11-14.md"
      },
      {
        "taskId": "TD-17",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-20261114-1719.md"
      },
      {
        "taskId": "TD-18",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td18-good-state-diary-port-c2-batch2-task-2026-11-14.md"
      },
      {
        "taskId": "TD-18",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td18-good-state-diary-port-c2-batch2-implementation-2026-11-14.md"
      },
      {
        "taskId": "TD-18",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-20261114-1818.md"
      },
      {
        "taskId": "TD-19",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-task-2026-11-15.md"
      },
      {
        "taskId": "TD-19",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-implementation-2026-11-15.md"
      },
      {
        "taskId": "TD-19",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-20261115-0227.md"
      },
      {
        "taskId": "TD-20",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td20-home-messages-moodlog-port-c2-batch4-task-2026-11-15.md"
      },
      {
        "taskId": "TD-20",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td20-home-messages-moodlog-port-c2-batch4-implementation-2026-11-15.md"
      },
      {
        "taskId": "TD-20",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-20261115-0346.md"
      },
      {
        "taskId": "TD-21",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-task-2026-11-15.md"
      },
      {
        "taskId": "TD-21",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-implementation-2026-11-15.md"
      },
      {
        "taskId": "TD-21",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-20261115-1211.md"
      },
      {
        "taskId": "AF-001",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af001-framework-bootstrap-task-2026-11-15.md"
      },
      {
        "taskId": "AF-001",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af001-framework-bootstrap-implementation-2026-11-15.md"
      },
      {
        "taskId": "AF-001",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-af001-20261115.md"
      },
      {
        "taskId": "AF-002",
        "kind": "taskSheet",
        "ref": null
      },
      {
        "taskId": "AF-002",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af002-framework-adapter-decoupling-implementation-2026-11-15.md"
      },
      {
        "taskId": "AF-003",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af003-framework-finalization-task-2026-11-15.md"
      },
      {
        "taskId": "AF-003",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af003-framework-finalization-implementation-2026-11-15.md"
      },
      {
        "taskId": "AF-003",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-20261115-1533.md"
      },
      {
        "taskId": "AF-004",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af004-framework-hardening-task-2026-11-15.md"
      },
      {
        "taskId": "AF-004",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af004-framework-hardening-implementation-2026-11-15.md"
      },
      {
        "taskId": "AF-004",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-20261115-1616.md"
      },
      {
        "taskId": "AF-005",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af005-framework-evolution-watcher-state-machine-2026-11-15.md"
      },
      {
        "taskId": "AF-005",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md"
      },
      {
        "taskId": "AF-006",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af006-framework-evolution-validation-scripts-2026-11-15.md"
      },
      {
        "taskId": "AF-006",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md"
      },
      {
        "taskId": "AF-007",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af007-framework-evolution-tool-standardization-2026-11-15.md"
      },
      {
        "taskId": "AF-007",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md"
      },
      {
        "taskId": "AF-008",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af008-framework-evolution-agent-protocol-mapping-2026-11-15.md"
      },
      {
        "taskId": "AF-008",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md"
      },
      {
        "taskId": "AF-009",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af009-handover-contract-schema-transport-2026-11-16.md"
      },
      {
        "taskId": "AF-009",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af009-handover-contract-schema-transport-implementation-2026-11-16.md"
      },
      {
        "taskId": "AF-009",
        "kind": "reply",
        "ref": null
      },
      {
        "taskId": "AF-010",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af010-dispatch-wiring-receipt-watcher-2026-11-16.md"
      },
      {
        "taskId": "AF-010",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af010-dispatch-wiring-receipt-watcher-implementation-2026-11-16.md"
      },
      {
        "taskId": "AF-010",
        "kind": "reply",
        "ref": null
      },
      {
        "taskId": "AF-011",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af011-file-scope-mutex-validation-2026-11-16.md"
      },
      {
        "taskId": "AF-011",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af011-file-scope-mutex-validation-implementation-2026-11-16.md"
      },
      {
        "taskId": "AF-011",
        "kind": "reply",
        "ref": null
      },
      {
        "taskId": "AF-012",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af012-task-branch-workflow-scripts-2026-11-16.md"
      },
      {
        "taskId": "AF-012",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af012-task-branch-workflow-scripts-implementation-2026-11-16.md"
      },
      {
        "taskId": "AF-012",
        "kind": "reply",
        "ref": null
      },
      {
        "taskId": "AF-013",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af013-gui-dispatch-readonly-drill-2026-11-16.md"
      },
      {
        "taskId": "AF-013",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af013-gui-dispatch-readonly-drill-implementation-2026-11-16.md"
      },
      {
        "taskId": "AF-013",
        "kind": "reply",
        "ref": "docs/worklog/pending/archive/relay-response-af013-drill-20261116.md"
      },
      {
        "taskId": "AF-014",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af014-release-layer-policy-doc-sync-2026-11-16.md"
      },
      {
        "taskId": "AF-014",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af014-release-layer-policy-doc-sync-implementation-2026-11-16.md"
      },
      {
        "taskId": "AF-014",
        "kind": "reply",
        "ref": null
      },
      {
        "taskId": "AF-015",
        "kind": "taskSheet",
        "ref": "docs/worklog/completed/phase2.5/af015-channel-reliability-policy-anchor-2026-11-16.md"
      },
      {
        "taskId": "AF-015",
        "kind": "deliveryRecord",
        "ref": "docs/worklog/completed/phase2.5/af015-channel-reliability-policy-anchor-implementation-2026-11-16.md"
      }
    ],
    "groupId": null,
    "groupIds": [],
    "capabilityDeclarations": [
      {
        "agentId": "AGENT-EXEC-001",
        "role": "executor",
        "skills": [
          "implementation",
          "gate-evidence",
          "deviation-reporting",
          "self-test"
        ],
        "tools": [
          "workspace-read",
          "workspace-write",
          "gate-execution"
        ],
        "resources": [],
        "limits": null,
        "availability": "available"
      },
      {
        "agentId": "AGENT-HUMAN-001",
        "role": "human",
        "skills": [
          "goal-setting",
          "policy-approval",
          "arbitration",
          "release-decision"
        ],
        "tools": [],
        "resources": [],
        "limits": null,
        "availability": "available"
      },
      {
        "agentId": "AGENT-ORCH-001",
        "role": "orchestrator",
        "skills": [
          "queue-management",
          "task-decomposition",
          "claim-management",
          "acceptance-organization",
          "index-maintenance",
          "evidence-review",
          "improvement-tracking"
        ],
        "tools": [
          "state-persistence",
          "queue-scheduler",
          "acceptance-gate",
          "delivery-packing",
          "knowledge-capture",
          "orchestration-cli"
        ],
        "resources": [],
        "limits": null,
        "availability": "available"
      }
    ]
  },
  "webRefresh": {
    "enabled": true,
    "intervalMs": 3000
  },
  "archivedCount": 32
};
