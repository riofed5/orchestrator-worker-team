'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { runUsage, leadUsage, featureUsage, compareFeatures, lessonsForPlanning, boardInsights, verdictFor } = require('../usage.js');

let tempDir;

test.before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  fs.mkdirSync(path.join(tempDir, 'features'));
  fs.mkdirSync(path.join(tempDir, 'runs'));

  // Fixture: features/F-1.json
  fs.writeFileSync(
    path.join(tempDir, 'features', 'F-1.json'),
    JSON.stringify({
      id: 'F-1',
      n: 1,
      title: 'First',
      status: 'done',
      updatedAt: '2026-09-08T09:00:00.000Z',
      log: [
        { at: '2026-09-01T00:00:00.000Z', who: 'senior', text: 'started' },
        { at: '2026-09-09T11:00:00.000Z', who: 'senior', text: 'finished' }
      ],
      plan: { forecast: { cost: 'medium', plain: 'x' } },
      tasks: [
        { id: 'T-1', title: 'A', model: 'sonnet-5', level: 'MID', status: 'done', attempts: 2, escalated: false },
        { id: 'T-2', title: 'B', model: 'haiku-4.5', level: 'JUNIOR', status: 'done', attempts: 1, escalated: false }
      ]
    })
  );

  // Fixture: features/F-2.json
  fs.writeFileSync(
    path.join(tempDir, 'features', 'F-2.json'),
    JSON.stringify({
      id: 'F-2',
      n: 2,
      title: 'Second',
      status: 'done',
      updatedAt: '2026-09-05T12:00:00.000Z',
      plan: { forecast: { cost: 'low', plain: 'x' } },
      tasks: []
    })
  );

  // Fixture: features/F-3.json (not done, must be excluded from insights)
  fs.writeFileSync(
    path.join(tempDir, 'features', 'F-3.json'),
    JSON.stringify({
      id: 'F-3',
      n: 3,
      title: 'Third',
      status: 'building',
      plan: { forecast: { cost: 'high', plain: 'x' } },
      tasks: []
    })
  );

  // Fixture: runs/r-a.json and r-a.jsonl
  fs.writeFileSync(
    path.join(tempDir, 'runs', 'r-a.json'),
    JSON.stringify({
      id: 'r-a',
      kind: 'team',
      feature: 'F-1',
      step: 'read',
      status: 'done',
      startedAt: '2026-09-09T10:00:00.000Z',
      model: 'claude-fable-5-1'
    })
  );
  fs.writeFileSync(
    path.join(tempDir, 'runs', 'r-a.jsonl'),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.5,
      modelUsage: {
        'claude-fable-5-1': {
          inputTokens: 10,
          outputTokens: 1000,
          cacheReadInputTokens: 100,
          cacheCreationInputTokens: 50,
          costUSD: 0.5
        }
      }
    }) + '\n'
  );

  // Fixture: runs/r-b.json and r-b.jsonl
  fs.writeFileSync(
    path.join(tempDir, 'runs', 'r-b.json'),
    JSON.stringify({
      id: 'r-b',
      kind: 'team',
      feature: 'F-1',
      step: 'build',
      status: 'done',
      startedAt: '2026-09-09T10:05:00.000Z',
      model: 'claude-fable-5-1'
    })
  );
  fs.writeFileSync(
    path.join(tempDir, 'runs', 'r-b.jsonl'),
    JSON.stringify({ type: 'assistant' }) + '\n' +
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 1.0,
      modelUsage: {
        'claude-fable-5-1': {
          inputTokens: 5,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0.1
        }
      }
    }) + '\n' +
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 3.0,
      modelUsage: {
        'claude-fable-5-1': {
          inputTokens: 20,
          outputTokens: 2000,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 100,
          costUSD: 2.0
        },
        'claude-sonnet-5': {
          inputTokens: 5,
          outputTokens: 500,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 25,
          costUSD: 0.8
        },
        'claude-haiku-4-5-20251001': {
          inputTokens: 1,
          outputTokens: 100,
          cacheReadInputTokens: 10,
          cacheCreationInputTokens: 5,
          costUSD: 0.2
        }
      }
    }) + '\n'
  );

  // Fixture: runs/r-c.json and r-c.jsonl
  fs.writeFileSync(
    path.join(tempDir, 'runs', 'r-c.json'),
    JSON.stringify({
      id: 'r-c',
      kind: 'team',
      feature: 'F-1',
      step: 'plan',
      status: 'running',
      startedAt: '2026-09-09T10:02:00.000Z',
      model: 'claude-fable-5-1'
    })
  );
  fs.writeFileSync(
    path.join(tempDir, 'runs', 'r-c.jsonl'),
    JSON.stringify({ type: 'assistant' }) + '\n'
  );

  // Fixture: runs/r-d.json and r-d.jsonl (for F-9, should be ignored)
  fs.writeFileSync(
    path.join(tempDir, 'runs', 'r-d.json'),
    JSON.stringify({
      id: 'r-d',
      kind: 'team',
      feature: 'F-9',
      step: 'read',
      status: 'done',
      startedAt: '2026-09-09T10:10:00.000Z',
      model: 'claude-fable-5-1'
    })
  );
  fs.writeFileSync(
    path.join(tempDir, 'runs', 'r-d.jsonl'),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 100.0,
      modelUsage: {
        'claude-fable-5-1': {
          inputTokens: 1000,
          outputTokens: 10000,
          cacheReadInputTokens: 1000,
          cacheCreationInputTokens: 500,
          costUSD: 100.0
        }
      }
    }) + '\n'
  );
});

test.after(() => {
  // Remove temp folder
  fs.rmSync(tempDir, { recursive: true });
});

/* ---------- the lead engineer's own figures, in a folder of their own ---------- */

const FABLE = 'claude-fable-5-1';

const tokens = (input, cacheRead, cacheWrite, output) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  output_tokens: output
});

const turnEvent = (id, usage, opts = {}) => JSON.stringify({
  type: 'assistant',
  parent_tool_use_id: opts.parent || null,
  message: { id, model: opts.model || FABLE, usage }
});

const toolResultEvent = (content, opts = {}) => JSON.stringify({
  type: 'user',
  parent_tool_use_id: opts.parent || null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content }] }
});

const resultEvent = (usage, costUsd) => JSON.stringify({
  type: 'result',
  subtype: 'success',
  total_cost_usd: costUsd,
  modelUsage: { [FABLE]: usage }
});

const modelUsage = (input, cacheRead, cacheWrite, output, costUsd, thinking) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: cacheWrite,
  costUSD: costUsd,
  thinkingTokens: thinking || 0
});

let leadDir;

/** A run of two lead turns with the reads split evenly-ish, plus its result event. */
function writeLeadRun(dir, id, feature, step, turns, costUsd) {
  fs.writeFileSync(path.join(dir, 'runs', id + '.json'), JSON.stringify({
    id, kind: 'team', feature, step, status: 'done',
    startedAt: '2026-09-09T10:00:00.000Z', model: FABLE
  }));
  const cacheRead = turns.reduce((s, t) => s + t[0], 0);
  const cacheWrite = turns.reduce((s, t) => s + t[1], 0);
  fs.writeFileSync(path.join(dir, 'runs', id + '.jsonl'),
    turns.map((t, i) => turnEvent(id + '-m' + i, tokens(0, t[0], t[1], 1))).join('\n') + '\n' +
    resultEvent(modelUsage(0, cacheRead, cacheWrite, 1000, costUsd, 10), costUsd) + '\n');
}

test.before(() => {
  leadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-lead-'));
  fs.mkdirSync(path.join(leadDir, 'features'));
  fs.mkdirSync(path.join(leadDir, 'runs'));

  // One run with repeated message ids, a worker's turn, a worker's tool result
  // and two of the lead's own tool results, one of them big.
  fs.writeFileSync(path.join(leadDir, 'runs', 'r-lead.json'), JSON.stringify({
    id: 'r-lead', kind: 'team', feature: 'F-13', step: 'build', status: 'done',
    startedAt: '2026-09-09T10:00:00.000Z', model: FABLE
  }));
  fs.writeFileSync(path.join(leadDir, 'runs', 'r-lead.jsonl'), [
    turnEvent('m1', tokens(10, 1000, 500, 5)),
    turnEvent('m1', tokens(10, 1000, 500, 7)),
    turnEvent('m1', tokens(10, 1000, 500, 6)),
    turnEvent('ms', tokens(999, 999, 999, 999), { parent: 'toolu_sub', model: 'claude-sonnet-5' }),
    turnEvent('m2', tokens(20, 2000, 100, 3)),
    turnEvent('m2', tokens(20, 2000, 100, 9)),
    toolResultEvent('x'.repeat(20000)),
    toolResultEvent('y'.repeat(30000), { parent: 'toolu_sub' }),
    turnEvent('m3', tokens(5, 3000, 0, 2)),
    toolResultEvent([{ type: 'text', text: 'z'.repeat(100) }]),
    resultEvent(modelUsage(35, 6000, 600, 500, 1.25, 42), 1.5)
  ].join('\n') + '\n');

  // A run with no meta file: the model comes from the lead's first turn.
  fs.writeFileSync(path.join(leadDir, 'runs', 'r-nometa.jsonl'),
    turnEvent('n1', tokens(1, 10, 5, 1)) + '\n');

  // A run that only ever emitted worker turns: nothing of the lead's own.
  fs.writeFileSync(path.join(leadDir, 'runs', 'r-workeronly.jsonl'),
    turnEvent('w1', tokens(1, 1, 1, 1), { parent: 'toolu_sub', model: 'claude-sonnet-5' }) + '\n');

  // Two finished requests: F-10 the baseline, F-12 half as heavy per run.
  for (const [id, n, title] of [['F-10', 10, 'Baseline'], ['F-12', 12, 'Later']]) {
    fs.writeFileSync(path.join(leadDir, 'features', id + '.json'), JSON.stringify({
      id, n, title, status: 'done', updatedAt: '2026-09-09T12:00:00.000Z',
      plan: { forecast: { cost: 'high', plain: 'x' } }, tasks: []
    }));
  }
  writeLeadRun(leadDir, 'r-b10-plan', 'F-10', 'plan', [[85000, 15000]], 2);
  writeLeadRun(leadDir, 'r-b10-build', 'F-10', 'build', [[150000, 20000], [120000, 10000]], 4);
  writeLeadRun(leadDir, 'r-b12-plan', 'F-12', 'plan', [[44500, 5500]], 1);
  writeLeadRun(leadDir, 'r-b12-build', 'F-12', 'build', [[90000, 10000], [45000, 5000]], 2);
});

test.after(() => {
  fs.rmSync(leadDir, { recursive: true });
});

/* ---------- neighbours of the same size ---------- */

let sizeDir;

function writeFeature(dir, id, n, title, size, status, updatedAt) {
  fs.writeFileSync(path.join(dir, 'features', id + '.json'), JSON.stringify({
    id, n, title, size, status, updatedAt, tasks: []
  }));
}

function writeCostRun(dir, id, feature, costUsd) {
  fs.writeFileSync(path.join(dir, 'runs', id + '.json'), JSON.stringify({
    id, kind: 'team', feature, step: 'build', status: 'done',
    startedAt: '2026-09-01T00:00:00.000Z', model: FABLE
  }));
  fs.writeFileSync(path.join(dir, 'runs', id + '.jsonl'), JSON.stringify({
    type: 'result', subtype: 'success', total_cost_usd: costUsd,
    modelUsage: { [FABLE]: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: costUsd } }
  }) + '\n');
}

test.before(() => {
  sizeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-size-'));
  fs.mkdirSync(path.join(sizeDir, 'features'));
  fs.mkdirSync(path.join(sizeDir, 'runs'));

  // Two comparable finished medium requests, older than F-20, plus a distractor of another size and one not done.
  writeFeature(sizeDir, 'F-20', 20, 'Target medium', 'medium', 'done', '2026-09-10T10:00:00.000Z');
  writeFeature(sizeDir, 'F-21', 21, 'Medium one', 'medium', 'done', '2026-09-09T10:00:00.000Z');
  writeFeature(sizeDir, 'F-22', 22, 'Medium two', 'medium', 'done', '2026-09-08T10:00:00.000Z');
  writeFeature(sizeDir, 'F-23', 23, 'Medium but unfinished', 'medium', 'building', '2026-09-09T12:00:00.000Z');
  writeCostRun(sizeDir, 'r-s20', 'F-20', 4);
  writeCostRun(sizeDir, 'r-s21', 'F-21', 3);
  writeCostRun(sizeDir, 'r-s22', 'F-22', 1);

  // One comparable finished large request.
  writeFeature(sizeDir, 'F-30', 30, 'Target large', 'large', 'done', '2026-09-10T10:00:00.000Z');
  writeFeature(sizeDir, 'F-31', 31, 'Large one', 'large', 'done', '2026-09-09T10:00:00.000Z');
  writeCostRun(sizeDir, 'r-s30', 'F-30', 5);
  writeCostRun(sizeDir, 'r-s31', 'F-31', 5);

  // No comparable finished request the same size.
  writeFeature(sizeDir, 'F-40', 40, 'Target small, alone', 'small', 'done', '2026-09-10T10:00:00.000Z');
  writeCostRun(sizeDir, 'r-s40', 'F-40', 2);
});

test.after(() => {
  fs.rmSync(sizeDir, { recursive: true });
});

test('featureUsage.neighbours with two comparable requests', () => {
  const u = featureUsage('F-20', { dataDir: sizeDir });

  assert.equal(u.neighbours.items.length, 2);
  assert.deepEqual(u.neighbours.items.map(n => n.feature), ['F-21', 'F-22']);
  assert.equal(u.neighbours.items[0].title, 'Medium one');
  assert.equal(u.neighbours.items[0].size, 'medium');
  assert.equal(u.neighbours.items[0].totalCostUsd, 3);
  assert.equal(u.neighbours.items[1].totalCostUsd, 1);
  // mine 4, average of 3 and 1 is 2, so 100% more.
  assert.ok(Math.abs(u.neighbours.change - 1) < 1e-9);
});

test('featureUsage.neighbours with one comparable request', () => {
  const u = featureUsage('F-30', { dataDir: sizeDir });

  assert.equal(u.neighbours.items.length, 1);
  assert.equal(u.neighbours.items[0].feature, 'F-31');
  assert.equal(u.neighbours.items[0].totalCostUsd, 5);
  // mine 5, average of just 5 is 5, so no change.
  assert.ok(Math.abs(u.neighbours.change) < 1e-9);
});

test('featureUsage.neighbours with none comparable', () => {
  const u = featureUsage('F-40', { dataDir: sizeDir });

  assert.deepEqual(u.neighbours.items, []);
  assert.equal(u.neighbours.change, null);
});

test('featureUsage.neighbours is null-safe when the feature is missing or has no size', () => {
  const missing = featureUsage('F-999', { dataDir: sizeDir });
  assert.deepEqual(missing.neighbours, { items: [], change: null });

  const noSize = featureUsage('F-1', { dataDir: tempDir });
  assert.deepEqual(noSize.neighbours, { items: [], change: null });
});

test('featureUsage("F-1") with multiple runs', () => {
  const u = featureUsage('F-1', { dataDir: tempDir });

  assert.equal(u.recorded, true);
  assert.equal(u.runs.length, 3);
  assert.ok(Math.abs(u.totalCostUsd - 3.5) < 1e-9);
  assert.equal(u.unrecorded, 1);
  assert.deepEqual(u.missingSteps, ['plan']);
  assert.ok(Math.abs(u.steps.read.costUsd - 0.5) < 1e-9);
  assert.ok(Math.abs(u.steps.build.costUsd - 3.0) < 1e-9);
  assert.equal(u.steps.plan.recorded, false);

  assert.deepEqual(u.models['claude-fable-5-1'], {
    input: 30,
    output: 3000,
    cacheRead: 300,
    cacheWrite: 150,
    costUsd: 2.5,
    total: 3480,
    runs: 2,
    avgTotalPerRun: 1740,
    maxTotalPerRun: 2320
  });
  assert.equal(u.models['claude-sonnet-5'].output, 500);
  assert.ok(Math.abs(u.models['claude-haiku-4-5-20251001'].costUsd - 0.2) < 1e-9);

  assert.equal(u.forecast.verdict, 'about');
});

test('featureUsage("F-2") with no runs', () => {
  const u = featureUsage('F-2', { dataDir: tempDir });

  assert.equal(u.recorded, false);
  assert.equal(u.runs.length, 0);
  assert.equal(u.totalCostUsd, null);
  assert.equal(u.forecast.verdict, null);
  assert.deepEqual(u.lessons, []);
});

test('featureUsage("F-1").lessons contains redone information', () => {
  const u = featureUsage('F-1', { dataDir: tempDir });

  const lessons = u.lessons;
  const hasARedone = lessons.some(line => line.includes("'A'") && line.includes('redone'));
  const hasBRedone = lessons.some(line => line.includes("'B'") && line.includes('redone'));

  assert.equal(hasARedone, true, "Should mention 'A' as redone");
  assert.equal(hasBRedone, false, "Should not mention 'B' as redone");
});

test('verdictFor with various inputs', () => {
  assert.equal(verdictFor('medium', 1), 'under');
  assert.equal(verdictFor('medium', 7), 'over');
  assert.equal(verdictFor('medium', 3.5), 'about');
  assert.equal(verdictFor('high', 10), 'about');
  assert.equal(verdictFor('low', 1), 'about');
  assert.equal(verdictFor('nope', 1), null);
  assert.equal(verdictFor('low', null), null);
});

test('lessonsForPlanning with recorded features', () => {
  const lessons = lessonsForPlanning({ dataDir: tempDir });

  assert.equal(lessons.features, 1);
  assert.ok(lessons.lines.length > 0);

  const hasSomeLineWithA = lessons.lines.some(line => line.includes("'A'"));
  assert.equal(hasSomeLineWithA, true);
});

test('boardInsights lists finished requests newest first', () => {
  const insights = boardInsights({ dataDir: tempDir });

  assert.ok(Array.isArray(insights.lessons));

  // Only done requests (F-1, F-2), not the building one (F-3), sorted newest (n) first.
  assert.deepEqual(insights.features.map(f => f.id), ['F-2', 'F-1']);

  const f1 = insights.features.find(f => f.id === 'F-1');
  const f2 = insights.features.find(f => f.id === 'F-2');

  assert.equal(f1.recorded, true);
  assert.ok(Math.abs(f1.totalCostUsd - 3.5) < 1e-9);
  assert.equal(f1.forecast.cost, 'medium');
  assert.equal(f1.forecast.verdict, 'about');
  assert.equal(f1.runs, 3);
  assert.ok(Array.isArray(f1.lessons));
  assert.ok(f1.lessons.length > 0);
  // finishedAt comes from the last log entry when one exists.
  assert.equal(f1.finishedAt, '2026-09-09T11:00:00.000Z');

  assert.equal(f2.recorded, false);
  assert.equal(f2.totalCostUsd, null);
  assert.equal(f2.runs, 0);
  assert.deepEqual(f2.lessons, []);
  // finishedAt falls back to updatedAt when there is no log.
  assert.equal(f2.finishedAt, '2026-09-05T12:00:00.000Z');
});

test('runUsage with specific runs', () => {
  const runsDir = path.join(tempDir, 'runs');

  const runC = runUsage('r-c', { runsDir });
  assert.equal(runC.recorded, false);

  const missing = runUsage('missing', { runsDir });
  assert.equal(missing.recorded, false);
});

test('leadUsage counts each turn once and leaves the workers out', () => {
  const runsDir = path.join(leadDir, 'runs');
  const l = leadUsage('r-lead', { runsDir });

  assert.equal(l.recorded, true);
  assert.equal(l.model, 'claude-fable-5-1');
  assert.equal(l.turns, 3);
  assert.equal(l.input, 35);
  assert.equal(l.cacheRead, 6000);
  assert.equal(l.cacheWrite, 600);
  assert.equal(l.reads, 6635);
  // What was written comes from the run's result event, not the streaming turns.
  assert.equal(l.output, 500);
  assert.equal(l.thinking, 42);
  assert.equal(l.costUsd, 1.25);
  assert.deepEqual(l.context, { first: 1510, last: 3005, max: 3005, mean: 2212 });
  assert.deepEqual(l.toolResults, { count: 2, chars: 20127, big: 1 });

  const shares = l.share.input + l.share.cacheRead + l.share.cacheWrite + l.share.output;
  assert.ok(Math.abs(shares - 1) < 1e-9);
  assert.ok(l.share.cacheWrite > 0);
});

test('leadUsage falls back to the first lead turn for the model, and reports nothing without lead turns', () => {
  const runsDir = path.join(leadDir, 'runs');

  const noMeta = leadUsage('r-nometa', { runsDir });
  assert.equal(noMeta.recorded, true);
  assert.equal(noMeta.model, 'claude-fable-5-1');
  assert.equal(noMeta.reads, 16);
  assert.equal(noMeta.costUsd, null);

  assert.equal(leadUsage('r-workeronly', { runsDir }).recorded, false);
  assert.equal(leadUsage('r-missing', { runsDir }).recorded, false);
  assert.equal(leadUsage('r-c', { runsDir: path.join(tempDir, 'runs') }).recorded, false);
});

test('featureUsage adds the lead up per request and per stage', () => {
  const u = featureUsage('F-10', { dataDir: leadDir });

  assert.equal(u.lead.runs, 2);
  assert.equal(u.lead.turns, 3);
  assert.equal(u.lead.reads, 400000);
  assert.equal(u.lead.readsPerRun, 200000);
  assert.ok(Math.abs(u.lead.cachedShare - 0.8875) < 1e-9);
  assert.equal(u.lead.big, 0);
  assert.equal(u.steps.plan.lead.reads, 100000);
  assert.equal(u.steps.build.lead.reads, 300000);
  assert.equal(u.steps.build.lead.turns, 2);
  assert.equal(u.lead.baseline, null);
  assert.ok(u.lessons.some(line => line.includes('this is the baseline request')));

  const runsWithLead = u.runs.filter(r => r.lead.recorded);
  assert.equal(runsWithLead.length, 2);
});

test('featureUsage compares a later request with the baseline', () => {
  const u = featureUsage('F-12', { dataDir: leadDir });

  assert.equal(u.lead.readsPerRun, 100000);
  assert.equal(u.lead.baseline.feature, 'F-10');
  assert.ok(Math.abs(u.lead.baseline.readsPerRun.change + 0.5) < 1e-9);
  assert.ok(Math.abs(u.lead.baseline.costUsd.change + 0.5) < 1e-9);
  assert.ok(Math.abs(u.lead.baseline.byStage.plan.change + 0.5) < 1e-9);
  assert.ok(Math.abs(u.lead.baseline.byStage.build.change + 0.5) < 1e-9);
  assert.ok(u.lessons.some(line => line.includes('50% less than F-10')));
});

test('compareFeatures puts the requests side by side against the first id', () => {
  const c = compareFeatures(['F-10', 'F-12'], { dataDir: leadDir });

  assert.equal(c.baseline, 'F-10');
  assert.deepEqual(c.rows.map(r => r.feature), ['F-10', 'F-12']);
  assert.deepEqual(c.rows[0].change, { readsPerRun: null, costUsd: null, plan: null, build: null });

  const later = c.rows[1];
  assert.equal(later.runs, 2);
  assert.equal(later.readsPerRun, 100000);
  assert.equal(later.cacheWritePerRun, 10250);
  assert.equal(later.outputPerRun, 1000);
  assert.equal(later.turnsPerRun, 1.5);
  assert.ok(Math.abs(later.costUsd - 3) < 1e-9);
  assert.ok(Math.abs(later.change.readsPerRun + 0.5) < 1e-9);
  assert.ok(Math.abs(later.change.costUsd + 0.5) < 1e-9);
  assert.ok(Math.abs(later.change.build + 0.5) < 1e-9);
});

test('compareFeatures survives an unknown request', () => {
  const c = compareFeatures(['F-10', 'F-404'], { dataDir: leadDir });

  assert.equal(c.rows.length, 2);
  assert.equal(c.rows[1].runs, 0);
  assert.equal(c.rows[1].readsPerRun, null);
  assert.equal(c.rows[1].change.readsPerRun, null);
  assert.deepEqual(compareFeatures([], { dataDir: leadDir }), { baseline: null, rows: [] });
});

test('boardInsights carries the lead figures and one line about the trend', () => {
  const insights = boardInsights({ dataDir: leadDir });

  const f12 = insights.features.find(f => f.id === 'F-12');
  const f10 = insights.features.find(f => f.id === 'F-10');

  assert.equal(f12.lead.readsPerRun, 100000);
  assert.ok(Math.abs(f12.lead.change + 0.5) < 1e-9);
  assert.equal(f10.lead.change, null);
  assert.ok(insights.lessons.some(line => line.includes('Since F-10, the lead has read on average 50% less per run over 1 request')));
});

/* ---------- the subscription allowance ---------- */

const { allowanceBasis, allowanceShare } = require('../usage.js');

/** A data dir holding just a claude.json, so the basis has a reading to work from. */
function basisDir(claude) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowance-'));
  if (claude !== undefined) fs.writeFileSync(path.join(dir, 'claude.json'), JSON.stringify(claude));
  return dir;
}

const fakeUsage = { last5h: { 'claude-opus-5': { input: 1000, output: 500, cacheRead: 400, cacheWrite: 100 } },
                    last7d: { 'claude-opus-5': { input: 8000, output: 1000, cacheRead: 900, cacheWrite: 100 } } };

const reading = (fiveHour, sevenDay, checkedAt) => ({
  rateLimitCheckedAt: checkedAt || '2026-09-10T11:45:48.117Z',
  rateLimit: { unifiedWindows: { five_hour: fiveHour, seven_day: sevenDay } }
});

test('allowanceBasis turns a normal reading into a capacity and a share', () => {
  const dir = basisDir(reading({ utilization: 0.5, resetsAt: 1789046400 }, { utilization: 0.1, resetsAt: 1789538400 }));
  const basis = allowanceBasis({ dataDir: dir, usage: fakeUsage });

  const five = basis.windows.five_hour;
  assert.equal(five.countedTokens, 2000);
  assert.equal(five.capacityTokens, 4000);       // 2000 counted at 50% used
  assert.equal(five.utilization, 0.5);
  assert.equal(five.resetsAt, 1789046400);
  assert.equal(five.estimated, true);
  assert.equal(five.checkedAt, '2026-09-10T11:45:48.117Z');
  assert.match(five.note, /five-hour window/);
  assert.match(five.note, /estimate/);
  assert.match(five.note, /only work done on this computer/);

  assert.equal(basis.windows.seven_day.capacityTokens, 100000);   // 10000 counted at 10% used
  assert.equal(basis.share(1000, 'five_hour'), 0.25);
  assert.equal(allowanceShare(basis, 50000, 'seven_day'), 0.5);
  assert.equal(basis.share(1000, 'not_a_window'), null);
});

test('allowanceBasis refuses to guess when there is no reading', () => {
  const dir = basisDir({ updatedAt: '2026-09-10T11:00:00.000Z' });
  const basis = allowanceBasis({ dataDir: dir, usage: fakeUsage });

  for (const name of ['five_hour', 'seven_day']) {
    const w = basis.windows[name];
    assert.equal(w.capacityTokens, null);
    assert.equal(w.utilization, null);
    assert.equal(w.resetsAt, null);
    assert.equal(basis.share(1000, name), null);
    assert.match(w.note, /cannot be worked out yet/);
  }
  assert.equal(basis.checkedAt, null);
});

test('allowanceBasis gives no share for a window used zero percent, or one with nothing counted', () => {
  const dir = basisDir(reading({ utilization: 0, resetsAt: 1789046400 }, { utilization: 0.25, resetsAt: 1789538400 }));
  const basis = allowanceBasis({ dataDir: dir, usage: { last5h: fakeUsage.last5h, last7d: {} } });

  assert.equal(basis.windows.five_hour.utilization, 0);
  assert.equal(basis.windows.five_hour.capacityTokens, null);
  assert.equal(basis.share(1000, 'five_hour'), null);

  assert.equal(basis.windows.seven_day.countedTokens, 0);         // a reading, but nothing counted to divide
  assert.equal(basis.windows.seven_day.capacityTokens, null);
  assert.equal(basis.share(1000, 'seven_day'), null);
});

test('allowanceBasis still returns a stale reading, with the time it was taken', () => {
  const old = '2026-08-01T00:00:00.000Z';
  const dir = basisDir(reading({ utilization: 0.4, resetsAt: 1785000000 }, { utilization: 0.2, resetsAt: 1785500000 }, old));
  const basis = allowanceBasis({ dataDir: dir, usage: fakeUsage });

  assert.equal(basis.checkedAt, old);
  assert.equal(basis.windows.five_hour.checkedAt, old);
  assert.equal(basis.windows.five_hour.capacityTokens, 5000);
  assert.equal(basis.windows.seven_day.checkedAt, old);
});

test('a basis survives being sent as JSON, without the share helper leaking into it', () => {
  const dir = basisDir(reading({ utilization: 0.5, resetsAt: 1789046400 }, { utilization: 0.1, resetsAt: 1789538400 }));
  const basis = JSON.parse(JSON.stringify(allowanceBasis({ dataDir: dir, usage: fakeUsage })));

  assert.equal(basis.share, undefined);
  assert.equal(basis.windows.five_hour.capacityTokens, 4000);
  assert.equal(allowanceShare(basis, 2000, 'five_hour'), 0.5);
});

/* ---------- tokens per stage, per run and per model (T-2) ---------- */

let tokenDir;

function writeTokenFeature(dir, id, n) {
  fs.writeFileSync(path.join(dir, 'features', id + '.json'), JSON.stringify({
    id, n, title: 'Token feature', status: 'done', updatedAt: '2026-09-10T12:00:00.000Z',
    size: 'medium', plan: { forecast: { cost: 'medium', plain: 'x' } }, tasks: []
  }));
}

function writeTokenRun(dir, id, feature, step, tokensByModel, costUsd) {
  fs.writeFileSync(path.join(dir, 'runs', id + '.json'), JSON.stringify({
    id, kind: 'team', feature, step, status: 'done',
    startedAt: '2026-09-10T10:00:00.000Z', model: Object.keys(tokensByModel)[0]
  }));
  const modelUsageMap = {};
  for (const [m, t] of Object.entries(tokensByModel)) {
    modelUsageMap[m] = {
      inputTokens: t.input, outputTokens: t.output,
      cacheReadInputTokens: t.cacheRead, cacheCreationInputTokens: t.cacheWrite, costUSD: t.costUsd
    };
  }
  fs.writeFileSync(path.join(dir, 'runs', id + '.jsonl'), JSON.stringify({
    type: 'result', subtype: 'success', total_cost_usd: costUsd, modelUsage: modelUsageMap
  }) + '\n');
}

function writeUnrecordedRun(dir, id, feature, step) {
  fs.writeFileSync(path.join(dir, 'runs', id + '.json'), JSON.stringify({
    id, kind: 'team', feature, step, status: 'running', startedAt: '2026-09-10T10:00:00.000Z', model: FABLE
  }));
  fs.writeFileSync(path.join(dir, 'runs', id + '.jsonl'), JSON.stringify({ type: 'assistant' }) + '\n');
}

test.before(() => {
  tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-tokens-'));
  fs.mkdirSync(path.join(tokenDir, 'features'));
  fs.mkdirSync(path.join(tokenDir, 'runs'));

  // F-60: two stages of equal weight, so no stage dominates; one unrecorded run in a third stage.
  writeTokenFeature(tokenDir, 'F-60', 60);
  writeTokenRun(tokenDir, 'r-t60-read', 'F-60', 'read', { [FABLE]: { input: 5, output: 3, cacheRead: 1, cacheWrite: 1, costUsd: 0.1 } }, 0.1);
  writeTokenRun(tokenDir, 'r-t60-build', 'F-60', 'build', { [FABLE]: { input: 5, output: 3, cacheRead: 1, cacheWrite: 1, costUsd: 0.1 } }, 0.1);
  writeUnrecordedRun(tokenDir, 'r-t60-plan', 'F-60', 'plan');

  // F-61: one stage clearly dominates.
  writeTokenFeature(tokenDir, 'F-61', 61);
  writeTokenRun(tokenDir, 'r-t61-read', 'F-61', 'read', { [FABLE]: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 } }, 0.01);
  writeTokenRun(tokenDir, 'r-t61-build', 'F-61', 'build', { [FABLE]: { input: 100, output: 100, cacheRead: 0, cacheWrite: 0, costUsd: 1 } }, 1);

  // F-62: nothing at all recorded.
  writeTokenFeature(tokenDir, 'F-62', 62);
});

test.after(() => {
  fs.rmSync(tokenDir, { recursive: true });
});

test('featureUsage rolls tokens up per stage and per model', () => {
  const u = featureUsage('F-60', { dataDir: tokenDir, usage: {} });

  assert.deepEqual(u.steps.read.tokens, { input: 5, output: 3, cacheRead: 1, cacheWrite: 1, total: 10 });
  assert.deepEqual(u.steps.build.tokens, { input: 5, output: 3, cacheRead: 1, cacheWrite: 1, total: 10 });
  assert.equal(u.steps.plan.recorded, false);
  assert.deepEqual(u.steps.plan.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

  assert.deepEqual(u.tokens, { input: 10, output: 6, cacheRead: 2, cacheWrite: 2, total: 20 });
  assert.equal(u.models[FABLE].runs, 2);
  assert.equal(u.models[FABLE].avgTotalPerRun, 10);
  assert.equal(u.models[FABLE].maxTotalPerRun, 10);

  const run = u.runs.find(r => r.id === 'r-t60-plan');
  assert.equal(run.recorded, false);
  assert.deepEqual(run.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
});

test('featureUsage.dominantStep fires only when one stage is more than half the total', () => {
  const balanced = featureUsage('F-60', { dataDir: tokenDir, usage: {} });
  assert.equal(balanced.dominantStep, null);

  const skewed = featureUsage('F-61', { dataDir: tokenDir, usage: {} });
  assert.equal(skewed.dominantStep.step, 'build');
  assert.ok(Math.abs(skewed.dominantStep.share - 200 / 202) < 1e-9);
});

test('featureUsage.tokens and allowance are null when nothing was recorded', () => {
  const u = featureUsage('F-62', { dataDir: tokenDir, usage: {} });
  assert.equal(u.recorded, false);
  assert.equal(u.tokens, null);
  assert.equal(u.allowance.five_hour, null);
  assert.equal(u.allowance.seven_day, null);
  assert.equal(u.dominantStep, null);
});
