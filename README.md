# Tabscope

Tabscope is a private attention mirror for Chrome. It replaces the New Tab page with a factual view of where your active browser time went—without reading page contents or judging what you were doing.

## What you see

- **Last hour**, **Last 3 hours**, and **Today** views.
- One plain-language reflection of the selected period.
- First and last observed activity times.
- Total observed active-tab time and observed switches.
- A domain breakdown with Chrome-cached site favicons.
- Activity combined across every Chrome window as focus moves between them.

Only the focused Chrome window is counted. Background windows are not treated as simultaneous attention.

## Install from source

You need:

- Chrome or another Chromium-based browser;
- Node.js 20 or newer;
- npm.

### 1. Download and build Tabscope

```bash
git clone https://github.com/randomness11/tabscope.git
cd tabscope
npm install
npm run build
```

The production extension is created in `dist/`.

### 2. Load it into Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the generated `tabscope/dist/` folder—not the repository root.
5. Confirm that the Tabscope card shows version `0.4.5`.
6. Open a new tab.
7. Click **Continue** and approve tab and favicon access.

### 3. Let it observe normal browsing

Browse regular websites for a few minutes, including switching between windows if you use more than one. Open a new tab to see the reflection.

The page updates automatically as new timing data is stored. A first-time installation cannot reconstruct activity from before it was installed.

## Updating an unpacked installation

Pull and rebuild the project:

```bash
git pull
npm install
npm run build
```

Then return to `chrome://extensions` and click the **Reload** button on the Tabscope card.

Important: the reflection data updates automatically, but Chrome does **not** automatically reload changed extension code. After pulling or editing source files, rebuild and use the extension-card Reload button.

## How timing works

After tab access is granted, Tabscope records timestamped active-tab intervals locally. It reacts to:

- tab activation and navigation;
- Chrome window focus changes;
- tab closure;
- browser startup;
- a one-minute safety checkpoint.

Tabscope excludes its own New Tab page, Chrome-internal pages, unsupported URLs, and time when Chrome has no focused window. If the background worker sleeps, a single unchecked segment is capped at five minutes to prevent inflated totals.

Intervals are retained locally for eight days. The displayed values are conservative **observed active-tab time**, not proof that every second was spent reading the page.

## Privacy

The attention mirror runs entirely on the device. It does not call OpenRouter, an AI model, a third-party logo service, or any external API.

Stored locally:

- normalized domains;
- redacted tab titles;
- timestamped active-tab intervals;
- a compact current-tab snapshot used by the extension.

Favicons are read from Chrome's local cache when the breakdown is displayed; Tabscope does not send domains to a logo provider.

Tabscope never reads:

- page contents;
- form inputs, messages, cookies, passwords, or keystrokes;
- Chrome browsing history.

There are no content scripts, host permissions, or browsing-history permissions.

## Permissions

| Permission | Why it is used |
| --- | --- |
| `storage` | Stores the local attention ledger and extension state. |
| `alarms` | Runs the one-minute timing checkpoint. |
| `tabs` (requested at runtime) | Reads the active tab's URL and title so time can be assigned to a normalized domain. |
| `favicon` (requested at runtime) | Displays Chrome's cached site icons in the breakdown. |

## Troubleshooting

### The page says nothing has been observed

- Confirm you clicked **Continue** and granted access.
- Browse normal `http://` or `https://` pages while Chrome is focused.
- Wait at least one minute or switch tabs once, then open a new tab.
- Chrome settings pages and the Tabscope page itself are intentionally excluded.

### Activity from another window is missing

Tabscope counts the window you are actively using. Switch focus to the other Chrome window and browse normally; its activity will join the same local timeline. Tabs left open in an unfocused window do not accumulate time.

### Source changes are not appearing

1. Run `npm run build` again.
2. Verify Chrome loaded the `dist/` folder.
3. Click **Reload** on the extension card at `chrome://extensions`.
4. Open a fresh New Tab.

### The extension reports a service-worker error

Open `chrome://extensions`, find Tabscope, and inspect the error shown on its card. Make sure the selected folder contains `manifest.json` directly; if it does not, you selected the wrong folder.

## Development

```bash
npm run dev        # local Vite preview
npm run typecheck  # TypeScript validation
npm run lint       # ESLint
npm test           # Vitest suite
npm run build      # production extension in dist/
```

Before submitting a change, run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Project map

```text
public/manifest.json                              Manifest V3 configuration and permissions
src/background/index.ts                          active-tab tracking and checkpoints
src/dashboard/DashboardApp.tsx                   onboarding and New Tab states
src/dashboard/components/AttentionMirrorView.tsx reflection, ranges, and domain chart
src/lib/attention.ts                             interval ledger and range summaries
src/lib/privacy.ts                               title and URL sanitization
```
