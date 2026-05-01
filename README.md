# AdSkip

A Chrome extension (MV3) that detects and skips in-video sponsor reads on YouTube. It pulls the video's captions, hands them to an LLM via OpenRouter, and uses the returned timestamps to either auto-skip the segment or surface a "Skip now" button on the player.

## How it works

The extension runs across three execution contexts that talk by message-passing.

```
┌─────────────────────────┐         ┌──────────────────────────┐
│ inject.ts (MAIN world)  │         │ index.tsx (ISOLATED)     │
│ - patches fetch + XHR   │ window. │ - mounts overlay (shadow │
│ - clicks CC if needed   │ postMsg │   DOM, anchored to       │
│ - posts caption JSON    ├────────►│   #movie_player rect)    │
│ - posts status updates  │         │ - watches video time     │
└─────────────────────────┘         │ - performs the skip      │
                                    └─────────────┬────────────┘
                                                  │ chrome.runtime
                                                  │  .sendMessage
                                                  ▼
                                    ┌──────────────────────────┐
                                    │ service-worker.ts        │
                                    │ - calls OpenRouter LLM   │
                                    │ - caches segments        │
                                    │   (storage.session)      │
                                    │ - records skip history   │
                                    └──────────────────────────┘
```

### 1. Caption capture (`src/content-scripts/youtube/inject.ts`)

Injected into the page's MAIN world via `<script src>` at `document_start` so its `fetch`/`XMLHttpRequest` patches land before YouTube's player code runs. Whenever YouTube hits `/api/timedtext`, the patched fetch clones the response and posts the caption JSON back to the isolated content script.

If the user has CC turned off, the script briefly clicks YouTube's own CC button to make the player request captions, then restores the original state. Two non-obvious cases are handled here:

- **Pre-roll ads** delay the main video's `timedtext` call. Before touching the CC button, the script blocks on `#movie_player.ad-showing` / `.ad-interrupting` clearing — otherwise the toggle hits the ad player and the intercept times out.
- **Re-entry** — the content script schedules force-fetch retries in case the natural flow stalls. An `inFlight` set in the inject prevents concurrent CC clicks if a retry fires while the first attempt is still waiting.

### 2. Overlay + skip controller (`src/content-scripts/youtube/index.tsx`)

The isolated-world content script renders a React tree inside a shadow root anchored to YouTube's `#movie_player`. It:

- Forwards captured caption payloads to the service worker for analysis.
- Listens for `AD_SEGMENTS` messages back from the service worker.
- Watches `video.currentTime` and runs `computeSkipState` (`skipController.ts`) every tick to decide whether to show the warning, count down a preroll, and/or perform the skip.
- Renders the `Overlay` with a "Don't skip" button (auto mode) or a "Skip now" button (manual mode).

The skip itself is a `video.currentTime = seg.endMs / 1000` jump. After the skip a `SkippedToast` confirms how much was skipped and a `RECORD_SKIP` message logs it for the popup's stats panel.

### 3. Analysis backend (`src/scripts/service-worker/service-worker.ts`)

Holds the OpenRouter API key (from extension storage), accepts `ANALYZE_CAPTIONS` messages, and calls the configured model. Results are cached per-video in `chrome.storage.session` so revisiting a tab doesn't re-pay for analysis. Concurrent requests for the same video share a single in-flight promise. Returned `AdSegment[]` (id + start/end ms + summary) is broadcast back to the originating tab.

### 4. Popup (`src/scripts/popup/Popup.tsx`)

- **Activity** — polls the active YouTube tab once a second for state (next ad, caption status, "analyzing" flag) and renders the cumulative time-saved counter.
- **Settings** — OpenRouter API key, model name, auto-skip toggle. A `PING_OPENROUTER` test verifies the key/model pair before you commit to it.

## Setup

```bash
pnpm install
pnpm build
```

Load `dist/` via `chrome://extensions` → Developer mode → **Load unpacked**. Open the popup, paste an OpenRouter API key, pick a model, then visit a YouTube video.

## Development

```bash
pnpm dev
```

Runs three Vite builds in watch mode (main, `inject.ts`, the `youtube` content script). After saving, click **Reload** on the extension card and refresh the YouTube tab — content scripts only re-attach on a fresh page load.

Logs are tagged `[adskip:inject]`, `[adskip:content]`, and `[adskip:bg]`. Inspect the service worker via `chrome://extensions` → **Inspect views: service worker**.

## License

ISC
