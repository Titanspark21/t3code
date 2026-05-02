/**
 * Backfill provider_instance_id for fork-only driver kinds.
 *
 * Upstream's multi-provider refactor (PR #2277) introduced
 * `provider_instance_id` columns on `provider_session_runtime` and
 * `projection_thread_sessions`. The upstream migration intentionally leaves
 * those columns NULL because for built-in providers (codex/claudeAgent/
 * cursor/opencode) the persistence boundary handles the fallback at read
 * time.
 *
 * The fork ships four extra drivers — amp, copilot, geminiCli, kilo — and
 * seeds a default instance id for each (e.g. `amp_default`) in the
 * `BUILT_IN_DRIVERS` catalog. To keep existing fork users' sessions
 * routable after the upgrade, this migration assigns those default instance
 * ids to any pre-existing rows that name one of the fork drivers but lack a
 * provider_instance_id.
 *
 * Built-in upstream driver rows are intentionally left NULL so they keep
 * matching the read-time fallback.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

// Default instance ids for the fork drivers. These match
// `defaultInstanceIdForDriver(driverKind)` from
// packages/contracts/src/providerInstance.ts which uses the bare driver
// kind slug as the back-compat default instance id (so existing threads,
// bindings, and cache files stay routable across the migration).
const FORK_DRIVERS_AND_DEFAULT_INSTANCE_IDS = [
  ["amp", "amp"],
  ["copilot", "copilot"],
  ["geminiCli", "geminiCli"],
  ["kilo", "kilo"],
] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  for (const [driverKind, instanceId] of FORK_DRIVERS_AND_DEFAULT_INSTANCE_IDS) {
    yield* sql`
      UPDATE provider_session_runtime
      SET provider_instance_id = ${instanceId}
      WHERE provider_instance_id IS NULL
        AND provider_name = ${driverKind}
    `;
    yield* sql`
      UPDATE projection_thread_sessions
      SET provider_instance_id = ${instanceId}
      WHERE provider_instance_id IS NULL
        AND provider_name = ${driverKind}
    `;
  }
});
