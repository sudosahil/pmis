# PMIS — working notes

A works, procurement and payments system for a state Public Works Department.
`README.md` explains what it does and how it is put together; this file is the
short list of rules to work by. Interface reasoning lives in
`docs/design-guidelines.md`.

## Running it

```bash
npm run install:all
npm run db:seed        # then: npm run dev --prefix app/server   (API, :4000)
                       #       npm run dev --prefix app/client   (web, :5173)
npm test               # server, vitest
npm run typecheck      # both projects
```

Every demo account uses the password `Pmis@12345`.

**`db:reset` fails with `EBUSY` while the dev server is running**, and `db:seed`
then still prints "Seed complete" while silently keeping the old data, because
`seedDemoRecords` short-circuits when projects already exist. Stop the dev server
before reseeding, and verify by counting rows rather than trusting the log line.

## Non-negotiables

- **Money is never a float.** Below the HTTP boundary everything is an integer:
  money in paise, percentages in basis points, quantities scaled by 1000.
  Conversion happens only in the zod layer inbound and the presenter outbound.
- **Every query is scoped.** Read paths go through `scopeFilter(user)`. A figure
  that mixes one division's costs with another division's payments is a defect,
  not a rounding issue — it has happened once already.
- **Layers stay separate.** Routes wire, controllers hand off, services hold the
  logic and know nothing of HTTP, models hold SQL and no logic.
- **The workflow engine and domain services never import each other.** Domains
  register an outcome handler; that is what keeps the graph acyclic.
- **History is append-only.** Rate changes, audit entries and workflow actions
  are written, never overwritten, and copy the names they refer to rather than
  joining, so they still read after the master row is gone.
- **Statute is enforced in the service**, not only in the request schema, so a
  second caller cannot get around it.

## Interface rules

Full reasoning in `docs/design-guidelines.md`. The rules themselves:

- **Use the motion tokens.** `--dur-press` 90ms, `--dur-fast` 140ms,
  `--dur-base` 220ms, `--dur-slow` 320ms; `--ease-out` for arriving,
  `--ease-in` for leaving. Never write a raw duration or easing value.
- **Feedback on pointer-down.** Anything clickable depresses on `:active`.
- **Surfaces leave by the path they arrived on**, and menus grow from the control
  that opened them.
- **Do not add a spring library** unless the app grows something draggable or
  swipeable. Nothing here is dragged, and a spring's only real advantage is
  surviving being grabbed mid-flight.
- **No bounce, no ambient motion, no page transitions**, and never animate
  tables, figures or bill totals.
- **Translucency only where something passes underneath** — the user menu,
  toasts, the modal scrim. Legibility beats the material.
- **Reduced motion keeps the feedback** and drops the movement; also honour
  `prefers-reduced-transparency` and `prefers-contrast`.
- **Charts:** colour follows the entity and never its position in the data;
  sequential for magnitude, categorical for identity; never a second y-axis;
  continuous axes with empty periods filled server-side; complete periods only;
  every chart keeps its table.
- **Print is a supported output.** Records must survive a greyscale printout, so
  no meaning may rest on colour alone.

## House style

- Follow the surrounding code; match its comment density and naming.
- Comments explain *why*, especially where a rule comes from a departmental
  document or an Act. Do not narrate what the code plainly does.
- Commit messages are a plain imperative sentence, lower-case after the first
  word, no `feat:`/`fix:` prefixes — match `git log`.
- Do not commit or push unless asked.
