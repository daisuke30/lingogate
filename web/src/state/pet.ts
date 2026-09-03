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

/** Load the current pet, creating (and persisting) generation 1 on first run. */
export async function loadPet(now: number = Date.now()): Promise<PetState> {
  const existing = await getPetState();
  if (existing) return existing;
  const pet = newPet(1, now);
  await putPetState(pet);
  return pet;
}

export function loadCollection(): Promise<PetCollection> {
  return getPetCollection();
}

/** Advance the pet to `now` and persist: writes the (possibly next-generation)
 * pet, folds hatch/evolve events into the 図鑑, and returns the fresh snapshot
 * plus what happened (so the UI can celebrate an evolution / 旅立ち). */
export async function tickPet(
  overdueCount: number,
  now: number = Date.now(),
): Promise<{ snapshot: PetSnapshot; events: PetEvent[] }> {
  const pet = await loadPet(now);
  const { pet: next, events } = tick(pet, { now, overdueCount });
  await putPetState(next);
  if (events.length > 0) {
    const collection = recordDiscoveriesFromEvents(await getPetCollection(), events);
    await putPetCollection(collection);
  }
  return { snapshot: petSnapshot(next, now, overdueCount), events };
}

/** 餌をあげる. Returns the updated snapshot. */
export async function feedPet(
  overdueCount: number,
  now: number = Date.now(),
): Promise<PetSnapshot> {
  const pet = await loadPet(now);
  const next = applyFeed(pet, now);
  await putPetState(next);
  return petSnapshot(next, now, overdueCount);
}

/** 掃除する. Returns the updated snapshot. */
export async function cleanPet(
  overdueCount: number,
  now: number = Date.now(),
): Promise<PetSnapshot> {
  const pet = await loadPet(now);
  const next = applyClean(pet, overdueCount, now);
  await putPetState(next);
  return petSnapshot(next, now, overdueCount);
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
