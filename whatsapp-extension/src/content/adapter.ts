/**
 * Surface adapter contract. The side panel is surface-agnostic: each
 * messaging surface (WhatsApp Web, a custom inbox) implements this interface
 * and only extracts {name, phone} from the open conversation. Retiring a
 * surface later means deleting one adapter file, nothing else.
 */

export interface ConversationInfo {
  /** Contact display name as shown by the surface (may be the raw phone). */
  name: string | null;
  /** Phone normalized to E.164 (+55...), or null when not extractable. */
  phone: string | null;
  /** True when the open chat is a group (lead capture disabled). */
  isGroup: boolean;
}

export interface SurfaceAdapter {
  readonly surface: "whatsapp" | "custom-inbox";
  /** Whether this adapter handles the current page. */
  detect(): boolean;
  /** Extract the currently open conversation, or null when none is open. */
  getOpenConversation(): ConversationInfo | null;
  /**
   * Subscribe to conversation changes. The callback fires with the new
   * conversation (or null) whenever the open chat changes. Returns an
   * unsubscribe function.
   */
  onConversationChange(callback: (conversation: ConversationInfo | null) => void): () => void;
}

/** Stable identity key used to detect conversation switches. */
export function conversationKey(conversation: ConversationInfo | null): string {
  if (!conversation) return "";
  return `${conversation.phone ?? ""}|${conversation.name ?? ""}|${conversation.isGroup}`;
}
