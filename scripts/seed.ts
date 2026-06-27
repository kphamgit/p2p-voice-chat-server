import { prisma } from "../src/prisma.js";

// Placeholder hash — replace with a real bcrypt hash once auth is wired up.
const user = await prisma.user.upsert({
  where: { email: "test@example.com" },
  update: {},
  create: {
    email: "test@example.com",
    name: "Test User",
    passwordHash: "REPLACE_WITH_BCRYPT_HASH",
  },
});

console.log("seeded user:", user);
await prisma.$disconnect();
