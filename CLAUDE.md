# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome MV3 browser extension that automatically captures Weibo API request headers (including cookies via `extraHeaders`) on a daily schedule and uploads them to the AWSL API (`PUT /admin/wb_headers`).

## Development

No build step, no dependencies. Pure vanilla JavaScript Chrome extension.

- **Load in Chrome**: `chrome://extensions/` → Developer mode → Load unpacked → select project root
- **Reload after changes**: Click the refresh icon on the extension card, or Ctrl+R on the service worker inspector
- **Debug background**: Click "Inspect views: service worker" on the extension card
- **Debug popup**: Right-click extension icon → Inspect popup

## Architecture

**Two runtime contexts communicate via `chrome.runtime.sendMessage`:**

- `background.js` — Service worker: scheduling, webRequest interception, upload, state management
- `popup.js` — UI: configuration form, status display, real-time logs

**State lives in `chrome.storage.local` under three keys:**

| Key | Purpose |
|-----|---------|
| `awslConfig` | User settings (times, URLs, token) |
| `awslState` | Capture lifecycle state machine: `idle → tab_opened → captured → done` |
| `awslLogs` | Circular buffer of last 50 log entries |

**Capture flow:**

```
alarm fires → open weibo tab (hidden) → webRequest intercepts /ajax/statuses/mymblog
→ extract all request headers → PUT to AWSL API with Bearer auth
→ wait 30-120s random → close tab → schedule tomorrow
```

## Key Design Constraints

1. **webRequest listener must be registered at module top level** — MV3 requires synchronous registration during service worker initialization. The handler uses `captureState.active` flag to decide whether to process.
2. **`extraHeaders` option is required** — Without it, Chrome strips sensitive headers (Cookie, Authorization) from `onBeforeSendHeaders`.
3. **All timers use `chrome.alarms`** — `setTimeout` is unreliable because service workers can be terminated. Both capture scheduling and tab-close delays use alarms.
4. **State persisted to storage for crash recovery** — `recoverState()` on startup detects interrupted captures and resets cleanly.

## Message Protocol (popup ↔ background)

| `msg.type` | Direction | Purpose |
|------------|-----------|---------|
| `getStatus` | popup → bg | Fetch config + state |
| `saveConfig` | popup → bg | Save config, reschedule |
| `runNow` | popup → bg | Manual trigger (ignores lastRunDate) |
| `getLogs` | popup → bg | Fetch log entries |
| `clearLogs` | popup → bg | Clear log buffer |

## Storage Helper Pattern

`safeStorageGet`/`safeStorageSet` are Promise wrappers that never reject — they resolve with `{}` or `undefined` on error. All config/state reads go through `normalizeConfig`/`normalizeState` which enforce types and apply defaults.
