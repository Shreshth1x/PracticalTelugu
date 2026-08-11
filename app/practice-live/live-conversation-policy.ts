import type { LiveListenerRelationship } from "./live-config.ts";
import {
  getLiveClosingFarewell,
  getLiveFamilyAteFollowup,
  type LiveScenarioId,
} from "./live-scenarios.ts";
import {
  isPlainAteReply,
  type ParsedLivePresentedTurnToolCall,
} from "./live-transcript.ts";

type LiveConversationPolicyInput = {
  scenarioId: LiveScenarioId;
  relationship: LiveListenerRelationship;
  turn: ParsedLivePresentedTurnToolCall;
  groundedLearnerTranscript?: string;
  isControlTurn?: boolean;
};

/**
 * Applies the few high-confidence conversational transitions that should not
 * be left to a generic model choice. Everything else remains model-driven.
 */
export function applyLiveConversationPolicy({
  scenarioId,
  relationship,
  turn,
  groundedLearnerTranscript,
  isControlTurn = false,
}: LiveConversationPolicyInput): ParsedLivePresentedTurnToolCall {
  if (isControlTurn && !turn.replay) {
    const farewell = getLiveClosingFarewell(relationship);

    return {
      ...turn,
      mayu: {
        teluguInternal: farewell.telugu,
        roman: farewell.roman,
        pronunciation: farewell.pronunciation,
        english: farewell.english,
        sourceLanguage: "telugu",
      },
    };
  }

  if (
    scenarioId !== "family-check-in" ||
    turn.replay ||
    !isPlainAteReply({
      english: groundedLearnerTranscript ?? turn.learner?.english ?? "",
    })
  ) {
    return turn;
  }

  const followup = getLiveFamilyAteFollowup(relationship);

  return {
    ...turn,
    mayu: {
      teluguInternal: followup.telugu,
      roman: followup.roman,
      pronunciation: followup.pronunciation,
      english: followup.english,
      sourceLanguage: "telugu",
    },
  };
}
