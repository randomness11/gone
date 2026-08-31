# Tabscope

Tabscope is a private Chrome New Tab conscience. It notices where observed active-tab time actually went, what keeps pulling the user back, and the unfinished decision still sitting underneath it.

The New Tab surface deliberately contains only three things:

- one timely observation;
- an honest local attention breakdown;
- one unresolved thread with a way to return, acknowledge, or resolve it.

The product stays quiet when it lacks evidence. Nothing is automatically closed, and cleanup still requires selecting every tab explicitly.

## Local attention timing

After tab permission is granted, the background worker observes active-tab transitions and checkpoints the current tab once per minute. It aggregates time by normalized domain for the current local day. Tabscope pages, browser-internal pages, unsupported URLs, and time while Chrome has no focused window are excluded.

To avoid overstating time after a suspended worker or sleeping machine, any unchecked segment is capped at five minutes. This makes the displayed number a conservative measure of **observed active browser time**, not proof that the page was continuously read.

## Live reflection

Tabscope keeps the reflection current by default while Chrome is open. The default cadence is 10 minutes, with 30-minute and 1-hour options.

Each cycle first compares a compact local digest of the current tabs with the previous digest. If nothing meaningful changed, it stops there. In adaptive mode, the model is contacted only after a meaningful change or a user-requested refresh. Provider failure falls back to a local analysis.

**Reflect again** never waits on the network: Tabscope renders a local reflection immediately, then sharpens it in the background. The model pass has a seven-second total deadline, after which the local result simply remains in place.

Chrome alarms are approximate: a sleeping device is not woken, and a delayed check resumes after Chrome becomes active again. The dashboard updates from extension storage without requiring a page reload.

## Privacy boundary

Tabscope reads tab metadata, not page contents.

Stays on the device:

- raw URLs and Chrome tab IDs;
- query parameters and fragments before sanitization;
- duplicate detection and saved reflection history;
- raw active-tab timing segments and the current local attention ledger;
- user corrections and live-refresh settings.

May be sent to the configured model:

- redacted tab titles;
- normalized domains and sanitized path hints;
- synthetic window and group labels;
- pinned and active state;
- coarse age buckets such as “today” or “older.”
- aggregated active-tab minutes and revisit counts by normalized domain.

Never read:

- page contents;
- form inputs, messages, cookies, passwords, or keystrokes;
- browsing history outside the tabs currently open.

Sensitive query parameters, fragments, emails, obvious tokens, long opaque IDs, and secret-like values are removed before inference.

## Permissions

- `storage`: saved reflections, settings, and corrections.
- `alarms`: one-minute local timing checkpoints and 10/30/60-minute reflection checks.
- `tabs` (optional): requested when the user begins a reflection.
- `tabGroups` (optional): requested only when the user creates a focus group.
- provider host access (optional): requested for the configured model endpoint.

There is no content script, browsing-history permission, or page-content access.

## Install locally

Requirements: Node.js 20+ and Chrome/Chromium.

```bash
npm install
cp .env.example .env
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Remove an older unpacked Tabscope build if Chrome points to a different folder.
4. Click **Load unpacked** and select this repository’s `dist/` folder.
5. Confirm that the extension card shows version `0.3.1`.
6. Open a New Tab and click **Continue**.

## OpenRouter configuration

```dotenv
LLM_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=
LLM_MODEL=inclusionai/ling-3.0-flash-fin:free
```

A browser extension cannot protect an embedded API key. A key compiled into `dist/` is suitable only for private local testing. Public distribution should use a narrow authenticated proxy and must never ship a valuable upstream key.

## Development

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Key files:

```text
public/manifest.json                    Manifest V3 permissions and New Tab override
src/background/index.ts                active-tab timing and live-reflection pipelines
src/dashboard/DashboardApp.tsx         permission, analysis, and result states
src/dashboard/components/AnalysisView.tsx  Chrome-native browser-conscience surface
src/dashboard/store.ts                 manual analysis and live-session synchronization
src/lib/privacy.ts                     title and URL sanitization boundary
src/lib/live.ts                        local digest comparison and model-refresh policy
src/lib/attention.ts                   conservative local active-tab timing ledger
```
