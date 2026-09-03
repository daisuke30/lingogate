import { describe, it, expect } from "vitest";
import { ensureStores } from "./idb";

// LINGO-029: the v2→v3 upgrade is additive-only — it must add exactly the two
// pet stores and never re-create (or touch) the four pre-existing ones. Tested
// against a mock IDBDatabase (the test env is `node`, no real IndexedDB) so the
// upgrade logic is verifiable without a browser.
function mockDb(existing: string[]) {
  const names = new Set(existing);
  const created: { name: string; opts?: IDBObjectStoreParameters }[] = [];
  return {
    created,
    objectStoreNames: { contains: (n: string) => names.has(n) },
    createObjectStore(name: string, opts?: IDBObjectStoreParameters) {
      created.push({ name, opts });
      names.add(name);
      return {};
    },
  };
}

describe("ensureStores (idb v3 migration, LINGO-029)", () => {
  it("v2 → v3 adds only the pet stores, touching nothing existing", () => {
    const db = mockDb(["reviewStates", "gateSessions", "meta", "wordKnowledge"]);
    ensureStores(db);
    expect(db.created.map((c) => c.name)).toEqual(["petState", "petCollection"]);
  });

  it("a fresh (v0) DB creates the full six-store schema in one pass", () => {
    const db = mockDb([]);
    ensureStores(db);
    expect(db.created.map((c) => c.name)).toEqual([
      "reviewStates",
      "gateSessions",
      "meta",
      "wordKnowledge",
      "petState",
      "petCollection",
    ]);
  });

  it("uses the agreed keyPaths for the pet stores", () => {
    const db = mockDb(["reviewStates", "gateSessions", "meta", "wordKnowledge"]);
    ensureStores(db);
    const byName = Object.fromEntries(db.created.map((c) => [c.name, c.opts]));
    expect(byName.petState).toEqual({ keyPath: "key" });
    expect(byName.petCollection).toEqual({ keyPath: "speciesId" });
  });

  it("is idempotent — re-running on the full schema creates nothing", () => {
    const db = mockDb([
      "reviewStates",
      "gateSessions",
      "meta",
      "wordKnowledge",
      "petState",
      "petCollection",
    ]);
    ensureStores(db);
    expect(db.created).toHaveLength(0);
  });
});
