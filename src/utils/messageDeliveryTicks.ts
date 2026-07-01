/** WhatsApp-style delivery tick colors (matches ChatScreen). */
export const MESSAGE_TICK_COLORS = {
  unseen: '#54656F',
  read: '#53BDEB',
} as const;

export type OutgoingDeliveryState = 'sending' | 'sent' | 'delivered' | 'read';

/** Strict booleans — only explicit `true` counts; avoids undefined/null flicker. */
export function isMessageDelivered(message: { delivered?: boolean } | null | undefined): boolean {
  return message?.delivered === true;
}

export function isMessageSeen(message: { seen?: boolean } | null | undefined): boolean {
  return message?.seen === true;
}

export function normalizeOutgoingDeliveryFields<T extends Record<string, any>>(message: T): T {
  if (!message) return message;
  return {
    ...message,
    delivered: isMessageDelivered(message),
    seen: isMessageSeen(message),
  };
}

export function getOutgoingDeliveryState(message: {
  _pending?: boolean;
  delivered?: boolean;
  seen?: boolean;
} | null | undefined): OutgoingDeliveryState {
  if (!message) return 'sent';
  if (message._pending) return 'sending';
  if (isMessageSeen(message)) return 'read';
  if (isMessageDelivered(message)) return 'delivered';
  return 'sent';
}

export function getOutgoingDeliveryTicks(message: {
  _pending?: boolean;
  delivered?: boolean;
  seen?: boolean;
} | null | undefined): { ticks: string; color: string; state: OutgoingDeliveryState } {
  const state = getOutgoingDeliveryState(message);
  const ticks = state === 'sent' || state === 'sending' ? '✓' : '✓✓';
  const color = state === 'read' ? MESSAGE_TICK_COLORS.read : MESSAGE_TICK_COLORS.unseen;
  return { ticks, color, state };
}

export function isLastMessageFromUser(
  lastMessage: any,
  currentUserId?: string | null,
): boolean {
  if (!lastMessage || !currentUserId) return false;
  const senderId =
    lastMessage.sender?._id?.toString?.() ??
    lastMessage.sender?.toString?.() ??
    (lastMessage.sender != null ? String(lastMessage.sender) : '');
  return !!senderId && senderId === String(currentUserId);
}

/** Normalize list row lastMessage ticks from API (conservative defaults). */
export function normalizeConversationLastMessage(lastMessage: any) {
  if (!lastMessage) return lastMessage;
  return normalizeOutgoingDeliveryFields(lastMessage);
}
