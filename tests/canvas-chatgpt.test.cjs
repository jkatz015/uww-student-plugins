const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const plugin = path.resolve(__dirname, '../plugins/uww-canvas-chatgpt');
const source = fs.readFileSync(path.join(plugin, 'server/server.js'), 'utf8');
const toolNames = [
  'canvas_list_courses', 'canvas_list_assignments', 'canvas_get_assignment',
  'canvas_upcoming', 'canvas_list_discussions', 'canvas_get_discussion',
  'canvas_get_grades', 'canvas_setup_status', 'canvas_list_modules',
  'canvas_download_file', 'canvas_download_course_files',
  'canvas_submit_assignment', 'canvas_post_discussion_reply',
];

function harness(t, answers = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-tools-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const calls = [], prompts = [], replies = [];
  const due = new Date(Date.now() + 86400000).toISOString();
  const assignment = { id: 10, name: 'Test assignment', due_at: due,
    points_possible: 10, description: '<p>Test instructions</p>',
    submission_types: ['online_text_entry', 'online_url', 'online_upload'],
    html_url: 'https://canvas.test/assignment',
    submission: { score: 8, graded_at: due },
    rubric: [{ description: 'Test rubric', points: 10 }] };
  const topic = { id: 20, title: 'Test discussion', message: '<p>Test prompt</p>', posted_at: due };
  const fetch = async (url, options = {}) => {
    const u = new URL(url), method = options.method || 'GET';
    calls.push({ url: String(url), method, body: options.body });
    let data;
    if (u.pathname === '/download') return new Response('fixture file bytes');
    if (u.pathname === '/upload') return Response.json({ id: 31, filename: 'work.txt', size: 4 });
    if (method === 'POST' && u.pathname.endsWith('/submissions/self/files')) data = { upload_url: 'https://canvas.test/upload', upload_params: {} };
    else if (method === 'POST' && u.pathname.endsWith('/submissions')) data = { submitted_at: due, attempt: 1 };
    else if (method === 'POST' && /\/(entries|replies)$/.test(u.pathname)) data = { id: 21, created_at: due, message: JSON.parse(options.body).message };
    else if (u.pathname === '/api/v1/courses') data = [{ id: 1, name: 'Test course', course_code: 'TEST', workflow_state: 'available', enrollments: [{ type: 'student', computed_current_score: 80 }] }];
    else if (u.pathname.endsWith('/assignments')) data = [assignment];
    else if (u.pathname.endsWith('/assignments/10')) data = assignment;
    else if (u.pathname.endsWith('/discussion_topics')) data = [topic];
    else if (u.pathname.endsWith('/discussion_topics/20')) data = topic;
    else if (u.pathname.endsWith('/entries')) data = [{ user_name: 'Test user', message: 'Test reply', created_at: due }];
    else if (u.pathname.endsWith('/modules')) data = [{ id: 2, name: 'Module one', items: [{ type: 'File', content_id: 30, title: 'Reading' }] }];
    else if (u.pathname.endsWith('/files/30')) data = { display_name: 'reading.txt', url: 'https://canvas.test/download' };
    else throw Error(`Unexpected fixture request ${method} ${u.pathname}`);
    return Response.json(data);
  };
  const processMock = {
    platform: 'win32', env: { CANVAS_URL: 'https://canvas.test', CANVAS_TOKEN: 'fixture-token', CANVAS_ALLOW_WRITE: 'false' },
    pid: 1, stdin: Object.assign(new EventEmitter(), { setEncoding() {} }),
    stdout: { write(line) { replies.push(JSON.parse(line)); } },
    exit() { throw Error('Unexpected process exit'); },
  };
  const spawn = (_cmd, _args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = { end(message) {
      prompts.push(message);
      const answer = answers.shift();
      queueMicrotask(() => { child.stdout.emit('data', answer === true ? '6' : '7'); child.emit('close', 0); });
    } };
    return child;
  };
  const context = vm.createContext({
    require(name) {
      if (name === 'node:os') return { homedir: () => home };
      if (name === 'node:child_process') return { spawn };
      return require(name);
    },
    process: processMock, console: { error() {} }, fetch, URL, Buffer, FormData, Blob,
    setTimeout, clearTimeout,
  });
  vm.runInContext(source, context);
  let id = 0;
  const request = async (method, params) => {
    context.request = { id: ++id, method, params };
    await vm.runInContext('handle(request)', context);
    return replies.find(r => r.id === id).result;
  };
  return { home, calls, prompts, request, call: (name, args = {}) => request('tools/call', { name, arguments: args }) };
}

test('ChatGPT package declares permission for the complete server', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(plugin, '.codex-plugin/plugin.json')));
  const config = JSON.parse(fs.readFileSync(path.join(plugin, '.mcp.json'))).mcpServers['uww-canvas'];
  assert.equal(manifest.mcpServers, './.mcp.json');
  assert.equal(config.default_tools_approval_mode, 'approve');
  assert.equal(config.env.CANVAS_ALLOW_WRITE, 'false');
  assert.equal(fs.existsSync(path.join(plugin, 'plugin.json')), false, 'Portable manifest would take precedence over this MCP config');
});

test('all 13 tools execute against Canvas fixtures; downloads write actual temporary files', async t => {
  const h = harness(t, [true, true, true]);
  const listed = (await h.request('tools/list', {})).tools;
  assert.deepEqual(listed.map(x => x.name).sort(), [...toolNames].sort());
  const dest = path.join(h.home, 'downloads');
  const inputs = {
    canvas_list_courses: {}, canvas_list_assignments: { course_id: '1' },
    canvas_get_assignment: { course_id: '1', assignment_id: '10' },
    canvas_upcoming: {}, canvas_list_discussions: { course_id: '1' },
    canvas_get_discussion: { course_id: '1', topic_id: '20' },
    canvas_get_grades: {}, canvas_setup_status: {}, canvas_list_modules: { course_id: '1' },
    canvas_download_file: { course_id: '1', file_id: '30', dest_dir: dest },
    canvas_download_course_files: { course_id: '1', dest_dir: dest },
    canvas_submit_assignment: { course_id: '1', assignment_id: '10', text: 'Fixture submission' },
    canvas_post_discussion_reply: { course_id: '1', topic_id: '20', message: 'Fixture reply' },
  };
  for (const name of toolNames) {
    const result = await h.call(name, inputs[name]);
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result)}`);
    assert.ok(result.content[0].text.length, name);
  }
  assert.equal(fs.readFileSync(path.join(dest, 'reading.txt'), 'utf8'), 'fixture file bytes');
  assert.equal(fs.readFileSync(path.join(dest, 'Module one', 'reading.txt'), 'utf8'), 'fixture file bytes');
  assert.equal(h.prompts.length, 3, 'Enable once, then confirm each of the two Canvas writes');
  assert.equal(h.calls.filter(x => x.method === 'POST').length, 2);
  for (const name of ['canvas_download_file', 'canvas_download_course_files', 'canvas_submit_assignment', 'canvas_post_discussion_reply']) {
    assert.equal(listed.find(x => x.name === name).annotations.readOnlyHint, false);
  }
});

for (const [label, answers] of [['enable declined', [false]], ['action declined', [true, false]]]) {
  for (const [tool, args] of [
    ['canvas_submit_assignment', { course_id: '1', assignment_id: '10', text: 'Do not send' }],
    ['canvas_post_discussion_reply', { course_id: '1', topic_id: '20', message: 'Do not send' }],
  ]) {
    test(`${tool}: ${label} sends nothing to Canvas`, async t => {
      const h = harness(t, [...answers]);
      const result = await h.call(tool, args);
      assert.equal(result.isError, true);
      assert.equal(h.calls.filter(x => x.method !== 'GET').length, 0);
      assert.equal(h.prompts.length, answers.length);
    });
  }
}

test('downloads preview without writes and skip existing files', async t => {
  const h = harness(t);
  const dest = path.join(h.home, 'preview');
  const plan = await h.call('canvas_download_course_files', { course_id: '1', dest_dir: dest, dry_run: true });
  assert.match(plan.content[0].text, /DRY RUN/);
  assert.equal(fs.existsSync(dest), false);
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'reading.txt'), 'keep this');
  const result = await h.call('canvas_download_file', { course_id: '1', file_id: '30', dest_dir: dest });
  assert.match(result.content[0].text, /SKIPPED/);
  assert.equal(fs.readFileSync(path.join(dest, 'reading.txt'), 'utf8'), 'keep this');
  assert.equal(h.prompts.length, 0);
});

test('file and URL submissions, and replies to existing entries, retain confirmations', async t => {
  const h = harness(t, [true, true, true, true]);
  const file = path.join(h.home, 'work.txt'); fs.writeFileSync(file, 'work');
  for (const mode of [{ file_path: file }, { url: 'https://example.com/work' }]) {
    const result = await h.call('canvas_submit_assignment', { course_id: '1', assignment_id: '10', ...mode });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.match(result.content[0].text, /SUBMITTED/);
  }
  const reply = await h.call('canvas_post_discussion_reply', { course_id: '1', topic_id: '20', parent_entry_id: '22', message: 'Nested reply' });
  assert.notEqual(reply.isError, true);
  assert.equal(h.prompts.length, 4, 'One enable prompt plus three action confirmations');
});
