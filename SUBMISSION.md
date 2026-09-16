# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:**

---

## How to run it

Anything we need to know beyond `npm install && npm run dev`.

## Time spent

Roughly, and how you split it.

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends >50 ids in one call | `App.tsx` | |
| 2 | Search input fired requests on every keystroke with no cancellation (`AbortController`) or debounce, causing race conditions where slow older responses overwrite newer results | `App.tsx`, `useAssets.ts`, `client.ts` | Fixed |
| 3 | State was not synchronized to URL, losing search/filter state on page reload and lacking deep-linking | `App.tsx` | Fixed |

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**

**Stale response handling**
- Implemented `AbortController` in `useAssets.ts` wired directly to `fetch` signals in `client.ts`, aborting in-flight requests during `useEffect` cleanup.
- Added a 300ms debounce for search text (`q`) in `App.tsx` while keeping status/sort filter changes instantaneous (0ms delay), striking the right balance between responsiveness and avoiding rate-limit storms.

**Virtualization approach**

**Optimistic updates and rollback**

**Retry and backoff policy**

**State placement and URL sync**
- Initialized state from URL query parameters via `getInitialParams()` on mount (`q`, `status`, `sort`).
- Used `window.history.replaceState` synchronized with the debounced query state so that active views are shareable, deep-linkable, and persist across page refreshes without cluttering the browser history with an entry for every keystroke.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser (e.g., macOS, Firefox).

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | | | |
| Cards re-rendered when toggling one selection | | | |
| Longest task during sustained scroll | | | |
| Requests fired while typing a 6-character query | 6–8 requests | 1 request | Firefox DevTools Network tab typing "trailer" |
| Production bundle, gzipped | | | |

What was the actual bottleneck, and how did you find it?

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

---

## Interface decisions

Three or four sentences: what you were optimising for, and the decisions that
follow from it. Then briefly:

- **Visual system.** Your colour, spacing and type decisions, and where they live.
- **Status treatment.** How the four statuses read as a progression, and how they
  stay distinguishable without relying on colour.
- **States.** What you did with loading, empty, error, offline and partial
  failure.
- **Contrast.** What you checked against, and with what.
- **Copy.** Any user-facing message you rewrote and why.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

- **Debounce placement (`App.tsx` vs `useAssets.ts`)**: We debounced only the search input in `App.tsx` instead of delaying the entire `useAssets` hook. This way, clicking a filter checkbox or changing the sort dropdown updates the screen instantly, while typing still waits 300ms so we don't spam the server on every keystroke.

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
