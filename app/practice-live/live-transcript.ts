export type LiveTranscriptSpeaker = "you" | "mayu";
export type LiveTranscriptSource = "telugu" | "english" | "mixed";

export type LiveTranscriptTurn = {
  id: string;
  speaker: LiveTranscriptSpeaker;
  roman: string;
  pronunciation?: string;
  english: string;
  final: boolean;
  cueId?: string;
  sourceLanguage?: LiveTranscriptSource;
};

export type LiveCaptionTurn = {
  roman: string;
  pronunciation?: string;
  english: string;
  cueId?: string;
  sourceLanguage?: LiveTranscriptSource;
};

export type ParsedLiveTurnToolCall = {
  mayu: LiveCaptionTurn;
  learner: LiveCaptionTurn | null;
  replay: boolean;
};

const TELUGU_SCRIPT = /[\u0c00-\u0c7f]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{Letter}/u;
const MAX_CAPTION_LENGTH = 420;

function cleanCaptionText(value: unknown) {
  if (typeof value !== "string") return "";

  const cleaned = value.replace(/\s+/g, " ").trim();
  if (
    !cleaned ||
    cleaned.length > MAX_CAPTION_LENGTH ||
    TELUGU_SCRIPT.test(cleaned) ||
    NON_LATIN_LETTER.test(cleaned) ||
    !LATIN_LETTER.test(cleaned)
  ) {
    return "";
  }

  return cleaned;
}

function cleanInternalTelugu(value: unknown) {
  if (typeof value !== "string") return "";

  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned &&
    cleaned.length <= MAX_CAPTION_LENGTH &&
    TELUGU_SCRIPT.test(cleaned)
    ? cleaned
    : "";
}

function sourceLanguage(value: unknown): LiveTranscriptSource {
  return value === "english" || value === "mixed" ? value : "telugu";
}

/**
 * Accepts only display-safe Latin Telugu and English. Gemini may use Telugu
 * script internally for speech accuracy, but it can never cross this boundary
 * into the learner-facing transcript.
 */
export function parseLiveTurnToolCall(
  value: unknown,
): ParsedLiveTurnToolCall | null {
  if (!value || typeof value !== "object") return null;
  const args = value as Record<string, unknown>;

  const mayuTeluguInternal = cleanInternalTelugu(args.mayuTeluguInternal);
  const mayuRoman = cleanCaptionText(args.mayuRoman);
  const mayuPronunciation = cleanCaptionText(args.mayuPronunciation);
  const mayuEnglish = cleanCaptionText(args.mayuEnglish);
  if (
    !mayuTeluguInternal ||
    !mayuRoman ||
    !mayuPronunciation ||
    !mayuEnglish
  ) {
    return null;
  }

  const rawCueId =
    typeof args.cueId === "string" && args.cueId.trim()
      ? args.cueId.trim()
      : undefined;
  const learnerRoman = cleanCaptionText(args.learnerRoman);
  const learnerPronunciation = cleanCaptionText(args.learnerPronunciation);
  const learnerEnglish = cleanCaptionText(args.learnerEnglish);
  const learnerTeluguInternal = cleanInternalTelugu(
    args.learnerTeluguInternal,
  );
  const suppliedLearnerTeluguInternal =
    typeof args.learnerTeluguInternal === "string" &&
    Boolean(args.learnerTeluguInternal.trim());
  const hasAnyLearnerCaption = Boolean(
    learnerRoman || learnerPronunciation || learnerEnglish,
  );

  if (
    (suppliedLearnerTeluguInternal && !learnerTeluguInternal) ||
    hasAnyLearnerCaption &&
    (!learnerRoman ||
      !learnerPronunciation ||
      !learnerEnglish)
  ) {
    return null;
  }

  return {
    mayu: {
      roman: mayuRoman,
      pronunciation: mayuPronunciation,
      english: mayuEnglish,
      cueId: rawCueId,
      sourceLanguage: "telugu",
    },
    learner: hasAnyLearnerCaption
      ? {
          roman: learnerRoman,
          pronunciation: learnerPronunciation,
          english: learnerEnglish,
          sourceLanguage: sourceLanguage(args.learnerSourceLanguage),
        }
      : null,
    replay: args.replay === true,
  };
}

export function beginPendingLearnerTurn(
  turns: LiveTranscriptTurn[],
  id: string,
) {
  const latest = turns.at(-1);
  if (latest?.speaker === "you" && !latest.final) return turns;

  return [
    ...turns,
    {
      id,
      speaker: "you" as const,
      roman: "",
      english: "",
      final: false,
    },
  ];
}

export function applyLiveCaptionTurn(
  turns: LiveTranscriptTurn[],
  update: LiveCaptionTurn & {
    id: string;
    speaker: LiveTranscriptSpeaker;
  },
) {
  const next = [...turns];
  const exactIndex = next.findIndex((turn) => turn.id === update.id);
  const pendingLearnerIndex =
    update.speaker === "you"
      ? next.findLastIndex(
          (turn) => turn.speaker === "you" && !turn.final,
        )
      : -1;
  const index = exactIndex >= 0 ? exactIndex : pendingLearnerIndex;
  const turn: LiveTranscriptTurn = {
    id: index >= 0 ? next[index].id : update.id,
    speaker: update.speaker,
    roman: update.roman,
    pronunciation: update.pronunciation,
    english: update.english,
    final: true,
    cueId: update.cueId,
    sourceLanguage: update.sourceLanguage,
  };

  if (index >= 0) {
    next[index] = turn;
  } else {
    next.push(turn);
  }

  return next;
}

export function removePendingLiveTurns(turns: LiveTranscriptTurn[]) {
  return turns.filter((turn) => turn.final);
}
