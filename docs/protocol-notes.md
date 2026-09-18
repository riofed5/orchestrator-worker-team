# Protocol notes: the records, field by field

The binding rules are in `PROTOCOL.md`. This file is the field-by-field
explanation and the commentary around it.

A three-level AI engineering team works this project on Claude Code;
Antigravity is only the editor. `CLAUDE.md`, `AGENTS.md` and `PROTOCOL.md` are
loaded on every call, which is why they carry rules only.

## Where the board lives

```
board/
├── serve.js                  # local viewer: node board/serve.js
├── index.html
└── data/
    ├── features/F-<n>.json   # one request per file
    ├── messages/m-<id>.json  # one message per file
    └── runs/r-<id>.json      # one launch of the team per file (board writes these)
```

## `data/features/F-<n>.json`

- `id`, `n` — must match the filename.
- `raw` — the human's original words. **Never overwrite.**
- `context[]` — `{at, text, round}`: more words the human added after
  seeing a plan, with the plan round they were answering. Appended by the
  board only; agents read it and **never overwrite or edit** it. The Senior
  folds every entry into the next plan and into the card's `CONTEXT` block.
- `title`, `goal`, `why`, `must[]`, `mustNot[]`, `assumptions[]`,
  `questions[{q,a}]`, `hint`, `prio`, `size` (`small|medium|large`).
- `status` — one of:
  `new` (the human's words, not read back yet),
  `spec-review` (waiting on the human),
  `ready` (approved; plan it),
  `planning`,
  `plan-review` (waiting on the human),
  `building`, `checking`,
  `needs-input` (a question is waiting on the human),
  `done`, `blocked`.
- `approvals` — `{spec, plan}` timestamps, written by the board. Do not fake
  these; they are the human's signature.
- `plan` — `{plain, approach, patterns[], risks[], forecast, lessons[],
  round}` where `forecast` is `{cost, plain}` and `cost` is
  `low | medium | high` (see "Cost hint" in `docs/models.md`).
  `round` is `1` for the first plan and goes up by one each time a fresh
  plan is written after the human added context. A fresh plan replaces the
  old one; the rounds stay visible through `context[]` and `log[]`.
  `lessons[]` is plain lines learned from earlier finished requests, brought in by the Senior at plan time.
- `tasks[]` — `{id, title, level, agent, model, modelWhy, cost, status,
  attempts, escalated, detail?}`; `status` is
  `todo | running | done | rejected | escalated`; `model` is one of
  `haiku-4.5 | sonnet-5 | opus-5` (older records may say the retired
  `fable-5.1`) and `cost` is
  `low | medium | high`. Update `model` and `modelWhy` if a card is re-sent
  on a stronger model, so the record shows what actually did the work.
  `detail` is the card itself: a delegation names only the request and the
  piece, so the worker reads `detail` from here and it has to stand alone.
- `report` — `{plain, summary, tests[{cmd,result,plain}], files[],
  deferred[], followups[]}`.
- `log[]` — `{at, who, text}`, appended one line per checkpoint.
- `blockedReason` — only when `status` is `blocked`.
- `interrupted` — `{runId, at, step, why, resumeFrom, resumeFromTitle,
  resumedAt, resumedRun}`, written by the board only, never by an agent.
  Set when a run the board launched was cut off before the request was
  finished: `why` is a plain reason, `resumeFrom` is the first task not yet
  `done` (or `null` when only the final check remains), and `resumedAt` /
  `resumedRun` are filled in when the human presses resume. The Senior reads
  it and continues from `resumeFrom`, keeping every `done` task.
- `updatedAt` — ISO timestamp on every write.

## `data/messages/m-<id>.json`

`{id, feature, task, to, from, kind, text, status, replyTo, createdAt}` where
`status` is `queued` (undelivered), `delivered`, or `answered`.

## `data/runs/r-<id>.json`, `r-<id>.jsonl`, `data/claude.json`

Written by the board's server only, never by an agent. A run is one launch of
the team from the board. `r-<id>.json` holds `{id, kind, feature, step,
prompt, startedAt, endedAt, status, exitCode, sessionId, model, costUsd,
numTurns, resultSubtype, lines, error, heartbeatAt, notes[]}`; `r-<id>.jsonl`
holds the raw events the run emitted, one per line. `step` is one of `read`,
`plan`, `build`, `resume` or `inbox`; `resume` is a fresh run of the same
stage after a cut-off. `claude.json` holds the latest subscription reading
and the last run. `r-<id>.json` also carries `effort` (the thinking effort
the board asked for), `lead` (`{model, turns, context, budget, reads,
paused}`, the lead's own context size, kept current by the board while the
run is live), `continuedFrom` and `continuation` (set when the board
carried a build on in a fresh session after a pause).

## Writing for the human: what each plain field should say

The rule and the full list of plain fields are in "Writing for the human" in
`PROTOCOL.md`. What each one is for:

- `plan.plain` — 2 to 4 lines on what will happen.
- `tasks[].title` — what the piece achieves, not how it is done.
- `tasks[].modelWhy` — one line on why that model suits the card.
- `plan.forecast.plain` — 2 to 3 lines on the likely cost and why the mix of
  models is a fair trade of strength against spend.
- `report.plain` — 3 to 5 lines: what is different now, and anything that went
  sideways.
- `report.tests[].plain` — what the check proves, in the human's terms.
- `log[].text` — one past-tense sentence per checkpoint.
- `context[].text` — the human's own words, shown back exactly as written.

## The formats in full

The rules for these are in `PROTOCOL.md` ("Feature request") and `AGENTS.md`
("Task card format", "Report format"); the templates themselves are here.

Feature request — the card the agents receive:

```
F-<n> <title>
GOAL: <one sentence, what not how>
WHY: <one line, optional>
MUST:
- <criterion, verbatim into task cards>
MUST NOT:
- <constraint>
ASSUMED:
- <assumption the human accepted>
ANSWERS:
- <question> → <the human's answer>
HINT: <files or patterns to copy, optional>
PRIO: P1 | P2 | P3
```

Task card — the Senior writes one per piece into `tasks[].detail`:

```
### T-<n>: <short title>
Level: JUNIOR | MID | SENIOR
Model: haiku-4.5 | sonnet-5 | opus-5  (why, in one line)
Cost: low | medium | high
Goal: <one sentence>
Context: <what the worker needs to know; links to files, patterns to copy,
          credential variable names it may use>
Files: <expected files to create/modify>
Acceptance criteria:
- [ ] ...
- [ ] tests pass: <command>
Out of scope: <what NOT to touch>
```

Report — what a Mid or Junior returns, at most the report cap:

```
Task: T-<n>
Status: DONE | BLOCKED | ESCALATE
Changed: <files>
Tests: <command run and result>
Notes: <decisions made, anything the reviewer should look at>
Escalation reason (if any): <why this needs a higher level>
```
