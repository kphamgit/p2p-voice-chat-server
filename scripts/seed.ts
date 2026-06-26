import { prisma } from "../src/prisma.js";

// levelNumber is required on ApiLevel (no default), so it must be provided.
await prisma.apiLevel.createMany({
  data: [
    { name: "Beginner", levelNumber: 1 },
    { name: "Advanced", levelNumber: 2 },
  ],
});

const all = await prisma.apiLevel.findMany({ orderBy: { levelNumber: "asc" } });
console.log("seeded:", all);

await prisma.$disconnect();
