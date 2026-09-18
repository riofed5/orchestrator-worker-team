# Model choice: the reasoning and the cost table

The rules themselves are in "Model choice" in `AGENTS.md`. This file holds the
reasoning behind them and the full cost-hint table.

The level says *who* owns a task; the model says *how strong a brain* it
gets. The Senior picks the model for every card, from this list only:

| Id          | Name             | Cost tier | Use it for                                    |
|-------------|------------------|-----------|-----------------------------------------------|
| `haiku-4.5` | Claude Haiku 4.5 | 1 (cheapest) | Mechanical, fully specified edits           |
| `sonnet-5`  | Claude Sonnet 5  | 2         | Ordinary implementation with a pattern to copy |
| `opus-5`    | Claude Opus 5    | 3 (dearest) | Harder investigation, subtle logic, wide diffs, and the Senior's own SENIOR cards |

`fable-5.1` was the Senior's model until 10 September 2026 and is retired. It
is no longer a choice; the board still names it on older records.

Raising the model rather than the level is for a card that is at its level but
heavier than usual: several files, behaviour that needs investigation, subtle
edge cases, a spec that is complete but long, or a card that was rejected once
already. There is nothing above `opus-5`, so a card that needs more than it is
a SENIOR card. Never lower a model below its level's default; if a card looks
too easy for its level, lower the level instead. Re-sending a rejected card is
the usual moment to raise the model, and the task's `model` and `modelWhy` are
updated so the record shows what actually did the work.

## Cost hint

Each card carries a `cost` of `low`, `medium` or `high`. It is an estimate for
comparing options, not a bill. Read it from this table using the model's cost
tier and the card's size (how much reading and writing it needs):

| Size of the card        | tier 1 | tier 2 | tier 3 |
|-------------------------|--------|--------|--------|
| small (one file, short) | low    | low    | medium |
| medium (a few files)    | low    | medium | high   |
| large (many files)      | medium | high   | high   |

The plan carries a `forecast` for the whole request: the highest `cost` among
its cards, raised one step if more than half the cards sit at that cost, plus
2 to 3 plain lines on why the mix is a good trade of strength against spend.
