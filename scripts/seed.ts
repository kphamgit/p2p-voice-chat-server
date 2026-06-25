import { prisma } from "../src/prisma.js";

await prisma.level.createMany({ data: [{ name: "Beginner" }, { name: "Advanced" }] });
const all = await prisma.level.findMany();
console.log("seeded:", all);
await prisma.$disconnect();
