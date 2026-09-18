---
name: team
description: Move one request on the team board forward one stage. Use when the human types /team F-<n>, /team with no argument, or /team <problem text>. Stops for human approval of the read-back and again of the plan before any code is written.
---
# /team — move one request forward one stage

Input: everything after `/team`. A board id (`F-2`), free problem text, or
nothing. `PROTOCOL.md` is binding for every format, status and checkpoint.
The board is plain JSON under `board/data/`. Read and write those
files directly with your normal file tools.

Each run advances the request to the next point where a human is needed, then
stops. Run it again after the human answers.

## 1. Load

- `F-<n>` → read `board/data/features/F-<n>.json`.
- Nothing → read every file in that folder and take the oldest `n` whose
  status is `new`, `ready` or `building`. If there is none, say what each
  request is waiting for and stop.
- Free text → write it to `raw`, save a new `F-<n>.json` with `status: new`,
  then continue at step 2.

The request may carry `context[]`: words the human added after seeing a
plan, each with the round it answered. It is part of the request; read it
alongside `raw` and the card.

Also read `board/data/messages/*.json` for this feature where
`status` is `queued`. `INFO` is context. `FIX` is work. `A` with `replyTo`
answers a question you asked.

Never act on a request whose status is `spec-review` or `plan-review`. Those
are waiting on the human. Say so and stop.

## 2. Read it back (status `new`)

Read `raw`. Write back, in the human's own plain words and without opening a
single source file:

- `title`, `goal` (one sentence, what not how), `why`
- `must[]` — 3 to 6 things that will be true when it is finished, each one
  the human could check themselves. **Include every concrete instruction in
  `raw`**, such as which folder to build in, or credentials you will need
  from them.
- `mustNot[]`, `assumptions[]`, `size`
- `questions[]` — at most 3, as `{q, a: ""}`. Only what you genuinely cannot
  proceed without, and only about *what*, never *how*.

Set `status: spec-review`, append a log line, and **stop**. Tell the human to
check it on the board.

**A long pasted document.** If `raw` is longer than the big-attachment dial
in `AGENTS.md`, the pasted part (everything after a separator line such as
`--- name ---`, or any block the human clearly pasted rather than wrote)
goes to the `general-purpose` agent on `haiku` with: "Outline this document:
headings, every concrete instruction, every number, name, file and
deadline, in at most 60 lines. Do not interpret." Save the outline on the
feature as `attachment: {plain, chars, note: "the full text is in your
original words"}` and work from it. The human's own lines are read verbatim
and never sent for outlining; `raw` is never changed.

## 3. Plan (status `ready`)

The human approved the read-back. Now explore the codebase and note the
patterns each task should copy. Explore through the Explore agent on
`haiku` (a short summary with file and line pointers), then read only those
lines; bring in nothing whole above the big-result dial in `AGENTS.md`.
Then write to the feature file in one go:

- `plan` — `plain` (2 to 4 lines in the human's words), `approach`,
  `round` (`1` for a first plan; see below for a fresh plan),
  `patterns[]`, `risks[]` (plain), and `forecast` `{cost, plain}` following
  "Cost hint" in `AGENTS.md`.
- `tasks[]` — every card `todo`, with a plain `title`, a technical `detail`,
  a `level` of JUNIOR / MID / SENIOR by the triage rules in `AGENTS.md`, and
  a `model`, a plain one-line `modelWhy` and a `cost` by the "Model choice"
  rules there. Default first; raise the model only when the card is heavier
  than usual for its level.
- Run `node board/usage.js lessons` and copy the lines that apply to this request into `plan.lessons[]` (at most 5, plain); if it reports no finished requests, write an empty list.
- `status: plan-review`, log line.

**A fresh plan after added context.** If the request already has a `plan`,
or `context[]` has entries, the human sent the plan back with more to say.
Write the plan afresh, not as a patch: take `raw`, the card and every
`context[]` entry into account, and check that each entry is reflected in
`plan.plain` or a task. Set `plan.round` to the previous round plus one
(`1` when there was none). Open `plan.plain` with what changed since the
last round. Set all tasks `todo` again. The log line reads
"the team wrote a fresh plan (round n) using the context you added".
Never build on this path; it ends at `plan-review` like any other plan.

**Stop.** Delegate nothing. Edit no file. Tell the human the plan is waiting
for them on the board.

## 4. Build (status `building`)

The human approved the plan. Delegate: JUNIOR cards to `junior-dev`, MID
cards to `mid-dev`, passing the card's `model` as the agent's model override
(`haiku-4.5`→`haiku`, `sonnet-5`→`sonnet`, `opus-5`→`opus`). The prompt is
two lines naming the request (`F-<n>`) and the piece (`T-<n>`), plus the
report format; the card itself is not pasted in. The worker reads its own
card from `tasks[]` on the board (see "Finding your card" in its agent
file) and has not read this conversation. Because the card is no longer
pasted, it must stand alone in `tasks[].detail`: everything the worker needs
— including any credential variable names it may use — has to be in the
card, not left for the delegation prompt to carry. Run independent cards in
parallel. Keep SENIOR cards. Mark the batch `running` in one write.

**Resuming after a cut-off.** If the feature carries an `interrupted`
marker, or any task is already `done`, an earlier run was cut off. Keep
every `done` task exactly as it is and start from the first task whose
status is not `done`. A task the board reset from `running` back to `todo`
is delegated again with its `attempts` count carried on, and its Context
must warn the worker that the files may hold a half-finished earlier attempt
which it must check and either complete or revert before continuing. If the
status is `checking`, every piece was already accepted: go straight to
step 6. Never redo accepted work. The log line for the resumed delegation
names the piece it resumed from.

**Pausing a long build.** After each batch's checkpoint, if pieces remain,
read only the `lead` field of the newest running run record under
`board/data/runs/` (for example `node -e` printing `lead.context` and
`lead.budget` of the `r-*.json` with `status` running). If `lead.context` is
at or above `lead.budget`, append the log line "The lead paused so the run
does not snowball; the board continues in a fresh session." and stop. The
board starts a fresh build run that resumes from the first unfinished piece
exactly as in "Resuming" above.

## 5. Review

Read every diff. Run the tests. Reject anything missing its acceptance
criteria and send it back to the same agent with a note; increment
`attempts`. A re-send is the usual moment to raise the model one step; if you
do, update the task's `model` and `modelWhy` so the record shows what did the
work. Resolve every ESCALATE yourself or re-scope the card. One write per
returned report.

## 6. Close

Integrate, run the full suite, `status: checking`. Then write `report`
(`plain` for the human, `summary` technical, tests with a `plain` label,
files, deferred, followups), `status: done`, final log line. Mark the queued
messages you handled `answered` or `delivered`, writing `A:` replies as new
message files. Tell the human what changed, in plain language.

The resources report on a finished request is worked out by the board from the run records; never write token or dollar figures into the feature file by hand.
