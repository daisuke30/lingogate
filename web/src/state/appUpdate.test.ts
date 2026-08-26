import { describe, it, expect, afterEach, vi } from "vitest";

// LINGO-010 follow-up (2026-08-26 redesign, post black-screen incident): the
// SW auto-update flow now only ever applies a pending update at boot, at most
// once per tab session (sessionStorage-guarded — a JS variable can't survive
// the reload it causes, which is exactly what turned a real update into a
// reload loop last time; see appUpdate.ts's header comment for the full
// trace). These tests exercise that boot-time gate, the manual "最新版に更新"
// path, and hasPendingUpdate(), by stubbing the globals this module reads.
// vitest's environment is plain Node, so `navigator`/`location`/`sessionStorage`
// are stubbed via Object.defineProperty (Node already defines a read-only
// built-in `navigator`, so plain assignment throws).

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

function fakeSessionStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function makeWorker() {
  return {
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    state: "installing" as string,
  };
}

/** Minimal fake of `navigator.serviceWorker` — a real-enough EventTarget for
 * `addEventListener("controllerchange", fn, {once})` + a manual `_dispatch`
 * to simulate the browser firing it. */
function fakeServiceWorkerContainer(registration: any) {
  const listeners: Record<string, Array<{ fn: () => void; once?: boolean }>> = {};
  return {
    controller: {},
    register: vi.fn(async () => registration),
    getRegistration: vi.fn(async () => registration),
    addEventListener(type: string, fn: () => void, opts?: { once?: boolean }) {
      (listeners[type] ??= []).push({ fn, once: opts?.once });
    },
    removeEventListener() {
      /* not needed by these tests */
    },
    _dispatch(type: string) {
      const list = (listeners[type] ?? []).slice();
      listeners[type] = (listeners[type] ?? []).filter((l) => !l.once);
      for (const l of list) l.fn();
    },
  };
}

function makeRegistration(opts: { waiting?: any; installing?: any } = {}) {
  return {
    waiting: opts.waiting ?? null,
    installing: opts.installing ?? null,
    update: vi.fn(async () => undefined),
  };
}

describe("registerServiceWorkerAutoUpdate (boot-time, once per session)", () => {
  it("applies an already-waiting update and reloads once controllerchange fires", async () => {
    const reload = vi.fn();
    const restoreLocation = stubGlobal("location", { reload });
    const restoreStorage = stubGlobal("sessionStorage", fakeSessionStorage());
    const worker = makeWorker();
    const reg = makeRegistration({ waiting: worker });
    const sw = fakeServiceWorkerContainer(reg);
    const restoreNav = stubGlobal("navigator", { serviceWorker: sw });
    try {
      const mod = await freshModule();
      await mod.registerServiceWorkerAutoUpdate();

      expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
      expect(reload).not.toHaveBeenCalled(); // not yet — waits for controllerchange
      expect(reg.update).toHaveBeenCalledTimes(1); // background check still runs

      sw._dispatch("controllerchange");
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      restoreNav();
      restoreStorage();
      restoreLocation();
    }
  });

  it("never applies/reloads a second time in the same tab session, even if another update is found right after a simulated reload", async () => {
    const reload = vi.fn();
    const restoreLocation = stubGlobal("location", { reload });
    // Same sessionStorage instance across both phases — this is what "survives
    // the reload" actually means; a plain module-level flag could not.
    const storage = fakeSessionStorage();
    const restoreStorage = stubGlobal("sessionStorage", storage);
    try {
      // Phase 1: fresh module (page load), a worker is waiting -> applied.
      const worker1 = makeWorker();
      const reg1 = makeRegistration({ waiting: worker1 });
      const sw1 = fakeServiceWorkerContainer(reg1);
      let restoreNav = stubGlobal("navigator", { serviceWorker: sw1 });
      let mod = await freshModule();
      await mod.registerServiceWorkerAutoUpdate();
      sw1._dispatch("controllerchange");
      expect(reload).toHaveBeenCalledTimes(1);
      restoreNav();

      // Phase 2: simulates the reload — a brand new JS module instance (all
      // in-memory state gone) but the same sessionStorage. Even though a new
      // worker is *again* found waiting (plausible with rapid back-to-back
      // deploys — exactly what happened in the incident), it must not be
      // auto-applied or reloaded again this session.
      const worker2 = makeWorker();
      const reg2 = makeRegistration({ waiting: worker2 });
      const sw2 = fakeServiceWorkerContainer(reg2);
      restoreNav = stubGlobal("navigator", { serviceWorker: sw2 });
      mod = await freshModule();
      await mod.registerServiceWorkerAutoUpdate();

      expect(worker2.postMessage).not.toHaveBeenCalled();
      sw2._dispatch("controllerchange"); // even if this somehow fired, no reload should follow
      expect(reload).toHaveBeenCalledTimes(1); // unchanged from phase 1
      restoreNav();
    } finally {
      restoreStorage();
      restoreLocation();
    }
  });

  it("does nothing (no postMessage, no reload) when nothing is waiting, but still checks for updates in the background", async () => {
    const reload = vi.fn();
    const restoreLocation = stubGlobal("location", { reload });
    const restoreStorage = stubGlobal("sessionStorage", fakeSessionStorage());
    const reg = makeRegistration();
    const sw = fakeServiceWorkerContainer(reg);
    const restoreNav = stubGlobal("navigator", { serviceWorker: sw });
    try {
      const mod = await freshModule();
      await mod.registerServiceWorkerAutoUpdate();
      expect(reg.update).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      restoreNav();
      restoreStorage();
      restoreLocation();
    }
  });

  it("never throws even if register() rejects (defensive boot)", async () => {
    const restoreNav = stubGlobal("navigator", {
      serviceWorker: { register: vi.fn(async () => { throw new Error("boom"); }) },
    });
    try {
      const mod = await freshModule();
      await expect(mod.registerServiceWorkerAutoUpdate()).resolves.toBeUndefined();
    } finally {
      restoreNav();
    }
  });

  it("no-ops (does not throw) when serviceWorker is unsupported", async () => {
    const restoreNav = stubGlobal("navigator", {});
    try {
      const mod = await freshModule();
      await expect(mod.registerServiceWorkerAutoUpdate()).resolves.toBeUndefined();
    } finally {
      restoreNav();
    }
  });
});

describe("checkForUpdate() — manual '最新版に更新' button, always applies immediately", () => {
  afterEach(() => {
    delete (globalThis as any).navigator;
  });

  it("reports unsupported when there is no serviceWorker API", async () => {
    stubGlobal("navigator", {});
    const mod = await freshModule();
    expect(await mod.checkForUpdate()).toBe("unsupported");
  });

  it("reports unsupported when there is no active registration", async () => {
    stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn(async () => undefined) } });
    const mod = await freshModule();
    expect(await mod.checkForUpdate()).toBe("unsupported");
  });

  it("posts SKIP_WAITING and reloads on controllerchange when a worker is waiting", async () => {
    const reload = vi.fn();
    const restoreLocation = stubGlobal("location", { reload });
    const worker = makeWorker();
    const reg = makeRegistration({ waiting: worker });
    const sw = fakeServiceWorkerContainer(reg);
    stubGlobal("navigator", { serviceWorker: sw });
    try {
      const mod = await freshModule();
      expect(await mod.checkForUpdate()).toBe("updating");
      expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
      expect(reload).not.toHaveBeenCalled();
      sw._dispatch("controllerchange");
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      restoreLocation();
    }
  });

  it("waits for an installing worker to finish, then posts SKIP_WAITING", async () => {
    const worker = makeWorker();
    // An object property (rather than a bare `let`) sidesteps TS narrowing a
    // closure-assigned variable back to its initial `null` at the read site.
    const handlerRef: { current: (() => void) | null } = { current: null };
    worker.addEventListener = vi.fn((_type: string, fn: () => void) => {
      handlerRef.current = fn;
    }) as any;
    const reg = makeRegistration({ installing: worker });
    const sw = fakeServiceWorkerContainer(reg);
    stubGlobal("navigator", { serviceWorker: sw });
    const mod = await freshModule();
    expect(await mod.checkForUpdate()).toBe("updating");
    expect(worker.postMessage).not.toHaveBeenCalled(); // not yet — still installing
    worker.state = "installed";
    handlerRef.current?.();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("reports up-to-date when nothing is waiting or installing", async () => {
    const reg = makeRegistration();
    stubGlobal("navigator", { serviceWorker: fakeServiceWorkerContainer(reg) });
    const mod = await freshModule();
    expect(await mod.checkForUpdate()).toBe("up-to-date");
  });

  it("does not throw when update() rejects (offline)", async () => {
    const reg = makeRegistration();
    reg.update = vi.fn(async () => {
      throw new Error("offline");
    });
    stubGlobal("navigator", { serviceWorker: fakeServiceWorkerContainer(reg) });
    const mod = await freshModule();
    await expect(mod.checkForUpdate()).resolves.toBe("up-to-date");
  });
});

describe("hasPendingUpdate()", () => {
  afterEach(() => {
    delete (globalThis as any).navigator;
  });

  it("is false when there's no serviceWorker API", async () => {
    stubGlobal("navigator", {});
    const mod = await freshModule();
    expect(await mod.hasPendingUpdate()).toBe(false);
  });

  it("is true when a worker is waiting", async () => {
    const reg = makeRegistration({ waiting: makeWorker() });
    stubGlobal("navigator", { serviceWorker: fakeServiceWorkerContainer(reg) });
    const mod = await freshModule();
    expect(await mod.hasPendingUpdate()).toBe(true);
  });

  it("is true when a worker is installing", async () => {
    const reg = makeRegistration({ installing: makeWorker() });
    stubGlobal("navigator", { serviceWorker: fakeServiceWorkerContainer(reg) });
    const mod = await freshModule();
    expect(await mod.hasPendingUpdate()).toBe(true);
  });

  it("is false when nothing is pending", async () => {
    const reg = makeRegistration();
    stubGlobal("navigator", { serviceWorker: fakeServiceWorkerContainer(reg) });
    const mod = await freshModule();
    expect(await mod.hasPendingUpdate()).toBe(false);
  });
});
