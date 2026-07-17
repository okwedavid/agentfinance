import fs from 'fs';
import { PRODUCTS_DIR } from '../config.js';

const prods = fs.readdirSync(PRODUCTS_DIR);
console.log(`Products in ${PRODUCTS_DIR}: ${prods.length}`);
prods.forEach(p => {
  console.log(` - ${p}`);
  const manifestPath = `${PRODUCTS_DIR}/${p}/release_manifest.json`;
  if (fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    console.log(`   -> ${m.brand_name} $${m.price} overall ${m.evaluation.overall}`);
  }
});
