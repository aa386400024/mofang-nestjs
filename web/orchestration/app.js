/* 编排队列只读视图。数据源：window.ORCH_SNAPSHOT（data.js，由 CLI 生成）。 */
(function () {
  'use strict';

  const snapshot = window.ORCH_SNAPSHOT || null;

  const STATUS_LABEL = {
    backlog: '待立项',
    ready: '就绪',
    submitted: '已提交',
    working: '执行中',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
    rejected: '已打回',
    'input-required': '待输入',
    deadLetter: '死信',
  };

  const VERDICT_LABEL = {
    passed: '通过',
    'conditional-pass': '附条件通过',
    rejected: '打回',
  };

  const SOURCE_LABEL = {
    implementation: '实现',
    acceptance: '验收',
    rework: '返修',
    'dead-letter': '死信',
    review: '评审',
  };

  const TYPE_LABEL = {
    gap: '缺口',
    guardrail: '护栏',
    tool: '工具',
    standard: '规范',
    performance: '性能',
    'tech-debt': '技术债',
  };

  const LAYER_LABEL = { adapter: '适配层', framework: '通用层' };
  const IMP_STATUS_LABEL = { candidate: '候选', queued: '排队', accepted: '实现中', done: '已完成', wontfix: '不采纳' };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(id) {
    return document.getElementById(id);
  }

  function badge(kind, label, value) {
    return `<span class="badge badge-${kind} ${value || ''}">${escapeHtml(label)}</span>`;
  }

  function tag(text) {
    if (!text) return '';
    return `<span class="tag">${escapeHtml(text)}</span>`;
  }

  function renderMode(snap) {
    const pill = el('mode-pill');
    if (!snap) {
      pill.textContent = '未加载数据';
      return;
    }
    pill.textContent = snap.mode.autoLoopEnabled ? '自治模式 · 开启' : '自治模式 · 关闭';
    pill.className = `mode-pill ${snap.mode.autoLoopEnabled ? 'on' : 'off'}`;
  }

  function renderOverview(snap) {
    const cards = el('overview-cards');
    const counts = snap.counts || {};
    const order = ['backlog', 'ready', 'submitted', 'working', 'completed', 'failed', 'canceled', 'rejected', 'input-required', 'deadLetter'];
    cards.innerHTML = order
      .map((key) => {
        const n = counts[key] || 0;
        return `<div class="card card-${key}">
          <div class="card-num">${n}</div>
          <div class="card-label">${STATUS_LABEL[key]}</div>
        </div>`;
      })
      .join('');
    el('snapshot-meta').textContent = `生成时间：${snap.generatedAt}　·　已归档：${snap.archivedCount ?? 0}　·　返修上限：${snap.mode.reworkLimit}`;
  }

  function artifactRefs(artifacts) {
    return Object.entries(artifacts || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `<li><span class="ref-key">${escapeHtml(k)}</span> <code>${escapeHtml(v)}</code></li>`)
      .join('');
  }

  function renderTasks(snap) {
    const list = el('task-list');
    if (!snap.tasks || snap.tasks.length === 0) {
      list.innerHTML = '<p class="empty">当前无活跃任务。</p>';
      return;
    }
    list.innerHTML = snap.tasks
      .map((t, i) => {
        const verdict = t.verdict
          ? badge('verdict', VERDICT_LABEL[t.verdict] || t.verdict, t.verdict)
          : '<span class="badge badge-muted">未验收</span>';
        const detail = `
          <div class="task-detail">
            <div class="detail-row"><span class="ref-key">上下文</span> ${escapeHtml(t.contextId)}　·　类型 ${escapeHtml(t.type)}　·　返修次数 ${t.attemptCount}${t.reworkOf ? `　·　返修自 ${escapeHtml(t.reworkOf)}` : ''}</div>
            ${t.frozen ? '<div class="detail-row"><span class="ref-key">冻结</span> 命中冻结动作，待人工批准</div>' : ''}
            ${t.verdictRationale ? `<div class="detail-row"><span class="ref-key">结论依据</span> ${escapeHtml(t.verdictRationale)}</div>` : ''}
            <ul class="ref-list">${artifactRefs(t.artifacts)}</ul>
            ${(t.manualReview || []).length ? `<ul class="ref-list">${t.manualReview.map((m) => `<li>· ${escapeHtml(m)}</li>`).join('')}</ul>` : ''}
          </div>`;
        return `<div class="task-row">
          <button class="task-head" type="button" data-index="${i}" aria-expanded="false">
            ${badge('status', STATUS_LABEL[t.status] || t.status, t.status)}
            <span class="task-id">${escapeHtml(t.taskId)}</span>
            ${verdict}
            <span class="task-title">${escapeHtml(t.title)}</span>
          </button>
          ${detail}
        </div>`;
      })
      .join('');

    list.querySelectorAll('.task-head').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.task-row');
        const open = row.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }

  function renderDeadLetters(snap) {
    const box = el('dead-letters');
    if (!snap.deadLetters || snap.deadLetters.length === 0) {
      box.innerHTML = '<p class="empty">无死信。</p>';
      return;
    }
    box.innerHTML = snap.deadLetters
      .map((d) => {
        const evidence = (d.escalation && d.escalation.evidence) || [];
        return `<div class="list-item">
          <div class="list-title">${escapeHtml(d.taskId)}</div>
          <div class="list-text">${escapeHtml(d.escalation ? d.escalation.waiting : '待人工裁决')}</div>
          ${evidence.length ? `<ul class="ref-list">${evidence.map((e) => `<li>· ${escapeHtml(e)}</li>`).join('')}</ul>` : ''}
        </div>`;
      })
      .join('');
  }

  function renderRework(snap) {
    const box = el('rework-proposals');
    if (!snap.reworkProposals || snap.reworkProposals.length === 0) {
      box.innerHTML = '<p class="empty">无返修提案。</p>';
      return;
    }
    box.innerHTML = snap.reworkProposals
      .map((p) => `<div class="list-item">
        <div class="list-title">${escapeHtml(p.proposalId)}</div>
        <div class="list-text">自 ${escapeHtml(p.originalTaskId)}：${escapeHtml(p.rationale)}</div>
      </div>`)
      .join('');
  }

  function renderPending(snap) {
    const box = el('pending-approvals');
    if (!snap.pendingApprovals || snap.pendingApprovals.length === 0) {
      box.innerHTML = '<p class="empty">无待批动作。</p>';
      return;
    }
    box.innerHTML = snap.pendingApprovals
      .map((p) => `<div class="list-item">
        <div class="list-title">${escapeHtml(p.taskId)}</div>
        <div class="list-text">${escapeHtml(p.reason)}</div>
      </div>`)
      .join('');
  }

  function distributionLine(obj, labels) {
    return Object.entries(labels)
      .map(([key, label]) => `${label} ${obj[key] || 0}`)
      .join(' · ');
  }

  function renderImprovements(snap) {
    const box = el('improvements');
    const imp = snap.improvements;
    if (!imp || imp.total === 0) {
      box.innerHTML = '<p class="empty">无候选改进。</p>';
      return;
    }
    const b = imp.byStatus;
    const head = `<div class="list-text">活跃 ${imp.activeCount} / 总 ${imp.total}　·　候选 ${b.candidate}　排队 ${b.queued}　实现中 ${b.accepted}　完成 ${b.done}　不采纳 ${b.wontfix}</div>`;
    const typeLine = `<div class="meta">类型：${distributionLine(imp.byType || {}, TYPE_LABEL)}</div>`;
    const sourceLine = `<div class="meta">来源：${distributionLine(imp.bySource || {}, SOURCE_LABEL)}</div>`;
    const items = (imp.items || [])
      .map((it) => {
        const meta = [
          tag(SOURCE_LABEL[it.source] || it.source),
          tag(TYPE_LABEL[it.type] || it.type),
          tag(LAYER_LABEL[it.layer] || it.layer),
          it.relatedTaskId ? tag(`关联 ${it.relatedTaskId}`) : '',
        ]
          .filter(Boolean)
          .join('');
        const evidence = (it.evidence || []).length
          ? `<ul class="ref-list">${it.evidence.map((e) => `<li>· ${escapeHtml(e)}</li>`).join('')}</ul>`
          : '';
        const transition =
          it.lastTransition && it.lastTransition.to
            ? `<div class="meta">末次流转：${escapeHtml(IMP_STATUS_LABEL[it.lastTransition.to] || it.lastTransition.to)}（${escapeHtml(it.lastTransition.by || '')}）${it.lastTransition.note ? ` — ${escapeHtml(it.lastTransition.note)}` : ''}</div>`
            : '';
        const extra = [
          it.impact ? `<div class="meta">影响：${escapeHtml(it.impact)}</div>` : '',
          it.suggestion ? `<div class="meta">建议：${escapeHtml(it.suggestion)}</div>` : '',
          transition,
        ]
          .filter(Boolean)
          .join('');
        return `<div class="list-item">
          <div class="list-title">${badge('status', IMP_STATUS_LABEL[it.status] || it.status, it.status)} <span class="task-id">${escapeHtml(it.improvementId)}</span> ${escapeHtml(it.title)}</div>
          <div class="tags">${meta}</div>
          ${evidence}${extra}
        </div>`;
      })
      .join('');
    box.innerHTML = `${head}${typeLine}${sourceLine}<div class="panel-list imp-list">${items || '<p class="empty">无条目明细。</p>'}</div>`;
  }

  function renderDeliveryPacks(snap) {
    const box = el('delivery-packs');
    const packs = snap.deliveryPacks || [];
    if (packs.length === 0) {
      box.innerHTML = '<p class="empty">暂无交付包，运行 <code>pnpm orchestration:pack</code> 生成。</p>';
      return;
    }
    box.innerHTML = packs
      .map((p) => `<div class="list-item">
        <div class="list-title"><code>${escapeHtml(p.fileName)}</code></div>
        <div class="list-text">${escapeHtml(p.generatedAt ?? '—')}</div>
        <div class="meta">结论 ${p.taskResults}　死信 ${p.deadLetters}　遗留 ${p.openItems}　待批 ${p.pendingApprovals}</div>
      </div>`)
      .join('');
  }

  function renderAgentCards(snap) {
    const box = el('agent-cards');
    const cards = snap.agentCards || [];
    if (cards.length === 0) {
      box.innerHTML = '<p class="empty">无角色声明。</p>';
      return;
    }
    box.innerHTML = cards
      .map((c) => `<div class="list-item">
        <div class="list-title">${escapeHtml(c.role ?? c.agentId ?? '—')} ${badge('muted', c.availability ?? '', '')}</div>
        <div class="tags">${(c.skills || []).map(tag).join('')}</div>
        ${c.note ? `<div class="meta">${escapeHtml(c.note)}</div>` : ''}
      </div>`)
      .join('');
  }

  function renderToolContracts(snap) {
    const box = el('tool-contracts');
    const tools = snap.toolContracts || [];
    if (tools.length === 0) {
      box.innerHTML = '<p class="empty">无工具契约。</p>';
      return;
    }
    box.innerHTML = tools
      .map((t) => `<div class="list-item">
        <div class="list-title"><code>${escapeHtml(t.toolId)}</code> ${badge('muted', t.category ?? '', '')}</div>
        <div class="list-text">${escapeHtml(t.description ?? '')}</div>
        <div class="tags">${tag(t.sideEffect)} ${(t.allowedRoles || []).map(tag).join('')}</div>
      </div>`)
      .join('');
  }

  function renderEmpty() {
    el('overview-cards').innerHTML = '<p class="empty">尚未生成快照。请先在仓库运行 <code>pnpm orchestration:snapshot</code>。</p>';
    el('task-list').innerHTML = '';
    el('dead-letters').innerHTML = '';
    el('rework-proposals').innerHTML = '';
    el('pending-approvals').innerHTML = '';
    el('improvements').innerHTML = '';
    el('delivery-packs').innerHTML = '';
    el('agent-cards').innerHTML = '';
    el('tool-contracts').innerHTML = '';
  }

  renderMode(snapshot);
  if (snapshot) {
    renderOverview(snapshot);
    renderTasks(snapshot);
    renderDeadLetters(snapshot);
    renderRework(snapshot);
    renderPending(snapshot);
    renderImprovements(snapshot);
    renderDeliveryPacks(snapshot);
    renderAgentCards(snapshot);
    renderToolContracts(snapshot);
  } else {
    renderEmpty();
  }
})();
