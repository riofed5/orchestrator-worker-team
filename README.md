# Three-level AI dev team

Senior plans, splits and reviews. Mid and Junior execute. You approve twice
before any code is written. Everything runs locally in this project.

The team runs on **Claude Code**, in a terminal. Antigravity is the editor you
read and write files in; open its integrated terminal and run Claude Code
there. None of Antigravity's own models or agents are used.

## Layout

```
your-project/
├── AGENTS.md                        # team charter
├── PROTOCOL.md                      # record format and the two approval gates
├── CLAUDE.md                        # always-on rule + the Senior's persona
├── credentials/                     # company toolbox: service tokens (never committed)
├── project/                         # every app lives here, one folder each
│   └── your-app/                    # one app per folder, each its own git repo
├── .claude/
│   ├── settings.json                # pins this project to Claude Opus 5
│   ├── agents/mid-dev.md            # subagent, MID tasks   (Claude Sonnet 5)
│   ├── agents/junior-dev.md         # subagent, JUNIOR tasks (Claude Haiku 4.5)
│   ├── skills/team/SKILL.md         # /team
│   └── skills/inbox/SKILL.md        # /inbox
└── board/                           # the board: viewer + record
    ├── serve.js
    ├── index.html
    └── data/features, data/messages
```

Open Antigravity's integrated terminal in this folder and start Claude Code.
Check with `/agents` that `mid-dev` and `junior-dev` are listed, and `/model`
that the session is on Opus 5.

## The models

All three run on Claude, set in this repo. These are the defaults: the Senior
picks the model for each piece of work and may raise it for a harder one, and
the board shows the choice on every task (see "Model choice" in `AGENTS.md`).

| Role | Default model | Set in |
|---|---|---|
| Senior | Claude Opus 5 | `.claude/settings.json` |
| Mid | Claude Sonnet 5 | `.claude/agents/mid-dev.md` |
| Junior | Claude Haiku 4.5 | `.claude/agents/junior-dev.md` |

The Senior is the session you type in, so pinning it in settings means every
session in this folder starts on Opus 5. Confirm with `/model`. If Opus 5 is
not on your plan, the picker will say so and you can drop the `model` line
from `.claude/settings.json` to fall back to your best available model.

## Start the board

```
node board/serve.js
```

It opens `http://localhost:4477`. Needs Node 18 or newer and no packages.
Leave it running while you work. The page and the agents read and write the
same JSON files, so both always see one record.

The board can also start the team itself. It looks for Claude Code on this
computer (the `claude` command, or the copy bundled with your editor); if it
cannot find it, start the board with `CLAUDE_BIN=/path/to/claude` in front of
the command. The Claude page (the second icon on the left) shows whether
Claude is up, how close your subscription is to its limits, what each model
has done, and the recent runs.

## The loop

Each stage has a button on the request page, and the team's work streams
onto the page while it runs.

| You do | Then press | The team does |
|---|---|---|
| Press "Ask for something" and describe it in your own words | "Read it back now" | Reads it back to you as a short spec. No code opened. |
| Check the read-back, answer its questions, press "plan it" | "Plan it now" | Reads the code, writes a plan and who does what. Stops. |
| Press "Go ahead, build it" | "Build it now" | Builds it, reviews it, runs the checks, writes the summary. |

"Deliver my messages" runs `/inbox`, which does whatever is due across all
requests, including answers you left in "Talk to the team". The terminal
still works as a fallback: `/team F-2` and `/inbox` do the same things.
While the team runs from the board it does not stop to ask permission; the
block-list in `.claude/settings.json` is the only brake.

## What the board gives you

**You ask in your own words.** No fields, no jargon, no file names. Mention
anything specific you already know you need, such as which folder to build in
or which service to use.

**The lead reads it back.** A short spec: what will be true when it is
finished, what it will leave alone, what it assumed, and up to three questions
it needs answered. You edit any of it in place before approving.

**Nothing is built until you approve twice.** The read-back is the first gate,
the plan is the second. Both are enforced in the charter, the always-on rule
and the `team` skill.

**Then you watch it happen.** Each piece of work shows who has it (lead
engineer, developer, assistant) and whether it is waiting, in progress, done,
sent back or stuck. At the end you get a plain summary of what is different
now, what was left for later, and what is worth deciding next.

**Talk to anyone.** "Talk to the team" opens a conversation per request with
each of the three. Messages queue until your next `/inbox`.

**Technical detail is one toggle away.** File names, test commands and the
exact card the agents receive. Off by default.

## Tuning

- Too much going to the Senior? Loosen the MID examples in `AGENTS.md`.
- Junior producing sloppy work? Tighten its cards: smaller `Files`, more
  explicit "copy this file" pointers.
- Trust the team enough to skip the plan gate? In
  `.claude/skills/team/SKILL.md`, step 3, set `building` instead of
  `plan-review`. The read-back gate stays either way.
- Want a different split? Change `model:` in the two files under
  `.claude/agents/`. Full model ids or the aliases `opus`, `sonnet`, `haiku`
  and `inherit` all work.
- Board on a different port: `PORT=4478 node board/serve.js`.
- Editing a request by hand is fine. The files under
  `board/data/features/` are plain JSON and the page reloads them
  every two seconds.
- The lead reading too much? The dials are in "Context budget" in
  `AGENTS.md`; the run budget and the effort per step are at the top of
  `board/serve.js`. `node board/usage.js compare F-3 F-7` shows any
  request against the baseline.

## Kickoff message (paste once at the start of a session)

> You are the Senior Engineer of the three-level team defined in AGENTS.md.
> Confirm you have read AGENTS.md and PROTOCOL.md, then summarise in five
> lines how you will divide work between yourself, mid-dev and junior-dev,
> and where the two approval gates are. After that, wait for my first problem.
