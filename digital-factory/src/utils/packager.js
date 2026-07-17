import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

export async function createProductStructure({ idea, contents, publishing, evaluation, baseDir }) {
  const slug = publishing.meta.slug || idea.slug;
  const productRoot = path.join(baseDir, slug);

  const customerDir = path.join(productRoot, 'Customer');
  const publishingDir = path.join(productRoot, 'Publishing');
  const internalDir = path.join(productRoot, 'Internal');
  const listingAssetsDir = path.join(productRoot, '..', '..', 'Published', slug, 'Listing_Assets'); // compatibility with old tree

  [customerDir, publishingDir, internalDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  // Write customer files
  const customerFiles = {
    'START_HERE.txt': contents.startHere,
    'README.md': contents.readme,
    'User_Guide.md': contents.guide,
    'Prompt_Library.md': contents.prompts,
    'Bonus_Checklist.md': contents.checklist,
    'Resources.md': contents.resources,
    'Bonus.md': contents.bonus,
    'License.txt': contents.license,
  };

  for (const [filename, content] of Object.entries(customerFiles)) {
    fs.writeFileSync(path.join(customerDir, filename), content, 'utf8');
  }

  // Write HTML versions (needed for PDF)
  const { writeHTMLFile } = await import('./htmlGenerator.js');
  const htmlPairs = [];

  const htmls = [
    { md: contents.guide, title: `${idea.brand_name} - Complete Guide`, mdName: 'User_Guide.md', htmlName: 'User_Guide.html', pdfName: 'User_Guide.pdf' },
    { md: contents.prompts, title: `${idea.brand_name} - Prompt Library`, mdName: 'Prompt_Library.md', htmlName: 'Prompt_Library.html', pdfName: 'Prompt_Library.pdf' },
    { md: contents.checklist, title: `${idea.brand_name} - Checklist`, mdName: 'Bonus_Checklist.md', htmlName: 'Bonus_Checklist.html', pdfName: 'Bonus_Checklist.pdf' },
    { md: contents.resources, title: `${idea.brand_name} - Resources`, mdName: 'Resources.md', htmlName: 'Resources.html', pdfName: 'Resources.pdf' },
    { md: contents.bonus, title: `${idea.brand_name} - Bonus`, mdName: 'Bonus.md', htmlName: 'Bonus.html', pdfName: 'Bonus.pdf' },
    { md: contents.startHere, title: `START HERE - ${idea.brand_name}`, mdName: 'START_HERE.txt', htmlName: 'START_HERE.html', pdfName: 'START_HERE.pdf' },
  ];

  for (const h of htmls) {
    const htmlPath = await writeHTMLFile(customerDir, h.htmlName, h.md, h.title);
    htmlPairs.push({ htmlPath, pdfPath: path.join(customerDir, h.pdfName) });
  }

  // Generate PDFs
  const { batchHTMLToPDF } = await import('./pdfGenerator.js');
  await batchHTMLToPDF(htmlPairs);

  // Covers
  const { generateCoverImages } = await import('./imageGenerator.js');
  const covers = await generateCoverImages({
    brandName: idea.brand_name,
    title: idea.title,
    outcome: idea.dream_outcome,
    dir: customerDir,
  });

  // Also copy to Published/Listing_Assets for backward compat
  try {
    fs.mkdirSync(listingAssetsDir, { recursive: true });
    fs.copyFileSync(covers.cover, path.join(listingAssetsDir, 'cover.jpg'));
    fs.copyFileSync(covers.thumbnail, path.join(listingAssetsDir, 'thumbnail.jpg'));
  } catch {}

  // Publishing assets
  for (const [filename, content] of Object.entries(publishing.files)) {
    fs.writeFileSync(path.join(publishingDir, filename), content, 'utf8');
  }

  // Additional curated
  fs.writeFileSync(path.join(publishingDir, 'gumroad.md'), publishing.files['gumroad.md'], 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'etsy.md'), publishing.files['etsy.md'], 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'seo.txt'), publishing.files['seo.txt'], 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'listing.json'), JSON.stringify(publishing, null, 2), 'utf8');

  // Internal
  fs.writeFileSync(path.join(internalDir, 'generation.json'), JSON.stringify({ idea, evaluation, timestamp: new Date().toISOString() }, null, 2), 'utf8');
  fs.writeFileSync(path.join(internalDir, 'guide.md'), contents.guide, 'utf8');
  fs.writeFileSync(path.join(internalDir, 'prompts.md'), contents.prompts, 'utf8');
  fs.writeFileSync(path.join(internalDir, 'sales.md'), publishing.files['gumroad.md'], 'utf8');
  fs.writeFileSync(path.join(internalDir, 'seo.md'), publishing.files['seo.txt'], 'utf8');
  fs.writeFileSync(path.join(internalDir, 'prompt_log.json'), JSON.stringify({ model: process.env.GROQ_MODEL, ideaSlug: slug }, null, 2), 'utf8');

  // Manifests
  const manifest = {
    slug,
    brand_name: idea.brand_name,
    title: idea.title,
    outcome: idea.dream_outcome,
    avatar: idea.avatar,
    price: publishing.meta.price,
    evaluation,
    created_at: new Date().toISOString(),
    files_customer: fs.readdirSync(customerDir),
    files_publishing: fs.readdirSync(publishingDir),
    bundle_with: idea.bundle_with,
  };

  fs.writeFileSync(path.join(productRoot, 'release_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(productRoot, 'quality_report.json'), JSON.stringify({
    slug,
    overall: evaluation.overall,
    verdict: evaluation.verdict,
    checked_at: new Date().toISOString(),
    ...evaluation
  }, null, 2), 'utf8');

  return { productRoot, customerDir, publishingDir, internalDir, slug, manifest, covers };
}

export async function zipCustomerPackage(productRoot, customerDir, outputZipPath) {
  const outDir = path.dirname(outputZipPath);
  fs.mkdirSync(outDir, { recursive: true });

  const output = fs.createWriteStream(outputZipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`📦 ZIP created: ${outputZipPath} (${archive.pointer()} bytes)`);
      resolve(outputZipPath);
    });
    archive.on('error', err => reject(err));
    archive.pipe(output);
    archive.directory(customerDir, false);
    archive.finalize();
  });
}
