/**
 * Level 3 — Episodic Memory Database Connection
 *
 * Lazy singleton for Drizzle ORM instance connected to PostgreSQL
 * via standard `pg` driver (node-postgres).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: InstanceType<typeof Pool> | null = null;

/**
 * Get or create the Drizzle database instance.
 * Requires DATABASE_URL environment variable.
 *
 * Uses lazy initialization to avoid crashes when DATABASE_URL is not set
 * (e.g., during unit tests that mock the DB layer).
 */
export function getDb() {
    if (!_db) {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error(
                "DATABASE_URL environment variable is required for Episodic Memory. " +
                "Add it to your .env file."
            );
        }
        _pool = new Pool({ connectionString: databaseUrl });
        _db = drizzle(_pool, { schema });
    }
    return _db;
}

/**
 * Reset the DB singleton (used in tests).
 */
export function resetDb(): void {
    _db = null;
    if (_pool) {
        _pool.end().catch(() => { });
        _pool = null;
    }
}
