/**
 * Publish to all platforms sequentially
 */

import fs from 'fs';
import path from 'path';
import { PRODUCTS_DIR } from '../config.js';
import { publishToGumroad } from './gumroad.js';
import { publishToShopify } from './shopify.js';
import { publishToEtsy } from './etsy.js';
import { publishToWooCommerce } from './woocommerce.js';

const slug = process.argv[2] || fs.readdirSync(PRODUCTS_DIR)[0];
if (!slug) {
  console.error('No products found');
  process.exit(1);
}

console.log(`Publishing ${slug} to all configured platforms...`);

const publishers = [
  { name: 'Gumroad', fn: () => publishToGumroad({ slug }) },
  { name: 'Shopify', fn: () => publishToShopify(slug) },
  { name: 'Etsy', fn: () => publishToEtsy(slug) },
  { name: 'WooCommerce', fn: () => publishToWooCommerce(slug) },
];

for (const pub of publishers) {
  try {
    console.log(`\n--- ${pub.name} ---`);
    await pub.fn();
    console.log(`✅ ${pub.name} success`);
  } catch (e) {
    console.error(`❌ ${pub.name} failed: ${e.message}`);
  }
}
