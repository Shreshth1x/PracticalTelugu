import {
  getLiveFamilyVoiceLabel,
  type LiveFamilyVoice,
  type LiveVoiceMode,
} from "./live-config.ts";

export const LIVE_VOICE_MODE_REASONS = [
  "authorized",
  "not_configured",
  "signed_out",
  "not_allowlisted",
  "auth_unavailable",
] as const;

export type LiveVoiceModeReason =
  (typeof LIVE_VOICE_MODE_REASONS)[number];

export function isLiveVoiceModeReason(
  value: unknown,
): value is LiveVoiceModeReason {
  return LIVE_VOICE_MODE_REASONS.some((reason) => reason === value);
}

export function getLiveVoiceModeNotice({
  familyVoice,
  voiceMode,
  reason,
}: {
  familyVoice: LiveFamilyVoice;
  voiceMode: LiveVoiceMode;
  reason: LiveVoiceModeReason;
}) {
  if (voiceMode === "fish") return "";

  const selectedVoice = getLiveFamilyVoiceLabel(familyVoice);
  if (reason === "signed_out") {
    return `Sign in with the authorized account to use ${selectedVoice}. Mayu's backup voice is playing.`;
  }
  if (reason === "not_allowlisted") {
    return `This account cannot use ${selectedVoice}. Mayu's backup voice is playing.`;
  }
  if (reason === "auth_unavailable") {
    return `Private voice access could not be verified in time. Mayu's backup voice is playing.`;
  }
  if (reason === "not_configured") {
    return `${selectedVoice} is not configured in this deployment. Mayu's backup voice is playing.`;
  }

  return `Mayu's backup voice is playing.`;
}

export function getLiveVoiceFallbackNotice(
  familyVoice: LiveFamilyVoice,
  code?: unknown,
) {
  if (code === "fish_payment_required") {
    return `Fish Audio needs API credit before ${getLiveFamilyVoiceLabel(familyVoice)} can play. Mayu's backup voice is playing.`;
  }

  return `${getLiveFamilyVoiceLabel(familyVoice)} could not load this turn. Mayu's backup voice is playing.`;
}
