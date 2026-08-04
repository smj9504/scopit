# 001 — Bridge the Packing Estimator's async result reveals with a fade+rise entrance

- **Status**: DONE (partially superseded) — executed in isolated worktree `scopeit-wt-plan001` (branch `claude/plan-001-result-reveal`), reviewed against AUDIT.md, verdict **PASS WITH NOTES**. Merged back into the main working directory, then found that `PackingDemoPage.tsx` and `packing-demo/DemoEstimateSummary.tsx` had since been rewritten by unrelated concurrent work (the public demo now reuses `PhotoAITab`/`EstimateEditorModal` directly via `packing-demo/demoApiShims.ts` instead of bespoke `Demo*` components) — Steps 3, 4, and 7 of this plan (the two `PackingDemoPage.tsx` fragment→div reveals and the `DemoEstimateSummary.tsx` Grand Total reveal) no longer apply to the current file and were **not** committed. Steps 1, 2, 5, and 6 (the `global.css` utility and its application to `PhotoAITab.tsx` / `EstimateEditorModal.tsx`) are still valid and committed, and — since the rewritten demo page reuses those exact components — still take effect there too.
- **Commit**: cbfa377 (updated from 18eae03 — a merge landed on `main` after this plan was first drafted; verified via `git diff --stat 18eae03 cbfa377 -- <target files>` that none of this plan's target files changed in that merge, so all citations below still hold)
- **Severity**: MEDIUM
- **Category**: Missed opportunities (8) — also touches Physicality (3) and Accessibility (6, inherited for free — see Repo conventions)
- **Estimated scope**: 5 files, ~6 small edits (1 shared CSS addition + 5 call sites)

> **Drift note**: `frontend/src/pages/public/LandingPage.tsx` is currently modified but **uncommitted** relative to `cbfa377` (confirmed via `git status --porcelain`). `frontend/src/pages/public/PackingDemoPage.tsx` and `frontend/src/pages/public/packing-demo/DemoEstimateSummary.tsx` are **untracked new files** — they don't exist in git history at all yet. Every excerpt and line number below was read directly off the current working-tree disk state (not off the commit), so it is accurate as of now regardless of git status. `PhotoAITab.tsx` and `EstimateEditorModal.tsx` are clean and match `cbfa377` exactly. If any cited line has moved by the time this plan is executed, STOP at that step and report the drift rather than guessing the new location.

## Problem

Four places in the Packing Estimator tool (the app's core "photo → AI-detected items → priced estimate" flow, plus its public unauthenticated demo at `/demo/packing`) resolve an async action by swapping a loading/empty state for a fully-populated result in the exact same render — no transition bridges the two states. The result pops in instantly, which reads as jarring precisely at the tool's payoff moments.

**1. `frontend/src/components/features/tools/packing/PhotoAITab.tsx:1295-1296`** — detected-items panel, current code:

```tsx
{/* Detected items + field notes — AI mode only */}
{hasItems && (
  <div>
```

`hasItems` (line 1042: `const hasItems = !room.usePreset && (room.analyzed || room.items.length > 0);`) flips true the instant `handleAnalyze`'s success branch runs `updateRoom(roomId, { items: result.items, ..., analyzed: true, analyzing: false });` (lines 1661-1671). The whole item list, field notes, and totals mount at once.

**2. `frontend/src/pages/public/PackingDemoPage.tsx:315-330`** — analyzing → editing bridge, current code:

```tsx
{(stage === 'editing' || stage === 'calculating' || (stage === 'done' && result)) && jobRooms.length > 0 && (
  <>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <Button size="small" onClick={handleStartOver}>Start over</Button>
    </div>
    {jobRooms.map((room) => (
      <Card key={room.room_key} title={`${room.room_name} — Detected Items`} style={{ marginBottom: 16 }}>
```

This whole block is absent while `stage === 'analyzing'` (which instead renders a `<Spin>` card at lines 306-313) and mounts in full — "Start over" button, every room card, every detected item — the instant `stage` becomes `'editing'`.

**3. `frontend/src/pages/public/PackingDemoPage.tsx:346-351`** — calculating → done bridge (the estimate payoff moment), current code:

```tsx
{stage === 'done' && result && (
  <>
    <div style={{ marginBottom: 16, textAlign: 'right' }}>
      <Button onClick={handleCalculate}>Recalculate</Button>
    </div>
    <DemoEstimateSummary result={result} />
```

Same pattern, nested one level in: the price the user came here for appears with zero transition the moment `handleCalculate` resolves.

**4. `frontend/src/components/features/tools/packing/EstimateEditorModal.tsx:1642` / `1690-1698`** — the authenticated tool's equivalent, current code:

```tsx
{!result ? (
  <div
    style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32,
      background: colors.bgLight,
    }}
  >
    {/* "No Estimate Yet" empty state, ends line 1689 */}
  </div>
) : (
  <div
    style={{
      flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
      padding: isMobile ? '16px 16px' : '32px 32px',
      background: colors.bgLight,
    }}
```

Same swap, same absence of a bridge, for the in-app modal's "No Estimate Yet" → populated two-column result layout.

**5. The Grand Total specifically** gets no distinct emphasis even once revealed — it renders as just another row:

- `EstimateEditorModal.tsx:2090-2116`:
  ```tsx
  {/* Grand Total */}
  <Row justify="space-between" align="middle">
    <Col><Text strong style={{ fontSize: 15, fontFamily: fonts.heading, color: colors.textPrimary }}>Grand Total</Text></Col>
    <Col><Text strong style={{ fontSize: 22, fontFamily: fonts.heading, color: colors.info }}>{fmt(computedGrandTotal)}</Text></Col>
  </Row>
  ```
- `DemoEstimateSummary.tsx:85-87`:
  ```tsx
  <div style={{ borderTop: `2px solid ${colors.primary}`, marginTop: 4 }}>
    <Row label="Grand Total" value={money(result.grand_total)} strong />
  </div>
  ```
  (This `Row` is a **local** component defined at `DemoEstimateSummary.tsx:13-33` — a plain `<div>` wrapper with no `className`/`style` passthrough. Do not add a className to it directly; target the wrapping `<div>` shown above instead, per Step 6.)

## Target

One shared CSS entrance (fade + slight rise + slight scale, no layout properties) applied at each of the 5 sites above. The Grand Total rows additionally get a short `animation-delay` so the total settles a beat after its panel, instead of both arriving in the same instant.

```css
/* target: frontend/src/styles/global.css, appended after .animate-slide-up */
@keyframes resultReveal {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.animate-result-reveal {
  animation: resultReveal 400ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
```

Applied, e.g., at call site 1:

```tsx
{hasItems && (
  <div className="animate-result-reveal">
```

And at the Grand Total in `EstimateEditorModal.tsx`:

```tsx
<Row justify="space-between" align="middle" className="animate-result-reveal" style={{ animationDelay: '150ms' }}>
```

## Repo conventions to follow

- **Exemplar for the utility-class pattern**: `frontend/src/styles/global.css:484-507` already does exactly this — `@keyframes fadeIn` / `@keyframes slideUp` paired with `.animate-fade-in` / `.animate-slide-up` utility classes. `resultReveal` / `.animate-result-reveal` is a third entry in that same family; add it immediately after `.animate-slide-up` (currently ending at `global.css:507`), before the `/* ===== Responsive Utilities ===== */` comment.
- **Exemplar for the exact curve/physicality values**: `frontend/src/pages/public/LandingPage.tsx:282-284,324-326` — `@keyframes materialize` + `.reveal-visible { animation: materialize 500ms cubic-bezier(0.16, 1, 0.3, 1) both; }`. This plan reuses the identical `cubic-bezier(0.16, 1, 0.3, 1)` curve (do not substitute a different easing) at a slightly shorter duration (400ms vs. 500ms) and a lighter transform (`translateY(10px) scale(0.97)` vs. `translateY(14px) scale(0.96)` — both are inside AUDIT.md's `scale(0.9–0.97)` physicality band) because these are user-triggered tool results appearing inline, not a passive hero-scroll reveal. Deliberately **not** carrying over `materialize`'s `filter: blur(6px)→0` — that reads correctly on the hero's large card but would look like text smearing on the single-line Grand Total row it also needs to cover; leaving it out keeps one class usable at every call site.
- **`@keyframes` vs. transition**: AUDIT.md category 4 requires transitions/springs for anything "triggered rapidly or reversible mid-motion." None of these 5 sites qualify — each mounts once per user-initiated action (click Analyze, click Get Combined Estimate/Calculate), gated by a loading state that prevents re-triggering mid-flight — so a restart-from-zero `@keyframes` animation is the right tool and correctly replays in full on every fresh analysis/calculation.
- **Reduced motion is already handled — do not re-implement it.** `global.css:890-898` has a blanket `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; ... } }`. Because `.animate-result-reveal` is a plain `animation`, it's automatically covered; no per-class override needed.
- **No new dependency.** None of the 4 target files import `framer-motion` (confirmed absent from all of `components/features/tools/packing/*` and `pages/public/*`), so this plan stays CSS-only rather than introducing it for a single use.

## Steps

1. **`frontend/src/styles/global.css`** — after the existing block:
   ```css
   .animate-slide-up {
     animation: slideUp 0.3s ease;
   }
   ```
   (ends at line 507), insert:
   ```css

   @keyframes resultReveal {
     from { opacity: 0; transform: translateY(10px) scale(0.97); }
     to { opacity: 1; transform: translateY(0) scale(1); }
   }

   .animate-result-reveal {
     animation: resultReveal 400ms cubic-bezier(0.16, 1, 0.3, 1) both;
   }
   ```

2. **`frontend/src/components/features/tools/packing/PhotoAITab.tsx:1296`** — change:
   ```tsx
   {hasItems && (
     <div>
   ```
   to:
   ```tsx
   {hasItems && (
     <div className="animate-result-reveal">
   ```

3. **`frontend/src/pages/public/PackingDemoPage.tsx:316`** — change the fragment opening the editing/calculating/done block:
   ```tsx
       <>
         <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
   ```
   to a `div` carrying the class (this is the one structural exception in this plan — a bare `<>` cannot take a `className`, and this block's siblings are already all block-level, so swapping fragment→div is layout-neutral):
   ```tsx
       <div className="animate-result-reveal">
         <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
   ```
   and update its matching closing `</>` (immediately before the `)}` that closes this conditional block, a few dozen lines below — locate it by matching indentation, do not guess a line number) to `</div>`.

4. **`frontend/src/pages/public/PackingDemoPage.tsx:347`** — same fragment→div treatment for the calculating→done bridge:
   ```tsx
       <>
         <div style={{ marginBottom: 16, textAlign: 'right' }}>
   ```
   becomes:
   ```tsx
       <div className="animate-result-reveal">
         <div style={{ marginBottom: 16, textAlign: 'right' }}>
   ```
   with its matching closing `</>` → `</div>` (the fragment closes right before this block's own `)}`).

5. **`frontend/src/components/features/tools/packing/EstimateEditorModal.tsx:1691`** — change:
   ```tsx
     ) : (
     <div
       style={{
         flex: 1,
         minHeight: 0,
         overflowY: 'auto',
         overflowX: 'hidden',
         padding: isMobile ? '16px 16px' : '32px 32px',
         background: colors.bgLight,
       }}
   ```
   to add the class (keep every existing style key unchanged):
   ```tsx
     ) : (
     <div
       className="animate-result-reveal"
       style={{
         flex: 1,
         minHeight: 0,
         overflowY: 'auto',
         overflowX: 'hidden',
         padding: isMobile ? '16px 16px' : '32px 32px',
         background: colors.bgLight,
       }}
   ```

6. **`frontend/src/components/features/tools/packing/EstimateEditorModal.tsx:2091`** — Grand Total emphasis. Change:
   ```tsx
     <Row justify="space-between" align="middle">
   ```
   to:
   ```tsx
     <Row justify="space-between" align="middle" className="animate-result-reveal" style={{ animationDelay: '150ms' }}>
   ```

7. **`frontend/src/pages/public/packing-demo/DemoEstimateSummary.tsx:85`** — Grand Total emphasis. Change:
   ```tsx
     <div style={{ borderTop: `2px solid ${colors.primary}`, marginTop: 4 }}>
       <Row label="Grand Total" value={money(result.grand_total)} strong />
     </div>
   ```
   to (add the class and merge the delay into the existing `style` object — do not add a second `style` prop):
   ```tsx
     <div
       className="animate-result-reveal"
       style={{ borderTop: `2px solid ${colors.primary}`, marginTop: 4, animationDelay: '150ms' }}
     >
       <Row label="Grand Total" value={money(result.grand_total)} strong />
     </div>
   ```

## Boundaries

- Do NOT touch the `analyzing`/`calculating` loading states themselves (`PhotoAITab.tsx`'s Cancel button at 1194-1197, `PackingDemoPage.tsx`'s `<Spin>` cards at 306-313) — only the states that appear after them are in scope.
- Do NOT add a count-up/number-tween animation to the Grand Total values. The audit that produced this plan noted `LandingPage.tsx`'s `useCountUp` hook (lines 27-45) as a candidate for this, but extracting it into a shared hook and wiring two different result shapes to it is materially bigger than this plan — leave it as explicit future work, not something to improvise here.
- Do NOT touch `DemoItemEditor.tsx`'s item list (no stagger) — that's a separate, not-yet-written finding.
- Do NOT touch `QuickEstimateTab.tsx`, `PackoutTab.tsx`, or `OnboardingWizard.tsx`'s step-swap teleports, even though they share the same root cause — those belong to a different plan (wizard/stepped-flow transitions), out of scope here.
- Do NOT add `framer-motion` or any new dependency.
- Do NOT change any property other than `className`/`style` (animation-related keys only) — no markup restructuring beyond the two named fragment→div conversions in steps 3 and 4.
- If any cited line's surrounding code doesn't match what's quoted above (drift since the commit stamp), STOP that step and report the mismatch instead of improvising a fix.

## Verification

- **Mechanical**: from `frontend/`, run `./node_modules/.bin/tsc --noEmit -p .` (or `npx tsc --noEmit -p .`). Expect no new errors in the 5 touched files. Note: this command already reports pre-existing, unrelated errors in `FolderImportModal.tsx`, `PackoutTab.tsx`, `QuickEstimateTab.tsx`, `ReportExportModal.tsx`, and `InvoiceEditorPage.tsx` — those are not caused by this plan; do not attempt to fix them here.
- **Feel check (public demo, no login needed)**: `npm run dev` from `frontend/`, open `http://localhost:3001/demo/packing`, select a sample room, click "Analyze N Room(s)". Confirm:
  - The `<Spin>` card is gone before the room cards + detected items appear — the new content fades and rises into place over ~400ms rather than popping in instantly.
  - Click "Get Combined Estimate" — confirm the summary panel arrives, and the Grand Total row visibly settles a beat (~150ms) after the rest of the panel rather than everything landing in the same instant.
  - In DevTools → More tools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce", repeat both actions and confirm the reveals become effectively instant (no visible motion) while the content itself still appears correctly — this exercises the existing global reducer, it should need no code change to pass.
  - In DevTools → Animations panel, set playback to 10% and confirm the motion is a clean fade+rise with no jump/flash at the start or end frame.
- **Feel check (authenticated tool)**: log in, open a Packing Estimator job (`/app/tools/packing`), reach the "No Estimate Yet" state, click "Calculate Estimate", and confirm the same fade+rise on the populated two-column layout and the same delayed settle on its Grand Total. (If a throwaway login isn't readily available in the execution environment, code-review this site against the public-demo behavior as a proxy and note that live verification was skipped.)
- **Layout check**: confirm the fragment→div changes in steps 3-4 introduced no visible shift — the "Start over" button row, room cards, and CTA/summary block should stack and align exactly as before.
- **Done when**: all 4 reveal points show the fade+rise instead of an instant pop, both Grand Totals settle ~150ms after their panel, `tsc --noEmit` shows no new errors, and reduced-motion collapses all of the above to near-instant.
