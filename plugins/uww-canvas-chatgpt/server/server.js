#!/usr/bin/env node
/**
 * canvas-mcp — a minimal MCP server for Canvas LMS.
 *
 * Zero dependencies: speaks JSON-RPC 2.0 over stdio directly and uses the
 * global fetch in Node 18+.
 *
 * Reads go through get(), which is hard-wired to GET. Anything that changes
 * state in Canvas — submitting an assignment, posting a discussion reply —
 * goes through write(). In this plugin build writes are off until the user
 * turns them on in an on-screen box, and every write needs its own on-screen Yes.
 * Downloading course files writes to local disk but never mutates Canvas.
 *
 * Config comes from the environment:
 *   CANVAS_URL         e.g. https://uwwtw.instructure.com
 *   CANVAS_TOKEN       a Canvas personal access token (optional in the plugin
 *                      build: if unset, the token is read from
 *                      ~/.canvas-mcp/token, and if that is missing the user is
 *                      asked for it in a private pop-up box on first use)
 *   CANVAS_TZ          IANA zone for due dates (default America/Chicago)
 *   CANVAS_ALLOW_WRITE "true" pre-enables writes (each still needs an on-screen Yes)
 */

const CANVAS_URL = (process.env.CANVAS_URL || '').replace(/\/+$/, '');
let CANVAS_TOKEN = (process.env.CANVAS_TOKEN || '').trim();
const TZ = process.env.CANVAS_TZ || 'America/Chicago';
// Master switch for the two tools that change state in Canvas. Flip this to
// anything but "true" and submissions/replies refuse before touching the API.
const ALLOW_WRITE = String(process.env.CANVAS_ALLOW_WRITE || '').toLowerCase() === 'true';
const VERSION = '1.4.3-chatgpt';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

/* ---------- token and write-permission storage ---------- */

// The token never travels through a chat. It comes from the environment, or
// from storage only this user can read: Windows DPAPI encryption (tied to the
// user's Windows login) or the macOS Keychain. It is entered in a pop-up box
// on the user's own screen.
const STATE_DIR = path.join(os.homedir(), '.canvas-mcp');
const TOKEN_DPAPI = path.join(STATE_DIR, 'token.dpapi'); // Windows, encrypted
const TOKEN_PLAIN = path.join(STATE_DIR, 'token');       // legacy Windows token only
const WRITE_OPTIN = path.join(STATE_DIR, 'allow-write');  // created only by an on-screen Yes
const KEYCHAIN = ['-a', 'canvas-mcp', '-s', 'uww-canvas'];
let tokenPrompt = null; // shared promise so two calls never open two boxes
// Setup diagnostics, never containing the token itself.
const DIAG = { pid: process.pid, started: new Date().toISOString(), popupRuns: 0, lastPopup: 'never opened', lastStore: 'never tried', lastLoad: 'never tried' };

function run(cmd, args, timeoutMs, input) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    // NOT windowsHide: on Windows that flag also hides the pop-up itself (the
    // first window inherits SW_HIDE). PowerShell hides its own console via
    // -WindowStyle Hidden instead.
    try { child = spawn(cmd, args, { windowsHide: false }); } catch { return resolve({ code: -1, out: '' }); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: '', err: String(e && e.message) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (input !== undefined) { try { child.stdin.end(input); } catch {} } else { try { child.stdin.end(); } catch {} }
  });
}

// Run a PowerShell script without any quoting or newline pitfalls.
function ps(script, timeoutMs, input) {
  // Silence PowerShell's progress records, which otherwise arrive as CLIXML noise on stderr.
  script = "$ProgressPreference = 'SilentlyContinue'\n" + script;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], timeoutMs, input);
}

const PS_PROTECT = `$p = [Console]::In.ReadToEnd().Trim()
ConvertTo-SecureString $p -AsPlainText -Force | ConvertFrom-SecureString`;
const PS_UNPROTECT = `$e = [Console]::In.ReadToEnd().Trim()
$s = ConvertTo-SecureString $e
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }`;

async function loadToken() {
  try {
    if (process.platform === 'win32') {
      if (fs.existsSync(TOKEN_DPAPI)) {
        const r = await ps(PS_UNPROTECT, 20000, fs.readFileSync(TOKEN_DPAPI, 'utf8'));
        DIAG.lastLoad = `decrypt exit code ${r.code}, got ${r.out.trim() ? 'a token' : 'nothing'}${r.err ? ' | ' + r.err.slice(0, 200) : ''}`;
        return r.code === 0 ? r.out.trim() : '';
      }
      // Migrate a plain-text token left by an older version, then remove it.
      if (fs.existsSync(TOKEN_PLAIN)) {
        const t = fs.readFileSync(TOKEN_PLAIN, 'utf8').trim();
        if (t && await storeToken(t)) {
          fs.unlinkSync(TOKEN_PLAIN);
          return t;
        }
        return '';
      }
      DIAG.lastLoad = 'no saved token file';
      return '';
    }
    if (process.platform === 'darwin') {
      const r = await run('security', ['find-generic-password', ...KEYCHAIN, '-w'], 10000);
      return r.code === 0 ? r.out.trim() : '';
    }
    return '';
  } catch { return ''; }
}

async function storeToken(t) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (process.platform === 'win32') {
    const r = await ps(PS_PROTECT, 20000, t);
    if (r.code !== 0 || !r.out.trim()) {
      DIAG.lastStore = `encrypt failed: exit code ${r.code}${r.err ? ' | ' + r.err.slice(0, 200) : ''}`;
      log('could not encrypt token:', DIAG.lastStore);
      return false;
    }
    fs.writeFileSync(TOKEN_DPAPI, r.out.trim(), 'utf8');
    DIAG.lastStore = 'saved encrypted at ' + new Date().toISOString();
    return true;
  }
  if (process.platform === 'darwin') {
    const r = await run('security', ['add-generic-password', '-U', ...KEYCHAIN, '-w', t], 10000);
    return r.code === 0;
  }
  // This plugin promises encrypted local storage. Fail closed on systems
  // without the Windows DPAPI or macOS Keychain implementation.
  return false;
}

async function clearToken() {
  for (const f of [TOKEN_DPAPI, TOKEN_PLAIN]) { try { fs.unlinkSync(f); } catch {} }
  if (process.platform === 'darwin') await run('security', ['delete-generic-password', ...KEYCHAIN], 10000);
}

const PROMPT_TEXT = 'Paste your Canvas access token. (Canvas > Account > Settings > Approved Integrations > + New Access Token)';

async function askForToken() {
  if (process.platform === 'win32') {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$f = New-Object Windows.Forms.Form
$f.Text = 'Canvas for ChatGPT'; $f.TopMost = $true; $f.StartPosition = 'CenterScreen'
$f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
$f.ClientSize = New-Object Drawing.Size(480,190)
$l = New-Object Windows.Forms.Label
$l.Text = '${PROMPT_TEXT}'; $l.SetBounds(12,10,456,40)
$t = New-Object Windows.Forms.TextBox
$t.UseSystemPasswordChar = $true; $t.SetBounds(12,56,456,24)
$c = New-Object Windows.Forms.Label
$c.Text = 'Click in the box above, then press Ctrl+V (or right-click > Paste).'; $c.SetBounds(12,86,456,20)
$show = New-Object Windows.Forms.CheckBox
$show.Text = 'Show token'; $show.SetBounds(12,110,200,22)
$show.Add_CheckedChanged({ $t.UseSystemPasswordChar = -not $show.Checked })
$ok = New-Object Windows.Forms.Button
$ok.Text = 'Save'; $ok.SetBounds(312,146,75,28); $ok.DialogResult = 'OK'; $ok.Enabled = $false
$cancel = New-Object Windows.Forms.Button
$cancel.Text = 'Cancel'; $cancel.SetBounds(393,146,75,28); $cancel.DialogResult = 'Cancel'
$t.Add_TextChanged({
  $n = $t.Text.Trim().Length
  $ok.Enabled = ($n -gt 0)
  if ($n -gt 0) { $c.Text = "Token entered: $n characters. Click Save." } else { $c.Text = 'Click in the box above, then press Ctrl+V (or right-click > Paste).' }
})
$f.Controls.AddRange(@($l,$t,$c,$show,$ok,$cancel)); $f.AcceptButton = $ok; $f.CancelButton = $cancel
$f.ShowInTaskbar = $true
$f.WindowState = 'Normal'
$f.ActiveControl = $t
$f.Add_Shown({ $f.TopMost = $true; $f.BringToFront(); $f.Activate(); $t.Select(); $t.Focus() })
if ($f.ShowDialog() -eq 'OK') { [Console]::Out.Write($t.Text.Trim()) }
`;
    DIAG.popupRuns++;
    const r = await ps(script, 10 * 60 * 1000);
    DIAG.lastPopup = `closed at ${new Date().toISOString()}, exit code ${r.code}, returned ${r.out.trim() ? r.out.trim().length + ' characters' : 'nothing'}${r.err ? ' | ' + r.err.slice(0, 200) : ''}`;
    return r.out.trim();
  }
  if (process.platform === 'darwin') {
    const script = `text returned of (display dialog "${PROMPT_TEXT}" default answer "" with hidden answer with title "Canvas for ChatGPT" buttons {"Cancel", "Save"} default button "Save")`;
    return (await run('osascript', ['-e', script], 10 * 60 * 1000)).out.trim();
  }
  return '';
}

async function ensureToken() {
  if (CANVAS_TOKEN) return CANVAS_TOKEN;
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    throw new Error('Local token prompts and encrypted storage are supported on Windows and macOS only.');
  }
  const saved = await loadToken();
  if (saved) { CANVAS_TOKEN = saved; return CANVAS_TOKEN; }

  // Open the pop-up in the background. Tool calls must not wait on a human
  // typing (the desktop bridge gives up after about a minute), so answer
  // straight away and let the next call pick up the saved token.
  if (!tokenPrompt) {
    tokenPrompt = askForToken()
      .then(async (t) => {
        if (!t) { DIAG.emptyPopup = true; return log('token pop-up closed without a token'); }
        DIAG.emptyPopup = false;
        CANVAS_TOKEN = t;
        if (await storeToken(t)) log('token saved securely');
      })
      .catch((e) => log('token pop-up failed:', e && e.message))
      .finally(() => { tokenPrompt = null; });
    if (DIAG.emptyPopup) {
      throw new Error('SETUP NEEDED: the last token box was closed with nothing in it, so no token was saved. A new "Canvas for ChatGPT" box just opened. Click inside the text field, press Ctrl+V, and check that it says "Token entered: N characters" before clicking Save. Then ask again.');
    }
    throw new Error('SETUP NEEDED: a box titled "Canvas for ChatGPT" just opened on your screen (check behind other windows and the taskbar). Paste your Canvas token there and click Save, then ask again. Create a token in Canvas under Account > Settings > Approved Integrations > + New Access Token. Never paste the token into the chat.');
  }
  throw new Error('Still waiting for your Canvas token in the "Canvas for ChatGPT" box on your screen. Paste it, click Save, then ask again.');
}

// A rejected token is forgotten so the next request asks for a fresh one.
async function rejectToken() {
  if (!process.env.CANVAS_TOKEN) { CANVAS_TOKEN = ''; await clearToken(); }
}

/* ---------- on-screen confirmation for anything that changes Canvas ---------- */

// Text inside Canvas (a classmate's post, an assignment page) can contain
// instructions aimed at ChatGPT. So every submission or post needs a click on
// the user's own screen, which nothing in a conversation can fake.
const CONFIRM_SECONDS = 45; // stays under the desktop bridge's ~60s limit

function clip(sv, n) { sv = String(sv || ''); return sv.length > n ? sv.slice(0, n) + '...' : sv; }

async function confirmOnScreen(title, message) {
  if (process.platform === 'win32') {
    // WScript.Shell Popup: 4 = Yes/No, 48 = warning icon, 256 = default No,
    // 4096 = always on top. Returns 6 for Yes, 7 for No, -1 on timeout.
    const script = `$m = [Console]::In.ReadToEnd()
$r = (New-Object -ComObject WScript.Shell).Popup($m, ${CONFIRM_SECONDS}, '${title.replace(/'/g, "''")}', 4 + 48 + 256 + 4096)
[Console]::Out.Write([string]$r)`;
    const r = await ps(script, (CONFIRM_SECONDS + 10) * 1000, message);
    return r.out.trim() === '6';
  }
  if (process.platform === 'darwin') {
    const esc = (x) => String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `button returned of (display dialog "${esc(message)}" with title "${esc(title)}" buttons {"Cancel", "Yes"} default button "Cancel" with icon caution giving up after ${CONFIRM_SECONDS})`;
    const r = await run('osascript', ['-e', script], (CONFIRM_SECONDS + 10) * 1000);
    return r.out.trim() === 'Yes';
  }
  return false; // no way to ask a human on this system, so never write
}

// Writes are off until the user turns them on with an on-screen Yes, and each
// individual write then needs its own on-screen Yes.
async function requireWriteApproval(summary) {
  const enabled = ALLOW_WRITE || fs.existsSync(WRITE_OPTIN);
  if (!enabled) {
    const yes = await confirmOnScreen('Canvas for ChatGPT',
      'ChatGPT is asking to submit or post in Canvas for you.\n\n' +
      'Submitting and posting are OFF. Turn them on?\n\n' +
      'You will still have to click Yes in a box like this before every single submission or post.');
    if (!yes) throw new Error('Submitting and posting are turned off, and the user did not turn them on in the box on their screen. Nothing was sent to Canvas.');
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(WRITE_OPTIN, 'enabled by on-screen confirmation ' + new Date().toISOString() + '\n');
    log('writes enabled by on-screen confirmation');
  }
  const ok = await confirmOnScreen('Canvas for ChatGPT - confirm', summary + '\n\nSend this to Canvas now? This cannot be undone.');
  if (!ok) throw new Error(`Not confirmed in the box on the user's screen (clicked No, or no answer within ${CONFIRM_SECONDS} seconds). Nothing was sent to Canvas.`);
}

// stdout is the transport. Anything diagnostic has to go to stderr.
const log = (...a) => console.error('[canvas-mcp]', ...a);

/* ---------- Canvas REST ---------- */

// Canvas paginates via RFC 5988 Link headers; follow rel="next" to completion.
async function get(path, params = {}) {
  if (!CANVAS_URL) throw new Error('CANVAS_URL must be set in the MCP server env.');
  await ensureToken();
  const url = new URL(CANVAS_URL + '/api/v1/' + path.replace(/^\/+/, ''));
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k + '[]', x));
    else url.searchParams.set(k, String(v));
  }
  if (!url.searchParams.has('per_page')) url.searchParams.set('per_page', '100');

  let next = url.toString();
  let pages = 0;
  const acc = [];

  while (next && pages < 20) {
    const res = await fetch(next, {
      method: 'GET',
      headers: { Authorization: `Bearer ${CANVAS_TOKEN}`, Accept: 'application/json' },
    });
    if (res.status === 401) { await rejectToken(); throw new Error('Canvas rejected the token (401). It may have been mistyped, regenerated or revoked. Ask again and a pop-up will let you paste a new one.'); }
    if (res.status === 403) throw new Error('Canvas denied access (403) — the token lacks permission for this resource.');
    if (res.status === 404) throw new Error(`Canvas returned 404 for ${path} — check the course/assignment id.`);
    if (!res.ok) throw new Error(`Canvas HTTP ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);

    const body = await res.json();
    if (!Array.isArray(body)) return body; // single object: no pagination
    acc.push(...body);

    const link = res.headers.get('link') || '';
    const m = link.split(',').find((s) => s.includes('rel="next"'));
    next = m ? m.slice(m.indexOf('<') + 1, m.indexOf('>')) : null;
    pages++;
  }
  return acc;
}

// Write counterpart to get(). Kept separate so the read path stays provably
// GET-only and every mutating call has to come through this gate.
async function write(method, path_, body) {
  // Belt and braces: the tool handlers already required an on-screen Yes.
  if (!ALLOW_WRITE && !fs.existsSync(WRITE_OPTIN)) {
    throw new Error('Submitting and posting are turned off. Nothing was sent to Canvas.');
  }
  if (!CANVAS_URL) throw new Error('CANVAS_URL must be set.');
  await ensureToken();

  const res = await fetch(CANVAS_URL + '/api/v1/' + path_.replace(/^\/+/, ''), {
    method,
    headers: {
      Authorization: `Bearer ${CANVAS_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  if (res.status === 401) await rejectToken();
  if (!res.ok) {
    let detail = raw.slice(0, 400);
    try {
      const j = JSON.parse(raw);
      if (j.errors) detail = JSON.stringify(j.errors);
      else if (j.message) detail = j.message;
    } catch { /* keep the raw body */ }
    throw new Error(`Canvas HTTP ${res.status} on ${method} ${path_}: ${detail}`);
  }
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Canvas file uploads are a three-step handshake, not a single POST:
 *   1. tell Canvas the filename/size -> it hands back a one-time upload URL
 *   2. POST the bytes as multipart to that URL (a different host, S3-backed)
 *   3. Canvas may 201 with the file JSON, or 3xx to a confirmation endpoint
 * Returns the Canvas file id needed to attach the file to a submission.
 */
async function uploadFile(targetPath, filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`${filePath} is not a file.`);
  const name = path.basename(filePath);

  const init = await write('POST', targetPath, { name, size: stat.size, on_duplicate: 'rename' });
  if (!init.upload_url) throw new Error(`Canvas did not return an upload URL: ${JSON.stringify(init).slice(0, 200)}`);

  const form = new FormData();
  // Canvas requires its upload_params first, and the file field last.
  for (const [k, v] of Object.entries(init.upload_params || {})) form.append(k, String(v));
  form.append('file', new Blob([fs.readFileSync(filePath)]), name);

  const up = await fetch(init.upload_url, { method: 'POST', body: form, redirect: 'follow' });
  if (!up.ok) throw new Error(`File upload failed (HTTP ${up.status}): ${(await up.text()).slice(0, 300)}`);

  const raw = await up.text();
  let file = {};
  try { file = JSON.parse(raw); } catch { /* confirmation step may return HTML */ }

  if (!file.id && init.upload_params?.success_url) {
    const conf = await fetch(init.upload_params.success_url, {
      headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
    });
    try { file = await conf.json(); } catch { /* fall through to the error below */ }
  }
  if (!file.id) throw new Error('Upload completed but Canvas never returned a file id.');
  return file;
}

/* ---------- formatting ---------- */

// Canvas stores due dates in UTC. An 11:59pm Central deadline serializes as
// 04:59Z the *following* day, so rendering raw UTC shows the wrong date.
function localTime(iso) {
  if (!iso) return 'no due date';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '  - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });

/* ---------- tools ---------- */

const TOOLS = [
  {
    name: 'canvas_list_courses',
    description: 'List the Canvas courses you are enrolled in, with course id, code, term, and whether the instructor has published the course yet.',
    inputSchema: {
      type: 'object',
      properties: {
        include_unpublished: { type: 'boolean', description: 'Include courses the instructor has not published yet (default true).' },
      },
    },
    handler: async (a) => {
      const courses = await get('courses', { 'include[]': 'term', 'state[]': ['available', 'completed', 'unpublished'] });
      const rows = courses
        .filter((c) => (a.include_unpublished === false ? c.workflow_state !== 'unpublished' : true))
        .map((c) => {
          const term = (c.term || {}).name || '?';
          const pub = c.workflow_state === 'unpublished' ? '  [UNPUBLISHED — not open yet]' : '';
          return `id=${c.id}  ${c.name}\n    code=${c.course_code}  term=${term}${pub}\n    start=${localTime(c.start_at)}  end=${localTime(c.end_at)}`;
        });
      return text(rows.length ? `${rows.length} course(s):\n\n` + rows.join('\n\n') : 'No courses found.');
    },
  },
  {
    name: 'canvas_list_assignments',
    description: 'List assignments for a course with due dates (rendered in local time), point values, and your submission status. Use this to see what is outstanding.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string', description: 'Canvas course id, from canvas_list_courses.' },
        only_undated: { type: 'boolean', description: 'Show only assignments with no due date set (default false).' },
        limit: { type: 'number', description: 'Max assignments to return (default 25).' },
      },
      required: ['course_id'],
    },
    handler: async (a) => {
      const list = await get(`courses/${a.course_id}/assignments`, { 'include[]': 'submission', order_by: 'due_at' });
      const dated = list.filter((x) => x.due_at).sort((x, y) => x.due_at.localeCompare(y.due_at));
      const undated = list.filter((x) => !x.due_at);
      const chosen = (a.only_undated ? undated : dated).slice(0, a.limit || 25);

      const rows = chosen.map((x) => {
        const s = x.submission || {};
        const status = s.submitted_at
          ? `submitted ${localTime(s.submitted_at)}${s.score != null ? `, score ${s.score}` : ''}`
          : 'NOT SUBMITTED';
        return `${localTime(x.due_at)}  [${x.points_possible ?? 0} pts]  ${x.name}\n    id=${x.id}  ${status}\n    ${x.html_url}`;
      });
      const note = a.only_undated ? '' : `\n\n(${undated.length} further assignment(s) have no due date set.)`;
      return text(rows.length ? rows.join('\n\n') + note : 'No matching assignments.');
    },
  },
  {
    name: 'canvas_get_assignment',
    description: 'Get the full description, instructions, rubric, and submission requirements for one assignment.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string' },
        assignment_id: { type: 'string' },
      },
      required: ['course_id', 'assignment_id'],
    },
    handler: async (a) => {
      const x = await get(`courses/${a.course_id}/assignments/${a.assignment_id}`, { 'include[]': 'submission' });
      const s = x.submission || {};
      const out = [
        `# ${x.name}`,
        `Due: ${localTime(x.due_at)}   Points: ${x.points_possible ?? 0}`,
        `Submit via: ${(x.submission_types || []).join(', ') || 'n/a'}`,
        `Status: ${s.submitted_at ? `submitted ${localTime(s.submitted_at)}` : 'NOT SUBMITTED'}`,
        x.allowed_extensions?.length ? `Allowed file types: ${x.allowed_extensions.join(', ')}` : null,
        x.lock_at ? `Locks: ${localTime(x.lock_at)}` : null,
        `URL: ${x.html_url}`,
        '',
        '## Instructions',
        stripHtml(x.description) || '(no description provided)',
      ].filter(Boolean);

      if (x.rubric?.length) {
        out.push('', '## Rubric');
        for (const r of x.rubric) out.push(`- ${r.description} (${r.points} pts)${r.long_description ? ': ' + stripHtml(r.long_description) : ''}`);
      }
      return text(out.join('\n'));
    },
  },
  {
    name: 'canvas_upcoming',
    description: 'Everything due soon across ALL active courses, earliest first. The best starting point for "what do I owe and when".',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look ahead this many days (default 60).' },
        include_submitted: { type: 'boolean', description: 'Include work already submitted (default false).' },
      },
    },
    handler: async (a) => {
      const days = a.days || 60;
      const now = Date.now();
      const until = now + days * 864e5;
      const courses = (await get('courses', { 'state[]': 'available' })).filter((c) => c.workflow_state === 'available');

      const items = [];
      for (const c of courses) {
        let list = [];
        try {
          list = await get(`courses/${c.id}/assignments`, { 'include[]': 'submission' });
        } catch (e) {
          log(`skipping course ${c.id}: ${e.message}`);
          continue;
        }
        for (const x of list) {
          if (!x.due_at) continue;
          const t = Date.parse(x.due_at);
          if (t < now || t > until) continue;
          if (!a.include_submitted && (x.submission || {}).submitted_at) continue;
          items.push({ due: x.due_at, t, course: c.course_code || c.name, name: x.name, pts: x.points_possible ?? 0, url: x.html_url });
        }
      }
      items.sort((p, q) => p.t - q.t);
      if (!items.length) return text(`Nothing due in the next ${days} days.`);

      const rows = items.map((i) => {
        const inDays = Math.ceil((i.t - now) / 864e5);
        return `${localTime(i.due)}  (in ${inDays}d)  [${i.pts} pts]  ${i.course} — ${i.name}\n    ${i.url}`;
      });
      return text(`${items.length} item(s) due in the next ${days} days:\n\n` + rows.join('\n\n'));
    },
  },
  {
    name: 'canvas_list_discussions',
    description: 'List discussion topics and announcements for a course.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string' },
        announcements: { type: 'boolean', description: 'List announcements instead of discussions (default false).' },
      },
      required: ['course_id'],
    },
    handler: async (a) => {
      const list = await get(`courses/${a.course_id}/discussion_topics`, a.announcements ? { only_announcements: true } : {});
      if (!list.length) return text(a.announcements ? 'No announcements.' : 'No discussion topics.');
      const rows = list.map((t) => {
        const due = (t.assignment || {}).due_at;
        return `id=${t.id}  ${t.title}\n    posted=${localTime(t.posted_at)}${due ? `  due=${localTime(due)}` : ''}  replies=${t.discussion_subentry_count ?? 0}${t.locked ? '  [locked]' : ''}`;
      });
      return text(rows.join('\n\n'));
    },
  },
  {
    name: 'canvas_get_discussion',
    description: 'Read one discussion topic in full, including the prompt and posted replies.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string' },
        topic_id: { type: 'string' },
        include_replies: { type: 'boolean', description: 'Fetch the replies too (default true).' },
      },
      required: ['course_id', 'topic_id'],
    },
    handler: async (a) => {
      const t = await get(`courses/${a.course_id}/discussion_topics/${a.topic_id}`);
      const due = (t.assignment || {}).due_at;
      const out = [
        `# ${t.title}`,
        `Posted: ${localTime(t.posted_at)}${due ? `   Due: ${localTime(due)}` : ''}${t.locked ? '   [locked]' : ''}`,
        `URL: ${t.html_url}`,
        '',
        stripHtml(t.message) || '(no content)',
      ];
      if (a.include_replies !== false) {
        let entries = [];
        try {
          entries = await get(`courses/${a.course_id}/discussion_topics/${a.topic_id}/entries`);
        } catch (e) {
          log(`entries unavailable: ${e.message}`);
        }
        out.push('', `## Replies (${entries.length})`);
        for (const e of entries) out.push('', `**${e.user_name || 'unknown'}** — ${localTime(e.created_at)}`, stripHtml(e.message));
      }
      return text(out.join('\n'));
    },
  },
  {
    name: 'canvas_get_grades',
    description: 'Your current grade and score for each active course, plus per-assignment scores for one course if course_id is given.',
    inputSchema: {
      type: 'object',
      properties: { course_id: { type: 'string', description: 'Optional: itemize scores for this course.' } },
    },
    handler: async (a) => {
      if (!a.course_id) {
        const courses = await get('courses', { 'include[]': 'total_scores', 'state[]': 'available' });
        const rows = courses.map((c) => {
          const e = (c.enrollments || []).find((x) => x.type === 'student') || {};
          return `${c.course_code || c.name}: ${e.computed_current_grade || 'n/a'} (${e.computed_current_score ?? 'n/a'}%)  id=${c.id}`;
        });
        return text(rows.length ? rows.join('\n') : 'No graded courses.');
      }
      const list = await get(`courses/${a.course_id}/assignments`, { 'include[]': 'submission' });
      const rows = list
        .filter((x) => (x.submission || {}).score != null)
        .map((x) => `${x.name}: ${x.submission.score}/${x.points_possible ?? 0}  (graded ${localTime(x.submission.graded_at)})`);
      return text(rows.length ? rows.join('\n') : 'Nothing graded in this course yet.');
    },
  },
];

/* ---------- write tools ---------- */

TOOLS.push({
  name: 'canvas_setup_status',
  description: 'Show the Canvas connector setup state for troubleshooting: whether a token is loaded and saved, whether submitting is turned on, and what happened with the last token pop-up. Never shows the token itself.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => text([
    `Connector version ${VERSION}, process ${DIAG.pid}, started ${DIAG.started}, platform ${process.platform}`,
    `Canvas address: ${CANVAS_URL || '(not set)'}`,
    `Token in memory: ${CANVAS_TOKEN ? 'yes' : 'no'}${process.env.CANVAS_TOKEN ? ' (from environment)' : ''}`,
    `Encrypted token file: ${fs.existsSync(TOKEN_DPAPI) ? 'present (' + fs.statSync(TOKEN_DPAPI).size + ' bytes)' : 'absent'}`,
    `Plain token file: ${fs.existsSync(TOKEN_PLAIN) ? 'present' : 'absent'}`,
    `Token pop-up: opened ${DIAG.popupRuns} time(s) in this process; last: ${DIAG.lastPopup}; open now: ${tokenPrompt ? 'yes' : 'no'}`,
    `Last save: ${DIAG.lastStore}`,
    `Last load: ${DIAG.lastLoad}`,
    `Submitting/posting: ${ALLOW_WRITE || fs.existsSync(WRITE_OPTIN) ? 'ON (each still needs an on-screen Yes)' : 'OFF'}`,
  ].join('\n')),
});

TOOLS.push(
  {
    name: 'canvas_submit_assignment',
    description:
      'Submit work to a Canvas assignment. Provide exactly one of file_path (uploads a file), text (online text entry), or url (website URL submission). ' +
      'This is a real, graded submission that the instructor sees immediately — confirm the assignment id and the exact file with the user before calling.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string' },
        assignment_id: { type: 'string' },
        file_path: { type: 'string', description: 'Absolute path to the file to upload, e.g. C:\\Users\\yourname\\Documents\\exercise1.docx' },
        text: { type: 'string', description: 'Body for an online_text_entry submission.' },
        url: { type: 'string', description: 'URL for an online_url submission.' },
        comment: { type: 'string', description: 'Optional comment to the instructor.' },
      },
      required: ['course_id', 'assignment_id'],
    },
    handler: async (a) => {
      const modes = ['file_path', 'text', 'url'].filter((k) => a[k]);
      if (modes.length !== 1) throw new Error(`Provide exactly one of file_path, text, or url (got ${modes.length}).`);

      // Check the assignment accepts what we are about to send, so a rejected
      // submission fails here with a clear reason instead of a Canvas 400.
      const asg = await get(`courses/${a.course_id}/assignments/${a.assignment_id}`);
      const accepts = asg.submission_types || [];
      const wanted = a.file_path ? 'online_upload' : a.text ? 'online_text_entry' : 'online_url';
      if (!accepts.includes(wanted)) {
        throw new Error(`"${asg.name}" accepts [${accepts.join(', ')}], not ${wanted}.`);
      }

      if (a.file_path && !fs.existsSync(a.file_path)) throw new Error(`File not found: ${a.file_path}`);
      await requireWriteApproval(
        `SUBMIT ASSIGNMENT\n\nAssignment: ${clip(asg.name, 120)}\nCourse id: ${a.course_id}\n` +
        (a.file_path ? `File from your computer:\n${a.file_path}` : a.text ? `Text:\n${clip(a.text, 300)}` : `Website: ${clip(a.url, 200)}`) +
        (a.comment ? `\n\nComment to instructor:\n${clip(a.comment, 150)}` : '')
      );

      const body = { submission: { submission_type: wanted } };
      let uploaded = null;

      if (a.file_path) {
        if (!fs.existsSync(a.file_path)) throw new Error(`File not found: ${a.file_path}`);
        const ext = path.extname(a.file_path).replace('.', '').toLowerCase();
        if (asg.allowed_extensions?.length && !asg.allowed_extensions.includes(ext)) {
          throw new Error(`"${asg.name}" only accepts [${asg.allowed_extensions.join(', ')}] — got .${ext}`);
        }
        uploaded = await uploadFile(`courses/${a.course_id}/assignments/${a.assignment_id}/submissions/self/files`, a.file_path);
        body.submission.file_ids = [uploaded.id];
      } else if (a.text) {
        body.submission.body = a.text;
      } else {
        body.submission.url = a.url;
      }
      if (a.comment) body.comment = { text_comment: a.comment };

      const sub = await write('POST', `courses/${a.course_id}/assignments/${a.assignment_id}/submissions`, body);

      const late = sub.late ? '  ** MARKED LATE **' : '';
      return text(
        [
          `SUBMITTED — ${asg.name}`,
          `Course ${a.course_id}, assignment ${a.assignment_id}`,
          uploaded ? `File: ${uploaded.display_name || uploaded.filename} (${uploaded.size} bytes)` : `Type: ${wanted}`,
          `Submitted at: ${localTime(sub.submitted_at)}${late}`,
          `Attempt: ${sub.attempt ?? 1}`,
          `Verify at: ${asg.html_url}`,
        ].join('\n')
      );
    },
  },
  {
    name: 'canvas_post_discussion_reply',
    description:
      'Post a reply to a Canvas discussion topic, or reply to a specific existing entry when parent_entry_id is given. ' +
      'The post is immediately visible to the instructor and classmates under the user\'s name — show them the exact text first.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string' },
        topic_id: { type: 'string' },
        message: { type: 'string', description: 'The reply body. Plain text or simple HTML.' },
        parent_entry_id: { type: 'string', description: 'Reply to this entry instead of the topic itself.' },
      },
      required: ['course_id', 'topic_id', 'message'],
    },
    handler: async (a) => {
      if (!a.message.trim()) throw new Error('Refusing to post an empty reply.');

      const topic = await get(`courses/${a.course_id}/discussion_topics/${a.topic_id}`);
      if (topic.locked) throw new Error(`"${topic.title}" is locked — replies are closed.`);

      const p = a.parent_entry_id
        ? `courses/${a.course_id}/discussion_topics/${a.topic_id}/entries/${a.parent_entry_id}/replies`
        : `courses/${a.course_id}/discussion_topics/${a.topic_id}/entries`;

      await requireWriteApproval(
        `POST DISCUSSION REPLY\n\nDiscussion: ${clip(topic.title, 120)}\n` +
        (a.parent_entry_id ? `Replying to entry ${a.parent_entry_id}\n` : '') +
        `Visible to your instructor and classmates under your name.\n\nText:\n${clip(stripHtml(a.message), 400)}`
      );
      const entry = await write('POST', p, { message: a.message });
      return text(
        [
          `POSTED to "${topic.title}"`,
          a.parent_entry_id ? `In reply to entry ${a.parent_entry_id}` : 'As a top-level reply',
          `Entry id: ${entry.id}   Posted: ${localTime(entry.created_at || new Date().toISOString())}`,
          `Verify at: ${topic.html_url}`,
          '',
          '--- posted text ---',
          stripHtml(entry.message || a.message),
        ].join('\n')
      );
    },
  }
);

/* ---------- file / module tools ---------- */

// Course "files" listing is 403 for students on this Canvas instance, but the
// per-file endpoint works, so modules are the only route to the file ids.
async function courseFileItems(courseId) {
  const modules = await get(`courses/${courseId}/modules`, { 'include[]': 'items' });
  const out = [];
  for (const m of modules) {
    for (const it of m.items || []) {
      if (it.type === 'File' && it.content_id) {
        out.push({ module: m.name || 'Course Files', title: it.title, fileId: it.content_id });
      }
    }
  }
  return out;
}

// Windows rejects <>:"/\|?* in names; Canvas display names contain none of the
// path separators by contract, but titles are instructor-typed, so scrub both.
const safeName = (s) =>
  String(s || 'untitled')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|[. ]+$/g, '')
    .slice(0, 150) || 'untitled';

async function downloadOne(courseId, fileId, destDir, overwrite) {
  const meta = await get(`courses/${courseId}/files/${fileId}`);
  const name = safeName(meta.display_name || meta.filename || `file-${fileId}`);
  const target = path.join(destDir, name);

  if (fs.existsSync(target) && !overwrite) {
    return { name, target, skipped: true, size: fs.statSync(target).size };
  }
  // meta.url is pre-signed with a verifier; it needs no Authorization header.
  const res = await fetch(meta.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed for "${name}" (HTTP ${res.status})`);

  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  return { name, target, skipped: false, size: fs.statSync(target).size };
}

TOOLS.push(
  {
    name: 'canvas_list_modules',
    description:
      'List a course\'s modules and their contents, including the file id of every downloadable file. ' +
      'Use this to see what readings, rubrics, and handouts exist before downloading.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string' },
        files_only: { type: 'boolean', description: 'List only downloadable files, skipping pages and links (default false).' },
      },
      required: ['course_id'],
    },
    handler: async (a) => {
      const modules = await get(`courses/${a.course_id}/modules`, { 'include[]': 'items' });
      const lines = [];
      let fileCount = 0;
      for (const m of modules) {
        const items = (m.items || []).filter((it) => (a.files_only ? it.type === 'File' : true));
        if (a.files_only && !items.length) continue;
        lines.push(`## ${m.name}`);
        if (!items.length) lines.push('   (empty)');
        for (const it of items) {
          if (it.type === 'File') {
            fileCount++;
            lines.push(`   [FILE id=${it.content_id}] ${it.title}`);
          } else {
            lines.push(`   [${it.type}] ${it.title}`);
          }
        }
        lines.push('');
      }
      return text(`${modules.length} module(s), ${fileCount} downloadable file(s).\n\n` + lines.join('\n'));
    },
  },
  {
    name: 'canvas_download_file',
    description:
      'Download one Canvas file to a folder on this computer. Get the file id from canvas_list_modules. ' +
      'dest_dir is an absolute path and is created if missing — ask the user where they want it rather than guessing.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string' },
        file_id: { type: 'string' },
        dest_dir: { type: 'string', description: 'Absolute destination folder, e.g. C:\\Users\\yourname\\Documents\\Canvas\\Course Name' },
        overwrite: { type: 'boolean', description: 'Replace an existing file of the same name (default false).' },
      },
      required: ['course_id', 'file_id', 'dest_dir'],
    },
    handler: async (a) => {
      if (!path.isAbsolute(a.dest_dir)) throw new Error(`dest_dir must be an absolute path, got "${a.dest_dir}"`);
      const r = await downloadOne(a.course_id, a.file_id, a.dest_dir, a.overwrite === true);
      return text(
        r.skipped
          ? `SKIPPED — "${r.name}" already exists at ${r.target} (${Math.round(r.size / 1024)} KB). Pass overwrite:true to replace it.`
          : `DOWNLOADED — ${r.name} (${Math.round(r.size / 1024)} KB)\nSaved to: ${r.target}`
      );
    },
  },
  {
    name: 'canvas_download_course_files',
    description:
      'Bulk-download every file in a course to a folder on this computer, optionally into one subfolder per Canvas module. ' +
      'Always run with dry_run:true first and show the user the plan before writing anything. ' +
      'dest_dir must come from the user — ask which folder they want rather than assuming.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string' },
        dest_dir: { type: 'string', description: 'Absolute destination folder.' },
        by_module: { type: 'boolean', description: 'Create one subfolder per module (default true).' },
        modules: { type: 'array', items: { type: 'string' }, description: 'Only download from modules whose name contains one of these strings.' },
        dry_run: { type: 'boolean', description: 'List what would be written without downloading (default false).' },
        overwrite: { type: 'boolean', description: 'Replace existing files (default false — existing files are skipped).' },
      },
      required: ['course_id', 'dest_dir'],
    },
    handler: async (a) => {
      if (!path.isAbsolute(a.dest_dir)) throw new Error(`dest_dir must be an absolute path, got "${a.dest_dir}"`);
      const byModule = a.by_module !== false;

      let items = await courseFileItems(a.course_id);
      if (a.modules?.length) {
        const want = a.modules.map((s) => s.toLowerCase());
        items = items.filter((i) => want.some((w) => i.module.toLowerCase().includes(w)));
      }
      if (!items.length) return text('No matching files found in that course.');

      const plan = items.map((i) => ({ ...i, dir: byModule ? path.join(a.dest_dir, safeName(i.module)) : a.dest_dir }));

      if (a.dry_run) {
        const lines = plan.map((p) => `  ${p.title}\n      -> ${p.dir}`);
        return text(`DRY RUN — ${plan.length} file(s) would be downloaded:\n\n` + lines.join('\n') + '\n\nRe-run with dry_run:false to download.');
      }

      const done = [];
      const failed = [];
      for (const p of plan) {
        try {
          done.push(await downloadOne(a.course_id, p.fileId, p.dir, a.overwrite === true));
        } catch (e) {
          failed.push(`${p.title}: ${e.message}`);
        }
      }
      const saved = done.filter((d) => !d.skipped);
      const skipped = done.filter((d) => d.skipped);
      const out = [
        `Downloaded ${saved.length} file(s) to ${a.dest_dir}`,
        skipped.length ? `Skipped ${skipped.length} already present (pass overwrite:true to replace).` : null,
        failed.length ? `FAILED ${failed.length}:\n  ` + failed.join('\n  ') : null,
        '',
        ...saved.map((d) => `  ${d.name} (${Math.round(d.size / 1024)} KB)\n      ${d.target}`),
      ].filter(Boolean);
      return text(out.join('\n'));
    },
  }
);

/* ---------- JSON-RPC / MCP plumbing ---------- */

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return ok(id, {
        // Mirror the client's protocol version when it sends one.
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'canvas-mcp', version: VERSION },
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notifications carry no id and take no reply

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });

    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return err(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        return ok(id, await tool.handler(params.arguments || {}));
      } catch (e) {
        // Report tool failures in-band so the model can react and retry.
        return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }

    default:
      if (id !== undefined) err(id, -32601, `Method not found: ${method}`);
  }
}

let buf = '';
let pending = 0;      // in-flight handlers
let closed = false;   // stdin reached EOF

// Exit only once every in-flight request has been answered, otherwise a client
// that closes stdin promptly would cut off replies mid-fetch.
const exitWhenDrained = () => {
  if (closed && pending === 0) process.exit(0);
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log('ignoring non-JSON line');
      continue;
    }
    pending++;
    Promise.resolve(handle(msg))
      .catch((e) => {
        log('handler crashed:', e.message);
        if (msg.id !== undefined) err(msg.id, -32603, e.message);
      })
      .finally(() => {
        pending--;
        exitWhenDrained();
      });
  }
});

process.stdin.on('end', () => {
  closed = true;
  exitWhenDrained();
});
log(`ready — ${CANVAS_URL || 'NO CANVAS_URL SET'} (tz ${TZ})`);
