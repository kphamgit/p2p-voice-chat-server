import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// BigInt isn't JSON-serializable by default, and several models (e.g. ApiLevel)
// use BigInt ids. Render them as strings so res.send()/res.json() works.
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

// Heroku Postgres requires SSL (and uses self-signed certs). Enable it in
// production; the local database doesn't use SSL, so keep it off there.
const ssl =
  process.env["NODE_ENV"] === "production" ? { rejectUnauthorized: false } : false;

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"],
  ssl,
});

// Single shared client for the whole app (one connection pool).
export const prisma = new PrismaClient({ adapter });
