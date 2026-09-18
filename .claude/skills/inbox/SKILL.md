---
name: inbox
description: Check the team board for requests to read back, plan or build, and for queued messages, then act on them. Use when the human types /inbox, or on a schedule via /loop 10m /inbox.
---
# /inbox — pick up everything the human left on the board

The board is plain JSON under `board/data/`. `PROTOCOL.md` is
binding. Be frugal: this runs often. Read the two folders, and do nothing
else unless there is work.

1. Read `board/data/features/*.json` and
   `board/data/messages/*.json`.
2. Nothing with status `new`, `ready`, `building`, or a message with
   `status: queued` → say "Nothing waiting" and stop. Do not open any source
   file.
3. Otherwise, in this order:
   - Every feature with `status: new` → step 2 of `.claude/skills/team/SKILL.md`
     (read it back, stop at `spec-review`).
   - Every feature with `status: ready` → step 3 of that workflow (plan, stop
     at `plan-review`).
   - Every feature with `status: building` that has any task not `done`,
     and every feature with `status: checking` → steps 4 to 6 (build,
     review, close), resuming as described in step 4 of that workflow.
   - Every queued message, by `to`:
     - `senior` — `Q`: answer in at most 5 plain lines as a new message.
       `FIX` on a plan: revise the plan and set `plan-review` again. `FIX` on
       finished work: treat it as a task card and run steps 4 to 6 for it.
       `INFO`: append a log line to the feature.
     - `mid-dev` / `junior-dev` — hand the message to that agent with its
       persona and the relevant task card, passing that task's `model` as
       the agent's model override as in step 4 of `team/SKILL.md`. Review
       any diff and run the tests before accepting, exactly as in `team.md`.
     - `human` with `kind: A` and `replyTo` — the human answered a question
       you asked. Clear `needs-input` and resume that feature where it
       stopped.
     Write each reply as a new message file (`from`, `to: human`, `kind: A`,
     `replyTo`, `status: answered`) and set the original to `answered`, or
     `delivered` for `INFO`.
4. Finish with one line per item handled, and say what each request is now
   waiting for.
