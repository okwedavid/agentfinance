import fs from 'fs';
import path from 'path';

/**
 * Cover & Thumbnail Generator
 * Premium gradient covers without external API.
 * Optionally uses HuggingFace or Groq vision if key present.
 * Generates PNG via SVG -> convert or canvas fallback.
 */

export async function generateCoverImages({ brandName, title, outcome, dir }) {
  fs.mkdirSync(dir, { recursive: true });

  const coverPath = path.join(dir, 'Cover.png');
  const thumbPath = path.join(dir, 'Thumbnail.png');
  const coverJpg = path.join(dir, 'cover.jpg');
  const thumbJpg = path.join(dir, 'thumbnail.jpg');

  // Create premium SVG cover
  const svgCover = createPremiumCoverSVG(brandName, title, outcome, 1600, 1200);
  const svgThumb = createPremiumCoverSVG(brandName, title, outcome, 600, 600, true);

  // Write SVG as temporary, then attempt PNG conversion via canvas or sharp fallback
  // Since canvas native module is heavy on Windows, we provide SVG->HTML fallback and PNG via base template
  // Simplest: write SVG files and also create HTML mockups; PNG creation via puppeteer screenshot

  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

    const coverDataUrl = await svgToPngDataUrl(browser, svgCover, 1600, 1200);
    const thumbDataUrl = await svgToPngDataUrl(browser, svgThumb, 600, 600);

    await saveDataUrlToFile(coverDataUrl, coverPath);
    await saveDataUrlToFile(thumbDataUrl, thumbPath);

    // Also copy as jpg paths (same png content renamed for compatibility with old code)
    fs.copyFileSync(coverPath, coverJpg);
    fs.copyFileSync(thumbPath, thumbJpg);

    await browser.close();
    console.log(`🎨 Covers generated: ${coverPath}, ${thumbPath}`);
  } catch (e) {
    console.warn(`⚠️ Puppeteer cover generation failed (${e.message}), fallback to SVG files`);
    // Fallback: save SVG as PNG path (will still display in some readers) and create placeholder
    fs.writeFileSync(coverPath.replace('.png','.svg'), svgCover, 'utf8');
    fs.writeFileSync(thumbPath.replace('.png','.svg'), svgThumb, 'utf8');
    // Create simple placeholder PNG via 1x1 pixel base64 (will be replaced by n8n image node)
    const placeholder = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAwMB/6XcBAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(coverPath, placeholder);
    fs.writeFileSync(thumbPath, placeholder);
    fs.writeFileSync(coverJpg, placeholder);
    fs.writeFileSync(thumbJpg, placeholder);
  }

  return { cover: coverPath, thumbnail: thumbPath };
}

function createPremiumCoverSVG(brandName, title, outcome, width, height, isThumb=false) {
  const safeBrand = escapeXml(brandName || 'Premium OS');
  const safeTitle = escapeXml((title || 'AI System').slice(0, isThumb?60:100));
  const safeOutcome = escapeXml((outcome || 'Get Results in 30 Days').slice(0, isThumb?80:120));

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000" flood-opacity="0.3"/></filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" rx="${isThumb?24:40}"/>
  <!-- Decorative blobs -->
  <circle cx="${width*0.2}" cy="${height*0.2}" r="${width*0.15}" fill="#ffffff" opacity="0.05"/>
  <circle cx="${width*0.85}" cy="${height*0.75}" r="${width*0.2}" fill="#ffffff" opacity="0.07"/>
  <rect x="${width*0.05}" y="${height*0.68}" width="${width*0.9}" height="${height*0.28}" rx="20" fill="#ffffff" opacity="0.95" filter="url(#shadow)"/>
  
  <!-- Brand Badge -->
  <g transform="translate(${width*0.08}, ${height*0.08})">
    <rect width="${width*0.35}" height="${height*0.08}" rx="${height*0.04}" fill="url(#accent)"/>
    <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="Inter, sans-serif" font-weight="800" font-size="${isThumb?width*0.04:width*0.025}" fill="white">${safeBrand}</text>
  </g>

  <!-- Main Title -->
  <foreignObject x="${width*0.08}" y="${height*0.22}" width="${width*0.84}" height="${height*0.35}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, sans-serif; color: white;">
      <div style="font-size: ${isThumb?width*0.055:width*0.032}px; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em;">${safeTitle}</div>
      <div style="margin-top: 16px; font-size: ${isThumb?width*0.032:width*0.018}px; font-weight: 500; opacity: 0.9; line-height: 1.4;">${safeOutcome}</div>
    </div>
  </foreignObject>

  <!-- Bottom white card content -->
  <g transform="translate(${width*0.08}, ${height*0.72})">
    <text x="0" y="0" font-family="Inter, sans-serif" font-weight="700" font-size="${width*0.018}px" fill="#0f172a">✓ Complete OS • ✓ 60+ Prompts • ✓ 30-Day Checklist • ✓ Bonus Vault</text>
    <text x="0" y="${height*0.06}px" font-family="Inter, sans-serif" font-weight="500" font-size="${width*0.016}px" fill="#64748b">Premium Digital Product • Instant Download • Personal Use</text>
    <text x="0" y="${height*0.12}px" font-family="Inter, sans-serif" font-weight="600" font-size="${width*0.015}px" fill="#6366f1">DIGITAL FACTORY • 2026 EDITION</text>
  </g>
</svg>`;
}

async function svgToPngDataUrl(browser, svg, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;">${svg}</body></html>`;
  await page.setContent(html);
  const screenshot = await page.screenshot({ type: 'png', clip: { x:0, y:0, width, height } });
  await page.close();
  return `data:image/png;base64,${screenshot.toString('base64')}`;
}

async function saveDataUrlToFile(dataUrl, filePath) {
  const base64 = dataUrl.split(',')[1];
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, c => {
    switch(c){ case '<': return '&lt;'; case '>': return '&gt;'; case '&': return '&amp;'; case '\'': return '&quot;'; case '"': return '&quot;'; default: return c; }
  });
}
