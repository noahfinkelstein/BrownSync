import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createBoardIdentity } from "./board-identity";
import { createBoardQueries } from "./board-queries";
import { createSql } from "./db";
import { createOrgAssetQueries } from "./org-asset-queries";
import { normalizeEmbedOrigin } from "./org-asset-services";
import { createQueries } from "./queries";

const sql = createSql();
const boardLaunched = process.env.BOARD_ENABLED === "true";
const app = createApp(createQueries(sql), {
  boardIdentity: createBoardIdentity({
    encodedPepper: boardLaunched ? process.env.BOARD_AUTHOR_PEPPER : undefined,
  }),
  boardQueries: createBoardQueries(sql),
  orgAssetQueries: createOrgAssetQueries(sql, {
    embedOrigin: normalizeEmbedOrigin(process.env.INSTAGRAM_EMBED_ORIGIN),
  }),
  embedOrigin: normalizeEmbedOrigin(process.env.INSTAGRAM_EMBED_ORIGIN),
});
const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`brownsync api listening on http://localhost:${info.port}`);
});
