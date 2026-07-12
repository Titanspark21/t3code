/**
 * Adds the nullable `forked_from_thread_id` column to `projection_threads`.
 *
 * Set when a thread was created as a fork of another thread; null for normal
 * threads. Powers the fork link indicator. Idempotent — re-running is a no-op
 * once the column exists.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (columns.some((column) => column.name === "forked_from_thread_id")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN forked_from_thread_id TEXT
  `;
});
