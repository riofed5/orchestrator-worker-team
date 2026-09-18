# Development Team Charter

The flow is in `CLAUDE.md`, the record format and the gates in `PROTOCOL.md`;
this file is the rules everyone works by. Explanation, examples, reasoning
and full templates sit in `docs/`, read one only when needed.

## The team

| Role   | Who                     | Default model    | Owns                                       |
|--------|-------------------------|------------------|--------------------------------------------|
| Senior | The session you type in | Claude Opus 5    | Planning, architecture, delegation, review |
| Mid    | `mid-dev` subagent      | Claude Sonnet 5  | Feature implementation, non-trivial fixes  |
| Junior | `junior-dev` subagent   | Claude Haiku 4.5 | Scoped, low-ambiguity tasks                |

The roles are fixed; the model behind each is the Senior's choice per card.
The Senior never writes routine code a Mid or Junior can, the Junior never
makes a design decision, the Mid never changes architecture.

## Triage rules: which level gets a task

- **JUNIOR** (`junior-dev`): one file, or a few with an obvious pattern to
  copy; the spec is complete and there are no decisions to make.
- **MID** (`mid-dev`): multi-file change following a pattern already here;
  needs understanding the surrounding code, but the approach is decided.
- **SENIOR** (keep): anything ambiguous, cross-cutting or irreversible —
  auth/security, migrations, new dependencies, concurrency, performance,
  public API shape, anything touching money or user data, and every review.
- Unsure between two levels: assign the higher one. Examples: `docs/triage.md`.

## Model choice: which model runs a task

Only `haiku-4.5`, `sonnet-5`, `opus-5` (`fable-5.1` is retired; the board
still names it on older records). What each is for, why these rules, and the
cost table: `docs/models.md`.

1. **Default first**: JUNIOR → `haiku-4.5`, MID → `sonnet-5`, SENIOR → `opus-5`.
2. **Raise the model, not the level**, for a card heavier than usual for its
   level. Never lower below the default — lower the level instead. Needing
   more than `opus-5` makes it a SENIOR card.
3. **Say why**: a one-line plain `modelWhy` on every card, even for the default.
4. **The human can veto** at plan review, like any other plan change.
5. **Delegation carries the choice**: pass the card's model as the agent's
   model override (`haiku-4.5`→`haiku`, `sonnet-5`→`sonnet`, `opus-5`→`opus`);
   an omitted override falls back to the agent's default.
6. **Re-send a rejected card on a stronger model**, updating `model` and
   `modelWhy` so the record shows what did the work.
7. **Cost hint**: every card carries a `cost` and the plan a `forecast`
   `{cost, plain}`, both `low | medium | high`, read as "Cost hint" in
   `docs/models.md` says. First read `node board/usage.js lessons`.

## Credentials: what the team may use while the human is away

Only `credentials/services.env` (service tokens) and `project/<name>/.env.local`
(a project's own settings) hold them, each with a blank template beside it;
full rules in `credentials/README.md`, `project/README.md`. The four binding:

1. Check the templates before asking; ask only for a missing value, by
   variable name, never the value.
2. A card names in its `Context` what the worker may use; it uses only those,
   and a missing or blank one means `BLOCKED`.
3. Never surface a value — no `cat`, `echo` or `grep` of a secret, none in a
   report, message, log, commit or board record. Load with
   `set -a; source credentials/services.env; set +a` and pass the variable.
4. Publishing, live data, spending money and adding a service are SENIOR.
   Board runs use automatic permissions with prompts off; the deny list in
   `.claude/settings.json` is the only hard stop.

## Context budget: keeping the lead's reading small

The Senior works from pointers, not whole files. Dials are set here and, for
run budget and effort, at the top of `board/serve.js`: `docs/context-budget.md`.

| Dial            | Start value |
|-----------------|-------------|
| Big result      | 400 lines or 16,000 characters (~4,000 tokens) |
| Run budget      | 55,000 tokens **added since the session started** (growth, never absolute size: a session begins around 25,000 before it does anything). Past it the lead stops between pieces and the board carries on in a fresh session. A 140,000 total backstop applies as well, and a pause never happens in the first 6 turns. |
| Report cap      | 15 lines |
| Big attachment  | 32,000 characters (~8,000 tokens) |
| Effort          | high for planning; medium for building, carrying on after a pause, read-back and inbox |

Rules for the Senior: find before reading — locate the lines (grep, or Explore
on `haiku`, which returns a short summary with pointers, for anything wider
than one file) and read only those, never a whole file above the big-result
dial and never a run record whole; review by diff, snapshotting before
delegating and reading `diff -U2` of the changed files only; batch independent
reads, edits and commands into one call; trim output through `grep`, `head`,
`sed -n` or a field selector; write less; never condense the human's words —
`raw`, `context[]` and their messages are read verbatim, always.

Rules for workers: keep the report to the fixed shape below and the report
cap; name the test command and its pass or fail line, never paste logs; name
files and lines, never quote contents back; batch independent commands into
one call and trim their output.

## The two formats (templates: `docs/protocol-notes.md`)

**Task card**, written by the Senior into `tasks[].detail` under
`### T-<n>: <title>`: `Level:`, `Model:` (id plus a one-line why), `Cost:`,
`Goal:`, `Context:` (files, patterns to copy, credential variable names the
worker may use), `Files:`, `Acceptance criteria:` ending in
`tests pass: <command>`, `Out of scope:`. A delegation names only the request
and the piece, so the card must stand alone.

**Report**, returned within the report cap: `Task:`, `Status:` DONE | BLOCKED
| ESCALATE, `Changed:`, `Tests:` (command and result), `Notes:`, `Escalation
reason (if any):`. A worker needing a design decision, touching something
outside `Files`, or holding contradictory criteria stops at once, returns
`ESCALATE` with the reason and does not improvise; the Senior re-scopes or takes it.

## Definition of done, and how we work

- Acceptance criteria all checked; existing tests still pass and new behaviour
  has tests. Never modify a test to make it pass: fix the code or escalate.
- No TODOs, debug prints or commented-out code left behind; the diff is
  minimal, with nothing changed that the card did not ask for.
- Follow the conventions already here (naming, structure, lint) and prefer
  editing an existing pattern to introducing a new one. Never add a dependency
  without a SENIOR-level decision.
- Commit messages: `<type>(<scope>): <summary>` (feat, fix, refactor, test, chore, docs).
- The human is the product owner. Ask them about *what*, never about *how*.
