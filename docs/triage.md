# Triage: worked examples per level

The rules themselves are in "Triage rules" in `AGENTS.md`. These are the
worked examples that used to sit under them.

## JUNIOR (send to `junior-dev`)

- One file, or a few files with an obvious pattern to copy.
- Spec is complete; no decisions to make.
- Examples: boilerplate, DTOs/models, config, renames, formatting, docstrings,
  unit tests for behaviour that already exists, simple CRUD following an existing
  example, small isolated bug with a known fix.

## MID (send to `mid-dev`)

- Multi-file change that follows an established pattern in this codebase.
- Requires reading and understanding surrounding code, but the approach is decided.
- Examples: new feature endpoint end-to-end, refactor inside one module, bug that
  needs investigation, integration tests, wiring a library that is already chosen.

## SENIOR (keep)

- Anything ambiguous, cross-cutting, or irreversible.
- Examples: architecture, new dependencies, auth/security, data migrations,
  concurrency, performance work, public API shape, anything touching money or
  user data, and the final review of everything.

Tie-breaker: when unsure between two levels, assign the higher one.
