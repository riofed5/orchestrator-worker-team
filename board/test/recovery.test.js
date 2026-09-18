'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { shouldPause, resumePoint, recoverFeature, markResumed, sweepRuns, isInterrupted, stepStillOpen } = require('../recovery.js');

const NOW = '2026-09-09T15:00:00.000Z';

function feature(status, tasks) {
  return {
    id: 'F-1', n: 1, title: 'First', status,
    tasks: tasks.map(([id, title, st]) => ({ id, title, status: st, attempts: 1, escalated: false })),
    log: [{ at: '2026-09-09T14:00:00.000Z', who: 'senior', text: 'started' }],
    updatedAt: '2026-09-09T14:00:00.000Z'
  };
}
const run = (id, step, extra) => ({ id, kind: 'team', feature: 'F-1', step, status: 'running', startedAt: NOW, endedAt: null, error: null, ...extra });

test('resumePoint is the first task that is not done, or null when only the final check remains', () => {
  const f = feature('building', [['T-1', 'One', 'done'], ['T-2', 'Two', 'running'], ['T-3', 'Three', 'todo']]);
  assert.equal(resumePoint(f).id, 'T-2');
  assert.equal(resumePoint(feature('checking', [['T-1', 'One', 'done']])), null);
  assert.equal(resumePoint({ id: 'F-9', status: 'new' }), null);
});

test('recoverFeature resets running tasks, keeps done ones, sets the marker and logs plainly', () => {
  const f = feature('building', [['T-1', 'Keep the accepted piece', 'done'], ['T-2', 'The piece in progress', 'running'], ['T-3', 'Later', 'todo']]);
  recoverFeature(f, run('r-1', 'build'), 'stopped when the board was restarted', NOW);
  assert.deepEqual(f.tasks.map(t => t.status), ['done', 'todo', 'todo']);
  assert.deepEqual(f.interrupted, {
    runId: 'r-1', at: NOW, step: 'build', why: 'stopped when the board was restarted',
    resumeFrom: 'T-2', resumeFromTitle: 'The piece in progress', resumedAt: null, resumedRun: null
  });
  assert.equal(f.updatedAt, NOW);
  const line = f.log.at(-1);
  assert.equal(line.who, 'board');
  assert.equal(line.at, NOW);
  assert.equal(line.text, 'The build run was cut off (stopped when the board was restarted); the piece “The piece in progress” went back to waiting; the team can resume from “The piece in progress”.');
  assert.equal(isInterrupted(f), true);
});

test('recoverFeature on a checking feature points at the final check', () => {
  const f = feature('checking', [['T-1', 'One', 'done'], ['T-2', 'Two', 'done']]);
  recoverFeature(f, run('r-2', 'resume'), 'stopped from the board', NOW);
  assert.equal(f.interrupted.resumeFrom, null);
  assert.equal(f.interrupted.resumeFromTitle, null);
  assert.equal(f.log.at(-1).text, 'The build run was cut off (stopped from the board); the team can resume from the final check.');
});

test('recoverFeature on a read-back run says to press the button again', () => {
  const f = { id: 'F-4', status: 'new', log: [] };
  recoverFeature(f, { id: 'r-3', step: 'read' }, 'stopped when the board was stopped', NOW);
  assert.equal(f.interrupted.resumeFrom, null);
  assert.equal(f.log.at(-1).text, 'The read-back run was cut off (stopped when the board was stopped); press the button to start it again.');
});

test('markResumed fills in the marker and logs which piece it resumed from', () => {
  const f = feature('building', [['T-1', 'One', 'done'], ['T-2', 'Two', 'todo']]);
  recoverFeature(f, run('r-1', 'build'), 'stopped when the board was restarted', NOW);
  const later = '2026-09-09T15:10:00.000Z';
  markResumed(f, 'r-9', later);
  assert.equal(f.interrupted.resumedAt, later);
  assert.equal(f.interrupted.resumedRun, 'r-9');
  assert.equal(isInterrupted(f), false);
  assert.deepEqual(f.log.at(-1), { at: later, who: 'you', text: 'You resumed the team from “Two”.' });
  assert.equal(markResumed({ id: 'F-2', log: [] }, 'r-9', later).interrupted, undefined);
});

test('stepStillOpen knows which statuses a cut-off run may still have been working on', () => {
  assert.equal(stepStillOpen('build', 'building'), true);
  assert.equal(stepStillOpen('resume', 'checking'), true);
  assert.equal(stepStillOpen('build', 'done'), false);
  assert.equal(stepStillOpen('plan', 'plan-review'), false);
  assert.equal(stepStillOpen('read', 'new'), true);
  assert.equal(stepStillOpen('inbox', 'building'), false);
});

test('sweepRuns marks every running run failed and recovers only the features still being worked on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-'));
  fs.mkdirSync(path.join(dir, 'features'));
  fs.mkdirSync(path.join(dir, 'runs'));
  const w = (sub, doc) => fs.writeFileSync(path.join(dir, sub, doc.id + '.json'), JSON.stringify(doc));

  w('features', feature('building', [['T-1', 'One', 'done'], ['T-2', 'Two', 'running']]));
  w('features', { ...feature('plan-review', []), id: 'F-2', n: 2 });
  w('features', { ...feature('building', [['T-1', 'Alpha', 'running']]), id: 'F-3', n: 3 });
  w('features', { ...feature('building', [['T-1', 'Quiet', 'todo']]), id: 'F-4', n: 4 });
  w('runs', run('r-build', 'build'));
  w('runs', run('r-plan', 'plan', { feature: 'F-2' }));
  w('runs', run('r-inbox', 'inbox', { feature: null }));
  w('runs', run('r-old', 'build', { status: 'done', endedAt: NOW }));

  const touched = sweepRuns(dir, 'stopped when the board was restarted', NOW);
  assert.deepEqual(touched.map(t => [t.run.id, t.features]).sort(), [
    ['r-build', ['F-1']], ['r-inbox', ['F-3']], ['r-plan', []]
  ]);

  const rd = (sub, id) => JSON.parse(fs.readFileSync(path.join(dir, sub, id + '.json'), 'utf8'));
  for (const id of ['r-build', 'r-plan', 'r-inbox']) {
    const r = rd('runs', id);
    assert.equal(r.status, 'failed');
    assert.equal(r.endedAt, NOW);
    assert.equal(r.error, 'stopped when the board was restarted');
  }
  assert.equal(rd('runs', 'r-old').status, 'done');

  const f1 = rd('features', 'F-1');
  assert.equal(f1.tasks[1].status, 'todo');
  assert.equal(f1.interrupted.runId, 'r-build');
  assert.equal(f1.interrupted.resumeFrom, 'T-2');
  assert.equal(rd('features', 'F-2').interrupted, undefined);
  const f3 = rd('features', 'F-3');
  assert.equal(f3.tasks[0].status, 'todo');
  assert.equal(f3.interrupted.runId, 'r-inbox');
  assert.equal(rd('features', 'F-4').interrupted, undefined);

  assert.deepEqual(sweepRuns(dir, 'again', NOW), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

const { continuationFor, noProgress, continueFeature } = require('../recovery.js');
const doneRun = (id, step, extra) => run(id, step, { status: 'done', endedAt: NOW, continuation: 0, resumeFrom: null, ...extra });

test('continuationFor names the first unfinished piece after a clean build run, or the final check', () => {
  const f = feature('building', [['T-1', 'One', 'done'], ['T-2', 'Two', 'todo']]);
  assert.equal(continuationFor(f, doneRun('r-1', 'build'), 8).id, 'T-2');
  assert.equal(continuationFor(f, doneRun('r-1', 'resume'), 8).id, 'T-2');
  assert.equal(continuationFor(feature('checking', [['T-1', 'One', 'done']]), doneRun('r-1', 'build'), 8), 'final check');
});

test('continuationFor is null when there is nothing to carry on', () => {
  const open = () => feature('building', [['T-1', 'One', 'done'], ['T-2', 'Two', 'todo']]);
  assert.equal(continuationFor(open(), run('r-1', 'build'), 8), null, 'still running');
  assert.equal(continuationFor(open(), doneRun('r-1', 'build', { status: 'failed' }), 8), null, 'failed');
  assert.equal(continuationFor(open(), doneRun('r-1', 'plan'), 8), null, 'not a build');
  assert.equal(continuationFor(feature('done', [['T-1', 'One', 'done']]), doneRun('r-1', 'build'), 8), null, 'finished');
  assert.equal(continuationFor(feature('needs-input', [['T-1', 'One', 'todo']]), doneRun('r-1', 'build'), 8), null, 'waiting on the human');
  assert.equal(continuationFor(feature('building', [['T-1', 'One', 'done']]), doneRun('r-1', 'build'), 8), null, 'every piece done but not yet checking');
  const cut = recoverFeature(open(), run('r-0', 'build'), 'stopped', NOW);
  assert.equal(continuationFor(cut, doneRun('r-1', 'build'), 8), null, 'interrupted');
  assert.equal(continuationFor(open(), doneRun('r-1', 'build', { continuation: 8 }), 8), null, 'too many fresh sessions');
  assert.equal(continuationFor(null, doneRun('r-1', 'build'), 8), null);
});

test('continuationFor keeps chaining past the old limit of eight and stops at the new one', () => {
  const open = () => feature('building', [['T-1', 'One', 'done'], ['T-2', 'Two', 'todo']]);
  for (const continuation of [8, 12, 19]) {
    assert.equal(continuationFor(open(), doneRun('r-1', 'build', { continuation }), 20).id, 'T-2', `chains at ${continuation}`);
  }
  assert.equal(continuationFor(open(), doneRun('r-1', 'build', { continuation: 20 }), 20), null, 'stops at the new max');
  assert.equal(continuationFor(open(), doneRun('r-1', 'build', { continuation: 21 }), 20), null, 'stops past the new max');
});

test('noProgress is true only for a fresh session that ended where it started', () => {
  const f = feature('building', [['T-1', 'One', 'done'], ['T-2', 'Two', 'todo']]);
  assert.equal(noProgress(doneRun('r-1', 'build', { continuation: 0, resumeFrom: 'T-2' }), f), false, 'the first run is never no-progress');
  assert.equal(noProgress(doneRun('r-2', 'build', { continuation: 1, resumeFrom: 'T-1' }), f), false, 'it moved on');
  assert.equal(noProgress(doneRun('r-2', 'build', { continuation: 1, resumeFrom: 'T-2' }), f), true);
  const checking = feature('checking', [['T-1', 'One', 'done']]);
  assert.equal(noProgress(doneRun('r-3', 'build', { continuation: 1, resumeFrom: null }), checking), true, 'still at the final check');
  assert.equal(noProgress(doneRun('r-3', 'build', { continuation: 1, resumeFrom: 'T-1' }), checking), false);
});

test('continueFeature logs the piece it carried on from and resets a piece left running', () => {
  const f = feature('building', [['T-1', 'One', 'done'], ['T-2', 'The next piece', 'todo']]);
  continueFeature(f, doneRun('r-1', 'build'), 'r-2', NOW);
  assert.equal(f.log.at(-1).who, 'board');
  assert.equal(f.log.at(-1).text, 'The build carried on in a fresh session from “The next piece” so the lead\'s memory stays small.');
  assert.equal(f.updatedAt, NOW);
  assert.equal(f.interrupted, undefined);

  const g = feature('building', [['T-1', 'Left running', 'running'], ['T-2', 'Later', 'todo']]);
  continueFeature(g, doneRun('r-1', 'build'), 'r-2', NOW);
  assert.deepEqual(g.tasks.map(t => t.status), ['todo', 'todo']);
  assert.equal(g.log.at(-1).text, 'The build carried on in a fresh session from “Left running” so the lead\'s memory stays small; the piece “Left running” went back to waiting.');

  const h = feature('checking', [['T-1', 'One', 'done']]);
  continueFeature(h, doneRun('r-1', 'build'), 'r-2', NOW);
  assert.equal(h.log.at(-1).text, 'The build carried on in a fresh session from the final check so the lead\'s memory stays small.');
});

/* ---------- when the lead pauses between pieces ---------- */

const { shouldPause: pause } = require('../recovery');
const leadAt = (turns, startContext) =>
  ({ turns, startContext, budget: 55_000, ceiling: 140_000, paused: false });

test('a fresh session never pauses on its own start-up cost', () => {
  // The trap that stopped F-12: a session starts at ~25k before doing anything.
  assert.equal(pause(leadAt(1, 25_736), 25_736, 6), false);
  assert.equal(pause(leadAt(3, 25_000), 26_500, 6), false, 'still too few turns to have done work');
});

test('a session pauses once it has grown past the budget, whatever it started at', () => {
  assert.equal(pause(leadAt(8, 25_000), 79_999, 6), false);
  assert.equal(pause(leadAt(8, 25_000), 80_000, 6), true);
  // A heavier rulebook shifts the start; the growth budget still holds.
  assert.equal(pause(leadAt(8, 40_000), 80_000, 6), false);
  assert.equal(pause(leadAt(8, 40_000), 95_000, 6), true);
});

test('the ceiling is a backstop and a paused lead is not asked twice', () => {
  assert.equal(pause({ ...leadAt(8, 100_000), budget: 55_000 }, 141_000, 6), true);
  assert.equal(pause({ ...leadAt(8, 25_000), paused: true }, 200_000, 6), false);
});

test('a run that is still beating belongs to another live board and is left alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-live-'));
  fs.mkdirSync(path.join(dir, 'features'));
  fs.mkdirSync(path.join(dir, 'runs'));
  const w = (sub, doc) => fs.writeFileSync(path.join(dir, sub, doc.id + '.json'), JSON.stringify(doc));
  const now = '2026-09-10T09:02:02.000Z';

  w('runs', run('r-live', 'build', { heartbeatAt: '2026-09-10T09:02:00.000Z' }));
  w('runs', run('r-dead', 'build', { heartbeatAt: '2026-09-10T07:10:00.000Z' }));
  w('features', feature('building', [['T-1', 'One', 'running']]));

  const touched = sweepRuns(dir, 'stopped when the board was restarted', now);

  assert.deepEqual(touched.map(t => t.run.id), ['r-dead'], 'only the run nobody is beating is swept');
  const live = JSON.parse(fs.readFileSync(path.join(dir, 'runs', 'r-live.json'), 'utf8'));
  assert.equal(live.status, 'running', 'the live board keeps its run');
  assert.equal(live.endedAt, null);
});
