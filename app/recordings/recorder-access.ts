import type { SupabaseClient } from "@supabase/supabase-js";

export type FamilyRecorderAccess = "allowed" | "denied" | "error";

/**
 * Claims and verifies recorder ownership inside Postgres. The database function
 * checks the signed Supabase user against the private owner allowlist, so this
 * result is only for presentation; row-level security remains the hard guard.
 */
export async function verifyFamilyRecorderOwner(
  supabase: Pick<SupabaseClient, "rpc">,
): Promise<FamilyRecorderAccess> {
  const { data, error } = await supabase.rpc("claim_phrase_recorder_access");

  if (error) return "error";
  return data === "owner" ? "allowed" : "denied";
}
