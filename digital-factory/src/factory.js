#!/usr/bin/env node
/**
 * Digital Factory - Main Orchestrator
 * Runs full pipeline: Idea -> Eval -> Content -> HTML/PDF -> Cover -> Publishing Assets -> ZIP -> Catalog
 *
 * Usage:
 *  node src/factory.js --single         -> 1 product
 *  node src/factory.js --batch 10       -> 10 products
 *  node src/factory.js --dev            -> dev mode, no PDF heavy
 */

import fs from 'fs';
import path from 'path';
import { CONFIG, PRODUCTS_DIR, CATALOG_DIR, PUBLISHED_DIR } from './config.js';
import { generateProductIdea } from './generators/ideaGenerator.js';
import { evaluateProduct } from './generators/evaluator.js';
import { generateAllContent } from './generators/contentGenerators.js';
import { generatePublishingAssets } from './generators/publishingAssetsGenerator.js';
import { createProductStructure, zipCustomerPackage } from './utils/packager.js';

const args = process.argv.slice(2);
const isSingle = args.includes('--single');
const isDev = args.includes('--dev');
const batchArgIndex = args.indexOf('--batch');
const batchCount = batchArgIndex !== -1 ? parseInt(args[batchArgIndex + 1], 10) || 5 : (isSingle ? 1 : 3);

console.log(`
╔══════════════════════════════════════════════════════╗
║  🚀 DIGITAL FACTORY v2.0 - AI Product Factory        ║
║  Groq: ${CONFIG.groq.model}                                     ║
║  Mode: ${isDev ? 'DEV' : 'PROD'} | Batch: ${batchCount}                                ║
╚══════════════════════════════════════════════════════╝
`);

async function ensureCatalog() {
  fs.mkdirSync(CATALOG_DIR, { recursive: true });
  const csvPath = path.join(CATALOG_DIR, 'approved_products.csv');
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, 'slug,brand_name,title,price,overall,created_at,status\n', 'utf8');
  }
  const jsonPath = path.join(CATALOG_DIR, 'approved_products.json');
  if (!fs.existsSync(jsonPath)) {
    fs.writeFileSync(jsonPath, '[]', 'utf8');
  }
}

async function runSingleProduct(attempt = 1) {
  console.log(`\n--- Product Attempt ${attempt} ---`);
  // 1. Idea
  const idea = await generateProductIdea();
  console.log(`💡 Idea: ${idea.brand_name} - ${idea.title}`);

  // 2. Eval
  const evaluation = await evaluateProduct(idea);
  console.log(`📊 Eval: Overall ${evaluation.overall} - ${evaluation.verdict} (Demand ${evaluation.demand_score}, Value ${evaluation.value_score})`);

  if (evaluation.verdict === 'REJECTED' || evaluation.overall < CONFIG.factory.minQualityScore) {
    console.log(`❌ Rejected: ${evaluation.reason}`);
    if (attempt < CONFIG.factory.maxRetries) {
      console.log(`🔄 Retrying... (${attempt}/${CONFIG.factory.maxRetries})`);
      return runSingleProduct(attempt + 1);
    }
    return null;
  }

  // 3. Content (parallel)
  const contents = await generateAllContent(idea);

  // 4. Publishing Assets
  const publishing = await generatePublishingAssets(idea, evaluation);

  // 5. Packaging
  const { productRoot, customerDir, manifest } = await createProductStructure({
    idea,
    contents,
    publishing,
    evaluation,
    baseDir: PRODUCTS_DIR,
  });

  // 6. ZIP
  const zipPath = path.join(PUBLISHED_DIR, `${manifest.slug}/${manifest.slug}.zip`);
  const customerZipPath = path.join(productRoot, 'Customer', `${manifest.slug}.zip`);
  const publishedCustomerZip = path.join(PUBLISHED_DIR, manifest.slug, 'Package', manifest.slug, `${manifest.slug}.zip`);

  // Create ZIPs
  await zipCustomerPackage(productRoot, customerDir, zipPath);
  await zipCustomerPackage(productRoot, customerDir, customerZipPath);
  await zipCustomerPackage(productRoot, customerDir, publishedCustomerZip);

  // 7. Also copy modern structure to old Published structure for backward compatibility (user's tree)
  const oldPackageRoot = path.join(PUBLISHED_DIR, manifest.slug, 'Package', manifest.slug);
  const oldListingAssets = path.join(PUBLISHED_DIR, manifest.slug, 'Listing_Assets');
  fs.mkdirSync(oldPackageRoot, { recursive: true });
  fs.mkdirSync(oldListingAssets, { recursive: true });

  // Copy customer files to old Package for compatibility
  fs.readdirSync(customerDir).forEach(file => {
    try {
      fs.copyFileSync(path.join(customerDir, file), path.join(oldPackageRoot, file));
    } catch {}
  });

  // Copy covers to Listing_Assets
  try {
    const coverJpg = path.join(customerDir, 'cover.jpg');
    const thumbJpg = path.join(customerDir, 'thumbnail.jpg');
    if (fs.existsSync(coverJpg)) fs.copyFileSync(coverJpg, path.join(oldListingAssets, 'cover.jpg'));
    if (fs.existsSync(thumbJpg)) fs.copyFileSync(thumbJpg, path.join(oldListingAssets, 'thumbnail.jpg'));
  } catch {}

  fs.writeFileSync(path.join(PUBLISHED_DIR, manifest.slug, 'quality_report.json'), JSON.stringify(evaluation, null, 2), 'utf8');
  fs.writeFileSync(path.join(PUBLISHED_DIR, manifest.slug, 'release_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 8. Catalog update
  appendToCatalog(manifest);

  console.log(`✅ COMPLETED: ${manifest.slug} | Price $${manifest.price} | ${productRoot}`);

  return manifest;
}

function appendToCatalog(manifest) {
  const csvPath = path.join(CATALOG_DIR, 'approved_products.csv');
  const jsonPath = path.join(CATALOG_DIR, 'approved_products.json');

  const csvLine = `${manifest.slug},"${manifest.brand_name}","${manifest.title.replace(/"/g,'""')}",${manifest.price},${manifest.evaluation.overall},${manifest.created_at},APPROVED\n`;
  fs.appendFileSync(csvPath, csvLine, 'utf8');

  let jsonData = [];
  try { jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {}
  jsonData.push(manifest);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
}

async function runBatch(count) {
  await ensureCatalog();
  const results = [];
  for (let i=0; i<count; i++) {
    console.log(`\n==================== Batch ${i+1}/${count} ====================`);
    try {
      const product = await runSingleProduct();
      if (product) results.push(product);
    } catch (e) {
      console.error(`❌ Failed product ${i+1}: ${e.message}\n${e.stack}`);
    }
  }
  console.log(`\n
╔════════════════════════════════════════╗
║  FINISHED BATCH                       ║
║  Requested: ${count}                          ║
║  Approved: ${results.length}                          ║
║  Products Dir: ${PRODUCTS_DIR}   ║
║  Published Dir: ${PUBLISHED_DIR}  ║
╚════════════════════════════════════════╝
`);
  results.forEach(r => console.log(` - ${r.brand_name} | $${r.price} | ${r.slug}`));
  return results;
}

await runBatch(batchCount);
