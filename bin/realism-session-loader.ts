// V2026-11-21 建立 (AF-227 · 真人度评分共享会话加载):
//   职责: 从 debug-sessions JSON 读取可评分会话，归一角色与场景。
//   边界: 纯读文件, 不联网、不写库、不启动服务；不输出台词原文。

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolveDebugRealismScene } from './realism-scene-loader.js';
import type { RealismScene } from '../src/shared/realism/turn-shape-selector.js';

export interface LoadedSession {
  readonly sessionId: string;
  readonly scene?: RealismScene;
  readonly prompt?: string | null;
  readonly messages: readonly { readonly role: 'counselor' | 'visitor'; readonly text: string }[];
}

function normalizeRole(raw: unknown): 'counselor' | 'visitor' | null {
  if (typeof raw !== 'string') return null;
  if (['visitor', 'client', '来访者', '来访'].includes(raw)) return 'visitor';
  if (['counselor', 'therapist', '咨询师', '咨询者'].includes(raw)) return 'counselor';
  return null;
}

/**
 * 读取目录下所有 debug-session JSON.
 *
 * 单文件解析失败直接跳过（与既有 CLI 一致），目录不存在抛错而非静默返回空。
 */
export function loadRealismSessions(dir: string): readonly LoadedSession[] {
  if (!existsSync(dir)) throw new Error(`源目录不存在：${dir}`);
  const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  const sessions: LoadedSession[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const root = parsed as Record<string, unknown>;
    const messagesRaw = root['messages'];
    if (!Array.isArray(messagesRaw)) continue;
    const messages: { role: 'counselor' | 'visitor'; text: string }[] = [];
    for (const item of messagesRaw) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      const role = normalizeRole(record['role']);
      const text = typeof record['text'] === 'string' ? record['text'] : '';
      if (role === null || text.trim().length === 0) continue;
      messages.push({ role, text });
    }
    const scene = resolveDebugRealismScene(root);
    const sessionId = String(root['id'] ?? file.replace(/\.json$/, ''));
    sessions.push({
      sessionId,
      scene,
      prompt: typeof root['prompt'] === 'string' ? root['prompt'] : null,
      messages,
    });
  }
  return sessions;
}
