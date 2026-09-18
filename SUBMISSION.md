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
| 1 | Bulk update sends >50 ids in one call without chunking, bounded concurrency, or partial failure handling | `App.tsx`, `client.ts` | Fixed |
| 2 | Search input fired requests on every keystroke with no cancellation (`AbortController`) or debounce, causing race conditions where slow older responses overwrite newer results | `App.tsx`, `useAssets.ts`, `client.ts` | Fixed |
| 3 | State was not synchronized to URL, losing search/filter state on page reload and lacking deep-linking | `App.tsx` | Fixed |
| 4 | No de-duplication of concurrent identical requests, causing duplicate network fetches | `client.ts` | Fixed |
| 5 | `AssetGrid` unconditionally showed "Nothing matches these filters" on `assets.length === 0`, causing empty state flashes during loading and masking error states | `AssetGrid.tsx`, `App.tsx` | Fixed |
| 6 | Unvirtualized asset grid mounted all loaded DOM elements continuously, causing unbounded DOM size (5,000+ nodes) and severe scroll jank at scale | `AssetGrid.tsx` | Fixed |
| 7 | Missing thumbnails (`hasThumbnail: false` or 404 responses) showed broken image icons and caused Cumulative Layout Shift (CLS) as pages loaded | `AssetGrid.tsx`, `styles.css` | Fixed |

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**
- **In-flight request de-duplication:** Concurrent identical `GET` requests are de-duplicated via a module-level `inFlight: Map<string, Promise<unknown>>` in `client.ts`. The first caller's promise is stored under a key of `METHOD path`; subsequent callers receive the same promise instead of issuing a redundant network fetch. Entries are removed in `.finally()`, ensuring the map only holds requests that are genuinely in flight and fresh requests can be made after settlement.
- **Idempotency gating:** De-duplication is strictly restricted to `GET` requests. Mutating operations (`PATCH`, `POST`) always execute independently to avoid merging distinct user intents, side effects, or interfering with future retry policies.
- **Atomic query-cursor pairing:** Coupled `query` and `cursor` in `useAssets.ts` via `cursorContextRef`. This guarantees that `loadMore` cannot accidentally pair an earlier query's cursor with a newly rendered query, eliminating wasted `400 stale_cursor` requests.

**Stale response handling**
- Implemented `AbortController` in `useAssets.ts` wired directly to `fetch` signals in `client.ts`, aborting in-flight requests during `useEffect` cleanup.
- Added a 300ms debounce for search text (`q`) in `App.tsx` while keeping status/kind/sort filter changes instantaneous (0ms delay), striking the right balance between responsiveness and avoiding rate-limit storms.

**Virtualization approach**
- **Dynamic 2D Row-Virtualization:** Built with `@tanstack/react-virtual`. Rather than virtualizing individual cards, we compute dynamic responsive column count via `ResizeObserver` on the grid container and virtualize entire rows. This keeps the virtualizer 1D while rendering a fluid responsive multi-column CSS grid.
- **Scroll Anchoring across width/column changes:** When container width changes (e.g. opening/closing the detail panel or window resize changing column count from 4 to 2), `AssetGrid` computes the index of the top-most visible asset and immediately scrolls to its new row via `rowVirtualizer.scrollToIndex(newRow, { align: 'start' })`. The user never loses their visual anchor.
- **Zero Cumulative Layout Shift (CLS):** Card thumbnail containers enforce a fixed `aspect-ratio: 16 / 10`. If a thumbnail 404s or is missing, a stable fallback placeholder renders into the identical geometry.

**Optimistic updates and rollback**
- **Selection model:** Built using `Set<string>` for O(1) membership checks. Supports click toggling, Shift-click range selection from the last-clicked anchor ID (surviving re-sorts), "Select all loaded", and "Clear selection". Selection resets on search/filter query identity changes, but is preserved across sort order changes.
- **Snapshot-based Optimistic Update & Rollback:** `useAssets.applyBulkStatus` captures an immutable pre-action status snapshot of targeted IDs from `itemsRef.current`, applies the new status to local React state immediately, and delegates network execution. On completion, only `failed` and `unknown` items are rolled back to their snapshot value; `succeeded` IDs keep their new status and reconcile server version metadata (`appliedAssets`).
- **Chunking with Bounded Concurrency:** `bulkSetStatus` splits large selections into ≤ 50-item batches and runs them through `mapConcurrent` with a concurrency ceiling of 3 workers. Network-level HTTP chunk errors are isolated: a failing chunk contributes only its own batch to `unknown`, while other successful chunks report per-item results.
- **Three-way Result Partitioning & Smart Recovery:** Each bulk operation yields `{ succeeded, failed, unknown, appliedAssets }`. Successful items are deselected immediately. `failed` carries an item-level error `code` and `retryable` boolean. "Retry N items" re-sends only the retryable subset (`conflict`, `unknown`); permanent failures (`legal_hold`, `not_found`) cannot succeed and are excluded from the count (e.g. if 96 items are selected and 21 fail with 13 on legal hold, the button prompts "Retry 8 items", not 21 failed, not 96 selected).
- **Single-Asset 409 Conflict Strategy in `AssetDetail`:** Catches `ApiError` structurally (status `409`), refetches the latest server asset, and renders a conflict banner with two clear choices: *Reload latest* (discard local edit, adopt server state) or *Overwrite* (re-apply edit with latest version). Chosen over auto-merge (silently resolves conflicts on user-owned metadata) and auto-reload (discards the reviewer's edit without asking). Accepted cost: 1 extra `getAsset` round-trip and 1 explicit user click.

**State placement and URL sync**
- Initialized state from URL query parameters via `getInitialParams()` on mount (`q`, `status`, `kind`, `tag`, `sort`).
- Used `window.history.replaceState` synchronized with the debounced query state so that active views are shareable, deep-linkable, and persist across page refreshes without cluttering the browser history with an entry for every keystroke.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser (e.g., macOS, Firefox).

*Environment: macOS (Apple Silicon), Google Chrome.*

**Task 3 Selection Profiling (React DevTools Profiler)**

*Baseline comparison not captured — the pre-Task-3 code lacked the selection features being measured.*

| Action / Interaction | Measured Outcome | Commit Duration | How measured |
| --- | --- | --- | --- |
| Toggling one card with 48 loaded | Exactly 1 `AssetCard` rendered (47 idle) | 2.0ms commit | React DevTools Profiler recording selection toggle with stable callback identity |
| Shift-selecting 10 cards | Exactly 10 `AssetCard`s rendered (38 idle) | 3.3ms commit | React DevTools Profiler recording range extension from anchor |
| Adding to a 9-card selection | Exactly 1 `AssetCard` rendered (47 idle) | 1.9ms commit | React DevTools Profiler recording individual card addition to existing selection |

**Task 2 Virtualization & Bundle Measurements**

| Metric | Measured Value | How measured |
| --- | --- | --- |
| Rendered DOM nodes at 5,040 assets loaded | 48 `.card` nodes; 445 total DOM elements | `document.querySelectorAll('.card').length` and `document.querySelectorAll('*').length` in Chrome DevTools Console |
| Production bundle, gzipped | 61.45 kB total (59.92 kB JS + 1.53 kB CSS) | `npm run build` Vite production build output |

What was the actual bottleneck, and how did you find it?
- **1. Unvirtualized DOM Bloat (Task 2)**: Without virtualization, loading subsequent pages mounted every asset directly to the DOM, causing unbounded DOM size as the library scaled. Identified using Chrome DevTools Console and `document.querySelectorAll('.card').length`. Resolved by implementing dynamic 2D row virtualization with `@tanstack/react-virtual` and `ResizeObserver`, bounding the DOM to 48 card nodes / 445 total DOM elements at 5,040 assets loaded.
- **2. Cascading Sibling Re-renders on Selection Toggle (Task 3)**: Discovered via React DevTools Profiler that mutating selection state re-rendered unselected cards when callback identities were unstable and cards unmemoized. Resolved by wrapping `AssetCard` in `React.memo` and stabilizing selection callbacks with `useCallback([], setState(prev => ...))`, achieving 100% sibling render isolation.
- **3. Broken Image 404s & Cumulative Layout Shift (Task 2)**: The API contract notes ~4% thumbnail 404s and assets where `hasThumbnail: false`. Found via visual inspection that missing images collapsed card dimensions. Resolved by enforcing a reserved `aspect-ratio: 16 / 10` thumbnail container and fallback placeholders, eliminating layout shift.

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
- **De-duplication limited to signal-less GETs**: The request layer de-duplicates only `GET` requests that have no `AbortSignal` attached. Signal-bearing GETs — which is what `listAssets` in `useAssets` always sends, to support query-change cancellation — bypass de-duplication and each perform their own fetch. The trade-off is that the most-used endpoint gets no de-dup coverage, but per-caller cancellation works correctly. Sharing a promise between signal-bearing callers was rejected because aborting one caller's request would reject the others, which breaks the cancellation contract that Task 1 requires.
- **Row-based 2D Virtualization**: Grouped items into dynamic row slices rather than maintaining an uncoordinated 2D grid matrix. Responsive column count is computed continuously by a `ResizeObserver`, keeping the virtualizer 1D and efficient while rendering a true responsive multi-column CSS grid.
- **Explicit 409 Conflict Resolution over Auto-Merge**: In `AssetDetail`, we prompt the user to *Reload latest* or *Overwrite* rather than attempting heuristic auto-merging. Auto-merging silently resolves concurrent edits on user-owned metadata, risking data loss. The explicit choice requires an extra `getAsset` round-trip and user click, but prevents silent state corruption.
- **ID-scoped Bulk Updates across Query Shifts**: Bulk status changes operate strictly on captured target IDs rather than live query boundaries. If the user shifts search/filter criteria while a bulk mutation is in flight, the operation finishes in the background, reporting accurate results without corrupting the newly loaded query items (guarded by `generationRef`). Global rate limiting across the bulk pool and read path is deferred to Task 4.
- **Batch query parameter ordering**: `getAssetsByIds(['a', 'b'])` and `getAssetsByIds(['b', 'a'])` produce different URLs and are treated as distinct request keys. Normalizing ID order before generating cache keys was deferred as a minor edge case.

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
