# @brownsync/contract

Single responsibility: the TypeScript rendering of `DATA_CONTRACT.md` — Zod schemas for the
read-API shapes (§3) and NDJSON seed rows (§1/§6), the fixed category taxonomy (§4), and the
design tokens (handoff §6.1). Everything that crosses a boundary validates against this
package. Changing anything here that mirrors the contract requires a contract version bump
in the same PR.
