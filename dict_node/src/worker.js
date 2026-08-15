// ECO 共享 NPC 词库 — Cloudflare Worker + D1
// 接口:
//   GET  /pull?lang=zh-CN&since=<ts>&limit=5000   拉取 ts 之后的词条(增量)
//   lang 对英文原文仍是目标语言(zh-CN)；日文/印尼文用 zh-CN-ja / zh-CN-id 隔离
//   POST /contribute  {lang, token, items:[{k,v,model}]}   上报新词条(先到先得)
//   GET  /stats?lang=zh-CN                         统计
// 鉴权: 若设置了 secret TOKEN, 则读写都要带对应 token(pull 用 ?token=, contribute 放 body)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", ...CORS },
  });
}

function checkToken(env, provided) {
  if (!env.TOKEN) return true;            // 没配 TOKEN = 开放(开发用)
  return provided === env.TOKEN;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/pull" && request.method === "GET") return await pull(url, env);
      if (url.pathname === "/contribute" && request.method === "POST") return await contribute(request, env);
      if (url.pathname === "/stats" && request.method === "GET") return await stats(url, env);
      if (url.pathname === "/") return json({ ok: true, service: "eco-npc-dict" });
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

async function pull(url, env) {
  if (!checkToken(env, url.searchParams.get("token"))) return json({ error: "bad token" }, 401);
  const lang = url.searchParams.get("lang") || "zh-CN";
  const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
  let limit = parseInt(url.searchParams.get("limit") || "5000", 10) || 5000;
  if (limit > 5000) limit = 5000;
  const rows = (await env.DB
    .prepare("SELECT k,v,ts FROM entries WHERE lang=?1 AND ts>?2 ORDER BY ts ASC LIMIT ?3")
    .bind(lang, since, limit).all()).results || [];
  const entries = {};
  let cursor = since;
  for (const r of rows) { entries[r.k] = r.v; if (r.ts > cursor) cursor = r.ts; }
  return json({ entries, cursor, count: rows.length, more: rows.length === limit });
}

async function contribute(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!checkToken(env, body.token)) return json({ error: "bad token" }, 401);
  const lang = (body.lang || "zh-CN").slice(0, 16);
  const items = Array.isArray(body.items) ? body.items : [];
  const maxItems = parseInt(env.MAX_ITEMS || "500", 10);
  const maxLen = parseInt(env.MAX_LEN || "4000", 10);
  if (items.length === 0) return json({ inserted: 0 });
  if (items.length > maxItems) return json({ error: `too many items (>${maxItems})` }, 413);

  const now = Date.now();
  const stmt = env.DB.prepare("INSERT OR IGNORE INTO entries (lang,k,v,model,ts) VALUES (?1,?2,?3,?4,?5)");
  const batch = [];
  for (const it of items) {
    const k = (it && it.k || "").toString();
    const v = (it && it.v || "").toString();
    if (!k || !v || k.length > maxLen || v.length > maxLen) continue;   // 基本校验, 挡脏数据
    const model = (it && it.model || "").toString().slice(0, 64);
    batch.push(stmt.bind(lang, k, v, model, now));
  }
  if (batch.length === 0) return json({ inserted: 0 });
  const res = await env.DB.batch(batch);
  const inserted = res.reduce((a, r) => a + ((r.meta && r.meta.changes) || 0), 0);
  return json({ inserted, received: batch.length });
}

async function stats(url, env) {
  const lang = url.searchParams.get("lang") || "zh-CN";
  const row = (await env.DB
    .prepare("SELECT COUNT(*) AS n, MAX(ts) AS last FROM entries WHERE lang=?1")
    .bind(lang).first());
  return json({ lang, total: (row && row.n) || 0, last: (row && row.last) || 0 });
}
