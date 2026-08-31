/**
 * the configured inbox adapter: STRUCTURED STUB.
 *
 * The real the configured inbox domain and DOM were not available on this machine
 * when the extension was built. To activate this surface:
 *
 * 1. Log into the configured inbox and note the hostname (e.g. "app.customInbox.com"
 *    or a tenant subdomain). Add it to INBOX_CONFIG.hostnames below.
 * 2. Open a conversation, inspect the DOM (F12) and fill INBOX_CONFIG.selectors:
 *    - conversationRoot: an element that only exists with a chat open
 *    - contactName: the element whose textContent is the contact name
 *    - contactPhone: the element whose textContent/attribute holds the phone
 *      (phoneAttribute: null reads textContent; otherwise the attribute name)
 * 3. Add the domain to manifest.json:
 *    - content_scripts[0].matches: "https://<domain>/*"
 *    - host_permissions: "https://<domain>/*"
 * 4. Rebuild (npm run build) and reload the extension.
 *
 * Full step-by-step instructions live in the README (section "the configured inbox").
 */

import { normalizePhone } from "../lib/phone";
import type { ConversationInfo, SurfaceAdapter } from "./adapter";
import { conversationKey } from "./adapter";

export const INBOX_CONFIG = {
  /** Hostnames where the configured inbox runs. Empty = adapter never activates. */
  hostnames: [] as string[],
  selectors: {
    /** Element present only when a conversation is open. */
    conversationRoot: "",
    /** Element containing the contact's display name. */
    contactName: "",
    /** Element containing the contact's phone. */
    contactPhone: "",
    /** Attribute to read the phone from; null = use textContent. */
    phoneAttribute: null as string | null,
  },
};

const POLL_INTERVAL_MS = 1200;
let warned = false;

function isConfigured(): boolean {
  return Boolean(
    INBOX_CONFIG.selectors.conversationRoot &&
      INBOX_CONFIG.selectors.contactName &&
      INBOX_CONFIG.selectors.contactPhone,
  );
}

export const customInboxAdapter: SurfaceAdapter = {
  surface: "custom-inbox",

  detect(): boolean {
    return INBOX_CONFIG.hostnames.includes(location.hostname);
  },

  getOpenConversation(): ConversationInfo | null {
    if (!isConfigured()) {
      if (!warned) {
        warned = true;
        console.warn(
          "[CRM Lead Capture] the configured inbox adapter is not configured yet. " +
            "Fill INBOX_CONFIG in src/content/customInbox-dom.ts (see README).",
        );
      }
      return null;
    }
    const root = document.querySelector(INBOX_CONFIG.selectors.conversationRoot);
    if (!root) return null;

    const nameEl = document.querySelector(INBOX_CONFIG.selectors.contactName);
    const phoneEl = document.querySelector(INBOX_CONFIG.selectors.contactPhone);
    const name = nameEl?.textContent?.trim() || null;
    const rawPhone = INBOX_CONFIG.selectors.phoneAttribute
      ? phoneEl?.getAttribute(INBOX_CONFIG.selectors.phoneAttribute)
      : phoneEl?.textContent;
    return { name, phone: normalizePhone(rawPhone?.trim() ?? null), isGroup: false };
  },

  onConversationChange(callback): () => void {
    let lastKey = conversationKey(this.getOpenConversation());
    const timer = window.setInterval(() => {
      const conversation = this.getOpenConversation();
      const key = conversationKey(conversation);
      if (key !== lastKey) {
        lastKey = key;
        callback(conversation);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  },
};
