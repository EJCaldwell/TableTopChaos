# TableTopChaos — Project Instructions

A "glorified notepad" web app for tabletop campaigns. **Stack:** React 19 +
TypeScript + Vite, Supabase (Auth, Postgres with Row-Level Security, Storage, Edge
Functions). RLS is the real access-control layer; UI role-gating is only
defense-in-depth. The roadmap and phase numbering live in
[PLANNING.md](PLANNING.md); owner actions that must happen before launch (Stripe
go-live, the `enforce_active` flip, test-data wipe, legal pages) live in
[PRE_LAUNCH.md](PRE_LAUNCH.md) — add to it whenever a change defers something to
launch day rather than doing it now.

## Testing is mandatory — always QA per the `qa-testing` skill

Whenever you build, change, or fix **any** feature in this project — a subphase,
migration, Edge Function, panel, or bug fix — you MUST QA it **before treating it as
done, even when the user did not explicitly ask you to test.** Follow the project's
**`qa-testing`** skill for the method; load it at the start of any build/QA work.

**Division of labor — do NOT self-QA and declare a feature done.** You do the
automated / server-side parts; the **user** runs the in-browser manual steps and
reports what they observe. Author the manual checklist, present the concrete steps,
and **stop and wait for the user's results** before recording a run log. Never mark
a manual/browser step PASS without the user's reported result, and never assume a
UI outcome — you cannot see or drive their browser.

In short (the skill has the full detail):

- **Build→QA loop:** finish a unit → `npm run build` clean → `get_advisors` clean
  after migrations → server-side RLS checks → **hand the manual checklist to the
  user** → record their reported results in a dated run log in `QA/<phase>_tests/`.
- **You do:** type-check/build, `get_advisors`, server-side access-control
  verification via the Supabase MCP (`set local role authenticated` + JWT claims;
  `pg_policies` audit), and authoring checklists.
- **The user does:** the browser manual steps, uploads, visual checks, two-session
  realtime tests, console-snippet reads. Wait for their results.
- **Access control is the headline:** the full role matrix — **DM / player /
  non-member / signed-out** — asserting both allowed and denied paths.
- **Stale-session caveat:** if a client read returns unexpected rows, confirm
  `auth.getUser()` before blaming RLS.
- **High-signal only:** skip cosmetic/label/wiring checks the build already
  guarantees.

## Keep PLANNING.md current AS YOU GO

Update [PLANNING.md](PLANNING.md) at the end of **every** unit of work, not at the
end of a phase — including when the step is only partly done. Two places, and
both matter:

1. **The Progress Tracker checkbox.** `[x]` done, `[~]` in progress, `[ ]` not
   started. A `[~]` must carry a short note saying what is done and what is not.
2. **The phase section body**, for decisions and status.

**The tracker is the part that drifts**, because the section body is where the
interesting writing happens and the checkbox is easy to forget. It has drifted
twice: 9.1.1 stayed `[ ]` after the backend shipped, and 8.2 read "63 assertions"
after it had grown to 96. Both were caught by the user, not by me.

Two rules that prevent the failure modes seen so far:

- **Never tick a box for work the user has not confirmed.** Browser/manual steps
  are theirs; a server-side pass is not evidence the UI behaves. If the automated
  half is done and the manual half is not, that is `[~]` with both halves named.
- **Update the note when scope changes**, not just when status changes. A count
  or a claim in a tracker note is a fact that can go stale.

## Workflow constraints

- **Never run git** — the user runs all git operations themselves.
- **Don't start a dev server** — the user runs their own on **port 5173**; stop any
  server you accidentally start on 5174.
- Follow the global comment standards (JSDoc on components/hooks/utils; document
  both sides of every Supabase call / Edge Function boundary).
