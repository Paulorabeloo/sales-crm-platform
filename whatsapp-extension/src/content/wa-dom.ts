/**
 * WhatsApp Web adapter. ALL selectors live in WA_SELECTORS so DOM changes
 * (WhatsApp ships them often) are fixed in one place.
 *
 * Phone extraction strategy, in order:
 * 1. The conversation header title: when the contact is NOT saved in the
 *    agenda, WhatsApp shows the raw number there ("+55 63 99999-0001").
 * 2. Message row ids: rows carry data-id like "false_5563999990001@c.us_..."
 *    which contains the peer phone for individual chats. Group chats use
 *    "@g.us" and expose no personal phone.
 *
 * Known limitation (documented in the README): a saved contact in a chat
 * with no loaded messages exposes no phone anywhere in the DOM. The panel
 * then falls back to a manual phone input.
 */

import { looksLikePhone, normalizePhone, phoneFromWhatsAppId } from "../lib/phone";
import type { ConversationInfo, SurfaceAdapter } from "./adapter";
import { conversationKey } from "./adapter";

/** Every DOM selector this adapter relies on. Edit here when WhatsApp changes. */
export const WA_SELECTORS = {
  /** Root of the open conversation (absent when no chat is open). */
  main: "#main",
  /** Contact name (or raw phone) in the conversation header. */
  headerTitle: "#main header span[title]",
  /** Fallback header title without the title attribute. */
  headerTitleFallback: "#main header span[dir='auto']",
  /** Message rows carrying the peer id ("..._<phone>@c.us_..."). */
  messageRows: "#main [data-id]",
  /** Group id marker inside data-id values. */
  groupIdMarker: "@g.us",
};

const POLL_INTERVAL_MS = 1200;

function getHeaderTitle(): string | null {
  const titled = document.querySelector(WA_SELECTORS.headerTitle);
  const text = titled?.getAttribute("title") || titled?.textContent;
  if (text?.trim()) return text.trim();
  const fallback = document.querySelector(WA_SELECTORS.headerTitleFallback);
  return fallback?.textContent?.trim() || null;
}

function extractPhoneFromMessages(): { phone: string | null; isGroup: boolean } {
  const rows = document.querySelectorAll(WA_SELECTORS.messageRows);
  let sawGroup = false;
  for (const row of Array.from(rows)) {
    const dataId = row.getAttribute("data-id");
    if (!dataId) continue;
    if (dataId.includes(WA_SELECTORS.groupIdMarker)) {
      sawGroup = true;
      continue;
    }
    const phone = phoneFromWhatsAppId(dataId);
    if (phone) return { phone, isGroup: false };
  }
  return { phone: null, isGroup: sawGroup };
}

export const whatsAppAdapter: SurfaceAdapter = {
  surface: "whatsapp",

  detect(): boolean {
    return location.hostname === "web.whatsapp.com";
  },

  getOpenConversation(): ConversationInfo | null {
    if (!document.querySelector(WA_SELECTORS.main)) return null;
    const title = getHeaderTitle();
    const fromMessages = extractPhoneFromMessages();

    if (fromMessages.isGroup && !fromMessages.phone) {
      return { name: title, phone: null, isGroup: true };
    }

    let phone = fromMessages.phone;
    let name = title;
    if (!phone && looksLikePhone(title)) {
      // Unsaved contact: the header shows the number itself.
      phone = normalizePhone(title);
      name = null; // no real name available
    }
    return { name, phone, isGroup: false };
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
