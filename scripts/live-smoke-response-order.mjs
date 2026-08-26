export function canAcceptLiveSmokeCompletion({
  hasAcceptedTurn,
  audiblePcmBytes,
  audiblePcmPeak,
}) {
  return Boolean(
    hasAcceptedTurn && audiblePcmBytes > 0 && audiblePcmPeak > 0,
  );
}
