export function getPracticeLiveClientIp(request: Request) {
  // Cloudflare sets cf-connecting-ip itself, so it is trustworthy whenever
  // present. Generic proxy headers are attacker-writable when the origin is
  // reachable directly, letting a caller rotate fake identities past every
  // rate limit, so they are honored only behind an explicit opt-in for
  // deployments whose front proxy is known to overwrite them.
  const trustForwarded = process.env.TRUST_FORWARDED_IP === "1";
  const candidate =
    request.headers.get("cf-connecting-ip") ??
    (trustForwarded
      ? (request.headers.get("x-forwarded-for")?.split(",")[0] ??
        request.headers.get("x-real-ip"))
      : null) ??
    "unknown";

  return candidate.trim().slice(0, 128) || "unknown";
}
