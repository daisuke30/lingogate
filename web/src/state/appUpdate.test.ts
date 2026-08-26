import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// LINGO-010 follow-up (2026-08-26): auto-update flow for a stuck old service
// worker. These tests exercise the pure logic in state/appUpdate.ts —
// quiz-active reload gating, the single-reload guard, and checkForUpdate()'s
// branching — by stubbing the global `navigator`/`location` this module reads.
// Node (vitest's default environment) already defines a read-only built-in
// `navigator` global, so plain assignment throws; Object.defineProperty
// overrides it and restores the original afterwards.
//
// Each test re-imports the module fresh (vi.resetModules) since it keeps
// module-level state (quizActive/reloadPending/reloaded) that must not leak
// between cases.

async function freshModule() {
  vi.resetModules();
  return import("./appUpdate");
}

function stubGlobal(name: string, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete (globalThis as any)[name];
  };
}

describe("appUpdate: reload gating (never mid-quiz, never twice)", () => {
  let reload: ReturnType<typeof vi.fn>;
  let restoreLocation: () => void;

  beforeEach(() => {
    reload = vi.fn();
    restoreLocation = stubGlobal("location", { reload });
  });

  afterEach(() => {
    restoreLocation();
  });

  it("reloads immediately when no quiz is active", async () => {
    const mod = await freshModule();
    mod.requestReloadForUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("defers the reload while a quiz is active, then fires it once the quiz ends", async () => {
    const mod = await freshModule();
    mod.setQuizActive(true);
    mod.requestReloadForUpdate();
    expect(reload).not.toHaveBeenCalled();
    mod.setQuizActive(false); // quiz screen unmounts -> deferred reload runs
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads a second time even if requested again", async () => {
    const mod = await freshModule();
    mod.requestReloadForUpdate();
    mod.requestReloadForUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("toggling quiz-active off with nothing pending does not reload", async () => {
    const mod = await freshModule();
    mod.setQuizActive(true);
    mod.setQuizActive(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("appUpdate: checkForUpdate()", () => {
  let restoreNavigator: () => void;

  afterEach(() => {
    restoreNavigator?.();
  });

  it("reports unsupported when the browser has no serviceWorker API", async () => {
    restoreNavigator = stubGlobal("navigator", {});
    const mod = await freshModule();
    expect(await mod.checkForUpdate()).toBe("unsupported");
  });

  it("reports unsupported when there is no active registration", async () => {
    restoreNavigator = stubGlobal("navigator", {
      serviceWorker: { getRegistration: vi.fn(async () => undefined) },
    });
    const mod = await freshModule();
    expect(await mod.checkForUpdate()).toBe("unsupported");
  });

  it("posts SKIP_WAITING and reports 'updating' when a new worker is already waiting", async () => {
    const postMessage = vi.fn();
    const update = vi.fn(async () => undefined);
    restoreNavigator = stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({ update, waiting: { postMessage }, installing: null })),
      },
    });
    const mod = await freshModule();
    expect(await mod.checkForUpdate()).toBe("updating");
    expect(update).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("reports 'updating' (no postMessage) when a worker is still installing", async () => {
    const update = vi.fn(async () => undefined);
    restoreNavigator = stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({ update, waiting: null, installing: {} })),
      },
    });
    const mod = await freshModule();
    expect(await mod.checkForUpdate()).toBe("updating");
  });

  it("reports 'up-to-date' when nothing is waiting or installing", async () => {
    const update = vi.fn(async () => undefined);
    restoreNavigator = stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({ update, waiting: null, installing: null })),
      },
    });
    const mod = await freshModule();
    expect(await mod.checkForUpdate()).toBe("up-to-date");
  });

  it("does not throw when update() rejects (offline) — falls back to current waiting/installing state", async () => {
    const update = vi.fn(async () => {
      throw new Error("offline");
    });
    restoreNavigator = stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({ update, waiting: null, installing: null })),
      },
    });
    const mod = await freshModule();
    await expect(mod.checkForUpdate()).resolves.toBe("up-to-date");
  });
});
