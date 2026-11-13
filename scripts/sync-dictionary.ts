// Syncs the dictionary from the Django app's database into this one (see
// src/dictionarySync.ts). The admin's "Manage Dictionary" tab does the same.
//
// Run from the server folder:
//   DJANGO_DATABASE_URL='postgres://…' pnpm sync:dictionary [--dry-run]
// It writes to the database in DATABASE_URL; both come from .env unless set.
// --dry-run reports what would change without writing anything.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { sslFor, syncDictionary, syncErrorMessage } from "../src/dictionarySync.js";

const djangoUrl = process.env["DJANGO_DATABASE_URL"];
const targetUrl = process.env["DATABASE_URL"];
if (!djangoUrl || !targetUrl) {
  console.error("Set DJANGO_DATABASE_URL (the Django database) and DATABASE_URL (this server's).");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: targetUrl, ssl: sslFor(targetUrl) }) });

try {
  const { tables, applied } = await syncDictionary(prisma, djangoUrl, dryRun);
  for (const t of tables) console.log(`${t.table}: ${t.new} new, ${t.changed} changed, ${t.deleted} deleted`);
  console.log(dryRun ? "Dry run: nothing written." : applied ? "Sync done." : "Already in sync.");
} catch (err) {
  console.error("Sync failed; nothing was changed.", syncErrorMessage(err));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
