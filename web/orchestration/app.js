/* 编排队列只读视图。数据源：window.ORCH_SNAPSHOT（data.js，由 CLI 生成）。 */
(function () {
  'use strict';

  const snapshot = window.ORCH_SNAPSHOT || null;

  const STATUS_LABEL = {
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
    const order = ['ready', 'submitted', 'working', 'completed', 'failed', 'canceled', 'rejected', 'input-required', 'deadLetter'];
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

  function renderImprovements(snap) {
    const box = el('improvements');
    const imp = snap.improvements;
    if (!imp || imp.total === 0) {
      box.innerHTML = '<p class="empty">无候选改进。</p>';
      return;
    }
    const b = imp.byStatus;
    box.innerHTML = `<div class="list-text">活跃 ${imp.activeCount} / 总 ${imp.total}　·　候选 ${b.candidate}　排队 ${b.queued}　实现中 ${b.accepted}　完成 ${b.done}　不采纳 ${b.wontfix}</div>`;
  }

  function renderEmpty() {
    el('overview-cards').innerHTML = '<p class="empty">尚未生成快照。请先在仓库运行 <code>pnpm orchestration:snapshot</code>。</p>';
    el('task-list').innerHTML = '';
    el('dead-letters').innerHTML = '';
    el('rework-proposals').innerHTML = '';
    el('pending-approvals').innerHTML = '';
    el('improvements').innerHTML = '';
  }

  renderMode(snapshot);
  if (snapshot) {
    renderOverview(snapshot);
    renderTasks(snapshot);
    renderDeadLetters(snapshot);
    renderRework(snapshot);
    renderPending(snapshot);
    renderImprovements(snapshot);
  } else {
    renderEmpty();
  }
})();
