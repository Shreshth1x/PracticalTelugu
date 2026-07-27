export function phraseKey(word) {
  return `${word.telugu}::${word.english}`;
}

export function resolvePracticePath(packs, confidence) {
  if (!packs.length) {
    return {
      packIndex: 0,
      phraseIndex: 0,
      completedInPack: 0,
      completedPacks: 0,
      allComplete: true,
    };
  }

  const completedPacks = packs.filter((pack) =>
    pack.words.every((word) => Boolean(confidence[phraseKey(word)])),
  ).length;
  const packIndex = packs.findIndex((pack) =>
    pack.words.some((word) => !confidence[phraseKey(word)]),
  );

  if (packIndex === -1) {
    return {
      packIndex: 0,
      phraseIndex: 0,
      completedInPack: packs[0].words.length,
      completedPacks,
      allComplete: true,
    };
  }

  const pack = packs[packIndex];
  const phraseIndex = pack.words.findIndex(
    (word) => !confidence[phraseKey(word)],
  );

  return {
    packIndex,
    phraseIndex,
    completedInPack: pack.words.filter((word) =>
      Boolean(confidence[phraseKey(word)]),
    ).length,
    completedPacks,
    allComplete: false,
  };
}
