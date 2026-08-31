# CRM Lead Capture Chrome extension

Chrome extension (Manifest V3, TypeScript + esbuild) that captures WhatsApp Web
leads straight into the Sales CRM. It injects a collapsible side panel on
`web.whatsapp.com`: when a conversation is open it looks the phone up in the
CRM and shows the lead card (stage, owner, next contact, last activities,
quick-log actions, message templates) or a one-click "create lead" form.

A second surface (any other web-based inbox) is prepared as a structured
adapter stub; see [Custom inbox adapter](#custom-inbox-adapter-stub).

## Setup

Prerequisites: Node.js 18+, the CRM API running (default
`http://127.0.0.1:8000`).

```bash
cd whatsapp-extension
npm install
npm run build        # bundles into dist/
```

Load in Chrome:

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" ("Carregar sem compactação") and select the `dist/` folder
4. Pin the extension and click its icon to log in with your CRM credentials

Backend configuration (once, in `03-backend/.env`):

- `EXTENSION_ORIGINS=chrome-extension://<your-extension-id>` where the id is
  shown on the extension card in `chrome://extensions`. This is a CORS
  allowlist; it is only needed if you point the extension at an API host NOT
  listed in `manifest.json` `host_permissions` (requests from the extension's
  background worker to hosts in `host_permissions` bypass CORS).
- `EXTENSION_ACCESS_TOKEN_EXPIRE_HOURS=12` (default) controls the extension
  session length.

Restart the API after changing `.env`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Bundle `src/` into `dist/` (the folder Chrome loads) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Unit tests (vitest): phone parser + template renderer |

After changing code: `npm run build`, then click the reload icon on the
extension card in `chrome://extensions`.

## How auth works

- Login happens in the popup and calls `POST /auth/login?client=extension`,
  which issues a single access token with a 12h TTL and NO refresh cookie
  (the SPA's httpOnly refresh cookie does not flow reliably in extension
  contexts, and persisting a rotating refresh token in extension storage
  would just create a second long-lived bearer secret).
- The token lives in `chrome.storage.session`: memory-backed, cleared when
  the browser closes, not readable by web pages. Expect to log in again after
  a browser restart or after 12h.
- All API calls are proxied through the background service worker; content
  scripts never hold the token.

## Architecture

```
src/
  background.ts          service worker: auth session + API proxy (fetch)
  lib/
    api.ts               typed client used by popup and content scripts
    messages.ts          message protocol content/popup <-> background
    phone.ts             E.164 normalization (mirrors backend rules) + helpers
    template.ts          {{variable}} rendering for message templates
    strings.ts           ALL pt-BR UI strings + activity labels
    types.ts             API response shapes
  content/
    adapter.ts           SurfaceAdapter interface ({name, phone} extraction)
    wa-dom.ts            WhatsApp Web adapter (selectors in WA_SELECTORS)
    custom-inbox-dom.ts  second-surface adapter (stub, INBOX_CONFIG)
    panel.ts             side panel UI (shadow DOM, no framework)
    content.ts           entry: picks adapter, orchestrates lookup flow
  popup/
    popup.html/.ts       login + API/CRM URL settings
```

The panel is surface-agnostic: each surface only implements
`detect()`, `getOpenConversation()` and `onConversationChange()`. Retiring a
surface means deleting one adapter file.

## Phone extraction on WhatsApp Web (and its limits)

Strategy, in order:

1. Conversation header title: unsaved contacts show the raw number there.
2. Message row `data-id` attributes (`..._5563999990001@c.us_...`) carry the
   peer phone for individual chats.

Known limitations (by design of WhatsApp's DOM):

- Group chats (`@g.us`) expose no personal phone; the panel shows a notice
  and disables capture.
- A SAVED contact in a conversation with no message rows loaded may expose no
  phone anywhere. The panel then falls back to a manual phone input in the
  create-lead form.
- WhatsApp ships DOM changes often. Every selector lives in `WA_SELECTORS`
  at the top of `src/content/wa-dom.ts`; fix them there when extraction breaks.

## Custom inbox adapter (stub)

Teams rarely live on WhatsApp Web alone. The second adapter ships as a
configured-off stub so it can be pointed at any web-based inbox without
touching the panel. To activate:

1. Log into the inbox and note the hostname of the web app.
2. Open a conversation, hit F12 and find stable selectors for: an element
   that only exists with a chat open, the contact name element, and the
   element holding the phone (text or attribute).
3. Fill `INBOX_CONFIG` in `src/content/custom-inbox-dom.ts` (hostnames +
   selectors; set `phoneAttribute` if the phone lives in an attribute).
4. Add the domain to `manifest.json`:
   - `content_scripts[0].matches`: add `"https://<domain>/*"`
   - `host_permissions`: add `"https://<domain>/*"`
5. `npm run build` and reload the extension.

Tip for step 2: contact phones often appear in `href` attributes
(`wa.me/55...`, `tel:+55...`) or in the conversation header subtitle.

## Manual test checklist

Prerequisites: API running with seeds, extension loaded, WhatsApp Web logged
in with a few conversations.

Auth
- [ ] Popup: wrong password shows "E-mail ou senha incorretos."
- [ ] Popup: correct login shows name/email; panel on WhatsApp Web leaves the
      "not logged in" state after switching conversations (or reloading)
- [ ] Logout in the popup makes the panel ask for login again

Conversation detection
- [ ] Opening a conversation with an UNSAVED contact (number as title) shows
      the lookup result within ~2s
- [ ] Opening a conversation with a SAVED contact that has messages loaded
      extracts the phone from the message rows
- [ ] A group conversation shows "captura de lead indisponivel"
- [ ] Switching between conversations updates the panel

Lead found
- [ ] Existing contact shows: name, phone, stage name, owner, next contact,
      last 3 activities, templates
- [ ] The 4 quick-log buttons create the activity (check the CRM timeline);
      "Visita agendada" requires the date and creates the Visit task
- [ ] "Agendar proximo contato" sets next_contact_at (visible in the CRM)
- [ ] "Registrar 1o contato" works once, then shows the timestamp
- [ ] "Abrir no CRM" opens the deal page (CRM URL configurable in the popup)

Lead not found
- [ ] "+ Criar lead" form: name prefilled from the conversation, unit select
      populated from GET /units
- [ ] Creating generates contact + deal (owner = logged user, source
      whatsapp, course into enrollment_data.interest_course) and the panel
      flips to the lead card
- [ ] Creating with a phone that already exists (409 duplicate_phone) loads
      the existing lead instead of duplicating

Templates
- [ ] Variables are rendered ({{first_name}}, {{course}}, {{unit}},
      {{consultant}}); missing values become empty, never the literal tag
- [ ] "Copiar" puts the rendered text on the clipboard

Session
- [ ] After browser restart the extension asks for login again (session
      storage is cleared by design)

## What was validated without a WhatsApp account

- `tsc --noEmit`, vitest (25 tests) and the esbuild bundle are clean.
- The panel UI (lead card and create form) was rendered in a real browser
  against a simulated host page: no console errors, all sections visible.
- The extension auth flow was exercised against the live API
  (`?client=extension` returns a 12h token, no cookie, `/auth/me` accepts it).
- WhatsApp Web blocks non-Chrome user agents in the harness browser, so
  content-script injection on the real page needs the manual checklist above.
