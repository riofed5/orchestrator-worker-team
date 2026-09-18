# Team communication protocol

The human speaks plain language, the agents the compact form below; the Senior
translates once, at intake. The **board** is the shared record: plain JSON
under `board/data/` (`features/`, `messages/`, `runs/`), edited with ordinary
file tools and written by the Senior alone; workers report to the Senior.
Every field and template in full: `docs/protocol-notes.md`.

## The two approval gates

The human approves twice, and the team stops dead at both:

1. **The request.** Read their words back as a structured card and set
   `spec-review`. You may not open a source file or plan anything until they
   approve; their approval sets `ready`.
2. **The plan.** After planning, set `plan-review` and stop. No agent is
   delegated to and no file edited until they approve; their approval sets
   `building` and adds an `INFO` message saying "Plan approved."
   Instead of approving, the human may **add more context**: the board appends
   it to `context[]` and sets `ready` again. That is not approval — write a
   fresh plan folding in every `context[]` entry, bump `plan.round`, set
   `plan-review` and stop again. Only "Plan approved" opens the build.

Never skip a gate. Never build on `ready`; `ready` means "plan it".

## Feature request (the card agents receive)

The card is the record's own fields: `goal`, `why`, `must[]`, `mustNot[]`,
`assumptions[]`, `questions[{q,a}]`, `hint`, `prio`. Writing `must[]` at
intake, carry over **every concrete instruction in `raw`** (folder, service,
credentials) because the card is what the workers receive. Before asking for a
credential check `credentials/services.env.example` and the project's
`.env.example`, and ask only for what is missing, by variable name.

## Message (human ↔ agent)

`@<senior|mid-dev|junior-dev|human> F-<n>[/T-<n>] <KIND>: <text>`, where
`KIND` is `Q` (question; answer with `A:`), `FIX` (change request, reviewed
like any card: report, then `A:`), `INFO` (context to remember, no reply) or
`A` (answer, no reply). Answer in at most 5 lines unless the message says
`detail`; cite `T-n` and file names; never invent test results; if you cannot
answer without reading code you have not read, say so and read it. To ask the
human something, write a message `to: "human"` of `kind: "Q"`, set the feature
to `needs-input` and stop; their answer arrives queued with `replyTo` set.

## Writing for the human

Plain language, no file paths, command names or jargon, in every field the
board shows them: `plan.plain` (2 to 4 lines), `tasks[].title` (what the piece
achieves, not how), `tasks[].modelWhy` (one line), `plan.forecast.plain` (2 to
3 lines), `report.plain` (3 to 5 lines), `report.tests[].plain`, `log[].text`
(one past-tense sentence), `plan.risks[]`, `plan.lessons[]`,
`report.deferred[]`, `report.followups[]`, `blockedReason`, `context[].text`
(the human's own words, shown back as written). Technical wording goes only in
the fields the board hides behind a toggle: `plan.approach`, `plan.patterns[]`,
`tasks[].detail`, `tasks[].model`, `report.summary`, `report.files[]`,
`report.tests[].cmd`. What each plain field says: `docs/protocol-notes.md`.

## The records

- `F-<n>.json`: `status` is `new | spec-review | ready | planning |
  plan-review | building | checking | needs-input | done | blocked`;
  `tasks[].status` `todo | running | done | rejected | escalated`;
  `tasks[].model` `haiku-4.5 | sonnet-5 | opus-5`; `tasks[].cost` and
  `plan.forecast.cost` `low | medium | high`. `tasks[].detail` is the card itself and must stand alone.
- **Never overwrite** `raw`, `context[]` or `approvals`: the first two are the
  human's words, the third their signature. Set `updatedAt` on every write.
- `interrupted` says where a cut-off run stopped: continue from `resumeFrom`,
  keeping every `done` task. The board's server alone writes `runs/` and
  `claude.json`; agents read them.
- Write the whole file each time and keep the JSON valid: the board reads it
  every two seconds and skips a file it cannot parse.

## Checkpoints (the only times the Senior writes to the board)

1. Read back → the card fields, `status: spec-review`, log line. **Stop.**
2. Plan written → `plan`, `tasks[]` (all `todo`), `status: plan-review`, log
   line naming the round. **Stop.** Same for every fresh plan after context.
3. Building → per delegation batch and per returned report, that task's
   `status`, `attempts`, `escalated`, `detail`; one log line each.
4. Review → `status: checking`.
5. Close → `report`, `status: done`, log line.

One write per checkpoint, never per file edit.
