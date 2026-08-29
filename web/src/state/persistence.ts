// Storage persistence + usage estimate (LINGO-021): a hedge against Safari's
// evictable-storage eviction under storage pressure, or "clear website data",
// silently wiping IndexedDB with no way back. navigator.storage.persist()
// asks the browser to exempt this origin from that automatic eviction —
// support and grant behaviour are inconsistent across browsers (iOS Safari
// especially), so every function here degrades to "unknown" rather than
// throwing, and nothing in the app depends on the result to function
// correctly (the request is a hedge, not a requirement).

export interface StorageProtectionStatus {
  /** Does the browser expose the Storage API at all? */
  supported: boolean;
  /** true=granted, false=denied, null=unknown/unsupported. */
  persisted: boolean | null;
}

function storageApi(): StorageManager | null {
  if (typeof navigator === "undefined" || !("storage" in navigator)) return null;
  return navigator.storage;
}

/** Ask the browser to persist this origin's storage. Safe to call every
 * boot — a no-op if already granted, and never throws; unsupported/denied
 * both resolve to a status the UI can display. */
export async function requestStoragePersistence(): Promise<StorageProtectionStatus> {
  const storage = storageApi();
  if (!storage || typeof storage.persist !== "function") {
    return { supported: false, persisted: null };
  }
  try {
    const persisted = await storage.persist();
    return { supported: true, persisted };
  } catch {
    return { supported: true, persisted: null };
  }
}

/** Current persisted status without re-requesting — for Settings to display
 * on mount without re-prompting every time the screen opens. */
export async function currentStoragePersisted(): Promise<boolean | null> {
  const storage = storageApi();
  if (!storage || typeof storage.persisted !== "function") return null;
  try {
    return await storage.persisted();
  } catch {
    return null;
  }
}

export interface StorageEstimateInfo {
  usageBytes: number | null;
  quotaBytes: number | null;
}

export async function storageEstimate(): Promise<StorageEstimateInfo> {
  const storage = storageApi();
  if (!storage || typeof storage.estimate !== "function") {
    return { usageBytes: null, quotaBytes: null };
  }
  try {
    const { usage, quota } = await storage.estimate();
    return { usageBytes: usage ?? null, quotaBytes: quota ?? null };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
}

/** Human-readable byte count ("12.3 MB"), binary (1024-based) units — good
 * enough precision for a small Settings-screen display, not a precise
 * accounting figure. Returns null unchanged for a null input so callers can
 * render a placeholder without a separate null-check at every call site. */
export function formatBytes(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}
