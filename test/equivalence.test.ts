import { expect, it } from "vitest";
import { listCreators } from "../src/list-creators.ts";
import { listCreators as original } from "./reference/original.ts";
import { openDatabase, resetQueryCount, getQueryCount } from "../src/db.ts";
import { seed, CAMPAIGN_ID } from "../src/seed.ts";

it("matches the original at larger volume, duplicate niches, metric ties and page boundaries", async () => {
  const db = openDatabase();
  seed(db, { creators: 2100, seed: 19 });
  db.exec(`UPDATE campaigns SET niches_json = '["beleza","beleza","moda"]' WHERE id = 'cmp_01'`);
  const accounts = db.prepare("SELECT id FROM social_accounts LIMIT 1").get() as {id: string};
  for (const [id, views] of [["zz_tie_a", 23], ["zz_tie_b", 999]]) {
    db.prepare("INSERT INTO metrics VALUES (?, ?, ?, ?, '')").run(id, accounts.id, views, "2026-06-01T12:00:00.000Z");
  }
  for (const offset of [0, 40, 99999]) {
    const input = {campaignId: CAMPAIGN_ID, limit: 20, offset};
    const expected = await original(db, input);
    resetQueryCount();
    expect(await listCreators(db, input)).toEqual(expected);
    expect(getQueryCount()).toBe(3);
  }
  db.close();
}, 30000);
