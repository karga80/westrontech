import type { FinalAlert, AlertTier } from "@/shared/types";

const TIER_EMOJI: Record<AlertTier, string> = {
  yellow: "🟡",
  orange: "🟠",
  red: "🔴",
};

export function formatForWebSocket(alert: FinalAlert): string {
  return JSON.stringify({
    type: "alert.new",
    payload: alert,
  });
}

export function formatForTelegram(alert: FinalAlert): string {
  const emoji = TIER_EMOJI[alert.tier];
  const enrichment = alert.enrichmentData;

  const lines: string[] = [
    `${emoji} *${alert.alertType.toUpperCase()} ALERT* — ${alert.tier.toUpperCase()}`,
    `📊 Score: ${alert.score} | Sources: ${alert.confluenceCount}`,
    `🎯 \`${alert.identifier}\`${alert.chain ? ` (${alert.chain})` : ""}`,
  ];

  if (enrichment && "liquidityUsd" in enrichment) {
    const token = enrichment;
    lines.push(`💰 Liq: $${formatNumber(token.liquidityUsd)} | MCap: $${formatNumber(token.marketCap)}`);
    lines.push(`📈 Vol 5m: $${formatNumber(token.volume5m)} | Age: ${formatAge(token.ageMs)}`);
  } else if (enrichment && "floorPriceEth" in enrichment) {
    const col = enrichment;
    lines.push(`🏷 Floor: ${col.floorPriceEth.toFixed(4)} ETH | Vol 24h: ${col.volume24hEth.toFixed(2)} ETH`);
    lines.push(`👥 Owners: ${formatNumber(col.ownerCount)} | Sales 24h: ${col.sales24h}`);
  }

  if (alert.confluenceSources.length > 0) {
    lines.push(`🔗 Signals: ${alert.confluenceSources.join(", ")}`);
  }

  return lines.join("\n").slice(0, 500);
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
