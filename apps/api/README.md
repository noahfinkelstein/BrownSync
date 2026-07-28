# @brownsync/api

Single responsibility: the read API — Hono + zod-openapi routes per `DATA_CONTRACT.md` §3 over
Postgres views/RPC. Emits `packages/contract/openapi.json` for future Swift codegen. No writes,
no auth in MVP.
