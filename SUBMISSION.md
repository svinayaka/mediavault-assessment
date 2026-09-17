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
| 4 | No de-duplication of concurrent identical requests, causing duplicate network fetches | `client.ts` | Fixed |
| 5 | `AssetGrid` unconditionally showed "Nothing matches these filters" on `assets.length === 0`, causing empty state flashes during loading and masking error states | `AssetGrid.tsx`, `App.tsx` | Fixed |

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**
- **In-flight request de-duplication:** Concurrent identical `GET` requests are de-duplicated via a module-level `inFlight: Map<string, Promise<unknown>>` in `client.ts`. The first caller's promise is stored under a key of `METHOD path`; subsequent callers receive the same promise instead of issuing a redundant network fetch. Entries are removed in `.finally()`, ensuring the map only holds requests that are genuinely in flight and fresh requests can be made after settlement.
- **Idempotency gating:** De-duplication is strictly restricted to `GET` requests. Mutating operations (`PATCH`, `POST`) always execute independently to avoid merging distinct user intents, side effects, or interfering with future retry policies.

**Stale response handling**
- Implemented `AbortController` in `useAssets.ts` wired directly to `fetch` signals in `client.ts`, aborting in-flight requests during `useEffect` cleanup.
- Added a 300ms debounce for search text (`q`) in `App.tsx` while keeping status/kind/sort filter changes instantaneous (0ms delay), striking the right balance between responsiveness and avoiding rate-limit storms.

**Virtualization approach**

**Optimistic updates and rollback**

**Retry and backoff policy**

**State placement and URL sync**
- Initialized state from URL query parameters via `getInitialParams()` on mount (`q`, `status`, `kind`, `tag`, `sort`).
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
- **States.** Distinct loading, empty, and error states in `AssetGrid`. Uncoupled empty filter results from loading and error states to prevent flashes of "No results found" before data lands.
- **Contrast.** What you checked against, and with what.
- **Copy.** Any user-facing message you rewrote and why.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

- **Debounce placement (`App.tsx` vs `useAssets.ts`)**: We debounced only the search input in `App.tsx` instead of delaying the entire `useAssets` hook. This way, clicking a filter checkbox or changing the sort dropdown updates the screen instantly, while typing still waits 300ms so we don't spam the server on every keystroke.
- **No per-caller cancellation on deduped GETs**: Shared `GET` requests inherit the first caller's `AbortSignal`. If the first caller aborts, the shared promise rejects; if a later caller aborts, its cancel is ignored. Fully supporting independent cancellations across multiple subscribers requires per-subscriber ref-counting on the shared `AbortController`. The alternative — bypassing de-duplication whenever a signal is present — was rejected because `useAssets` always passes a signal, which would have made de-duplication completely inert on the most-used endpoint.
- **Batch query parameter ordering**: `getAssetsByIds(['a', 'b'])` and `getAssetsByIds(['b', 'a'])` produce different URLs and are treated as distinct request keys. Normalizing ID order before generating cache keys was deferred as a minor edge case.

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
