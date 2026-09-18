# Context budget: why the dials exist

The dials and the rules are in "Context budget" in `AGENTS.md`. This file is
the reasoning around them.

Every token the Senior brings into its context is paid for again on every
later turn, and the Senior pays double to add it. The Senior works from
pointers, not whole files. Those three files — `CLAUDE.md`, `AGENTS.md` and
`PROTOCOL.md` — are loaded on every call the team makes, which is why they
carry rules only and the explanation lives here in `docs/`.

The dials are set in one place, "Context budget" in `AGENTS.md`; the run
budget and the effort are mirrored at the top of `board/serve.js` because the
board applies them when it launches a run.

- **Big result** — the most of one file or one command's output the Senior
  brings in at once. Above it, locate the lines first and read only those.
- **Run budget** — not a ceiling, and not a total. It counts only what the
  lead has *added since this session started*. A session begins carrying about
  25,000 tokens of system prompt, tools and rulebook before it does anything,
  so a budget measured as a total near that number pauses every session on its
  first turn and nothing is ever built. That is exactly what happened on 10
  September 2026, when the budget was set to 25,000 as a total: each fresh
  session paused immediately, the next one did the same, and the request was
  marked cut off. Past the growth budget the lead stops between pieces so the
  board can carry on in a fresh session. Under it a still-small session keeps
  going, because restarting then costs more than it saves. Two guards sit
  alongside it: a total backstop, and no pause in a session's first few turns,
  so a pause always follows real work.
- **Report cap** — the most a worker's report may run to. A worker names its
  test command and its pass or fail line rather than pasting logs, and names
  files and lines rather than quoting them back.
- **Big attachment** — a pasted document above this is outlined by a cheap
  model at read-back. The human's own lines are never sent for outlining and
  `raw` is never changed.
- **Effort** — the thinking effort the board asks for per step. Planning stays
  high because a weak plan costs a whole rework; building, carrying on after a
  pause, read-back and inbox run at medium.

Two of the Senior's rules there are worth spelling out. *Batch* means
independent reads, edits and commands go into one call, never one per turn:
each turn re-reads the whole conversation, so turns are what cost money.
*Write less* means plans, cards and reports carry what the reader needs and no
more — a card is read by the worker on every one of its turns too.
