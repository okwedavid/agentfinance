/**
 * WooCommerce Publisher
 * Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/#create-a-product
 */

import fs from 'fs';
import path from 'path';
import { PRODUCTS_DIR } from '../config.js';

export async function publishToWooCommerce(slug) {
  const url = process.env.WOOCOMMERCE_URL;
  const ck = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const cs = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!url || !ck || !cs) throw new Error('WooCommerce credentials missing');

  const dir = path.join(PRODUCTS_DIR, slug, 'Publishing');
  const listing = JSON.parse(fs.readFileSync(path.join(dir, 'listing.json'), 'utf8'));
  const desc = fs.readFileSync(path.join(dir, 'gumroad.md'), 'utf8');

  const product = {
    name: listing.long_title,
    type: 'simple',
    regular_price: String(listing.meta.price || 49),
    description: desc,
    short_description: listing.short_description,
    virtual: true,
    downloadable: true,
    slug: listing.seo_slug,
    tags: (listing.seo_tags || []).map(name => ({ name })),
  };

  const res = await fetch(`${url}/wp-json/wc/v3/products?consumer_key=${ck}&consumer_secret=${cs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`WooCommerce error: ${JSON.stringify(data).slice(0,1000)}`);
  console.log('WooCommerce created:', data.id);
  return data;
}
