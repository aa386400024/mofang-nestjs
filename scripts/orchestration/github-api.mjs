/** GitHub REST 最小客户端：复用安全凭据源，不打印 token，不写凭据文件。 */
import { resolveGithubTokenDetail } from './ci-status.mjs';

/**
 * @param {{path:string,method?:string,body?:object,token?:string|null,fetchImpl?:Function,apiBase?:string,env?:object}} opts
 * @returns {Promise<{ok:boolean,status:number,body:any,error:string|null}>}
 */
export async function githubRequest(opts = {}) {
  const env = opts.env ?? process.env;
  const resolved = opts.token ? { token: opts.token, hint: null } : resolveGithubTokenDetail({ env, fillCredential: opts.fillCredential });
  if (!resolved.token) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: `无 GitHub token${resolved.hint ? `；${resolved.hint}` : ''}`,
    };
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, status: 0, body: null, error: '运行环境无 fetch' };
  const apiBase = String(opts.apiBase ?? env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');
  try {
    const response = await fetchImpl(`${apiBase}${opts.path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `token ${resolved.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mofang-orchestration',
        ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body,
        error: `GitHub API ${response.status}：${body?.message ?? text ?? response.statusText}`,
      };
    }
    return { ok: true, status: response.status, body, error: null };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: `GitHub 请求失败：${error.message}` };
  }
}

export function unwrapGithub(response) {
  if (!response.ok) throw new Error(response.error ?? `GitHub API ${response.status}`);
  return response.body;
}
