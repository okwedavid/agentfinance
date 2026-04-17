#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

async function main() {
  const prisma = new PrismaClient();
  const email = 'admin@agentfinance.com';
  const password = 'password';
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { username: email },
    update: {},
    create: { username: email, passwordHash },
  });
  console.log('Demo user ready:', email);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
