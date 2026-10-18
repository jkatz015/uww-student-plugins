// Web mode of the Claude plugin (plugins/uww-canvas): sign-in, tokens, the MCP
// endpoint and the read-only tool set, plus a check that desktop mode is unchanged.
// Uses a local fake Canvas server; no real Canvas account or network access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const SERVER = path.resolve(__dirname, '../plugins/uww-canvas/server/server.js');
const PASSWORD = 'correct-horse-battery-staple-42';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

const ALL_TOOLS = [
  'canvas_download_course_files', 'canvas_download_file', 'canvas_get_assignment',
  'canvas_get_discussion', 'canvas_get_grades', 'canvas_list_assignments',
  'canvas_list_courses', 'canvas_list_discussions', 'canvas_list_modules',
  'canvas_post_discussion_reply', 'canvas_setup_status', 'canvas_submit_assignment',
  'canvas_upcoming',
];
const LOCAL_ONLY = ['canvas_download_course_files', 'canvas_download_file', 'canvas_post_discussion_reply', 'canvas_submit_assignment'];

function fakeCanvas(t) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/v1/courses')) {
      return res.end(JSON.stringify([{ id: 7, name: 'Fixture Course 860', course_code: 'FIX-860', workflow_state: 'available', term: { name: 'Fall 2026' } }]));
    }
    res.statusCode = 404; res.end('{}');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
    t.after(() => srv.close());
    resolve({ url: `http://127.0.0.1:${srv.address().port}`, seen });
  }));
}

function startWeb(t, env) {
  const child = spawn(process.execPath, [SERVER, '--web'], {
    env: { PATH: process.env.PATH, PORT: '0', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  t.after(() => child.kill());
  let log = '';
  return new Promise((resolve, reject) => {
    child.stderr.on('data', (d) => {
      log += d;
      const m = log.match(/listening on port (\d+)/);
      if (m) resolve({ base: `http://127.0.0.1:${m[1]}`, child });
    });
    child.on('exit', (code) => reject(Object.assign(new Error('exited ' + code), { code, log })));
  });
}

function exitCode(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER, '--web'], { env: { PATH: process.env.PATH, PORT: '0', ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    child.stderr.on('data', (d) => { log += d; });
    const timer = setTimeout(() => child.kill(), 5000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, log }); });
  });
}

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};
const form = (o) => new URLSearchParams(o).toString();
const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };

async function register(base, uris = [CALLBACK]) {
  const r = await fetch(base + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: uris }) });
  return { status: r.status, body: await r.json() };
}

async function signIn(base, clientId, challenge, password = PASSWORD, action = 'approve') {
  return fetch(base + '/authorize', {
    method: 'POST', redirect: 'manual', headers: formHeaders,
    body: form({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'canvas', action, password }),
  });
}

async function connect(base) {
  const { body: client } = await register(base);
  const { verifier, challenge } = pkce();
  const loc = new URL((await signIn(base, client.client_id, challenge)).headers.get('location'));
  const tok = await fetch(base + '/token', { method: 'POST', headers: formHeaders, body: form({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier }) });
  return { client, tokens: await tok.json() };
}

const rpc = (base, accessToken, body) => fetch(base + '/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify(body),
});

test('web mode refuses to start without a strong password or a Canvas token', async () => {
  const base = { CANVAS_URL: 'https://canvas.test', CANVAS_TOKEN: 'fixture-token' };
  let r = await exitCode(base);
  assert.equal(r.code, 1);
  assert.match(r.log, /CANVAS_CONNECTOR_PASSWORD/);
  r = await exitCode({ ...base, CANVAS_CONNECTOR_PASSWORD: 'short' });
  assert.equal(r.code, 1);
  r = await exitCode({ CANVAS_URL: 'https://canvas.test', CANVAS_CONNECTOR_PASSWORD: PASSWORD });
  assert.equal(r.code, 1);
  assert.match(r.log, /CANVAS_TOKEN/);
});

test('discovery: health, 401 challenge and OAuth metadata', async (t) => {
  const canvas = await fakeCanvas(t);
  const { base } = await startWeb(t, { CANVAS_URL: canvas.url, CANVAS_TOKEN: 'fixture-token', CANVAS_CONNECTOR_PASSWORD: PASSWORD });

  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');

  const anon = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}' });
  assert.equal(anon.status, 401);
  assert.equal(anon.headers.get('www-authenticate'), `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="canvas"`);

  const prm = await (await fetch(base + '/.well-known/oauth-protected-resource')).json();
  assert.equal(prm.resource, base + '/mcp');
  assert.deepEqual(prm.authorization_servers, [base]);

  const as = await (await fetch(base + '/.well-known/oauth-authorization-server')).json();
  assert.equal(as.issuer, base);
  assert.equal(as.registration_endpoint, base + '/register');
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.ok(as.token_endpoint_auth_methods_supported.includes('none'));

  assert.equal((await fetch(base + '/anything-else')).status, 404);
});

test('registration only accepts Claude callback addresses', async (t) => {
  const canvas = await fakeCanvas(t);
  const { base } = await startWeb(t, { CANVAS_URL: canvas.url, CANVAS_TOKEN: 'fixture-token', CANVAS_CONNECTOR_PASSWORD: PASSWORD });
  assert.equal((await register(base, ['https://evil.example/callback'])).status, 400);
  assert.equal((await register(base, [])).status, 400);
  const ok = await register(base);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.token_endpoint_auth_method, 'none');
  // Claude Code's loopback callback on any port.
  assert.equal((await register(base, ['http://localhost:51234/callback', 'http://127.0.0.1:9/callback'])).status, 201);
});

test('sign-in page, wrong password, cancel and approve', async (t) => {
  const canvas = await fakeCanvas(t);
  const { base } = await startWeb(t, { CANVAS_URL: canvas.url, CANVAS_TOKEN: 'fixture-token', CANVAS_CONNECTOR_PASSWORD: PASSWORD });
  const { body: client } = await register(base);
  const { challenge } = pkce();

  const page = await fetch(`${base}/authorize?${form({ response_type: 'code', client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' })}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const htmlText = await page.text();
  assert.match(htmlText, /claude\.ai/);
  assert.match(htmlText, /type="password"/);

  // A link that redirects somewhere unregistered is shown as an error, never followed.
  const evil = await fetch(`${base}/authorize?${form({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' })}`, { redirect: 'manual' });
  assert.equal(evil.status, 400);

  const wrong = await signIn(base, client.client_id, challenge, 'not-the-password');
  assert.equal(wrong.status, 401);
  assert.match(await wrong.text(), /not right/);

  const cancel = await signIn(base, client.client_id, challenge, '', 'deny');
  assert.equal(cancel.status, 302);
  const cancelled = new URL(cancel.headers.get('location'));
  assert.equal(cancelled.searchParams.get('error'), 'access_denied');
  assert.equal(cancelled.searchParams.get('state'), 'xyz');

  const approve = await signIn(base, client.client_id, challenge);
  assert.equal(approve.status, 302);
  const back = new URL(approve.headers.get('location'));
  assert.equal(back.origin + back.pathname, CALLBACK);
  assert.ok(back.searchParams.get('code'));
  assert.equal(back.searchParams.get('state'), 'xyz');
});

test('token exchange checks PKCE and one-time codes; refresh tokens rotate', async (t) => {
  const canvas = await fakeCanvas(t);
  const { base } = await startWeb(t, { CANVAS_URL: canvas.url, CANVAS_TOKEN: 'fixture-token', CANVAS_CONNECTOR_PASSWORD: PASSWORD });
  const { body: client } = await register(base);
  const { verifier, challenge } = pkce();
  const code = new URL((await signIn(base, client.client_id, challenge)).headers.get('location')).searchParams.get('code');
  const exchange = (extra) => fetch(base + '/token', { method: 'POST', headers: formHeaders, body: form({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: client.client_id, ...extra }) });

  const badVerifier = await exchange({ code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier' });
  assert.equal(badVerifier.status, 400);
  assert.equal((await badVerifier.json()).error, 'invalid_grant');

  const good = await exchange({ code_verifier: verifier });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('cache-control'), 'no-store');
  const tokens = await good.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.ok(tokens.access_token && tokens.refresh_token && tokens.expires_in > 0);

  const reused = await exchange({ code_verifier: verifier });
  assert.equal((await reused.json()).error, 'invalid_grant');

  const refresh = (rt) => fetch(base + '/token', { method: 'POST', headers: formHeaders, body: form({ grant_type: 'refresh_token', refresh_token: rt, client_id: client.client_id }) });
  const next = await (await refresh(tokens.refresh_token)).json();
  assert.ok(next.access_token && next.refresh_token);
  assert.equal((await (await refresh(tokens.refresh_token)).json()).error, 'invalid_grant');
  assert.ok((await (await refresh(next.refresh_token)).json()).access_token);
});

test('MCP endpoint: read-only tools, Canvas calls use the server token', async (t) => {
  const canvas = await fakeCanvas(t);
  const { base } = await startWeb(t, { CANVAS_URL: canvas.url, CANVAS_TOKEN: 'fixture-token', CANVAS_CONNECTOR_PASSWORD: PASSWORD });
  const { tokens } = await connect(base);

  const init = await rpc(base, tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.serverInfo.name, 'canvas-mcp');

  const note = await rpc(base, tokens.access_token, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.status, 202);

  const list = await (await rpc(base, tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  const names = list.result.tools.map((x) => x.name).sort();
  assert.deepEqual(names, ALL_TOOLS.filter((n) => !LOCAL_ONLY.includes(n)));

  const courses = await (await rpc(base, tokens.access_token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'canvas_list_courses', arguments: {} } })).json();
  assert.match(courses.result.content[0].text, /Fixture Course 860/);
  assert.equal(canvas.seen.at(-1).auth, 'Bearer fixture-token');

  const blocked = await (await rpc(base, tokens.access_token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'canvas_submit_assignment', arguments: { course_id: '7', assignment_id: '1', text: 'x' } } })).json();
  assert.match(blocked.error.message, /Unknown tool/);

  const status = await (await rpc(base, tokens.access_token, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'canvas_setup_status', arguments: {} } })).json();
  assert.match(status.result.content[0].text, /web mode/);
  assert.doesNotMatch(status.result.content[0].text, /fixture-token/);

  const tampered = await rpc(base, tokens.access_token.slice(0, -2) + 'xx', { jsonrpc: '2.0', id: 6, method: 'tools/list' });
  assert.equal(tampered.status, 401);
  assert.match(tampered.headers.get('www-authenticate'), /invalid_token/);

  const get = await fetch(base + '/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  assert.equal(get.status, 405);
});

test('sign-in survives a restart (sleep) but not a password change', async (t) => {
  const canvas = await fakeCanvas(t);
  // A fixed public address, as on Railway, so every restart expects the same audience.
  const env = { CANVAS_URL: canvas.url, CANVAS_TOKEN: 'fixture-token', PUBLIC_URL: 'https://canvas-connector.example' };
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

  const first = await startWeb(t, { ...env, CANVAS_CONNECTOR_PASSWORD: PASSWORD });
  const { tokens } = await connect(first.base);
  first.child.kill();

  const woke = await startWeb(t, { ...env, CANVAS_CONNECTOR_PASSWORD: PASSWORD });
  assert.equal((await rpc(woke.base, tokens.access_token, list)).status, 200);
  woke.child.kill();

  const rotated = await startWeb(t, { ...env, CANVAS_CONNECTOR_PASSWORD: PASSWORD + '-rotated' });
  assert.equal((await rpc(rotated.base, tokens.access_token, list)).status, 401);
});

test('desktop mode is unchanged: stdio transport with all 13 tools', async (t) => {
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, CANVAS_URL: 'https://canvas.test', CANVAS_TOKEN: 'fixture-token' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  t.after(() => child.kill());
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'no/such/method' }) + '\n');
  child.stdin.end();
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 0);
  const replies = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(replies.length, 3, 'one reply per request, none for the notification');
  const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
  assert.equal(byId[1].result.protocolVersion, '2025-06-18');
  assert.deepEqual(byId[2].result.tools.map((x) => x.name).sort(), ALL_TOOLS);
  assert.equal(byId[3].error.code, -32601);
});
