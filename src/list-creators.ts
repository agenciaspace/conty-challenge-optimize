import type { DatabaseSync } from "node:sqlite";
import { deliveriesSince } from "./clock.ts";
import { all, get } from "./db.ts";

export type CreatorMatch = {
  id: string;
  name: string;
  niche_score: number;
  latest_reach: number;
  deliveries_90d: number;
};

export type CreatorPage = {
  campaign_id: string;
  total: number;
  creators: CreatorMatch[];
};

// Score in SQL before pagination; a JSON join preserves duplicate-niche semantics.
const matching = `
  SELECT c.id, c.name, COUNT(*) AS niche_score
  FROM creators c, json_each(c.niches_json) cn, json_each(?) campaign_niche
  WHERE cn.value = campaign_niche.value
  GROUP BY c.id
`;

export async function listCreators(
  db: DatabaseSync,
  input: { campaignId: string; limit: number; offset: number },
): Promise<CreatorPage | null> {
  const campaign = await get<{ niches_json: string }>(
    db, "SELECT niches_json FROM campaigns WHERE id = ?", input.campaignId,
  );
  if (!campaign) return null;
  // Separate count preserves total even when the requested page is empty.
  const count = await get<{ total: number }>(
    db, `SELECT COUNT(*) AS total FROM (${matching})`, campaign.niches_json,
  );
  const creators = await all<CreatorMatch>(db, `
    WITH matched AS (${matching}),
    ranked_metrics AS (
      SELECT account_id, views,
        ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY captured_at DESC, id DESC) AS rn
      FROM metrics
    ), reach AS (
      SELECT a.creator_id, SUM(m.views) AS latest_reach
      FROM social_accounts a JOIN ranked_metrics m ON m.account_id = a.id AND m.rn = 1
      GROUP BY a.creator_id
    ), recent_deliveries AS (
      SELECT creator_id, COUNT(*) AS deliveries_90d FROM deliveries
      WHERE delivered_at >= ? GROUP BY creator_id
    )
    SELECT c.id, c.name, c.niche_score,
      COALESCE(r.latest_reach, 0) AS latest_reach,
      COALESCE(d.deliveries_90d, 0) AS deliveries_90d
    FROM matched c
    LEFT JOIN reach r ON r.creator_id = c.id
    LEFT JOIN recent_deliveries d ON d.creator_id = c.id
    ORDER BY c.niche_score DESC, latest_reach DESC, c.id ASC
    LIMIT ? OFFSET ?
  `, campaign.niches_json, deliveriesSince(), input.limit, input.offset);
  return { campaign_id: input.campaignId, total: Number(count?.total ?? 0), creators };
}
