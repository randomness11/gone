# Tabscope

**Tabscope grows with you.** It starts as a playful portrait of the characters inside your open tabs, then becomes more specific as patterns return.

> At first, it sees your tabs. Then it notices your patterns. Eventually, it shows you how you are changing.

Tabscope is a Chrome New Tab extension. It is not a productivity score, tab dashboard, or Q&A interface. Every New Tab shows one private, evidence-backed portrait derived from what is open and what has meaningfully recurred.

## The experience

On the first reflection, current tabs become recognizable browser characters:

- **The builder** — implementation docs, APIs, repositories, and product work.
- **The possible job-switcher** — roles, companies, culture, compensation, and risk.
- **The careful chooser** — comparisons, reviews, prices, and failure reports.
- **The systems thinker** — infrastructure, markets, economics, and benchmarks.
- **The collector** — articles, videos, and things left nearby for later.

The portrait never claims a small cluster dominates the whole browser. It reports how much evidence it actually has and admits when the remaining tabs do not form a convincing pattern.

As meaningful snapshots accumulate, Tabscope can distinguish a first impression from something that genuinely returns:

```text
The first brushstroke
  → Something is starting to repeat
  → Becoming familiar
  → A portrait taking shape
```

Feedback—**That’s me**, **Partly**, or **Not quite**—stays local and affects the immediate on-device read as well as later model reflections.

## Instant, then sharper

**Look again** never blocks on the network. Tabscope renders a local portrait immediately and gives the configured model one seven-second background window to sharpen it. If the provider is slow, unavailable, or malformed, the fast local portrait remains in place.

The New Tab page listens to extension storage, so a sharper background reflection appears without reloading the page.

## How it grows

Tabscope keeps up to 30 days or 720 compact reflection snapshots in local extension storage. A snapshot contains:

- capture time and readable tab count;
- recurring character/thread keys;
- redacted evidence titles;
- normalized domains;
- tab counts per thread.

Repeated manual clicks within 30 minutes do not manufacture a pattern: identical recent portraits replace one another. A model refinement of the same snapshot also replaces the local draft instead of counting twice.

Automatic reflection is enabled by default. Every 10 minutes while Chrome is available, Tabscope compares a local digest with the previous one. It stops if nothing meaningful changed. Adaptive model calls happen only after meaningful change, while manual **Look again** always requests a background refinement.

Chrome alarms are approximate: sleep may delay a check, and the missed check resumes after Chrome becomes active.

## Privacy boundary

Tabscope reads tab metadata, not page contents.

Stays on the device:

- raw URLs before sanitization and Chrome tab IDs;
- query parameters and fragments before they are stripped;
- current/previous reflections and compact 30-day portrait memory;
- user feedback and live-refresh settings.

May be sent to the configured model:

- redacted titles;
- normalized domains and sanitized path hints;
- synthetic window/group labels;
- pinned/active state and coarse age buckets;
- recent user corrections.

Never read:

- page contents;
- form inputs, messages, cookies, passwords, or keystrokes;
- browsing history outside the tabs currently open.

Sensitive query parameters, fragments, emails, obvious tokens, long opaque IDs, and secret-like values are removed before inference. OpenRouter requests deny provider data collection.

## Permissions

- `storage`: portrait memory, reflections, settings, and feedback.
- `alarms`: automatic 10/30/60-minute checks.
- `tabs` (optional): requested when the user creates the first portrait.
- `tabGroups` (optional): requested only when bringing a character’s tabs together.
- provider host access (optional): requested for the configured model endpoint.

There is no content script, browsing-history permission, or idle-time tracking.

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
3. Remove the older Tabscope build.
4. Click **Load unpacked** and select this repository’s `dist/` folder.
5. Confirm that the extension card shows version `0.2.0`.
6. Open a New Tab and click **Meet my browser** if permission has not already been granted.

## OpenRouter configuration

```dotenv
LLM_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=
LLM_MODEL=inclusionai/ling-3.0-flash-fin:free
```

A browser extension cannot protect an embedded API key. A key compiled into `dist/` is suitable only for private local testing. Public distribution should use a narrow authenticated proxy and must never ship a valuable upstream key.

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Key files:

```text
src/lib/portrait.ts                       character mapping and longitudinal portrait engine
src/lib/storage.ts                        compact 30-day browser memory
src/dashboard/components/PortraitView.tsx living New Tab portrait and feedback
src/background/index.ts                   automatic meaningful-change refresh
src/lib/privacy.ts                        title and URL sanitization boundary
```
