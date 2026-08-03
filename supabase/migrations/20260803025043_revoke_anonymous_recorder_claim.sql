-- Anonymous identities never need to invoke the owner-claim RPC. Keep the
-- explicit role ACL aligned with the function's fail-closed identity check.
revoke all on function public.claim_phrase_recorder_access()
  from public, anon;
grant execute on function public.claim_phrase_recorder_access()
  to authenticated;
