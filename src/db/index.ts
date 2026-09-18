import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

// Local dev: defaults to a SQLite file on disk, zero setup required.
// Production: point DATABASE_URL at a Turso database (libsql://...) and set
// DATABASE_AUTH_TOKEN — the same driver works unmodified in both places.
const url = process.env.DATABASE_URL ?? "file:./local.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

const client = createClient({ url, authToken });

export const db = drizzle(client, { schema });
