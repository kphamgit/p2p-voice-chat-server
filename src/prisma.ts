import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// BigInt isn't JSON-serializable by default, and several models (e.g. ApiLevel)
// use BigInt ids. Render them as strings so res.send()/res.json() works.
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"] });

// Single shared client for the whole app (one connection pool).
export const prisma = new PrismaClient({ adapter });
