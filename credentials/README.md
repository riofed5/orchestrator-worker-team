# Credentials

This folder is the company toolbox: the service accounts the team may use
while the human is away. It answers "which tools do we have?" so nobody has
to stop and ask.

```
credentials/
├── README.md              # this file
├── services.env.example   # blank template, committed
└── services.env           # real tokens, filled in by the human, NEVER committed
```

Project-level settings (a database URL, an admin password, a signing secret)
do **not** live here. Each project keeps its own `.env.local` next to its
code, with a committed `.env.example` template. See `project/README.md`.

## For the human

1. Copy `services.env.example` to `services.env`.
2. Fill in the tokens you want the team to be able to use. Each line in the
   template says where to get its value. Leave the rest blank.
3. Run `chmod 600 credentials/services.env` so only your user can read it.
4. Keep the computer locked when you leave it. Anything running on this
   machine can read this file; the rules below are rules, not locks.
5. If you ever suspect a token leaked, revoke it on the service's site and
   paste a new one. Nothing else needs to change.

## For the team

- **Load, don't read aloud.** In a shell:
  `set -a; source credentials/services.env; set +a` then use the variable
  (`vercel --token "$VERCEL_TOKEN"`, `supabase login --token
  "$SUPABASE_ACCESS_TOKEN"`, `gh auth login --with-token <<< "$GH_TOKEN"`). Never `cat`, `echo` or `grep` a value, and never
  copy one into a report, a message, a log line, a commit or a board record.
- **A card names what you may use.** A worker uses only the variables its
  task card lists. If a card needs a value that is blank here, return
  `Status: BLOCKED` naming the variable, not the value; the Senior asks the
  human.
- **Publishing and live data are SENIOR.** Deploys, DNS, database changes on
  a live project and anything that spends money are done by the Senior, by
  the triage rule in `AGENTS.md`. Mid and Junior build and test locally.
- **Missing token?** Check the template first; if the service is not listed,
  it is a SENIOR decision to add it.
