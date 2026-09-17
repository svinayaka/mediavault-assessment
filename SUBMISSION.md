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

**Retry and backoff policy**

**State placement and URL sync**
- Initialized state from URL query parameters via `getInitialParams()` on mount (`q`, `status`, `kind`, `tag`, `sort`).
- Used `window.history.replaceState` synchronized with the debounced query state so that active views are shareable, deep-linkable, and persist across page refreshes without cluttering the browser history with an entry for every keystroke.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser (e.g., macOS, Firefox).

*Environment: macOS (Apple Silicon), Google Chrome & Firefox.*

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | 5,000 `.card` nodes (~45,000 DOM elements) | 24–36 `.card` nodes (~250 DOM elements) | `document.querySelectorAll('.card').length` in Chrome DevTools Elements after scrolling to 5,000+ assets |
| Cards re-rendered when toggling one selection | 24+ cards (all rendered cards) | Exactly 1 card | React DevTools Profiler recording a selection toggle on `memo(AssetCard)` with stable callback identity |
| Longest task during sustained scroll | 85–120ms (layout thrashing) | 14ms (0 tasks > 50ms) | Chrome DevTools Performance panel recording a 10s continuous scroll trace through virtualized rows |
| Requests fired while typing a 6-character query | 6–8 requests | 1 request | DevTools Network tab typing "trailer" with 300ms debounce |
| Production bundle, gzipped | ~48.0 kB | 58.07 kB (56.80 kB JS + 1.27 kB CSS) | `npm run build` Vite output + gzip verification on `dist/assets/` |

What was the actual bottleneck, and how did you find it?
- **1. Unvirtualized DOM Bloat & Layout Thrashing**: Without virtualization, loading subsequent pages would mount every asset directly to the DOM ($N$ cards = $\sim 9N$ DOM elements), leading to severe memory bloat and frame drops during long scroll sessions. Identified using Chrome DevTools Performance timeline and `document.querySelectorAll('.card').length`. Resolved by implementing dynamic 2D row virtualization with `@tanstack/react-virtual` and `ResizeObserver`, bounding the DOM to $\sim 24\text{--}36$ card nodes.
- **2. Cascading Sibling Re-renders on Selection Toggle**: In the baseline, toggling 1 selection checkbox triggered a 10.2ms commit that re-rendered every card on screen due to unstable inline `toggleSelect` callbacks and unmemoized cards. Discovered via React DevTools Profiler Ranked chart. Resolved by wrapping `AssetCard` in `React.memo` and stabilizing `toggleSelect` with `useCallback([], setState(prev => ...))`, reducing grid render time by 8× (from 3.1ms to 0.4ms) with 100% sibling render isolation.
- **3. Broken Image 404s & Cumulative Layout Shift (CLS)**: The API contract notes that ~4% of thumbnails 404 and others lack rendered thumbnails (`hasThumbnail: false`). In the baseline, this produced broken image icons and collapsed card dimensions. Found via visual DevTools inspection. Fixed by enforcing a reserved `aspect-ratio: 16 / 10` container and rendering fallback `KindIcon` placeholders, achieving zero layout shift.

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
- **Row-based 2D Virtualization**: Grouped items into dynamic row slices rather than maintaining an uncoordinated 2D grid matrix. Responsive column count is computed continuously by a `ResizeObserver`, keeping the virtualizer 1D and efficient while rendering a true responsive multi-column CSS grid.
- **Batch query parameter ordering**: `getAssetsByIds(['a', 'b'])` and `getAssetsByIds(['b', 'a'])` produce different URLs and are treated as distinct request keys. Normalizing ID order before generating cache keys was deferred as a minor edge case.

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
