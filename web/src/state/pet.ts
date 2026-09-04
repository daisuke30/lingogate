// Pet wiring (LINGO-029): the thin async layer between the pure pet engine
// (pet/engine.ts) and IndexedDB (db/idb.ts). Mirrors state/service.ts's shape —
// the React layer (LINGO-030 育成 tab) and the session hook (LINGO-031) talk
// only to this module, never to the engine or db directly.
//
// Time is injected at every entry point (default Date.now()) so callers can pass
// a fixed clock; all growth logic stays in the pure engine, this file only
// loads → applies → persists. The overdue-review count that drives poop/care is
// passed IN by the caller (computed from ContentStore on the state/service side,
// per the design's dependency-injection rule) — this module never imports the
// content store, keeping the pet independent of course/deck loading.

import {
  newPet,
  tick,
  applyFeed,
  applyClean,
  applySession,
  petSnapshot,
  recordDiscoveriesFromEvents,
  migrateLegacyPet,
} from "../pet/engine";
import type {
  PetState,
  PetCollection,
  PetEarnings,
  PetEvent,
  PetSnapshot,
  PetSettings,
} from "../pet/engine";
import {
  getPetState,
  putPetState,
  getPetCollection,
  putPetCollection,
  getMeta,
  setMeta,
} from "../db/idb";

/** Load the current pet, creating (and persisting) generation 1 on first run.
 *
 * `overdueCountForMigration` is ONLY consulted for the one-time v2 (LINGO-029
 * poop-stock overhaul, 2026-09-05) backfill below — a pet persisted before
 * poopCount/poopAccruedAt existed gets seeded from whatever overdue count the
 * caller currently has (clamped to MAX_POOP), matching the coordinator's
 * "現在のoverdueから算出した値" migration spec. Callers with no overdue figure
 * handy (e.g. a bare loadPet() from a screen that already ticked) just pass 0,
 * which is harmless — real pets almost always hit this path via tickPet()
 * first, which does have the figure. */
export async function loadPet(
  now: number = Date.now(),
  overdueCountForMigration = 0,
): Promise<PetState> {
  const existing = await getPetState();
  if (!existing) {
    const pet = newPet(1, now);
    await putPetState(pet);
    return pet;
  }
  const migrated = migrateLegacyPet(existing, now, overdueCountForMigration);
  if (migrated !== existing) await putPetState(migrated);
  return migrated;
}

export function loadCollection(): Promise<PetCollection> {
  return getPetCollection();
}

/** Read-only glance at the pet — e.g. Home's mini status (LINGO-031). Loads
 * but does NOT advance the pet (no tick()): satiety is still live (continuous
 * decay), but poop (v2, 2026-09-05) is a discrete stock that only grows via
 * tick()'s accrual catch-up — this shows the last-ticked value, same as any
 * real Tamagotchi-style widget that isn't the main screen. No risk of a
 * hatch/evolve/depart side effect firing from a screen that isn't the 育成 tab
 * (only PetView's own tickPet() call does that). `overdueCount` is kept as a
 * parameter solely to feed the one-time legacy-pet migration in loadPet(). */
export async function peekPet(
  overdueCount: number,
  now: number = Date.now(),
): Promise<PetSnapshot> {
  const pet = await loadPet(now, overdueCount);
  return petSnapshot(pet, now);
}

/** Advance the pet to `now` and persist: catches the poop stock up (the only
 * thing that actually consumes overdueCount now — see pet/engine.ts's
 * advancePoop), writes the (possibly next-generation) pet, folds hatch/evolve
 * events into the 図鑑, and returns the fresh snapshot plus what happened (so
 * the UI can celebrate an evolution / 旅立ち). */
export async function tickPet(
  overdueCount: number,
  now: number = Date.now(),
): Promise<{ snapshot: PetSnapshot; events: PetEvent[] }> {
  const pet = await loadPet(now, overdueCount);
  const { pet: next, events } = tick(pet, { now, overdueCount });
  await putPetState(next);
  if (events.length > 0) {
    const collection = recordDiscoveriesFromEvents(await getPetCollection(), events);
    await putPetCollection(collection);
  }
  return { snapshot: petSnapshot(next, now), events };
}

/** 餌をあげる. Returns the updated snapshot. `overdueCount` is only used for
 * the legacy-pet migration in loadPet() (see its doc comment) — feeding
 * itself has never depended on it. */
export async function feedPet(
  overdueCount: number,
  now: number = Date.now(),
): Promise<PetSnapshot> {
  const pet = await loadPet(now, overdueCount);
  const next = applyFeed(pet, now);
  await putPetState(next);
  return petSnapshot(next, now);
}

/** 掃除する: deletes exactly one うんこ from the stock per 掃除P spent (design
 * §1 v2, 2026-09-05 — fixes the earlier "掃除ボタンが壊れている" bug, where
 * poop was derived live from overdueCount so spending 掃除P never visibly did
 * anything). Returns the updated snapshot. `overdueCount` is only used for the
 * legacy-pet migration in loadPet(). */
export async function cleanPet(
  overdueCount: number,
  now: number = Date.now(),
): Promise<PetSnapshot> {
  const pet = await loadPet(now, overdueCount);
  const next = applyClean(pet);
  await putPetState(next);
  return petSnapshot(next, now);
}

/** Session-commit hook for LINGO-031: adds 餌/掃除P, marks today studied, and
 * advances the study streak. Call from state/service.ts commitSession with the
 * session's { newCount, reviewCount }. Returns the earnings for the summary. */
export async function commitSessionToPet(
  input: { newCount: number; reviewCount: number },
  now: number = Date.now(),
): Promise<PetEarnings> {
  const pet = await loadPet(now);
  const { pet: next, earned } = applySession(pet, input, now);
  await putPetState(next);
  return earned;
}

/** The current pet's user-given name, or null when unnamed (UI then shows the
 * art-catalog default). Names are per generation — each new egg starts unnamed
 * — and live in the generic `meta` KV store, so the engine's PetState (a fixed
 * LINGO-029 contract) stays untouched. */
export function getPetName(generation: number): Promise<string | null> {
  return getMeta<string | null>(`pet.name.${generation}`, null);
}

export function setPetName(generation: number, name: string): Promise<void> {
  return setMeta(`pet.name.${generation}`, name);
}

/** Update the pet's settings (e.g. the hard-mode 旅立ち/死亡 toggle). */
export async function setPetSettings(
  settings: PetSettings,
  now: number = Date.now(),
): Promise<PetState> {
  const pet = await loadPet(now);
  const next = { ...pet, settings };
  await putPetState(next);
  return next;
}
