export function normalizeSpokenText(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function stableTextHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function createRecordingKey(telugu: string) {
  return `phrase-${stableTextHash(normalizeSpokenText(telugu))}`;
}
