#!/usr/bin/env node
/**
 * Team board — picking up after a cut-off run.
 *
 * A run the board launched can be cut off: the board is restarted, the
 * human stops it, or the computer sleeps and the run does not survive.
 * These functions tidy the record so nothing shows as running that is not,
 * and mark the request so the human can resume it from the first piece of
 * work that was not finished. Pieces already accepted are kept.
 *
 * Everything the human reads (`interrupted.why`, log lines) is plain
 * language. Only the board's server calls these; agents never do.
 *
 * No dependencies. Node 18 or newer.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/** What each kind of run was doing, for the log line. */
const STEP_NAME = { read: 'read-back', plan: 'planning', build: 'build', resume: 'build', inbox: 'inbox' };
/** Which request statuses a run of each step may still be working on. Past these, the run finished its checkpoint. */
const STEP_OPEN = {
  read: ['new'], plan: ['ready', 'planning'],
  build: ['building', 'checking'], resume: ['building', 'checking']
};
const RESUMABLE = ['building', 'checking'];

const nowIso = () => new Date().toISOString();

/** Write via a temp file so a half-written file is never read by the agents. */
function writeDoc(dir, id, doc) {
  const file = path.join(dir, id + '.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function readDoc(dir, id) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); } catch { return null; }
}

function readAll(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))); } catch {}
  }
  return out;
}

/** The first task that is not done, or null when every piece was accepted and only the final check remains. */
function resumePoint(feature) {
  const tasks = Array.isArray(feature && feature.tasks) ? feature.tasks : [];
  return tasks.find(t => t && t.status !== 'done') || null;
}

/** True when a feature carries a cut-off the human has not resumed yet. */
function isInterrupted(feature) {
  return !!(feature && feature.interrupted && !feature.interrupted.resumedAt);
}

/** True when a cut-off run of `step` could still have been working on a feature in this status. */
function stepStillOpen(step, status) {
  return (STEP_OPEN[step] || []).includes(status);
}

const quote = s => `“${s}”`;

/**
 * Mark a feature as cut off by `run`. Every task that was running goes back
 * to todo, `feature.interrupted` is set, and one plain log line is appended.
 * Mutates and returns the feature; the caller writes it.
 */
function recoverFeature(feature, run, why, now = nowIso()) {
  const reset = [];
  for (const t of feature.tasks || []) {
    if (t && t.status === 'running') { t.status = 'todo'; reset.push(t); }
  }
  const from = resumePoint(feature);
  feature.interrupted = {
    runId: run.id, at: now, step: run.step || null, why,
    resumeFrom: from ? from.id : null, resumeFromTitle: from ? from.title : null,
    resumedAt: null, resumedRun: null
  };
  const parts = [`The ${STEP_NAME[run.step] || 'team'} run was cut off (${why})`];
  if (reset.length === 1) parts.push(`the piece ${quote(reset[0].title)} went back to waiting`);
  else if (reset.length > 1) parts.push(`${reset.length} pieces went back to waiting`);
  if (RESUMABLE.includes(feature.status)) {
    parts.push(from ? `the team can resume from ${quote(from.title)}` : 'the team can resume from the final check');
  } else {
    parts.push('press the button to start it again');
  }
  feature.log = Array.isArray(feature.log) ? feature.log : [];
  feature.log.push({ at: now, who: 'board', text: parts.join('; ') + '.' });
  feature.updatedAt = now;
  return feature;
}

/**
 * Record that the human resumed a cut-off feature with a fresh run.
 * Mutates and returns the feature; the caller writes it.
 */
function markResumed(feature, runId, now = nowIso()) {
  if (!feature.interrupted) return feature;
  feature.interrupted.resumedAt = now;
  feature.interrupted.resumedRun = runId;
  const title = feature.interrupted.resumeFromTitle;
  feature.log = Array.isArray(feature.log) ? feature.log : [];
  feature.log.push({ at: now, who: 'you', text: title ? `You resumed the team from ${quote(title)}.` : 'You resumed the team from the final check.' });
  feature.updatedAt = now;
  return feature;
}

/**
 * Every run still marked running in dataDir/runs becomes failed with `why`,
 * and the feature it was working on (if the run could still have been
 * working on it) is recovered. Returns [{run, feature}] for what was touched.
 */
/** A run whose heartbeat is this fresh belongs to a board that is still alive. */
const LIVE_HEARTBEAT_MS = 90_000;

function sweepRuns(dataDir, why, now = nowIso(), liveWindowMs = LIVE_HEARTBEAT_MS) {
  const RUNS = path.join(dataDir, 'runs');
  const FEATURES = path.join(dataDir, 'features');
  const touched = [];
  for (const run of readAll(RUNS)) {
    if (!run || !run.id || run.status !== 'running') continue;
    // Another board may be running right now against the same board files. Its
    // run is alive, not cut off: touching it would wrongly tell the human the
    // team stopped, and reset a piece of work that is being done as we look.
    const beat = Date.parse(run.heartbeatAt || '');
    if (Number.isFinite(beat) && Date.parse(now) - beat < liveWindowMs) {
      console.log(`  ${run.id}: still beating, so another board is running it; left alone`);
      continue;
    }
    run.status = 'failed';
    run.endedAt = now;
    run.error = why;
    writeDoc(RUNS, run.id, run);
    const recovered = [];
    if (run.feature) {
      const feature = readDoc(FEATURES, run.feature);
      if (feature && stepStillOpen(run.step, feature.status)) recovered.push(feature);
    } else if (run.step === 'inbox') {
      // An inbox run may have been building any request; a task still marked running is its trace.
      for (const feature of readAll(FEATURES)) {
        if (RESUMABLE.includes(feature.status) && (feature.tasks || []).some(t => t && t.status === 'running')) recovered.push(feature);
      }
    }
    for (const feature of recovered) {
      recoverFeature(feature, run, why, now);
      writeDoc(FEATURES, feature.id, feature);
    }
    touched.push({ run, features: recovered.map(f => f.id) });
  }
  return touched;
}

/**
 * What a fresh session should carry on from after a build run ended cleanly
 * with work still to do: the first task not done, the string 'final check'
 * when every piece is accepted and the request is checking, or null when
 * there is nothing to continue (the run failed, the request moved on, it
 * was cut off, or `max` fresh sessions have already followed one another).
 */
function continuationFor(feature, run, max) {
  if (!feature || !run || run.status !== 'done') return null;
  if (run.step !== 'build' && run.step !== 'resume') return null;
  if (!RESUMABLE.includes(feature.status) || isInterrupted(feature)) return null;
  if ((run.continuation || 0) >= max) return null;
  const from = resumePoint(feature);
  if (from) return from;
  return feature.status === 'checking' ? 'final check' : null;
}

/**
 * True when `run` was itself a fresh session started by the board and the
 * piece to continue from is the same one it started at, so another session
 * would only spend money to stand still.
 */
function noProgress(run, feature) {
  if (!run || !(run.continuation > 0)) return false;
  const from = resumePoint(feature);
  return (from ? from.id : null) === (run.resumeFrom || null);
}

/**
 * Record that the board carried a build on in a fresh session `newRunId`
 * after `prevRun`. A task still marked running was left mid-flight by the
 * previous session and goes back to todo so the new one delegates it again.
 * Mutates and returns the feature; the caller writes it.
 */
function continueFeature(feature, prevRun, newRunId, now = nowIso()) {
  const reset = [];
  for (const t of feature.tasks || []) {
    if (t && t.status === 'running') { t.status = 'todo'; reset.push(t); }
  }
  const from = resumePoint(feature);
  const parts = [`The build carried on in a fresh session from ${from ? quote(from.title) : 'the final check'} so the lead's memory stays small`];
  if (reset.length === 1) parts.push(`the piece ${quote(reset[0].title)} went back to waiting`);
  else if (reset.length > 1) parts.push(`${reset.length} pieces went back to waiting`);
  feature.log = Array.isArray(feature.log) ? feature.log : [];
  feature.log.push({ at: now, who: 'board', text: parts.join('; ') + '.' });
  feature.updatedAt = now;
  return feature;
}

/**
 * Should the lead stop between pieces so the board can carry on in a fresh session?
 *
 * Measured as GROWTH above whatever this session started at, never as absolute
 * size: a session already carries ~25,000 tokens of system prompt, tools and
 * rulebook before the lead does anything, so an absolute budget near that
 * number pauses every session on its first turn and nothing ever gets built.
 * A session must also have taken a few turns, so a pause always follows real work.
 */
function shouldPause(lead, context, minTurns) {
  if (!lead || lead.paused) return false;
  if ((lead.turns || 0) < (minTurns || 0)) return false;
  const grown = context - (lead.startContext || 0) >= lead.budget;
  const huge = lead.ceiling ? context >= lead.ceiling : false;
  return grown || huge;
}

module.exports = {
  resumePoint, recoverFeature, markResumed, sweepRuns, isInterrupted, stepStillOpen, writeDoc, RESUMABLE,
  continuationFor, noProgress, continueFeature, shouldPause
};
