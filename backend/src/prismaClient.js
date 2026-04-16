import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

export const agent = prisma.agent;
export const task = prisma.task;
export const user = prisma.user;

export default prisma;
