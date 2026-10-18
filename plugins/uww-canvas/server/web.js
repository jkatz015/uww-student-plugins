'use strict';
/**
 * Web mode for the Canvas connector.
 *
 * Serves the same Canvas tools as the desktop plugin over HTTP, so the server
 * can run on Railway and be added to Claude as a custom connector. Loaded only
 * when server.js starts with --web; the desktop plugin never loads this file.
 * Zero dependencies, like server.js: node:http and node:crypto only.
 *
 * The lock is a small single-owner OAuth 2.1 sign-in, which is what Claude's
 * custom connectors are built around:
 *   1. Claude finds the sign-in through the protected resource metadata.
 *   2. Claude registers itself (Dynamic Client Registration).
 *   3. The owner types CANVAS_CONNECTOR_PASSWORD on a sign-in page.
 *   4. Claude swaps the one-time code (with PKCE) for an access token.
 *
 * Every client id, code and token is signed with a key derived from the
 * password instead of being stored, so the server keeps working after it
 * sleeps or restarts. Changing the password signs everyone out.
 *
 * Environment:
 *   PORT                       set by Railway (default 3000)
 *   CANVAS_CONNECTOR_PASSWORD  the owner's sign-in password, at least 16 characters
 *   CANVAS_TOKEN               the owner's Canvas access token (read by server.js)
 *   PUBLIC_URL                 optional fixed address, e.g. https://canvas.example.com;
 *                              otherwise RAILWAY_PUBLIC_DOMAIN, otherwise the Host header
 *   CANVAS_OAUTH_REDIRECTS     optional extra allowed redirect addresses, comma separated
 */

const http = require('node:http');
const crypto = require('node:crypto');

const ACCESS_SECONDS = 60 * 60;            // 1 hour; Claude refreshes on its own
const REFRESH_SECONDS = 30 * 24 * 60 * 60; // 30 days
const CODE_SECONDS = 5 * 60;
const SCOPE = 'canvas';
const MAX_BODY = 1024 * 1024;
// claude.ai on the web, Claude Desktop, mobile and Cowork all use this one.
const HOSTED_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOCK_AFTER = 10; // wrong passwords inside the window before sign-in pauses

const now = () => Math.floor(Date.now() / 1000);
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const rand = () => b64u(crypto.randomBytes(16));

function sameText(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function makeSigner(password) {
  const key = sha256('uww-canvas-web-v1\0' + password);
  const mac = (body) => crypto.createHmac('sha256', key).update(body).digest('base64url');
  return {
    sign(payload) {
      const body = b64u(JSON.stringify(payload));
      return body + '.' + mac(body);
    },
    // Returns the payload only if the signature, type and expiry all check out.
    open(token, typ) {
      if (typeof token !== 'string' || token.length > 4096) return null;
      const dot = token.lastIndexOf('.');
      if (dot < 1) return null;
      const body = token.slice(0, dot);
      if (!sameText(token.slice(dot + 1), mac(body))) return null;
      let p;
      try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
      if (!p || p.typ !== typ) return null;
      if (p.exp && p.exp < now()) return null;
      return p;
    },
  };
}

// Claude Code signs in through a loopback address on a random port, so the
// port is ignored for localhost and 127.0.0.1.
function redirectAllowed(uri, extra) {
  if (uri === HOSTED_CALLBACK || extra.includes(uri)) return true;
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
      u.pathname === '/callback' && !u.hash;
  } catch { return false; }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function signInPage({ fields, redirectHost, error }) {
  const hidden = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canvas connector sign-in</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f5f2; --card:#fff; --ink:#1d1d1b; --muted:#5f5d57; --line:#d9d6ce; --accent:#5a3fc0; --bad:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#191918; --card:#232321; --ink:#ecebe7; --muted:#a9a69e; --line:#3a3936; --accent:#a996ff; --bad:#ff8a80; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding:16px; }
  main { width:100%; max-width:400px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px 24px; }
  h1 { font-size:20px; margin:0 0 6px; }
  p { margin:0 0 16px; color:var(--muted); font-size:15px; }
  .to { color:var(--ink); font-weight:600; }
  label { display:block; font-weight:600; margin-bottom:6px; }
  input[type=password] { width:100%; padding:12px; font-size:16px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--ink); }
  .row { display:flex; gap:10px; margin-top:18px; }
  button { flex:1; padding:12px; font-size:16px; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--ink); cursor:pointer; }
  button.go { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  .error { color:var(--bad); font-weight:600; }
  .note { font-size:13px; margin-top:18px; margin-bottom:0; }
</style></head>
<body><main>
<h1>Connect your Canvas</h1>
<p>Approving lets <span class="to">${esc(redirectHost)}</span> read your courses, due dates, grades, modules and discussions through this connector. It cannot submit or post anything.</p>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/authorize">
${hidden}
<label for="pw">Connector password</label>
<input id="pw" type="password" name="password" autocomplete="current-password" autofocus>
<div class="row">
  <button type="submit" name="action" value="deny">Cancel</button>
  <button class="go" type="submit" name="action" value="approve">Approve</button>
</div>
</form>
<p class="note">The password is CANVAS_CONNECTOR_PASSWORD in your Railway service, under Variables.</p>
</main></body></html>`;
}

function startWeb({ handle, log, version, canvasUrl, hasToken }) {
  const password = process.env.CANVAS_CONNECTOR_PASSWORD || '';
  if (password.length < 16) {
    log('NOT STARTED: CANVAS_CONNECTOR_PASSWORD must be set and at least 16 characters long. Set it in the Railway service Variables.');
    process.exit(1);
  }
  if (!hasToken) {
    log('NOT STARTED: CANVAS_TOKEN is not set. Create a token in Canvas (Account > Settings > Approved Integrations > + New Access Token) and set it in the Railway service Variables.');
    process.exit(1);
  }
  if (!canvasUrl) {
    log('NOT STARTED: CANVAS_URL is not set, e.g. https://uwwtw.instructure.com');
    process.exit(1);
  }

  const signer = makeSigner(password);
  const passwordDigest = sha256(password);
  const extraRedirects = String(process.env.CANVAS_OAUTH_REDIRECTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const spent = new Map(); // one-time codes and rotated refresh tokens, by nonce -> expiry
  let failures = [];       // wrong-password timestamps

  const markSpent = (n, exp) => {
    const t = now();
    for (const [k, e] of spent) if (e < t) spent.delete(k);
    spent.set(n, exp);
  };

  function baseUrl(req) {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN;
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  }
  const resourceUrl = (req) => baseUrl(req) + '/mcp';
  const metadataUrl = (req) => baseUrl(req) + '/.well-known/oauth-protected-resource';
  const clientKey = (clientId) => b64u(sha256(clientId)).slice(0, 22);

  function reply(res, status, body, headers = {}) {
    const isText = typeof body === 'string';
    res.writeHead(status, {
      'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(isText ? body : JSON.stringify(body));
  }
  const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

  function html(res, status, page) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...noStore,
    });
    res.end(page);
  }

  function redirectTo(res, uri, params) {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
    res.writeHead(302, { Location: u.toString(), ...noStore });
    res.end();
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function readForm(req) {
    const raw = await readBody(req);
    if (String(req.headers['content-type'] || '').includes('application/json')) {
      try { return JSON.parse(raw) || {}; } catch { return {}; }
    }
    return Object.fromEntries(new URLSearchParams(raw));
  }

  /* ----- discovery ----- */

  function protectedResource(req, res) {
    reply(res, 200, {
      resource: resourceUrl(req),
      authorization_servers: [baseUrl(req)],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'UW-Whitewater Canvas',
    });
  }

  function authServer(req, res) {
    const base = baseUrl(req);
    reply(res, 200, {
      issuer: base,
      authorization_endpoint: base + '/authorize',
      token_endpoint: base + '/token',
      registration_endpoint: base + '/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE, 'offline_access'],
    });
  }

  /* ----- client registration ----- */

  async function register(req, res) {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return reply(res, 400, { error: 'invalid_client_metadata', error_description: 'Body must be JSON.' }, noStore); }
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10) return reply(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required.' }, noStore);
    const bad = uris.find((u) => !redirectAllowed(u, extraRedirects));
    if (bad) return reply(res, 400, { error: 'invalid_redirect_uri', error_description: `Redirect address not allowed: ${bad}` }, noStore);
    const issued = now();
    const clientId = signer.sign({ typ: 'client', r: uris, iat: issued });
    reply(res, 201, {
      client_id: clientId,
      client_id_issued_at: issued,
      client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : undefined,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, noStore);
  }

  /* ----- sign-in ----- */

  // Checks the request against the registered client. Returns { error } when the
  // problem must be shown on the page (never redirect to an unverified address).
  function checkAuthorize(q) {
    const client = signer.open(q.client_id, 'client');
    if (!client) return { error: 'This sign-in link is not valid. Remove the connector in Claude and add it again.' };
    let redirect = q.redirect_uri;
    if (!redirect && client.r.length === 1) redirect = client.r[0];
    if (!redirect || !client.r.includes(redirect) || !redirectAllowed(redirect, extraRedirects)) {
      return { error: 'The return address in this sign-in link does not match. Remove the connector in Claude and add it again.' };
    }
    if (q.response_type !== 'code') return { redirect, oauthError: 'unsupported_response_type' };
    if (!q.code_challenge || q.code_challenge_method !== 'S256') return { redirect, oauthError: 'invalid_request', description: 'PKCE with S256 is required.' };
    return { redirect };
  }

  const fieldsFrom = (q, redirect) => ({
    response_type: q.response_type, client_id: q.client_id, redirect_uri: redirect,
    code_challenge: q.code_challenge, code_challenge_method: q.code_challenge_method,
    state: q.state, scope: q.scope, resource: q.resource,
  });

  function authorizeGet(req, res, url) {
    const q = Object.fromEntries(url.searchParams);
    const c = checkAuthorize(q);
    if (c.error) return html(res, 400, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:16px system-ui;padding:16px">${esc(c.error)}</p>`);
    if (c.oauthError) return redirectTo(res, c.redirect, { error: c.oauthError, error_description: c.description, state: q.state });
    html(res, 200, signInPage({ fields: fieldsFrom(q, c.redirect), redirectHost: new URL(c.redirect).host }));
  }

  async function authorizePost(req, res) {
    const q = await readForm(req);
    const c = checkAuthorize(q);
    if (c.error) return html(res, 400, `<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:16px">${esc(c.error)}</p>`);
    if (c.oauthError) return redirectTo(res, c.redirect, { error: c.oauthError, error_description: c.description, state: q.state });
    const iss = baseUrl(req);
    if (q.action !== 'approve') return redirectTo(res, c.redirect, { error: 'access_denied', state: q.state, iss });

    const page = (error, status) => html(res, status, signInPage({ fields: fieldsFrom(q, c.redirect), redirectHost: new URL(c.redirect).host, error }));
    const t = Date.now();
    failures = failures.filter((f) => t - f < LOCK_WINDOW_MS);
    if (failures.length >= LOCK_AFTER) return page('Too many wrong passwords. Sign-in is paused for 15 minutes.', 429);
    if (!crypto.timingSafeEqual(sha256(String(q.password || '')), passwordDigest)) {
      failures.push(t);
      log('sign-in: wrong password');
      return page('That password is not right. Copy it from the Railway service Variables.', 401);
    }

    const code = signer.sign({
      typ: 'code', c: clientKey(q.client_id), r: c.redirect, ch: q.code_challenge,
      exp: now() + CODE_SECONDS, n: rand(),
    });
    log('sign-in: approved');
    redirectTo(res, c.redirect, { code, state: q.state, iss });
  }

  /* ----- tokens ----- */

  function issueTokens(req, res, cKey) {
    const access = signer.sign({ typ: 'access', c: cKey, aud: resourceUrl(req), exp: now() + ACCESS_SECONDS, n: rand() });
    const refresh = signer.sign({ typ: 'refresh', c: cKey, exp: now() + REFRESH_SECONDS, n: rand() });
    reply(res, 200, { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: SCOPE }, noStore);
  }

  async function token(req, res) {
    const q = await readForm(req);
    const fail = (status, error, description) => reply(res, status, { error, error_description: description }, noStore);
    if (!signer.open(q.client_id, 'client')) return fail(401, 'invalid_client', 'Unknown client.');
    const cKey = clientKey(q.client_id);

    if (q.grant_type === 'authorization_code') {
      const code = signer.open(q.code, 'code');
      if (!code || code.c !== cKey || spent.has(code.n)) return fail(400, 'invalid_grant', 'The code is not valid or was already used.');
      if (q.redirect_uri && q.redirect_uri !== code.r) return fail(400, 'invalid_grant', 'redirect_uri does not match.');
      if (!q.code_verifier || !sameText(b64u(sha256(String(q.code_verifier))), code.ch)) return fail(400, 'invalid_grant', 'PKCE check failed.');
      markSpent(code.n, code.exp);
      return issueTokens(req, res, cKey);
    }

    if (q.grant_type === 'refresh_token') {
      const rt = signer.open(q.refresh_token, 'refresh');
      if (!rt || rt.c !== cKey || spent.has(rt.n)) return fail(400, 'invalid_grant', 'The refresh token is not valid. Sign in again.');
      markSpent(rt.n, rt.exp); // rotate: each refresh token works once
      return issueTokens(req, res, cKey);
    }

    return fail(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  }

  /* ----- MCP endpoint ----- */

  function bearerOk(req) {
    const h = String(req.headers.authorization || '');
    if (!/^Bearer /i.test(h)) return 'missing';
    const at = signer.open(h.slice(7).trim(), 'access');
    if (!at || at.aud !== resourceUrl(req)) return 'invalid';
    return 'ok';
  }

  async function mcp(req, res) {
    const auth = bearerOk(req);
    if (auth !== 'ok') {
      const challenge = `Bearer resource_metadata="${metadataUrl(req)}", scope="${SCOPE}"` +
        (auth === 'invalid' ? ', error="invalid_token", error_description="Sign in again."' : '');
      return reply(res, 401, { error: auth === 'invalid' ? 'invalid_token' : 'unauthorized' }, { 'WWW-Authenticate': challenge });
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });

    let msg;
    try { msg = JSON.parse(await readBody(req)); } catch {
      return reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const one = async (m) => {
      try { return await handle(m); } catch (e) {
        log('handler crashed:', e.message);
        return m && m.id !== undefined ? { jsonrpc: '2.0', id: m.id, error: { code: -32603, message: e.message } } : undefined;
      }
    };
    const out = Array.isArray(msg) ? (await Promise.all(msg.map(one))).filter(Boolean) : await one(msg);
    if (!out || (Array.isArray(out) && !out.length)) { res.writeHead(202); return res.end(); } // notifications only
    reply(res, 200, out);
  }

  /* ----- routing ----- */

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://local'); } catch { return reply(res, 400, 'Bad request'); }
    const p = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (p === '/health') return reply(res, 200, { status: 'ok', version });
      if (p === '/' && req.method === 'GET') return reply(res, 200, `UW-Whitewater Canvas connector ${version} is running.\nAdd ${resourceUrl(req)} as a custom connector in Claude.\n`);
      if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp') return protectedResource(req, res);
      if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration') return authServer(req, res);
      if (p === '/register' && req.method === 'POST') return await register(req, res);
      if (p === '/authorize' && req.method === 'GET') return authorizeGet(req, res, url);
      if (p === '/authorize' && req.method === 'POST') return await authorizePost(req, res);
      if (p === '/token' && req.method === 'POST') return await token(req, res);
      if (p === '/mcp') return await mcp(req, res);
      return reply(res, 404, 'Not found');
    } catch (e) {
      log('request failed:', e.message);
      if (!res.headersSent) reply(res, e.message === 'too large' ? 413 : 500, { error: 'server_error' });
      else res.end();
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, '0.0.0.0', () => {
    log(`web mode ready — listening on port ${server.address().port}, Canvas ${canvasUrl}`);
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  return server;
}

module.exports = { startWeb, makeSigner, redirectAllowed };
