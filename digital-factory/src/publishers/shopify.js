/**
 * Shopify Publisher - Creates digital product via Shopify Admin API
 * Requires: SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN
 * Product type: digital, with file attachment via metafield or Digital Downloads app
 */

import fs from 'fs';
import path from 'path';
import { PRODUCTS_DIR } from '../config.js';

export async function publishToShopify(slug) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) throw new Error('Shopify credentials missing');

  const productDir = path.join(PRODUCTS_DIR, slug, 'Publishing');
  const listing = JSON.parse(fs.readFileSync(path.join(productDir, 'listing.json'), 'utf8'));

  const shopifyProduct = {
    product: {
      title: listing.long_title,
      body_html: fs.readFileSync(path.join(productDir, 'shopify.html'), 'utf8'),
      vendor: listing.meta.brand_name,
      product_type: 'Digital Product',
      tags: listing.seo_tags?.join(','),
      handle: listing.seo_slug,
      variants: [{ price: String(listing.meta.price || 49), inventory_management: null, requires_shipping: false, taxable: true }],
      metafields: [
        { namespace: 'custom', key: 'avatar', value: listing.meta.avatar, type: 'single_line_text_field' },
        { namespace: 'custom', key: 'outcome', value: listing.meta.outcome, type: 'single_line_text_field' }
      ]
    }
  };

  const res = await fetch(`https://${domain}/admin/api/2024-01/products.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(shopifyProduct)
  });

  const data = await res.json();
  console.log('Shopify response:', JSON.stringify(data).slice(0, 1000));
  if (!res.ok) throw new Error(`Shopify error: ${JSON.stringify(data)}`);
  return data;
}
