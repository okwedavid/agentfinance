import seed from '/app/prisma/seed.js';

seed().then(() => {
  console.log('SEED_OK');
  process.exit(0);
}).catch((e) => {
  console.error('SEED_ERROR');
  console.error(e);
  process.exit(1);
});
