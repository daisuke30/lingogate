// Seedable, deterministic RNG (SplitMix64) — port of the Swift SeededRNG so a
// fixed seed reproduces an entire session's card order in tests. JS has no
// native u64, so state is a BigInt masked to 64 bits.

const MASK = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;

export class SeededRNG {
  private state: bigint;

  constructor(seed: bigint | number) {
    const s = BigInt(seed) & MASK;
    this.state = s === 0n ? GOLDEN : s;
  }

  next(): bigint {
    this.state = (this.state + GOLDEN) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return (z ^ (z >> 31n)) & MASK;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return Number(this.next() >> 11n) / Number(1n << 53n);
  }

  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Number(this.next() % BigInt(i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }
}
