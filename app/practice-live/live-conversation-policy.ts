import type { LiveListenerRelationship } from "./live-config.ts";
import {
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
};

/**
 * Applies the few high-confidence conversational transitions that should not
 * be left to a generic model choice. Everything else remains model-driven.
 */
export function applyLiveConversationPolicy({
  scenarioId,
  relationship,
  turn,
}: LiveConversationPolicyInput): ParsedLivePresentedTurnToolCall {
  if (
    scenarioId !== "family-check-in" ||
    turn.replay ||
    !turn.learner ||
    !isPlainAteReply(turn.learner)
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
