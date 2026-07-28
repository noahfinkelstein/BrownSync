import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createSql } from "./db";
import { createQueries } from "./queries";

const app = createApp(createQueries(createSql()));
const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`brownsync api listening on http://localhost:${info.port}`);
});
