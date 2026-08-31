# Tabscope

Tabscope is a private attention mirror for Chrome. Every New Tab gives one direct sentence and a compact chart showing where the last hour, last three hours, or today went.

The result includes a simple range picker, the first and last observed activity times, total observed time, and observed switches. There are no cleanup actions, diagnoses, coaching, or judgment.

## How timing works

After the optional `tabs` permission is granted, the background worker records timestamped active-tab intervals. It follows the focused tab as the user moves across every Chrome window, checkpoints once per minute, and also reacts to tab changes, navigation, window focus, startup, and tab closure. Background windows are not counted as simultaneous attention.

Tabscope pages, browser-internal pages, unsupported URLs, and time while Chrome has no focused window are excluded. An unchecked segment is capped at five minutes so a suspended worker or sleeping computer cannot create a wildly inflated total. The result is a conservative measure of **observed browser attention**, not proof that a page was continuously read.

Intervals are retained locally for eight days. Existing installs begin building interval history after upgrading; older daily totals cannot be reconstructed into a timeline.

## Privacy boundary

The attention mirror runs entirely on the device. It does not call an AI model or any external API.

Stored locally:

- normalized domains;
- redacted tab titles;
- timestamped active-tab intervals;
- a compact current-tab snapshot used by legacy extension flows.

Never read:

- page contents;
- form inputs, messages, cookies, passwords, or keystrokes;
- Chrome browsing history.

## Permissions

- `storage`: stores the local attention ledger.
- `alarms`: creates the one-minute timing checkpoint.
- `tabs` (optional): requested when the user enables the mirror.

There is no content script, host access, browsing-history permission, or page-content access.

## Install locally

Requirements: Node.js 20+ and Chrome/Chromium.

```bash
npm install
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. If an older Tabscope points somewhere else, remove it.
4. Click **Load unpacked** and select this repository’s `dist/` folder.
5. Confirm the card shows version `0.4.3`.
6. Open a New Tab, click **Continue**, then browse normally.

The first useful reflection appears after Tabscope has observed some active browsing. The page updates from local extension storage without a manual reload.

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
public/manifest.json                              Manifest V3 permissions and New Tab override
src/background/index.ts                          active-tab event tracking and checkpoints
src/dashboard/DashboardApp.tsx                   onboarding and New Tab states
src/dashboard/components/AttentionMirrorView.tsx rolling attention mirror
src/lib/attention.ts                             interval ledger and range summaries
src/lib/privacy.ts                               title and URL sanitization boundary
```
