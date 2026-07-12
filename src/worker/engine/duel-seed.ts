export type DuelSeed = readonly [bigint, bigint, bigint, bigint];
export type RandomSeedSource = () => readonly bigint[];

export function createProductionSeed(
  randomWords: RandomSeedSource = () => [
    ...crypto.getRandomValues(new BigUint64Array(4)),
  ],
): DuelSeed {
  const words: bigint[] = [...randomWords()];
  const normalized = words.every((word) => word === 0n)
    ? [1n, 0n, 0n, 0n]
    : words;
  return [
    normalized[0] ?? 1n,
    normalized[1] ?? 0n,
    normalized[2] ?? 0n,
    normalized[3] ?? 0n,
  ];
}

export function validateProgrammedSeed(seed: DuelSeed): DuelSeed {
  if (seed.every((word) => word === 0n))
    throw new Error("A duel seed cannot contain four zero words");
  return seed;
}
