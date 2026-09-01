# Interface guidelines

How the PMIS interface is built, and why. `CLAUDE.md` carries the short version
of these rules; this file carries the reasoning, so that a rule can be argued
with rather than merely obeyed.

The product this serves is a departmental records system. It is used all day by
people who did not choose it, on the office machines they were given, and its
output is filed on paper. Every rule below is downstream of that.

---

## 1. What we took from Apple, and what we did not

The motion work here follows Apple's *Designing Fluid Interfaces*, but only the
half of it that applies. Most of that talk is about **gesture-driven** surfaces:
springs, velocity handoff, momentum projection, rubber-banding at boundaries,
grabbing an animation mid-flight and reversing it. Those techniques exist to
solve one problem — a moving thing must stay glued to a finger that is still
touching it.

PMIS has no drags, no swipes and no sheets. Nothing here is dragged. So we took
the parts that hold regardless:

- **Response.** Feedback belongs on pointer-*down*, not on release.
- **Continuity.** A surface leaves by the path it arrived on.
- **Anchoring.** A menu grows out of the control that opened it.
- **Craft.** Every duration and easing value is one somebody chose and can
  defend, not a `0.3s ease` that got copied around.
- **Restraint.** Motion that does not explain something is noise, and noise is
  expensive in software somebody uses for seven hours a day.

What we deliberately did **not** take:

- **Springs and a spring library.** A spring's advantage is that it can be
  re-targeted from its current position and velocity while it is moving. Nothing
  in this app can be grabbed mid-animation, so that advantage buys nothing, and
  a physics runtime is weight and a second styling model for no benefit. See §6
  for when this decision should be revisited.
- **Bounce and overshoot.** Apple's own guidance is that overshoot is earned by
  momentum — it is right for something you flicked, wrong for a dialog that
  simply appeared. Nothing here is flicked, so nothing here bounces.
- **Frosted glass everywhere.** Translucency is a way of showing that one layer
  floats above another. Where nothing passes underneath, it is decoration that
  costs contrast. See §4.

---

## 2. The motion tokens

Defined in `global.css`. Every animated property in the app uses one of these.
A timing that is not on this list is a timing that will drift.

| Token | Value | Use |
| --- | --- | --- |
| `--dur-press` | 90ms | Pointer-down feedback. Must read as instant. |
| `--dur-fast` | 140ms | Hover, small state changes, menus. |
| `--dur-base` | 220ms | A surface entering or leaving. |
| `--dur-slow` | 320ms | Large surfaces — the modal panel. |
| `--ease-out` | `cubic-bezier(0.32, 0.72, 0, 1)` | Things **arriving**. Decelerates. |
| `--ease-in` | `cubic-bezier(0.4, 0, 0.6, 1)` | Things **leaving**. Mirrors `--ease-out`. |

Bigger surfaces move for longer. A dialog that crossed the whole screen in the
time a button takes to depress reads as a glitch rather than as an object.

**Arriving uses `--ease-out`; leaving uses `--ease-in`.** The pair is mirrored so
that a reversible transition retraces its own path. Using one curve in both
directions is the most common way motion ends up feeling cheap.

---

## 3. Response: acknowledge the press, not the click

> The moment lag appears, the feeling of directness falls off a cliff.

Anything clickable depresses to `--press-scale` (0.978) over `--dur-press` on
`:active`. That is `.btn`, `a.stat`, `.nav-link`, `.modal__close`. A control that
does nothing until its click handler returns feels broken even when it is fast.

Hover is a *secondary* signal and never the only one — the app must work
identically for touch and keyboard, where hover does not exist.

---

## 4. Depth is a claim about layering

A translucent surface says "there is something behind me". Use it **only where
something actually passes underneath**:

- the floating user menu,
- toasts,
- the modal scrim.

The header and sidebar are opaque, because they are grid regions with nothing
scrolling under them; blurring them would be a claim about depth that the layout
does not support.

Where translucency is used, it must stay legible over whatever it lands on. The
user menu overlaps the navy header, and at 82% white the user's own name became
unreadable — it is 94% now. **Legibility outranks the material every time.**

Honour `prefers-reduced-transparency` by making the surface opaque, and
`prefers-contrast: more` by giving surfaces a defined border rather than a
heavier fill.

---

## 5. Surfaces leave the way they came

A dialog scales up from 0.96 and rises 8px on entry, and reverses exactly on
exit. A toast rises from the bottom-right corner it is anchored to and sinks back
into it. A menu grows from `transform-origin: top right` — the avatar that opened
it — so the menu and its trigger read as one object.

**React unmounts immediately, so an exit has to be arranged for.** `Modal` owns
its own dismissal: `requestClose()` sets the `is-closing` class, waits
`exitDuration()`, and only then calls the caller's `onClose`, which is what
unmounts it. Escape, the backdrop, the close button and the footer's Cancel all
route through it, so every way out behaves the same.

The footer Cancel is worth explaining, because it looks like magic. Footers are
built by the calling page and passed in as a prop, so they are rendered inside
the dialog but *constructed* outside it — a hook in the caller cannot read the
dialog's context. Instead `Button` compares its `onClick` against the dialog's
`onClose` **by function identity**: a footer button whose handler *is* this
dialog's dismissal is that dialog's Cancel, and is routed through the exit. It
cannot be fooled by a label, and any other handler is left untouched.

`lib/motion.ts` is the one place the CSS timings are known to JavaScript. If a
duration token changes, that file changes with it.

---

## 6. When to add a spring library

Not now. Revisit **only** when the app grows a surface the user can drag, swipe
or throw — a reorderable approval chain, a swipe-dismissable panel, a bottom
sheet. At that point CSS transitions genuinely cannot do the job, because they
cannot be grabbed mid-flight and re-targeted from their current velocity.

Until then, adding one would be weight without a use, and a second way of
describing motion competing with `global.css`.

If that day comes: springs go on the draggable surface only, at critical damping
(no overshoot) unless a real flick preceded the motion, and the rest of the app
stays on these tokens.

---

## 7. Motion that must not be added

- **Anything on the critical path of reading.** Tables, figures and bill totals
  do not animate in. A clerk reconciling a voucher should never wait for a number.
- **Looping or ambient motion.** Nothing moves unless the user caused it.
- **Page-level transitions.** Navigation should feel instantaneous; a route
  animation is a tax paid on every single navigation, all day.
- **Bounce**, for the reasons in §1.

---

## 8. Typography

Tracking is a function of size, never one value applied everywhere: letters read
too far apart as type grows and too tight as it shrinks. Headings tighten
(`-0.018em` on `h1`–`h3`), body sits at zero, and small uppercase labels open up.
Leading moves the opposite way to size — tight on headings, comfortable on body.

Money always uses tabular figures (`font-variant-numeric: tabular-nums`) so that
columns of rupees align on the decimal. This is not decoration; a column that
does not align is a column that gets misread.

---

## 9. Accessibility is a variant, not a switch

`prefers-reduced-motion` asks for less *movement*, not less *feedback*. The
stylesheet keeps opacity and colour transitions and drops transforms and travel,
so a press is still acknowledged. Turning every transition off — which is what
the stylesheet used to do — takes the responsiveness away from the very people
who asked only to avoid the motion.

`exitDuration()` collapses to ~20ms under reduced motion, so a surface is removed
as soon as its cross-fade is done instead of sitting invisible for the length of
an animation that never played.

Also honour `prefers-reduced-transparency` and `prefers-contrast: more` (§4).

---

## 10. Print is a supported output

Bills and vouchers are printed and filed. The print stylesheet drops chrome
(header, sidebar, buttons, tooltips, the user menu), and charts are inline SVG
precisely so they survive printing. Every chart mark carries a figure or a label
beside it, so nothing depends on colour — a greyscale printout must still be
readable. When adding a screen that produces a record, check it on paper.

---

## 11. Charts

Covered by the same discipline; the rules that bind:

- **Colour follows the entity, never its position.** Status mixes drop empty
  statuses, so indexing a palette by array position repaints whatever survived
  and two officers comparing screens read different charts. Keyed maps only.
- **Sequential for magnitude, categorical for identity.** Colouring a ranking
  categorically makes it harder to read, not easier.
- **Never a second y-axis.** Two measures of different scale are two charts.
- **A continuous axis.** Fill the empty months server-side; a line drawn across a
  missing month reports work that never happened.
- **Complete periods only.** A month in progress is partly counted and draws a
  cliff at the right-hand edge.
- **Every chart keeps its table**, behind the "Show the figures" disclosure.
