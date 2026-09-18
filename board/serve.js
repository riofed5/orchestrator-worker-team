#!/usr/bin/env node
/**
 * Team board — local server.
 *
 *   node board/serve.js
 *
 * Serves the board page and a small JSON API over the files in
 * board/data/. The agents read and write those same files directly,
 * so the page and the team always see one record.
 *
 * It can also start the team: POST /api/runs launches Claude Code in print
 * mode on a request and streams what it does into board/data/runs/, which
 * the page reads back live. One run at a time.
 *
 * No dependencies. Node 18 or newer.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFile, spawn } = require('child_process');
const { featureUsage, boardInsights, claudeUsage, allowanceBasis } = require('./usage');
const {
  recoverFeature, markResumed, sweepRuns, isInterrupted, stepStillOpen, writeDoc,
  continuationFor, noProgress, continueFeature, shouldPause
} = require('./recovery');

const ROOT = __dirname;
const WORKSPACE = path.resolve(ROOT, '..');
const DATA = process.env.BOARD_DATA ? path.resolve(process.env.BOARD_DATA) : path.join(ROOT, 'data');
const FEATURES = path.join(DATA, 'features');
const MESSAGES = path.join(DATA, 'messages');
const RUNS = path.join(DATA, 'runs');
const CLAUDE_FILE = path.join(DATA, 'claude.json');
const PORT = Number(process.env.PORT || 4477);
const MAX_BODY = 1_000_000;
const MAX_RUNS_LISTED = 50;
const HEARTBEAT_MS = 15_000;       // how often the active run's record is touched
const SLEEP_GAP_MS = 90_000;       // a longer gap between heartbeats means the computer slept
const STOP_CONFIRM_MS = 5_000;     // a second Ctrl+C within this window stops a busy board
const STOP_FORCE_MS = 10_000;      // the Stop button forces a run that has not stopped by then

// The dials for the lead's context (the rest are in "Context budget" in AGENTS.md).
// A session already carries about 25,000 tokens (system prompt, tools, the
// rulebook) before the lead does anything, so an absolute budget near that
// number pauses every session on its first turn and no work ever gets done.
// Measure GROWTH above whatever this session started at instead.
const LEAD_CONTEXT_GROWTH = Number(process.env.LEAD_CONTEXT_BUDGET) || 55_000;   // tokens added since the session's first turn
const LEAD_CONTEXT_CEILING = Number(process.env.LEAD_CONTEXT_CEILING) || 140_000; // backstop, whatever the growth says
const LEAD_MIN_TURNS = Number(process.env.LEAD_MIN_TURNS) || 6;                   // never pause before the lead has done real work so the board can carry on in a fresh session. Under it a still-small session keeps going, because restarting then costs more than it saves.
const EFFORT = { read: 'medium', plan: 'high', build: 'medium', resume: 'medium', inbox: 'medium', ...effortOverride() }; // per step; planning stays high because a weak plan costs a whole rework
const MAX_CONTINUATIONS = 20;      // fresh sessions the board may chain after a pause before it asks the human

function effortOverride() {
  try { return process.env.BOARD_EFFORT ? JSON.parse(process.env.BOARD_EFFORT) : {}; }
  catch { console.error('  BOARD_EFFORT is not valid JSON; using the default effort per step'); return {}; }
}

for (const dir of [DATA, FEATURES, MESSAGES, RUNS]) fs.mkdirSync(dir, { recursive: true });

const okId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);

function readAll(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))); }
    catch (e) { console.error(`  skipped ${name}: ${e.message}`); }
  }
  return out;
}

function readDoc(dir, id) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); }
  catch { return null; }
}

function readClaudeFile() {
  try { return JSON.parse(fs.readFileSync(CLAUDE_FILE, 'utf8')); } catch { return {}; }
}
function updateClaudeFile(patch) {
  const cur = readClaudeFile();
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  const tmp = CLAUDE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, CLAUDE_FILE);
  return next;
}

/* ---------- Claude Code CLI discovery ---------- */

const claudeInfo = { bin: null, version: null, source: null };

function versionKey(name) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(name);
  return m ? m.slice(1).map(Number) : [0, 0, 0];
}
function newestFirst(a, b) {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return 0;
}
function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
}

/** $CLAUDE_BIN, then PATH, then common installs, then the newest editor-bundled copy. */
function findClaude() {
  const home = os.homedir();
  const candidates = [];
  if (process.env.CLAUDE_BIN) candidates.push(['CLAUDE_BIN', process.env.CLAUDE_BIN]);
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(['PATH', path.join(dir, 'claude')]);
  }
  candidates.push(['install', path.join(home, '.local', 'bin', 'claude')]);
  candidates.push(['install', path.join(home, '.claude', 'local', 'claude')]);
  for (const editor of ['.antigravity-ide', '.vscode', '.vscode-insiders', '.cursor']) {
    const extRoot = path.join(home, editor, 'extensions');
    let names = [];
    try { names = fs.readdirSync(extRoot); } catch { continue; }
    names.filter(n => /^anthropic\.claude-code-/.test(n)).sort(newestFirst)
      .forEach(n => candidates.push([editor, path.join(extRoot, n, 'resources', 'native-binary', 'claude')]));
  }
  for (const [source, file] of candidates) {
    if (isExecutable(file)) return { bin: file, source };
  }
  return { bin: null, source: null };
}

function detectClaude() {
  Object.assign(claudeInfo, findClaude());
  if (!claudeInfo.bin) return;
  execFile(claudeInfo.bin, ['--version'], { timeout: 15000 }, (err, stdout) => {
    if (!err) claudeInfo.version = String(stdout).trim().split('\n')[0];
  });
}

/* ---------- runs ---------- */

const STEP_PROMPT = {
  read: id => `/team ${id}`,
  plan: id => `/team ${id}`,
  build: id => `/team ${id}`,
  resume: id => `/team ${id}`,
  inbox: () => '/inbox'
};
const STEP_STATUS = { read: 'new', plan: 'ready', build: 'building' };
const STEP_VERB = { read: 'read back', plan: 'planned', build: 'built', resume: 'resumed' };

let active = null; // { id, kind, feature, child, finish, stopReason }
let lastBeat = Date.now();

/** How long the computer has been asleep since the last heartbeat, or 0. */
function sleepGap() {
  const gap = Date.now() - lastBeat;
  return gap > SLEEP_GAP_MS ? gap : 0;
}
const sleptText = ms => `the computer slept for about ${ms < 90_000 ? 'a minute' : Math.round(ms / 60_000) + ' minutes'} during this run`;

/** After a run is cut off, put its request back in order so the human can resume it. */
function recoverAfter(meta, why) {
  if (!meta.feature) return;
  const doc = readDoc(FEATURES, meta.feature);
  if (!doc || !stepStillOpen(meta.step, doc.status)) return;
  recoverFeature(doc, meta, why);
  writeDoc(FEATURES, doc.id, doc);
  console.log(`  ${doc.id}: cut off, can resume from ${doc.interrupted.resumeFrom || 'the final check'}`);
}

/**
 * A build run that ended cleanly with pieces still to do paused so the lead's
 * context stays small: carry on in a fresh session from the first unfinished
 * piece. A fresh session that did not move the request on stops the chain
 * and hands the request to the human as cut off.
 */
function continueAfter(meta) {
  if (!meta.feature) return;
  const doc = readDoc(FEATURES, meta.feature);
  const next = continuationFor(doc, meta, MAX_CONTINUATIONS);
  if (!next) return;
  if (noProgress(meta, doc)) {
    recoverFeature(doc, meta, 'the lead paused but the next session did not advance');
    doc.log.push({ at: new Date().toISOString(), who: 'board', text: 'The team made no progress in a fresh session; press resume to try again.' });
    writeDoc(FEATURES, doc.id, doc);
    console.log(`  ${doc.id}: no progress in a fresh session; waiting for the human`);
    return;
  }
  let fresh;
  try {
    fresh = startRun({
      kind: 'team', feature: doc.id, step: 'build', prompt: STEP_PROMPT.build(doc.id),
      continuedFrom: meta.id, continuation: (meta.continuation || 0) + 1,
      resumeFrom: typeof next === 'string' ? null : next.id
    });
  } catch (e) {
    console.error(`  ${doc.id}: could not carry on in a fresh session (${e.message})`);
    return;
  }
  fresh.notes.push(`continued in a fresh session after run ${meta.id}`);
  writeDoc(RUNS, fresh.id, fresh);
  writeDoc(FEATURES, doc.id, continueFeature(doc, meta, fresh.id));
}

function runId() {
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/**
 * Start Claude Code in print mode and record everything it emits.
 * opts: { feature, step, prompt, model?, maxTurns?, kind, continuedFrom?, continuation?, resumeFrom? }
 * Returns the meta doc, or throws with .code = 409 | 503.
 */
function startRun(opts) {
  if (active) {
    const e = new Error(`the team is already busy with ${active.feature || 'another run'}`);
    e.code = 409; e.activeRun = active.id; throw e;
  }
  if (!claudeInfo.bin) {
    const e = new Error('Claude Code was not found on this computer; set CLAUDE_BIN or install the claude command');
    e.code = 503; throw e;
  }
  const id = runId();
  const args = ['-p', opts.prompt, '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'auto', '--permission-prompts', 'none'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
  const effort = (opts.step && EFFORT[opts.step]) || null;
  if (effort) args.push('--effort', effort);

  const meta = {
    id, kind: opts.kind || 'team', feature: opts.feature || null, step: opts.step || null,
    prompt: opts.prompt, startedAt: new Date().toISOString(), endedAt: null,
    status: 'running', exitCode: null, sessionId: null, model: opts.model || null,
    costUsd: null, numTurns: null, resultSubtype: null, lines: 0, error: null,
    heartbeatAt: null, notes: [], effort, lead: null,
    continuedFrom: opts.continuedFrom || null, continuation: opts.continuation || 0,
    resumeFrom: opts.resumeFrom || null
  };
  writeDoc(RUNS, id, meta);

  const eventsFile = path.join(RUNS, id + '.jsonl');
  const out = fs.createWriteStream(eventsFile, { flags: 'a' });
  // detached: the run gets its own process group, so a Ctrl+C in the board's
  // terminal reaches the board alone and it can refuse to stop while busy.
  const child = spawn(claudeInfo.bin, args, {
    cwd: WORKSPACE,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
    detached: true
  });
  active = { id, kind: meta.kind, feature: meta.feature, child, meta, stopReason: null, finish: null };
  lastBeat = Date.now();
  console.log(`  run ${id}: ${opts.prompt} (${meta.feature || opts.kind})`);

  let stderrTail = '';
  let finished = false;
  child.stderr.on('data', d => { stderrTail = (stderrTail + d).slice(-4000); });

  // The lead's own turns: top-level assistant events on the run's model. The
  // stream repeats a message once per content block, so each id counts once.
  const seenTurns = new Set();
  const leadTurn = ev => {
    if (ev.type !== 'assistant' || ev.parent_tool_use_id || !ev.message || !ev.message.usage) return;
    if (!meta.model || ev.message.model !== meta.model || seenTurns.has(ev.message.id)) return;
    seenTurns.add(ev.message.id);
    const u = ev.message.usage;
    const context = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const lead = meta.lead || {
      model: meta.model, turns: 0, context: 0, startContext: 0, growth: 0,
      budget: LEAD_CONTEXT_GROWTH, ceiling: LEAD_CONTEXT_CEILING, reads: 0, paused: false
    };
    lead.turns++;
    if (!lead.startContext) lead.startContext = context; // what this session costs before it does anything
    lead.context = context;
    lead.growth = Math.max(0, context - lead.startContext);
    lead.reads += context;
    meta.lead = lead;
    if (shouldPause(lead, context, LEAD_MIN_TURNS)) {
      lead.paused = true; // the lead is asked to stop between pieces; the board carries on in a fresh session
      writeDoc(RUNS, id, meta);
      console.log(`  run ${id}: the lead has added ${lead.growth.toLocaleString()} tokens since it started at ` +
        `${lead.startContext.toLocaleString()} (now ${context.toLocaleString()}); pausing between pieces`);
    }
  };

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', line => {
    if (finished || !line.trim()) return;
    out.write(line + '\n');
    meta.lines++;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'system' && ev.subtype === 'init') {
      meta.sessionId = ev.session_id || null;
      meta.model = ev.model || meta.model;
      writeDoc(RUNS, id, meta);
    } else if (ev.type === 'assistant') {
      leadTurn(ev);
    } else if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
      // A run emits several of these in different shapes: one carries the unified
      // window figures, a later "overage" one does not. Merge so nothing is lost.
      const cur = readClaudeFile().rateLimit || {};
      const info = ev.rate_limit_info;
      const merged = { ...cur, ...info };
      if (!info.unifiedWindows && cur.unifiedWindows) merged.unifiedWindows = cur.unifiedWindows;
      updateClaudeFile({ rateLimit: merged, rateLimitCheckedAt: new Date().toISOString(), rateLimitRun: id });
    } else if (ev.type === 'result') {
      meta.resultSubtype = ev.subtype || null;
      if (typeof ev.total_cost_usd === 'number') meta.costUsd = ev.total_cost_usd;
      if (typeof ev.num_turns === 'number') meta.numTurns = ev.num_turns;
      if (ev.is_error && !meta.error) meta.error = String(ev.result || ev.subtype || 'error').slice(0, 2000);
    }
  });

  const finish = (code, signal) => {
    if (finished) return;
    finished = true;
    const me = active && active.id === id ? active : null;
    if (me) active = null;
    let stopReason = me ? me.stopReason : null;
    if (!stopReason && sleepGap()) {
      meta.notes.push(sleptText(sleepGap()));
      stopReason = 'the computer went to sleep and the run did not survive it';
    }
    meta.endedAt = new Date().toISOString();
    meta.exitCode = code;
    const ok = code === 0 && meta.resultSubtype && !/error/i.test(meta.resultSubtype);
    meta.status = ok ? 'done' : 'failed';
    if (!ok) {
      // A cut-off gets the plain reason; a genuine failure keeps what the run said.
      if (stopReason) meta.error = stopReason;
      else if (signal) meta.error = meta.error || `stopped (${signal})`;
      else if (!meta.error) meta.error = (stderrTail.trim() || `exit code ${code}`).slice(-2000);
    }
    out.end();
    writeDoc(RUNS, id, meta);
    updateClaudeFile({ lastRun: { id, feature: meta.feature, step: meta.step, status: meta.status, endedAt: meta.endedAt, costUsd: meta.costUsd } });
    console.log(`  run ${id}: ${meta.status}${meta.costUsd != null ? ` ($${meta.costUsd.toFixed(2)})` : ''}`);
    if (!ok) recoverAfter(meta, stopReason || 'the run ended with an error before the team finished');
    else continueAfter(meta);
  };
  active.finish = finish;
  child.on('error', err => { meta.error = err.message; finish(-1, null); });
  child.on('close', finish);
  return meta;
}

/** Signal the run and everything it started (it is its own process group), falling back to the run alone. */
function signalRun(a, sig) {
  try { process.kill(-a.child.pid, sig); } catch { try { a.child.kill(sig); } catch {} }
}

/** Stop the active run now, recording `why` as the plain reason, and tidy its request. */
function stopActive(why) {
  const a = active;
  if (!a) return;
  a.stopReason = why;
  signalRun(a, 'SIGTERM');
  a.finish(null, 'SIGTERM');
}

/** The Stop button: ask the run to stop, and force it if it has not gone within a few seconds. */
function requestStop(why) {
  const a = active;
  a.stopReason = why;
  signalRun(a, 'SIGTERM');
  setTimeout(() => {
    if (active !== a) return;
    signalRun(a, 'SIGKILL');
    stopActive(why);
  }, STOP_FORCE_MS).unref();
}

/**
 * Every 15 s: touch the active run's record so a later start can see how
 * recent it was, notice when the computer has been asleep, and treat a run
 * that did not survive the sleep as cut off.
 */
function heartbeat() {
  const gap = sleepGap();
  lastBeat = Date.now();
  const a = active;
  if (!a) return;
  a.meta.heartbeatAt = new Date().toISOString();
  if (gap) {
    a.meta.notes.push(sleptText(gap));
    console.log(`  run ${a.id}: ${sleptText(gap)}`);
    let alive = true;
    try { process.kill(a.child.pid, 0); } catch { alive = false; }
    if (!alive) { stopActive('the computer went to sleep and the run did not survive it'); return; }
  }
  writeDoc(RUNS, a.id, a.meta);
}
setInterval(heartbeat, HEARTBEAT_MS).unref();

function listRuns() {
  return readAll(RUNS).filter(r => r && r.id)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, MAX_RUNS_LISTED);
}

function readEvents(id, since) {
  const file = path.join(RUNS, id + '.jsonl');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { events: [], next: since }; }
  const lines = text.split('\n').filter(Boolean);
  const events = [];
  for (let i = since; i < lines.length; i++) {
    try { events.push(JSON.parse(lines[i])); } catch { events.push({ type: 'raw', text: lines[i] }); }
  }
  return { events, next: lines.length };
}

/* ---------- Claude facts: service status, token usage, team roster ---------- */

const FACTS_TTL = 60_000;          // the status page reading is cached this long
const STATUS_TIMEOUT = 6_000;

let statusCache = { at: 0, data: null };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, timeout) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

/** status.claude.com, folded down to the Claude-facing components. */
async function claudeStatus() {
  const now = Date.now();
  if (statusCache.data && now - statusCache.at < FACTS_TTL) return { ...statusCache.data, cached: true };
  const fetchedAt = new Date().toISOString();
  try {
    const [comp, overall] = await Promise.all([
      fetchJson('https://status.claude.com/api/v2/components.json', STATUS_TIMEOUT),
      fetchJson('https://status.claude.com/api/v2/status.json', STATUS_TIMEOUT)
    ]);
    const data = {
      overall: {
        indicator: (overall && overall.status && overall.status.indicator) || null,
        description: (overall && overall.status && overall.status.description) || null
      },
      components: ((comp && comp.components) || [])
        .filter(c => c && typeof c.name === 'string' && /claude/i.test(c.name))
        .map(c => ({ name: c.name, status: c.status || null })),
      updatedAt: (comp && comp.page && comp.page.updated_at) || null,
      fetchedAt
    };
    statusCache = { at: now, data };
    return { ...data, cached: false };
  } catch (e) {
    console.error('  status page: ' + e.message);
    return { error: 'could not reach the status page', fetchedAt, cached: false };
  }
}

/** Which model each seat on the team actually runs on, straight from the config files. */
function claudeRoster() {
  const settings = path.join('.claude', 'settings.json');
  let senior = null;
  try { senior = JSON.parse(fs.readFileSync(path.join(WORKSPACE, settings), 'utf8')).model || null; } catch {}
  const roster = { senior: { model: senior, source: settings } };
  for (const agent of ['mid-dev', 'junior-dev']) {
    const rel = path.join('.claude', 'agents', agent + '.md');
    let model = null;
    try {
      const text = fs.readFileSync(path.join(WORKSPACE, rel), 'utf8');
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      const m = front && /^model:[ \t]*(.+?)[ \t]*$/m.exec(front[1]);
      if (m) model = m[1].replace(/^["']|["']$/g, '') || null;
    } catch {}
    roster[agent] = { model, source: rel };
  }
  return roster;
}

/* ---------- http ---------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    if (p === '/api/state' && req.method === 'GET') {
      return json(res, 200, { features: readAll(FEATURES), messages: readAll(MESSAGES) });
    }

    if (p.startsWith('/api/features/')) {
      const rest = p.slice('/api/features/'.length).split('/');
      const id = decodeURIComponent(rest[0]);
      if (!okId(id)) return json(res, 400, { error: 'bad id' });
      if (req.method === 'GET' && rest[1] === 'usage' && rest.length === 2) {
        if (!readDoc(FEATURES, id)) return json(res, 404, { error: 'no such request' });
        return json(res, 200, featureUsage(id, { dataDir: DATA }));
      }
      if (req.method === 'PUT') {
        const doc = await readBody(req);
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return json(res, 400, { error: 'expected an object' });
        doc.id = id;
        writeDoc(FEATURES, id, doc);
        console.log(`  saved ${id} (${doc.status})`);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        try { fs.unlinkSync(path.join(FEATURES, id + '.json')); } catch {}
        for (const m of readAll(MESSAGES)) {
          if (m.feature === id && okId(m.id)) { try { fs.unlinkSync(path.join(MESSAGES, m.id + '.json')); } catch {} }
        }
        for (const r of readAll(RUNS)) {
          if (r.feature === id && okId(r.id) && !(active && active.id === r.id)) {
            for (const ext of ['.json', '.jsonl']) { try { fs.unlinkSync(path.join(RUNS, r.id + ext)); } catch {} }
          }
        }
        console.log(`  deleted ${id}`);
        return json(res, 200, { ok: true });
      }
    }

    if (p === '/api/insights' && req.method === 'GET') {
      return json(res, 200, boardInsights({ dataDir: DATA }));
    }

    if (p === '/api/messages' && req.method === 'POST') {
      const doc = await readBody(req);
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return json(res, 400, { error: 'expected an object' });
      const id = 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      doc.id = id;
      writeDoc(MESSAGES, id, doc);
      return json(res, 200, { ok: true, id });
    }

    if (p.startsWith('/api/messages/')) {
      const id = decodeURIComponent(p.slice('/api/messages/'.length));
      if (!okId(id)) return json(res, 400, { error: 'bad id' });
      const file = path.join(MESSAGES, id + '.json');
      if (req.method === 'PATCH') {
        let cur;
        try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch { return json(res, 404, { error: 'no such message' }); }
        writeDoc(MESSAGES, id, { ...cur, ...(await readBody(req)), id });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        try { fs.unlinkSync(file); } catch {}
        return json(res, 200, { ok: true });
      }
    }

    /* ----- runs: start the team and watch it ----- */

    if (p === '/api/runs' && req.method === 'GET') {
      return json(res, 200, { runs: listRuns(), activeRun: active ? active.id : null });
    }

    if (p === '/api/runs' && req.method === 'POST') {
      const body = await readBody(req);
      const step = String(body.step || '');
      if (!STEP_PROMPT[step]) return json(res, 400, { error: 'step must be read, plan, build, resume or inbox' });
      let feature = null, doc = null;
      if (step !== 'inbox') {
        feature = String(body.feature || '');
        if (!okId(feature)) return json(res, 400, { error: 'bad feature id' });
        doc = readDoc(FEATURES, feature);
        if (!doc) return json(res, 404, { error: 'no such request' });
        if (step === 'resume') {
          if (!stepStillOpen('resume', doc.status) || !isInterrupted(doc)) {
            return json(res, 409, { error: `this request is "${doc.status}" and was not cut off, so there is nothing to resume` });
          }
        } else if (doc.status !== STEP_STATUS[step]) {
          return json(res, 409, { error: `this request is "${doc.status}", so it cannot be ${STEP_VERB[step]} right now` });
        }
      }
      try {
        const meta = startRun({ kind: 'team', feature, step, prompt: STEP_PROMPT[step](feature) });
        if (step === 'resume') writeDoc(FEATURES, feature, markResumed(doc, meta.id));
        return json(res, 200, { ok: true, run: meta });
      } catch (e) {
        return json(res, e.code || 500, { error: e.message, activeRun: e.activeRun || null });
      }
    }

    if (p.startsWith('/api/runs/')) {
      const rest = p.slice('/api/runs/'.length).split('/');
      const id = decodeURIComponent(rest[0]);
      if (!okId(id)) return json(res, 400, { error: 'bad id' });
      if (req.method === 'GET' && rest.length === 1) {
        const meta = readDoc(RUNS, id);
        if (!meta) return json(res, 404, { error: 'no such run' });
        const since = Math.max(0, Number(url.searchParams.get('since') || 0) | 0);
        const { events, next } = readEvents(id, since);
        return json(res, 200, { run: meta, since, events, next, active: !!(active && active.id === id) });
      }
      if (req.method === 'POST' && rest[1] === 'stop') {
        if (!active || active.id !== id) return json(res, 409, { error: 'that run is not running' });
        requestStop('stopped from the board');
        return json(res, 200, { ok: true });
      }
    }

    /* ----- claude facts: status page, token usage, roster, ping ----- */

    if (p === '/api/claude/status' && req.method === 'GET') {
      return json(res, 200, await claudeStatus());
    }

    if (p === '/api/claude/usage' && req.method === 'GET') {
      return json(res, 200, claudeUsage());
    }

    if (p === '/api/claude/allowance' && req.method === 'GET') {
      try { return json(res, 200, allowanceBasis({ dataDir: DATA })); }
      catch (e) { return json(res, 200, { error: e.message }); }
    }

    if (p === '/api/claude/roster' && req.method === 'GET') {
      return json(res, 200, claudeRoster());
    }

    if (p === '/api/claude/ping' && req.method === 'POST') {
      let meta;
      try {
        meta = startRun({
          kind: 'ping', prompt: 'Reply with exactly the word OK and nothing else.',
          model: 'haiku', maxTurns: 1
        });
      } catch (e) {
        return json(res, e.code || 500, { error: e.message, activeRun: e.activeRun || null });
      }
      const deadline = Date.now() + 60_000;
      let run = meta;
      while (run.status === 'running' && Date.now() < deadline) {
        await sleep(500);
        run = readDoc(RUNS, meta.id) || run;
      }
      const c = readClaudeFile();
      return json(res, 200, {
        ok: run.status === 'done', run, timedOut: run.status === 'running',
        rateLimit: c.rateLimit || null, rateLimitCheckedAt: c.rateLimitCheckedAt || null
      });
    }

    if (p === '/api/claude/info' && req.method === 'GET') {
      const c = readClaudeFile();
      return json(res, 200, {
        bin: claudeInfo.bin, version: claudeInfo.version, source: claudeInfo.source,
        workspace: WORKSPACE, activeRun: active ? active.id : null,
        rateLimit: c.rateLimit || null, rateLimitCheckedAt: c.rateLimitCheckedAt || null, lastRun: c.lastRun || null
      });
    }

    if (req.method === 'GET' && (p === '/' || p === '/index.html' || p === '/usage' || /^\/requests\/F-\d+$/.test(p))) {
      const html = fs.readFileSync(path.join(ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('  ' + e.message);
    json(res, 400, { error: e.message });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error(`The board may already be running at http://localhost:${PORT}`);
    console.error(`To use a different port:  PORT=4478 node board/serve.js\n`);
    process.exit(1);
  }
  throw e;
});

/**
 * A stop request while the team is busy is refused once, with a warning;
 * a second one within a few seconds stops the run and marks it as cut off
 * so the request can be resumed from the board.
 */
let stopAskedAt = 0;
function onStopSignal() {
  if (active && Date.now() - stopAskedAt > STOP_CONFIRM_MS) {
    stopAskedAt = Date.now();
    console.log(`\n  The team is busy with ${active.feature || active.kind} (run ${active.id}).`);
    console.log(`  Press Ctrl+C again within ${STOP_CONFIRM_MS / 1000} seconds to stop it anyway; the request will be marked as cut off so you can resume it from the board.\n`);
    return;
  }
  stopActive('stopped when the board was stopped');
  process.exit(0);
}
process.on('SIGINT', onStopSignal);
process.on('SIGTERM', onStopSignal);

module.exports = { startRun, listRuns, readEvents, claudeInfo, readClaudeFile, updateClaudeFile, WORKSPACE, RUNS };

detectClaude();
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  // Only the board that owns the port sweeps: anything still marked as running
  // from before this start was cut off with the previous board.
  for (const { run, features } of sweepRuns(DATA, 'stopped when the board was restarted')) {
    console.log(`  run ${run.id}: was still marked as running; marked stopped${features.length ? ` and ${features.join(', ')} can be resumed` : ''}`);
  }
  const n = readAll(FEATURES).length;
  console.log(`\n  Team board running at ${url}`);
  console.log(`  ${n} request${n === 1 ? '' : 's'} in board/data/`);
  console.log(claudeInfo.bin ? `  Claude Code: ${claudeInfo.bin} (${claudeInfo.source})` : '  Claude Code: not found (set CLAUDE_BIN to enable runs from the board)');
  console.log(`  Stop it with Ctrl+C\n`);
  if (process.platform === 'darwin' && process.env.NO_OPEN !== '1') execFile('open', [url], () => {});
});
