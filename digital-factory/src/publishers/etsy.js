/**
 * Etsy Publisher
 * Etsy API v3: https://developers.etsy.com/
 * Requires: ETSY_API_KEY, ETSY_ACCESS_TOKEN, ETSY_SHOP_ID
 * In n8n use Etsy node (OAuth).
 */

import fs from 'fs';
import path from 'path';
import { PRODUCTS_DIR } from '../config.js';

export async function publishToEtsy(slug) {
  const apiKey = process.env.ETSY_API_KEY;
  const token = process.env.ETSY_ACCESS_TOKEN;
  const shopId = process.env.ETSY_SHOP_ID;

  if (!apiKey || !token || !shopId) throw new Error('Etsy credentials missing. Use n8n Etsy OAuth node recommended.');

  const dir = path.join(PRODUCTS_DIR, slug, 'Publishing');
  const listing = JSON.parse(fs.readFileSync(path.join(dir, 'listing.json'), 'utf8'));

  const payload = {
    quantity: 999,
    title: listing.title,
    description: fs.readFileSync(path.join(dir, 'etsy.md'), 'utf8'),
    price: listing.meta.price,
    who_made: 'i_did',
    when_made: 'made_to_order',
    taxonomy_id: 123, // you must map category, e.g. digital templates = 69150493
    type: 'digital',
    tags: listing.etsy_tags || listing.seo_tags?.slice(0,13),
  };

  const res = await fetch(`https://openapi.etsy.com/v3/application/shops/${shopId}/listings`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log('Etsy:', data);
  if (!res.ok) throw new Error(`Etsy error ${JSON.stringify(data)}`);
  return data;
}
