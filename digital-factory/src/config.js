import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

// Windows-friendly defaults, fallback to repo-local for dev
export const FACTORY_ROOT = process.env.FACTORY_ROOT || path.join(ROOT, 'digital-factory');
export const PRODUCTS_DIR = process.env.PRODUCTS_DIR || path.join(FACTORY_ROOT, 'Products');
export const CATALOG_DIR = process.env.CATALOG_DIR || path.join(FACTORY_ROOT, 'catalog');
export const PUBLISHED_DIR = process.env.PUBLISHED_DIR || path.join(FACTORY_ROOT, 'Published');
export const TEMPLATES_DIR = path.join(FACTORY_ROOT, 'templates');

export const CONFIG = {
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    fastModel: process.env.GROQ_FAST_MODEL || 'llama-3.1-8b-instant',
    temperature: 0.85,
  },
  factory: {
    minQualityScore: 7.0,
    maxRetries: 2,
    batchSize: 10,
    // premium niches that SELL (outcome-oriented, not toolkit)
    niches: [
      'AI Freelancer Client Acquisition OS',
      '30-Day AI Content Engine for Coaches',
      'AI Proposal Writing System for Agencies',
      'AI Student Research Vault + Citation System',
      'AI Job Application Accelerator',
      'AI Real Estate Listing & Lead System',
      'Notion + AI Second Brain for Founders',
      'AI YouTube Script & Thumbnail System',
      'AI Cold Email & LinkedIn Outreach OS',
      'AI Digital Product Launch Kit',
      'AI Notion CRM for Solopreneurs',
      'AI UGC Script Vault for Ecommerce Brands',
      'AI Legal Contract Analyzer for Small Business',
      'AI Financial Tracker & Budget OS'
    ]
  },
  publishing: {
    includePlatforms: ['gumroad', 'payhip', 'etsy', 'shopify', 'woocommerce', 'kofi', 'lemonsqueezy'],
  }
};

// Ensure_dirs
[FACTORY_ROOT, PRODUCTS_DIR, CATALOG_DIR, PUBLISHED_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
