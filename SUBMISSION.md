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
| 8 | Transient failures (`503`, `429`, network drops) had no retry loop, exponential backoff, or `Retry-After` handling, causing immediate failures under hostile network conditions | `client.ts` | Fixed |
| 9 | Leaked raw technical backend messages (e.g. `429: Too many requests...`) into the UI without user-actionable explanations | `App.tsx`, `AssetDetail.tsx` | Fixed |
| 10 | Retried mutations on network drop caused phantom `409 Conflict` errors when server applied the change before dropping response | `client.ts`, `AssetDetail.tsx` | Fixed |
| 11 | No React Error Boundaries — a component-level rendering failure crashed and blanked the entire application | `App.tsx` | Fixed |

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
- **Three-way Result Partitioning & Smart Recovery:** Each bulk operation yields `{ succeeded, failed, unknown, appliedAssets }`. Successful items are deselected immediately. `failed` carries an item-level error `code` and `retryable` boolean. "Retry N items" re-sends only the retryable subset (`conflict`, `unknown`); permanent failures (`legal_hold`, `not_found`) cannot succeed and are excluded from the count.
- **Single-Asset 409 Conflict Strategy in `AssetDetail`:** Catches `ApiError` structurally (status `409`), refetches the latest server asset, and renders a conflict banner with two clear choices: *Reload latest* (discard local edit, adopt server state) or *Overwrite* (re-apply edit with latest version).

**Resilience, Retries, and Error Boundaries (Task 4)**
- **Two-Layer Retry Gating:** Retries require two independent gates to pass: `options.retryable: boolean` (endpoint policy) and `classifyError(err).retryable: boolean` (structural error classification). This guarantees that mutations never retry accidentally unless the call site explicitly opts in.
- **Safe-by-Default (`retryable: false`):** `requestWithRetry` defaults `retryable` to `false`. Read endpoints (`listAssets`, `getAsset`, `getAssetsByIds`) and OCC-protected endpoints explicitly opt in with `true`.
- **Pure Structural Error Classifier:** `classifyError` classifies errors purely on properties (`status`, `name`, `code`) without regex or string matching. `503`, `429`, `500`, network drops (`TypeError`), and unclassified errors default to transient/retryable; `400`, `409`, `422`, and `AbortError` are strictly non-retryable.
- **Wall-Clock Cooldown Synchronization (`Date.now()`):** `rateLimitUntil` stores an absolute timestamp updated via `Math.max`. We chose wall-clock `Date.now()` over monotonic `performance.now()` because it directly coordinates with HTTP `Retry-After` epoch offsets and remains consistent across environments. Cooldown waits do not burn retry attempts, and abort signals reject cooldown waits immediately.
- **Phantom-409 OCC Reconciliation in `updateAsset`:** When a retried `PATCH` (`attempt > 0`) receives `409 Conflict` (due to a lost response on an initial write that actually committed), `updateAsset` refetches the asset and performs per-field equality verification. If all patch fields match, it reconciles as success; if unmatched, it surfaces the genuine conflict; if the verification refetch fails, it surfaces an `unconfirmed` error state.
- **Panel-Scoped Error Boundaries (`PanelBoundary`):** Wrapped `AssetGrid` and `AssetDetail` in isolated boundaries with dynamic `resetKeys` (`queryKey` for grid, `activeId` for detail). A rendering crash in one panel never blanks the other, and users can reload individual panels without losing application state.
- **Guarded Offline Recovery:** Root-level `OfflineBanner` with `aria-live="polite"` announces connectivity changes. When reconnecting, active query refetch is guarded on `!isApplyingBulk && !isSavingDetail && !loading && !loadingMore` to prevent clobbering optimistic writes and duplicate fetches.
- **Offline detection trigger:** `reportNetworkFailure()` fires on any terminal retryable-class failure — an exhausted 5xx, an exhausted 429, or a TypeError network drop — not just `navigator.onLine === false`. This matters for a hostile API that fails server-side, not just network-side.
- **`unconfirmed` UX:** When the phantom-409 reconciliation refetch fails, `updateAsset` throws `ApiError` with `unconfirmed: true` and status `0`. `AssetDetail` renders: *"Network dropped during save; write outcome is unconfirmed. Reload asset to verify."* with a "Reload asset to verify" button.
- **`unconfirmed` ↔ `unknown`:** `unconfirmed` (single-asset) and Task 3's `unknown` bucket (bulk chunk) are the same concept at different granularities: "the write may or may not have landed." They share a shape but not a recovery path — Task 3 retries, Task 4 reloads to verify.
- **Deferred refetch:** When the reconnect refetch guard (`!isApplyingBulk && !isSavingDetail && !loading && !loadingMore`) blocks, the refetch is deferred, not dropped. A `pendingReconnectRefetchRef` flag fires it as soon as in-flight work settles. Verified in UI: reconnect → ~1s loading → grid populates.
- **Test evidence:** Task 4's classifier and retry loop are covered by 23 unit tests in `src/api/errorClassifier.test.ts` and `src/api/retry.test.ts`, runnable via `npm test`. Tests verify structural classification (two tests prove the classifier doesn't read error message strings), backoff bounds, retry-gate behavior, non-burning cooldown, abort-mid-backoff, and retry cap.

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
| Production bundle, gzipped | 64.42 kB total (62.65 kB JS + 1.77 kB CSS) | `npm run build` Vite production build output |

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
- **Copy.** User-facing messages rewritten through `getActionableErrorMessage`: translated technical codes (`429`, `503`, network drops) into clear, context-specific messages (e.g. "Server is busy. Automatically updating search results in a moment…") rather than leaking implementation details.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

- **Debounce placement (`App.tsx` vs `useAssets.ts`)**: We debounced only the search input in `App.tsx` instead of delaying the entire `useAssets` hook. This way, clicking a filter checkbox or changing the sort dropdown updates the screen instantly, while typing still waits 300ms so we don't spam the server on every keystroke.
- **De-duplication limited to signal-less GETs**: The request layer de-duplicates only `GET` requests that have no `AbortSignal` attached. Signal-bearing GETs — which is what `listAssets` in `useAssets` always sends, to support query-change cancellation — bypass de-duplication and each perform their own fetch.
- **Row-based 2D Virtualization**: Grouped items into dynamic row slices rather than maintaining an uncoordinated 2D grid matrix. Responsive column count is computed continuously by a `ResizeObserver`, keeping the virtualizer 1D and efficient while rendering a true responsive multi-column CSS grid.
- **Explicit 409 Conflict Resolution over Auto-Merge**: In `AssetDetail`, we prompt the user to *Reload latest* or *Overwrite* rather than attempting heuristic auto-merging. Auto-merging silently resolves concurrent edits on user-owned metadata, risking data loss.
- **Rejection of Client-Side Token Bucket**: Rejected building an in-memory token bucket for the 80/10s rate limit window. Driven by `Retry-After: 3`, a single module-level `rateLimitUntil` wall-clock timestamp awaited by all requests is deterministic, zero-overhead, and immune to multi-tab drift.
- **No Offline Mutating Write Queueing**: Rejected queueing and auto-replaying mutating status writes when offline. In a multi-user asset review platform, silently replaying stale writes 20 seconds later risks overwriting concurrent decisions made by other reviewers.
- **ID-scoped Bulk Updates across Query Shifts**: Bulk status changes operate strictly on captured target IDs rather than live query boundaries. If the user shifts search/filter criteria while a bulk mutation is in flight, the operation finishes in the background, reporting accurate results without corrupting the newly loaded query items (guarded by `generationRef`).

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
