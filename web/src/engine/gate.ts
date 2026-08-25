// Pure gate-flow helpers for the automationOnly web flow (there is no shield on
// the web — that is the iOS-only capability temporarily set aside). After a gate
// is completed the target app is "suppressed" for the unlock window: re-opening
// /gate?return=<app> within the window skips the quiz and returns immediately.
// Mirrors GateState.setAutomationSuppress / isAutomationSuppressed.

const MINUTE_MS = 60_000;

/** Timestamp until which `appKey` should skip the quiz, given an unlock window. */
export function suppressUntil(now: number, unlockMinutes: number): number {
  return now + unlockMinutes * MINUTE_MS;
}

/** True if `until` is set and we are still inside the suppression window. */
export function isSuppressed(until: number | null | undefined, now: number): boolean {
  return until != null && now < until;
}

/** Return-app scheme map — the web counterpart of iOS ReturnAppMap. First
 * candidate is tried first. Keys/schemes match the iOS table. */
export interface ReturnTarget {
  key: string;
  displayName: string;
  urlCandidates: string[];
}

export const RETURN_TARGETS: ReturnTarget[] = [
  { key: "tiktok", displayName: "TikTok", urlCandidates: ["tiktok://", "snssdk1233://"] },
  { key: "youtube", displayName: "YouTube", urlCandidates: ["youtube://", "vnd.youtube://"] },
  { key: "twitter", displayName: "X (Twitter)", urlCandidates: ["twitter://"] },
  { key: "x", displayName: "X (Twitter)", urlCandidates: ["twitter://"] },
  { key: "instagram", displayName: "Instagram", urlCandidates: ["instagram://"] },
  { key: "facebook", displayName: "Facebook", urlCandidates: ["fb://"] },
  { key: "reddit", displayName: "Reddit", urlCandidates: ["reddit://"] },
  { key: "vk", displayName: "VK", urlCandidates: ["vk://"] },
  { key: "telegram", displayName: "Telegram", urlCandidates: ["tg://", "telegram://"] },
  { key: "whatsapp", displayName: "WhatsApp", urlCandidates: ["whatsapp://"] },
];

export function returnTarget(key: string): ReturnTarget | undefined {
  const k = key.toLowerCase();
  return RETURN_TARGETS.find((t) => t.key === k);
}

export function returnDisplayName(key: string): string {
  return returnTarget(key)?.displayName ?? key;
}
