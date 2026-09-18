#!/usr/bin/env node
/**
 * Team board — what a request really cost.
 *
 *   node board/usage.js F-6            what one request used, per model and per stage
 *   node board/usage.js lessons        what every finished request has taught us
 *   node board/usage.js compare F-10 F-12   what the lead read per run, against a baseline
 *   node board/usage.js F-6 --json     the same as the board's API returns
 *
 * Reads the run records the board's server writes into board/data/runs/:
 * the last "result" event of each r-<id>.jsonl carries per-model tokens and
 * cost for the whole run. Nothing here writes to the board, and nothing is
 * sent anywhere; it only adds up what is already on disk.
 *
 * No dependencies. Node 18 or newer.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DATA = path.join(__dirname, 'data');

/** Dollar bands behind "under / about / over" for each forecast label. A first guess; tune as requests finish. */
const FORECAST_BANDS = { low: [0, 2], medium: [2, 6], high: [6, Infinity] };
const STEPS = ['read', 'plan', 'build'];
const STEP_TEXT = { read: 'reading it back', plan: 'planning', build: 'building' };
const DEFAULT_MODEL = { JUNIOR: 'haiku-4.5', MID: 'sonnet-5', SENIOR: 'opus-5' };
// What the default used to be, so older records do not read as "raised".
const WAS_DEFAULT = { SENIOR: 'fable-5.1' };
const raisedAbove = t => t.level && t.model && DEFAULT_MODEL[t.level] &&
  t.model !== DEFAULT_MODEL[t.level] && t.model !== WAS_DEFAULT[t.level];
const MODEL_NAME = {
  'haiku-4.5': 'Haiku 4.5', 'sonnet-5': 'Sonnet 5', 'opus-5': 'Opus 5', 'fable-5.1': 'Fable 5.1',
  'claude-haiku-4-5-20251001': 'Haiku 4.5', 'claude-haiku-4-5': 'Haiku 4.5', 'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-5': 'Opus 5', 'claude-fable-5-1': 'Fable 5.1'
};
/** Senior-model share of the spend at or above this is called "most of the spend". */
const SENIOR_SHARE_HIGH = 0.75;
/** A tool result of this many characters or more (about 4,000 tokens) was pulled into the lead's context whole. */
const BIG_RESULT_CHARS = 16000;
/** The request every later one is measured against. */
const BASELINE_FEATURE = 'F-10';
/**
 * Dollars per million tokens: list prices, September 2026, at the 1-hour
 * cache-write rate the lead's runs use. Used only to split the lead's cost
 * into shares; the recorded cost stays the board's figure.
 */
const LEAD_LIST_PRICE = {
  'claude-fable-5-1': { input: 10, cacheRead: 0.25, cacheWrite: 20, output: 50 },
  'claude-opus-5': { input: 5, cacheRead: 0.5, cacheWrite: 10, output: 25 },
  'claude-sonnet-5': { input: 2, cacheRead: 0.2, cacheWrite: 4, output: 10 },
  'claude-haiku-4-5-20251001': { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 5 },
  'claude-haiku-4-5': { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 5 }
};

const okId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const money = n => '$' + (Number(n) || 0).toFixed(2);
const pct = x => Math.round(x * 100) + '%';
const modelName = m => MODEL_NAME[m] || m;
const num = n => Math.round(Number(n) || 0).toLocaleString('en-US');
/** Round a big count to the nearest thousand, so a plain line reads like a figure and not a serial number. */
const roundish = n => (Math.abs(n) >= 10000 ? Math.round(n / 1000) * 1000 : Math.round(n));
/** (mine - base) / base, where a negative number is an improvement; null when either side is missing. */
const changeFrom = (mine, base) => (typeof mine === 'number' && typeof base === 'number' && base ? (mine - base) / base : null);
const changeWords = change => (change == null ? 'not comparable'
  : Math.abs(change) < 0.005 ? 'about the same' : `${pct(Math.abs(change))} ${change < 0 ? 'less' : 'more'}`);
const comparedWith = (change, other) => (change == null ? `not comparable with ${other}`
  : Math.abs(change) < 0.005 ? `about the same as ${other}` : `${changeWords(change)} than ${other}`);

/** What each kind of token in a bucket costs at list price, or null for a model we have no price for. */
function priced(model, tokens) {
  const p = LEAD_LIST_PRICE[model];
  if (!p) return null;
  return {
    input: (tokens.input || 0) * p.input / 1e6,
    cacheRead: (tokens.cacheRead || 0) * p.cacheRead / 1e6,
    cacheWrite: (tokens.cacheWrite || 0) * p.cacheWrite / 1e6,
    output: (tokens.output || 0) * p.output / 1e6
  };
}

/** The same costs as shares of one, so they can be read as "most of it was X". */
function shareOf(costs) {
  if (!costs) return null;
  const total = costs.input + costs.cacheRead + costs.cacheWrite + costs.output;
  if (!(total > 0)) return null;
  return { input: costs.input / total, cacheRead: costs.cacheRead / total,
    cacheWrite: costs.cacheWrite / total, output: costs.output / total };
}

const emptyBucket = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });

function addBucket(into, from) {
  into.input += from.input || 0;
  into.output += from.output || 0;
  into.cacheRead += from.cacheRead || 0;
  into.cacheWrite += from.cacheWrite || 0;
  into.costUsd += from.costUsd || 0;
}

function addModels(into, models) {
  for (const [m, b] of Object.entries(models || {})) {
    if (!into[m]) into[m] = emptyBucket();
    addBucket(into[m], b);
  }
}

/** Zeroed token fields, for a stage or run nothing was recorded for. */
const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

/** Every token in a map of per-model buckets, as one {input,output,cacheRead,cacheWrite,total}. */
function tokensOfBucketMap(map) {
  const t = zeroTokens();
  for (const b of Object.values(map || {})) {
    t.input += Number(b.input) || 0;
    t.output += Number(b.output) || 0;
    t.cacheRead += Number(b.cacheRead) || 0;
    t.cacheWrite += Number(b.cacheWrite) || 0;
  }
  t.total = t.input + t.output + t.cacheRead + t.cacheWrite;
  return t;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/* ---------- one run ---------- */

const runCache = new Map(); // id -> { key, data }

/**
 * Tokens and cost of one run, from the LAST result event in r-<id>.jsonl.
 * A run that is still going, or that died before reporting, is { recorded: false }.
 */
function runUsage(id, opts = {}) {
  const runsDir = opts.runsDir || path.join(DEFAULT_DATA, 'runs');
  const empty = { recorded: false, costUsd: null, models: {} };
  if (!okId(id)) return empty;
  const file = path.join(runsDir, id + '.jsonl');
  let stat;
  try { stat = fs.statSync(file); } catch { return empty; }
  const key = stat.size + ':' + stat.mtimeMs;
  const hit = runCache.get(id);
  if (hit && hit.key === key) return hit.data;

  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return empty; }
  const lines = text.split('\n');
  let data = empty;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"type":"result"')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || ev.type !== 'result') continue;
    const models = {};
    for (const [m, u] of Object.entries(ev.modelUsage || {})) {
      if (!u || typeof u !== 'object') continue;
      models[m] = {
        input: Number(u.inputTokens) || 0,
        output: Number(u.outputTokens) || 0,
        cacheRead: Number(u.cacheReadInputTokens) || 0,
        cacheWrite: Number(u.cacheCreationInputTokens) || 0,
        costUsd: Number(u.costUSD) || 0
      };
    }
    const fromModels = Object.values(models).reduce((s, b) => s + b.costUsd, 0);
    const costUsd = typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : fromModels;
    data = { recorded: true, costUsd, models };
    break;
  }
  runCache.set(id, { key, data });
  return data;
}

/* ---------- the lead engineer's own share of one run ---------- */

const leadCache = new Map(); // id -> { key, data }
const NO_LEAD = { recorded: false };

/**
 * What the lead engineer itself did in one run: how much it read (cached and
 * uncached), how much new material entered its context, how much it wrote, how
 * many turns it took and how many big tool results it pulled in whole.
 *
 * Worker turns carry a parent_tool_use_id and are left out. The stream repeats
 * the same message once per content block, so each message id is counted once.
 */
function leadUsage(id, opts = {}) {
  const runsDir = opts.runsDir || path.join(DEFAULT_DATA, 'runs');
  if (!okId(id)) return NO_LEAD;
  const file = path.join(runsDir, id + '.jsonl');
  let stat;
  try { stat = fs.statSync(file); } catch { return NO_LEAD; }
  const key = stat.size + ':' + stat.mtimeMs;
  const hit = leadCache.get(id);
  if (hit && hit.key === key) return hit.data;

  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return NO_LEAD; }
  const meta = readJson(path.join(runsDir, id + '.json'));
  let model = (meta && meta.model) || null;

  const turns = new Map(); // message id -> the turn, counted once
  const order = [];
  const toolResults = { count: 0, chars: 0, big: 0 };
  let result = null;

  for (const line of text.split('\n')) {
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || ev.parent_tool_use_id) continue;
    const message = ev.message || null;
    if (ev.type === 'assistant' && message && message.model && message.id) {
      if (!model) model = message.model;
      if (message.model !== model) continue;
      const u = message.usage || {};
      const seen = turns.get(message.id);
      if (!seen) {
        turns.set(message.id, {
          input: Number(u.input_tokens) || 0,
          cacheRead: Number(u.cache_read_input_tokens) || 0,
          cacheWrite: Number(u.cache_creation_input_tokens) || 0,
          output: Number(u.output_tokens) || 0
        });
        order.push(message.id);
      } else {
        seen.output = Math.max(seen.output, Number(u.output_tokens) || 0);
      }
    } else if (ev.type === 'user' && message && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block || block.type !== 'tool_result') continue;
        const c = block.content;
        const chars = typeof c === 'string' ? c.length : (Array.isArray(c) ? JSON.stringify(c).length : 0);
        toolResults.count++;
        toolResults.chars += chars;
        if (chars >= BIG_RESULT_CHARS) toolResults.big++;
      }
    } else if (ev.type === 'result') {
      result = ev;
    }
  }

  let data = NO_LEAD;
  if (order.length) {
    let input = 0, cacheRead = 0, cacheWrite = 0, written = 0;
    const context = [];
    for (const messageId of order) {
      const t = turns.get(messageId);
      input += t.input; cacheRead += t.cacheRead; cacheWrite += t.cacheWrite; written += t.output;
      context.push(t.input + t.cacheRead + t.cacheWrite);
    }
    const reads = input + cacheRead + cacheWrite;
    const usage = result && result.modelUsage ? result.modelUsage[model] : null;
    // A turn's own events carry only a partial output count while the answer is
    // still streaming; the run's result event holds the whole of what was written.
    const output = usage && Number(usage.outputTokens) ? Number(usage.outputTokens) : written;
    const tokens = { input, cacheRead, cacheWrite, output };
    data = {
      recorded: true, model, turns: order.length, reads, input, cacheRead, cacheWrite, output,
      thinking: usage ? Number(usage.thinkingTokens) || 0 : 0,
      costUsd: usage && typeof usage.costUSD === 'number' ? usage.costUSD : null,
      context: {
        first: context[0],
        last: context[context.length - 1],
        max: Math.max(...context),
        mean: Math.round(reads / order.length)
      },
      toolResults,
      share: shareOf(priced(model, tokens))
    };
  }
  leadCache.set(id, { key, data });
  return data;
}

/* ---------- one request ---------- */

function listFeatureRuns(id, runsDir) {
  let names = [];
  try { names = fs.readdirSync(runsDir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const meta = readJson(path.join(runsDir, name));
    if (meta && meta.id && meta.feature === id) out.push(meta);
  }
  return out.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

/** When a request finished: its log's last line, or its last-updated time if there is no log. */
function finishedAtFor(feature) {
  if (!feature) return null;
  const lastLog = Array.isArray(feature.log) && feature.log.length ? feature.log[feature.log.length - 1] : null;
  return (lastLog && lastLog.at) || feature.updatedAt || null;
}

/** What a request cost in total, straight from its runs, with no recursion into its own neighbours or lessons. */
function totalCostFor(id, runsDir) {
  let total = 0, any = false;
  for (const meta of listFeatureRuns(id, runsDir)) {
    const u = runUsage(meta.id, { runsDir });
    if (u.recorded) { total += u.costUsd; any = true; }
  }
  return any ? total : null;
}

/** The two most recently finished requests the same size as this one, newest first, this one left out. */
function sizeNeighbours(id, size, dataDir) {
  if (!size) return [];
  const runsDir = path.join(dataDir, 'runs');
  return listFeatures(dataDir)
    .filter(f => f.status === 'done' && f.id !== id && f.size === size)
    .map(f => ({ feature: f.id, title: f.title || null, size: f.size,
      finishedAt: finishedAtFor(f), totalCostUsd: totalCostFor(f.id, runsDir) }))
    .sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))
    .slice(0, 2);
}

function verdictFor(label, totalCostUsd) {
  const band = FORECAST_BANDS[label];
  if (!band || typeof totalCostUsd !== 'number') return null;
  if (totalCostUsd < band[0]) return 'under';
  if (totalCostUsd > band[1]) return 'over';
  return 'about';
}

const VERDICT_TEXT = {
  under: 'under what we forecast',
  about: 'about what we forecast',
  over: 'over what we forecast, which is worth a look'
};

const emptyStep = () => ({ costUsd: null, models: {}, runs: 0, recorded: false,
  tokens: zeroTokens(), lead: { reads: 0, turns: 0, cacheWrite: 0, output: 0 } });

const emptyLeadSummary = () => ({ turns: 0, reads: 0, cacheRead: 0, cacheWrite: 0, output: 0,
  big: 0, runs: 0, costUsd: 0, readsPerRun: null, cachedShare: null, share: null, baseline: null });

/** How this request's lead figures compare with the baseline request; null when either side has none. */
function leadBaseline(lead, steps, dataDir) {
  const base = featureUsage(BASELINE_FEATURE, { dataDir });
  if (!lead.runs || !base.lead.runs) return null;
  const byStage = {};
  for (const s of ['plan', 'build']) {
    const mine = steps[s] && steps[s].lead.reads ? steps[s].lead.reads : null;
    const theirs = base.steps[s] && base.steps[s].lead.reads ? base.steps[s].lead.reads : null;
    byStage[s] = { change: changeFrom(mine, theirs) };
  }
  return {
    feature: BASELINE_FEATURE,
    readsPerRun: { change: changeFrom(lead.readsPerRun, base.lead.readsPerRun) },
    costUsd: { change: changeFrom(lead.costUsd, base.lead.costUsd) },
    byStage
  };
}

/**
 * Everything a request used, added up per stage and per model, with a
 * forecast verdict and plain lessons. Never throws on missing data.
 */
function featureUsage(id, opts = {}) {
  const dataDir = opts.dataDir || DEFAULT_DATA;
  const runsDir = path.join(dataDir, 'runs');
  const feature = okId(id) ? readJson(path.join(dataDir, 'features', id + '.json')) : null;
  const forecastCost = feature && feature.plan && feature.plan.forecast ? feature.plan.forecast.cost || null : null;

  const steps = {};
  for (const s of STEPS) steps[s] = emptyStep();
  const models = {};
  const runs = [];
  const modelRunStats = {}; // model -> { runs, sum, max } of that run's total tokens
  const lead = emptyLeadSummary();
  const leadCost = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let totalCostUsd = 0, unrecorded = 0, recordedRuns = 0, seniorCostUsd = 0;

  for (const meta of listFeatureRuns(id, runsDir)) {
    const u = runUsage(meta.id, { runsDir });
    const l = leadUsage(meta.id, { runsDir });
    const step = meta.step || 'other';
    if (!steps[step]) steps[step] = emptyStep();
    steps[step].runs++;
    runs.push({ id: meta.id, step, status: meta.status || null, startedAt: meta.startedAt || null,
      model: meta.model || null, costUsd: u.recorded ? u.costUsd : null, recorded: u.recorded, lead: l,
      tokens: u.recorded ? tokensOfBucketMap(u.models) : zeroTokens() });
    if (l.recorded) {
      lead.runs++;
      lead.turns += l.turns;
      lead.reads += l.reads;
      lead.cacheRead += l.cacheRead;
      lead.cacheWrite += l.cacheWrite;
      lead.output += l.output;
      lead.big += l.toolResults.big;
      lead.costUsd += l.costUsd || 0;
      const st = steps[step].lead;
      st.reads += l.reads; st.turns += l.turns; st.cacheWrite += l.cacheWrite; st.output += l.output;
      const c = priced(l.model, l);
      if (c) for (const k of Object.keys(leadCost)) leadCost[k] += c[k];
    }
    if (!u.recorded) { unrecorded++; continue; }
    recordedRuns++;
    steps[step].recorded = true;
    steps[step].costUsd = (steps[step].costUsd || 0) + u.costUsd;
    addModels(steps[step].models, u.models);
    addModels(models, u.models);
    totalCostUsd += u.costUsd;
    if (meta.model && u.models[meta.model]) seniorCostUsd += u.models[meta.model].costUsd;
    for (const [m, b] of Object.entries(u.models)) {
      const total = (Number(b.input) || 0) + (Number(b.output) || 0) + (Number(b.cacheRead) || 0) + (Number(b.cacheWrite) || 0);
      if (!modelRunStats[m]) modelRunStats[m] = { runs: 0, sum: 0, max: 0 };
      const st = modelRunStats[m];
      st.runs++; st.sum += total; st.max = Math.max(st.max, total);
    }
  }

  for (const s of Object.keys(steps)) steps[s].tokens = steps[s].recorded ? tokensOfBucketMap(steps[s].models) : zeroTokens();
  for (const [m, b] of Object.entries(models)) {
    b.total = (b.input || 0) + (b.output || 0) + (b.cacheRead || 0) + (b.cacheWrite || 0);
    const st = modelRunStats[m] || { runs: 0, sum: 0, max: 0 };
    b.runs = st.runs;
    b.avgTotalPerRun = st.runs ? st.sum / st.runs : null;
    b.maxTotalPerRun = st.runs ? st.max : null;
  }

  if (lead.runs) {
    lead.readsPerRun = lead.reads / lead.runs;
    lead.cachedShare = lead.reads > 0 ? lead.cacheRead / lead.reads : null;
    lead.share = shareOf(leadCost);
  } else {
    lead.costUsd = null;
  }
  if (id !== BASELINE_FEATURE) lead.baseline = leadBaseline(lead, steps, dataDir);

  const size = feature ? feature.size || null : null;
  const neighbourItems = feature ? sizeNeighbours(id, size, dataDir) : [];
  const neighbourCosts = neighbourItems.map(n => n.totalCostUsd).filter(c => typeof c === 'number');
  const neighbourAvg = neighbourCosts.length ? neighbourCosts.reduce((s, c) => s + c, 0) / neighbourCosts.length : null;

  const recorded = recordedRuns > 0;
  const tokens = recorded ? tokensOfBucketMap(models) : null;
  const basis = opts.allowanceBasis || allowanceBasis({ dataDir, usage: opts.usage });
  const allowance = {};
  for (const name of Object.keys(ALLOWANCE_WINDOWS)) {
    allowance[name] = tokens ? allowanceShare(basis, tokens.total, name) : null;
  }
  let dominantStep = null;
  if (tokens && tokens.total > 0) {
    for (const s of STEPS) {
      const st = steps[s];
      if (st.recorded && st.tokens.total > tokens.total / 2) {
        dominantStep = { step: s, share: st.tokens.total / tokens.total };
        break;
      }
    }
  }
  const missingSteps = STEPS.filter(s => !steps[s].recorded);
  const verdict = recorded ? verdictFor(forecastCost, totalCostUsd) : null;
  let plain;
  if (!recorded) plain = 'nothing was recorded to compare with the forecast';
  else if (!forecastCost) plain = 'there was no forecast to compare with';
  else plain = VERDICT_TEXT[verdict];
  if (recorded && unrecorded) plain += `; ${unrecorded === 1 ? 'one run was' : unrecorded + ' runs were'} not recorded, so the real figure is higher`;

  const out = {
    feature: id, title: feature ? feature.title || null : null, recorded,
    runs, steps, models, lead, totalCostUsd: recorded ? totalCostUsd : null,
    tokens, allowance, dominantStep,
    seniorShare: recorded && totalCostUsd > 0 ? seniorCostUsd / totalCostUsd : null,
    unrecorded, missingSteps,
    forecast: { cost: forecastCost, verdict, plain },
    neighbours: { items: neighbourItems, change: changeFrom(recorded ? totalCostUsd : null, neighbourAvg) },
    lessons: []
  };
  out.lessons = recorded ? featureLessons(out, feature) : [];
  return out;
}

/* ---------- lessons ---------- */

function featureLessons(u, feature) {
  const lines = [];
  const total = u.totalCostUsd;
  const runsText = `${u.runs.length - u.unrecorded} recorded run${u.runs.length - u.unrecorded === 1 ? '' : 's'}`;

  const partial = u.unrecorded > 0 || u.missingSteps.length > 0;
  if (u.forecast.verdict) {
    const label = u.forecast.cost + '-cost';
    const how = u.forecast.verdict === 'about' ? 'about on' : u.forecast.verdict;
    lines.push(partial
      ? `So far the job is ${how} the ${label} forecast: ${money(total)} over ${runsText}, with some work not recorded yet.`
      : `The job came in ${how} the ${label} forecast: ${money(total)} over ${runsText}.`);
  } else if (!u.forecast.cost) {
    lines.push(`The job cost ${money(total)} over ${runsText}; there was no forecast to compare with.`);
  }

  if (u.seniorShare != null) {
    if (u.seniorShare >= SENIOR_SHARE_HIGH) {
      lines.push(`Most of the spend (${pct(u.seniorShare)}) was the lead engineer reading, planning and reviewing; the workers' share was small.`);
    } else if (u.seniorShare < 0.5) {
      lines.push(`More than half the spend (${pct(1 - u.seniorShare)}) went to the workers, so the pieces were sized well for handing out.`);
    }
  }

  if (u.lead.runs) {
    const perRun = `The lead read ${num(roundish(u.lead.readsPerRun))} words per run`;
    if (u.feature === BASELINE_FEATURE) lines.push(`${perRun}; this is the baseline request.`);
    else if (u.lead.baseline) lines.push(`${perRun}; ${comparedWith(u.lead.baseline.readsPerRun.change, BASELINE_FEATURE)}.`);
    else lines.push(`${perRun}.`);
  }

  const readPlan = (u.steps.read.costUsd || 0) + (u.steps.plan.costUsd || 0);
  const build = u.steps.build.costUsd;
  if ((u.steps.read.recorded || u.steps.plan.recorded) && u.steps.build.recorded) {
    if (readPlan > build) {
      lines.push(`Reading back and planning cost more than building (${money(readPlan)} against ${money(build)}); a lighter plan may do for jobs like this.`);
    } else {
      lines.push(`Building was the main cost (${money(build)} of ${money(total)}); reading back and planning stayed at ${money(readPlan)}.`);
    }
  }
  if (u.missingSteps.length) {
    lines.push(`No figures were recorded for ${u.missingSteps.map(s => STEP_TEXT[s]).join(' or ')}, so the total only covers the stages that ran from the board.`);
  }

  const allTasks = (feature && Array.isArray(feature.tasks)) ? feature.tasks : [];
  const tasks = allTasks.length && allTasks.every(t => t.status === 'done') ? allTasks : [];
  let redone = 0;
  for (const t of tasks) {
    const attempts = Number(t.attempts) || 0;
    const name = t.title ? `'${t.title}'` : (t.id || 'a piece');
    if (t.escalated) {
      redone++;
      lines.push(`The piece ${name} had to ask for help on ${modelName(t.model)}; giving work like it a higher level from the start would save a round trip.`);
    } else if (attempts > 1) {
      redone++;
      lines.push(`The piece ${name} was redone ${attempts - 1 === 1 ? 'once' : (attempts - 1) + ' times'} on ${modelName(t.model)}; starting it on a stronger model may be cheaper next time.`);
    }
  }
  if (tasks.length && !redone) {
    const stronger = tasks.filter(raisedAbove);
    if (!stronger.length) lines.push('Every piece passed first time on the usual model for its level, so the model choices were right.');
    else lines.push(`Every piece passed first time; ${stronger.length === 1 ? 'one piece' : stronger.length + ' pieces'} ran on a stronger model than usual, which paid off.`);
  }

  const used = Object.entries(u.models).sort((a, b) => a[1].costUsd - b[1].costUsd);
  if (used.length >= 2) {
    const [cheapId, cheap] = used[0];
    const [dearId, dear] = used[used.length - 1];
    lines.push(`The cheapest model used was ${modelName(cheapId)} at ${money(cheap.costUsd)}; the dearest was ${modelName(dearId)} at ${money(dear.costUsd)}.`);
  } else if (used.length === 1) {
    lines.push(`Only ${modelName(used[0][0])} did work on this request.`);
  }
  return lines;
}

function listFeatures(dataDir) {
  const dir = path.join(dataDir, 'features');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(n => n.endsWith('.json')).map(n => readJson(path.join(dir, n))).filter(f => f && f.id)
    .sort((a, b) => (Number(a.n) || 0) - (Number(b.n) || 0));
}

/** Plain lines the Senior can carry into the next plan, from every finished request with recorded usage. */
function lessonsForPlanning(opts = {}) {
  const dataDir = opts.dataDir || DEFAULT_DATA;
  const done = listFeatures(dataDir).filter(f => f.status === 'done');
  const usages = done.map(f => ({ feature: f, usage: featureUsage(f.id, { dataDir }) })).filter(x => x.usage.recorded);
  const lines = [];
  if (!usages.length) return { features: 0, lines };

  const total = usages.reduce((s, x) => s + x.usage.totalCostUsd, 0);
  lines.push(`${usages.length} finished request${usages.length === 1 ? ' has' : 's have'} recorded usage, ${money(total)} in all, ${money(total / usages.length)} each on average.`);

  for (const label of Object.keys(FORECAST_BANDS)) {
    const group = usages.filter(x => x.usage.forecast.cost === label);
    if (!group.length) continue;
    const costs = group.map(x => x.usage.totalCostUsd);
    const min = Math.min(...costs), max = Math.max(...costs), avg = costs.reduce((s, c) => s + c, 0) / costs.length;
    const over = group.filter(x => x.usage.forecast.verdict === 'over').length;
    const under = group.filter(x => x.usage.forecast.verdict === 'under').length;
    const range = group.length === 1 ? money(avg) : `${money(min)} to ${money(max)}, ${money(avg)} on average`;
    const verdicts = [];
    if (over) verdicts.push(`${over} came in over`);
    if (under) verdicts.push(`${under} under`);
    const tail = verdicts.length ? ` (${verdicts.join(', ')})` : ' (all about on forecast)';
    lines.push(`Requests forecast as ${label} cost ${range}${tail}.`);
  }

  const shares = usages.map(x => x.usage.seniorShare).filter(s => typeof s === 'number');
  if (shares.length) {
    const avg = shares.reduce((s, x) => s + x, 0) / shares.length;
    lines.push(`On average ${pct(avg)} of the spend was the lead engineer's own model; the rest went to the workers.`);
  }

  const planShares = usages.filter(x => x.usage.steps.build.recorded && (x.usage.steps.read.recorded || x.usage.steps.plan.recorded))
    .map(x => ((x.usage.steps.read.costUsd || 0) + (x.usage.steps.plan.costUsd || 0)) / x.usage.totalCostUsd);
  if (planShares.length) {
    const avg = planShares.reduce((s, x) => s + x, 0) / planShares.length;
    lines.push(`Reading back and planning took ${pct(avg)} of the spend on average; building took the rest.`);
  }

  const byModel = {};
  const redone = [];
  for (const { feature } of usages) {
    for (const t of feature.tasks || []) {
      if (!t.model) continue;
      if (!byModel[t.model]) byModel[t.model] = { first: 0, total: 0 };
      byModel[t.model].total++;
      const ok = !t.escalated && (Number(t.attempts) || 1) <= 1;
      if (ok) byModel[t.model].first++;
      else redone.push(`'${t.title || t.id}' in '${feature.title || feature.id}' on ${modelName(t.model)}`);
    }
  }
  for (const [m, c] of Object.entries(byModel)) {
    lines.push(`Pieces on ${modelName(m)} passed first time ${c.first} of ${c.total} time${c.total === 1 ? '' : 's'}.`);
  }
  if (redone.length) lines.push(`${redone.length === 1 ? 'One piece' : redone.length + ' pieces'} needed a redo or help: ${redone.join('; ')}.`);
  else lines.push('No piece has needed a redo or help so far; the default model per level has been enough.');

  return { features: usages.length, lines };
}

/**
 * Every finished request with what it cost, its forecast verdict, when it
 * finished, and the lessons across all of them — for the front page's
 * Insights tab. Newest request first.
 */
function boardInsights(opts = {}) {
  const dataDir = opts.dataDir || DEFAULT_DATA;
  const done = listFeatures(dataDir).filter(f => f.status === 'done')
    .sort((a, b) => (Number(b.n) || 0) - (Number(a.n) || 0));

  const features = done.map(f => {
    const usage = featureUsage(f.id, { dataDir });
    const finishedAt = finishedAtFor(f);
    return {
      id: f.id,
      title: f.title || null,
      finishedAt,
      recorded: usage.recorded,
      totalCostUsd: usage.totalCostUsd,
      tokens: { total: usage.tokens ? usage.tokens.total : null },
      allowance: usage.allowance,
      size: f.size || null,
      forecast: usage.forecast,
      runs: usage.runs.length,
      lead: {
        readsPerRun: usage.lead.readsPerRun,
        cachedShare: usage.lead.cachedShare,
        change: usage.lead.baseline ? usage.lead.baseline.readsPerRun.change : null
      },
      lessons: usage.lessons
    };
  });

  const lessons = lessonsForPlanning({ dataDir }).lines;
  const changes = features.filter(f => f.id !== BASELINE_FEATURE && f.lead.change != null).map(f => f.lead.change);
  if (changes.length) {
    const avg = changes.reduce((sum, c) => sum + c, 0) / changes.length;
    lessons.push(`Since ${BASELINE_FEATURE}, the lead has read on average ${pct(Math.abs(avg))} ${avg <= 0 ? 'less' : 'more'} per run over ${changes.length} request${changes.length === 1 ? '' : 's'}.`);
  }

  return { features, lessons };
}

/* ---------- one request against another ---------- */

/**
 * Side by side lead figures for several requests. The first id is the
 * baseline every other row is measured against. An id with nothing recorded
 * comes back as a row of nulls rather than an error.
 */
function compareFeatures(ids, opts = {}) {
  const dataDir = opts.dataDir || DEFAULT_DATA;
  const list = (Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && id);
  const usages = list.map(id => ({ id, usage: featureUsage(id, { dataDir }) }));
  const stageReads = (u, step) => (u.steps[step] && u.steps[step].lead.reads ? u.steps[step].lead.reads : null);
  const base = usages.length ? usages[0] : null;

  const rows = usages.map(({ id, usage }, i) => {
    const l = usage.lead;
    const per = n => (l.runs ? n / l.runs : null);
    const mine = l.runs ? l : null;
    const theirs = base && base.usage.lead.runs ? base.usage.lead : null;
    const change = { readsPerRun: null, costUsd: null, plan: null, build: null };
    if (i > 0 && mine && theirs) {
      change.readsPerRun = changeFrom(mine.readsPerRun, theirs.readsPerRun);
      // the whole request's bill, which is the figure the board already shows
      change.costUsd = changeFrom(usage.totalCostUsd, base.usage.totalCostUsd);
      change.plan = changeFrom(stageReads(usage, 'plan'), stageReads(base.usage, 'plan'));
      change.build = changeFrom(stageReads(usage, 'build'), stageReads(base.usage, 'build'));
    }
    return {
      feature: id,
      title: usage.title,
      runs: l.runs,
      readsPerRun: l.readsPerRun,
      cachedShare: l.cachedShare,
      cacheWritePerRun: per(l.cacheWrite),
      outputPerRun: per(l.output),
      turnsPerRun: per(l.turns),
      big: l.runs ? l.big : null,
      costUsd: usage.totalCostUsd,
      change
    };
  });

  return { baseline: base ? base.id : null, rows };
}

/* ---------- the subscription allowance ---------- */

const USAGE_TTL = 60_000;          // the transcript scan is cached this long
const USAGE_MAX_AGE_DAYS = 8;      // transcripts older than this are not read
const USAGE_DAYS = 7;

let usageCache = { at: 0, data: null };

const emptyTranscriptBucket = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 });

function safeReadDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

/** Every transcript worth reading: ~/.claude/projects/<p>/*.jsonl and <p>/<session>/subagents/*.jsonl */
function transcriptFiles() {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const cutoff = Date.now() - USAGE_MAX_AGE_DAYS * 86_400_000;
  const files = [];
  let projects = 0;
  const keep = file => {
    try { if (fs.statSync(file).mtimeMs >= cutoff) files.push(file); } catch {}
  };
  for (const project of safeReadDir(root)) {
    if (!project.isDirectory()) continue;
    projects++;
    const dir = path.join(root, project.name);
    for (const entry of safeReadDir(dir)) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) keep(path.join(dir, entry.name));
      else if (entry.isDirectory()) {
        const subs = path.join(dir, entry.name, 'subagents');
        for (const sub of safeReadDir(subs)) {
          if (sub.isFile() && sub.name.endsWith('.jsonl')) keep(path.join(subs, sub.name));
        }
      }
    }
  }
  return { files, projects };
}

function addUsage(bucket, u) {
  bucket.input += Number(u.input_tokens) || 0;
  bucket.output += Number(u.output_tokens) || 0;
  bucket.cacheRead += Number(u.cache_read_input_tokens) || 0;
  bucket.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
  bucket.messages += 1;
}

function bucketFor(map, key) {
  if (!map[key]) map[key] = emptyTranscriptBucket();
  return map[key];
}

/** Tokens per model per UTC day, plus 5-hour and 7-day totals. The one place the transcripts are counted. */
function claudeUsage() {
  const now = Date.now();
  if (usageCache.data && now - usageCache.at < USAGE_TTL) return { ...usageCache.data, cached: true };
  const computedAt = new Date().toISOString();
  try {
    const { files, projects } = transcriptFiles();
    const byModelDay = {}, last5h = {}, last7d = {};
    const since5h = now - 5 * 3_600_000;
    const since7d = now - USAGE_DAYS * 86_400_000;
    let read = 0;

    for (const file of files) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      read++;
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        const msg = ev && ev.message;
        const u = msg && msg.usage;
        if (!u || typeof u !== 'object') continue;
        const model = msg.model;
        if (!model || model === '<synthetic>') continue;
        const at = Date.parse(ev.timestamp);
        if (!Number.isFinite(at)) continue;
        const day = new Date(at).toISOString().slice(0, 10);
        if (!byModelDay[model]) byModelDay[model] = {};
        addUsage(bucketFor(byModelDay[model], day), u);
        if (at >= since5h) addUsage(bucketFor(last5h, model), u);
        if (at >= since7d) addUsage(bucketFor(last7d, model), u);
      }
    }

    const days = [];
    for (let i = USAGE_DAYS - 1; i >= 0; i--) days.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));

    const data = { byModelDay, last5h, last7d, days, projects, files: read, computedAt };
    usageCache = { at: now, data };
    return { ...data, cached: false };
  } catch (e) {
    console.error('  usage: ' + e.message);
    return { error: e.message, computedAt, cached: false };
  }
}

/** The two subscription windows the board can speak about, and the token count that belongs to each. */
const ALLOWANCE_WINDOWS = {
  five_hour: { key: 'last5h', label: 'five-hour window' },
  seven_day: { key: 'last7d', label: 'seven-day window' }
};

/** Every token in a map of per-model buckets. */
function bucketTokens(map) {
  let total = 0;
  for (const b of Object.values(map || {})) {
    if (!b || typeof b !== 'object') continue;
    total += (Number(b.input) || 0) + (Number(b.output) || 0) +
             (Number(b.cacheRead) || 0) + (Number(b.cacheWrite) || 0);
  }
  return total;
}

const resetText = resetsAt =>
  Number.isFinite(resetsAt) ? new Date(resetsAt * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : null;

function windowNote(label, capacityTokens, resetsAt) {
  const resets = resetText(resetsAt);
  if (!capacityTokens) {
    return `How much of your ${label} this is cannot be worked out yet: there is no usable usage reading to measure it against` +
           (resets ? `. That window resets at ${resets}.` : '.');
  }
  return `Measured against your ${label}, which resets at ${resets || 'a time the reading does not give'}. ` +
         'The size of the window is an estimate worked out from a usage reading, and it counts only work done on this computer.';
}

/**
 * What a share of the Claude subscription means, grounded in the last rate-limit reading.
 * Capacity is the counted tokens divided by the utilisation that reading gave; with no
 * usable reading the capacity is null and every share of that window is null, never a guess.
 */
function allowanceBasis(opts = {}) {
  const dataDir = opts.dataDir || DEFAULT_DATA;
  let claude = {};
  try { claude = JSON.parse(fs.readFileSync(path.join(dataDir, 'claude.json'), 'utf8')) || {}; } catch {}
  const usage = opts.usage || claudeUsage();
  const checkedAt = typeof claude.rateLimitCheckedAt === 'string' ? claude.rateLimitCheckedAt : null;
  const unified = (claude.rateLimit && claude.rateLimit.unifiedWindows) || {};

  const windows = {};
  for (const [name, meta] of Object.entries(ALLOWANCE_WINDOWS)) {
    const reading = unified[name] && typeof unified[name] === 'object' ? unified[name] : null;
    const util = reading ? Number(reading.utilization) : NaN;
    const utilization = Number.isFinite(util) ? util : null;
    const resets = reading ? Number(reading.resetsAt) : NaN;
    const resetsAt = Number.isFinite(resets) ? resets : null;
    const countedTokens = bucketTokens(usage && usage[meta.key]);
    const capacityTokens = utilization > 0 && countedTokens > 0 ? Math.round(countedTokens / utilization) : null;
    windows[name] = {
      window: name, label: meta.label, utilization, resetsAt, countedTokens, capacityTokens,
      estimated: true, checkedAt, note: windowNote(meta.label, capacityTokens, resetsAt)
    };
  }

  const basis = {
    windows, checkedAt, estimated: true,
    note: 'Every share of the allowance is an estimate worked out from your latest usage reading, ' +
          'and it counts only work done on this computer.'
  };
  Object.defineProperty(basis, 'share', { value: (tokens, window) => allowanceShare(basis, tokens, window) });
  return basis;
}

/** A token count as a fraction of one window, or null when that window has no capacity to divide by. */
function allowanceShare(basis, tokens, window) {
  const w = basis && basis.windows && basis.windows[window];
  const n = Number(tokens);
  if (!w || !w.capacityTokens || !Number.isFinite(n) || n < 0) return null;
  return n / w.capacityTokens;
}

/* ---------- command line ---------- */

function printFeature(u) {
  console.log(`\n${u.feature}${u.title ? ' ' + u.title : ''}`);
  if (!u.recorded) { console.log('  No usage was recorded for this request.\n'); return; }
  console.log(`  Total ${money(u.totalCostUsd)} over ${u.runs.length} run${u.runs.length === 1 ? '' : 's'}` +
    (u.unrecorded ? ` (${u.unrecorded} not recorded)` : '') +
    (u.forecast.cost ? `; forecast ${u.forecast.cost}: ${u.forecast.plain}` : ''));
  console.log('\n  Per stage');
  for (const [s, st] of Object.entries(u.steps)) {
    console.log(`    ${(STEP_TEXT[s] || s).padEnd(16)} ${st.recorded ? money(st.costUsd).padStart(8) : 'not recorded'}${st.runs ? `  (${st.runs} run${st.runs === 1 ? '' : 's'})` : ''}`);
  }
  console.log('\n  Per model            input   cache read  cache write     output      cost');
  for (const [m, b] of Object.entries(u.models).sort((a, b) => b[1].costUsd - a[1].costUsd)) {
    console.log(`    ${modelName(m).padEnd(14)} ${String(b.input).padStart(9)} ${String(b.cacheRead).padStart(12)} ${String(b.cacheWrite).padStart(12)} ${String(b.output).padStart(10)} ${money(b.costUsd).padStart(9)}`);
  }
  printLead(u);
  if (u.lessons.length) { console.log('\n  Lessons'); for (const l of u.lessons) console.log('    - ' + l); }
  console.log();
}

function printLead(u) {
  const leadRuns = u.runs.filter(r => r.lead && r.lead.recorded);
  if (!leadRuns.length) return;
  console.log('\n  Lead engineer, per run');
  console.log('    stage                turns          read   of which cached         added       written   big results');
  for (const r of leadRuns) {
    const l = r.lead;
    console.log(`    ${(STEP_TEXT[r.step] || r.step).padEnd(16)} ${String(l.turns).padStart(9)} ${num(l.reads).padStart(13)} ${(l.reads ? pct(l.cacheRead / l.reads) : '-').padStart(17)} ${num(l.cacheWrite).padStart(13)} ${num(l.output).padStart(13)} ${String(l.toolResults.big).padStart(13)}`);
  }
  const sh = u.lead.share;
  if (sh) {
    console.log(`\n    Of the lead's cost, about ${pct(sh.cacheWrite)} was adding to its memory, ${pct(sh.output)} writing, ${pct(sh.cacheRead)} re-reading.`);
  }
}

function printCompare(c) {
  if (!c.rows.length) { console.log('Name the requests to compare, the baseline first.'); return; }
  console.log(`\n  Lead engineer per run, measured against ${c.baseline}`);
  console.log('    request     runs          read   cached         added       written     turns   big          cost');
  for (const r of c.rows) {
    const cell = (v, w) => (v == null ? '-'.padStart(w) : v.padStart(w));
    console.log(`    ${r.feature.padEnd(10)} ${String(r.runs).padStart(4)} ${cell(r.readsPerRun == null ? null : num(r.readsPerRun), 13)} ${cell(r.cachedShare == null ? null : pct(r.cachedShare), 8)} ${cell(r.cacheWritePerRun == null ? null : num(r.cacheWritePerRun), 13)} ${cell(r.outputPerRun == null ? null : num(r.outputPerRun), 13)} ${cell(r.turnsPerRun == null ? null : r.turnsPerRun.toFixed(1), 9)} ${cell(r.big == null ? null : String(r.big), 5)} ${cell(r.costUsd == null ? null : money(r.costUsd), 13)}`);
  }
  console.log();
  for (const r of c.rows.slice(1)) {
    if (r.change.readsPerRun == null) {
      console.log(`    Compared with ${c.baseline}, ${r.feature} has no figures recorded to compare with.`);
    } else {
      console.log(`    Compared with ${c.baseline}, ${r.feature} read ${changeWords(r.change.readsPerRun)} per run` +
        ` and cost ${changeWords(r.change.costUsd)}.`);
    }
  }
  console.log();
}

function main(argv) {
  const args = argv.filter(a => a !== '--json');
  const asJson = argv.includes('--json');
  const what = args[0];
  if (!what) {
    console.log('usage: node board/usage.js <F-n> [--json]\n       node board/usage.js lessons [--json]' +
      '\n       node board/usage.js compare <F-n> <F-n> ... [--json]');
    return 2;
  }
  if (what === 'compare') {
    const c = compareFeatures(args.slice(1));
    if (asJson) console.log(JSON.stringify(c, null, 2));
    else printCompare(c);
    return 0;
  }
  if (what === 'lessons') {
    const l = lessonsForPlanning();
    if (asJson) console.log(JSON.stringify(l, null, 2));
    else if (!l.features) console.log('No finished request has recorded usage yet.');
    else for (const line of l.lines) console.log('- ' + line);
    return 0;
  }
  if (!okId(what)) { console.error('bad request id'); return 2; }
  const u = featureUsage(what);
  if (asJson) console.log(JSON.stringify(u, null, 2));
  else printFeature(u);
  return 0;
}

module.exports = { runUsage, leadUsage, featureUsage, compareFeatures, lessonsForPlanning, boardInsights,
  claudeUsage, allowanceBasis, allowanceShare, ALLOWANCE_WINDOWS,
  FORECAST_BANDS, BASELINE_FEATURE, BIG_RESULT_CHARS, verdictFor };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
