import { phraseAudioByRecordingKey } from "./phrase-audio.generated.ts";
import { createRecordingKey } from "./phrase-recording-key.ts";

export function resolvePhraseAudioSrc(telugu: string) {
  return phraseAudioByRecordingKey[createRecordingKey(telugu)];
}
