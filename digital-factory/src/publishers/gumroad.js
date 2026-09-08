/**
 * Gumroad Publisher
 * Docs: https://gumroad.com/api
 * Use HTTP Request node in n8n or this script locally.
 * Gumroad does not have official product create via API for new UI, but you can use "Products" endpoint.
 */

import fs from 'fs';
import path from 'path';
import { PRODUCTS_DIR } from '../config.js';

export async function publishToGumroad({ slug, manifestPath }) {
  const token = process.env.GUMROAD_ACCESS_TOKEN;
  if (!token) throw new Error('GUMROAD_ACCESS_TOKEN missing');

  const productDir = path.join(PRODUCTS_DIR, slug);
  const publishingDir = path.join(productDir, 'Publishing');
  const listing = JSON.parse(fs.readFileSync(path.join(publishingDir, 'listing.json'), 'utf8'));

  const formData = {
    name: listing.long_title,
    custom_summary: listing.short_description,
    custom_permalink: listing.seo_slug,
    description: fs.readFileSync(path.join(publishingDir, 'gumroad.md'), 'utf8').slice(0, 10000),
    price: listing.meta?.price || 49,
    tags: listing.seo_tags?.join(','),
  };

  // Gumroad API: POST https://api.gumroad.com/v2/products
  const res = await fetch('https://api.gumroad.com/v2/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...formData, access_token: token })
  });

  const data = await res.json();
  console.log('Gumroad response:', data);

  if (!res.ok) throw new Error(`Gumroad failed: ${JSON.stringify(data)}`);

  // Upload file: POST https://api.gumroad.com/v2/products/:id/files
  // Implementation skipped - requires multipart

  return data;
}

// CLI
if (process.argv[1].includes('gumroad.js')) {
  const slug = process.argv[2];
  if (!slug) { console.log('Usage: node gumroad.js <slug>'); process.exit(1); }
  publishToGumroad({ slug }).catch(console.error);
}
