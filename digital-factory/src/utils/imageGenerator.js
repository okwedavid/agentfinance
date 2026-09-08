import fs from 'fs';
import path from 'path';

/**
 * Cover & Thumbnail Generator - LIGHTWEIGHT WINDOWS BUILD
 * No canvas dependency. Uses SVG + optional puppeteer.
 * If puppeteer not installed, creates premium SVG and placeholder PNG.
 * n8n will generate real PNG via its own image node if needed.
 */

export async function generateCoverImages({ brandName, title, outcome, dir }) {
  fs.mkdirSync(dir, { recursive: true });

  const coverPath = path.join(dir, 'Cover.png');
  const thumbPath = path.join(dir, 'Thumbnail.png');
  const coverJpg = path.join(dir, 'cover.jpg');
  const thumbJpg = path.join(dir, 'thumbnail.jpg');
  const coverSvgPath = path.join(dir, 'Cover.svg');
  const thumbSvgPath = path.join(dir, 'Thumbnail.svg');

  // Create premium SVG covers - these are the real source
  const svgCover = createPremiumCoverSVG(brandName, title, outcome, 1600, 1200);
  const svgThumb = createPremiumCoverSVG(brandName, title, outcome, 600, 600, true);

  // Always write SVG (works everywhere, no native deps)
  fs.writeFileSync(coverSvgPath, svgCover, 'utf8');
  fs.writeFileSync(thumbSvgPath, svgThumb, 'utf8');

  // Try puppeteer if available (optional dep)
  let puppeteerSuccess = false;
  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const coverDataUrl = await svgToPngDataUrl(browser, svgCover, 1600, 1200);
    const thumbDataUrl = await svgToPngDataUrl(browser, svgThumb, 600, 600);
    await saveDataUrlToFile(coverDataUrl, coverPath);
    await saveDataUrlToFile(thumbDataUrl, thumbPath);
    fs.copyFileSync(coverPath, coverJpg);
    fs.copyFileSync(thumbPath, thumbJpg);
    await browser.close();
    console.log(`🎨 Covers generated via puppeteer: ${coverPath}, ${thumbPath}`);
    puppeteerSuccess = true;
  } catch (e) {
    console.warn(`⚠️ Puppeteer not available (${e.message}), using lightweight fallback - SVG is premium, PNG placeholder created. n8n will generate real PNG if needed.`);
  }

  if (!puppeteerSuccess) {
    const placeholderPNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAwMB/6XcBAAAABJRU5ErkJggg==', 'base64');
    const htmlViewer = `<!DOCTYPE html><html><body style="margin:0">${svgCover}</body></html>`;
    fs.writeFileSync(path.join(dir, 'Cover.html'), htmlViewer, 'utf8');
    fs.writeFileSync(coverPath, placeholderPNG);
    fs.writeFileSync(thumbPath, placeholderPNG);
    fs.writeFileSync(coverJpg, placeholderPNG);
    fs.writeFileSync(thumbJpg, placeholderPNG);
    console.log(`🎨 Lightweight covers: ${coverSvgPath} (real premium), ${coverPath} (placeholder PNG). Use Cover.svg as source.`);
  }

  return { cover: coverPath, thumbnail: thumbPath, coverSvg: coverSvgPath, thumbSvg: thumbSvgPath };
}

function createPremiumCoverSVG(brandName, title, outcome, width, height, isThumb=false) {
  const safeBrand = escapeXml(brandName || 'Premium OS');
  const safeTitle = escapeXml((title || 'AI System').slice(0, isThumb?60:100));
  const safeOutcome = escapeXml((outcome || 'Get Results in 30 Days').slice(0, isThumb?80:120));
  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#6366f1"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#ec4899"/></linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000" flood-opacity="0.3"/></filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" rx="${isThumb?24:40}"/>
  <circle cx="${width*0.2}" cy="${height*0.2}" r="${width*0.15}" fill="#ffffff" opacity="0.05"/>
  <circle cx="${width*0.85}" cy="${height*0.75}" r="${width*0.2}" fill="#ffffff" opacity="0.07"/>
  <rect x="${width*0.05}" y="${height*0.68}" width="${width*0.9}" height="${height*0.28}" rx="20" fill="#ffffff" opacity="0.95" filter="url(#shadow)"/>
  <g transform="translate(${width*0.08}, ${height*0.08})"><rect width="${width*0.35}" height="${height*0.08}" rx="${height*0.04}" fill="url(#accent)"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="Inter, sans-serif" font-weight="800" font-size="${isThumb?width*0.04:width*0.025}" fill="white">${safeBrand}</text></g>
  <foreignObject x="${width*0.08}" y="${height*0.22}" width="${width*0.84}" height="${height*0.35}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, sans-serif; color: white;"><div style="font-size: ${isThumb?width*0.055:width*0.032}px; font-weight: 800; line-height: 1.1;">${safeTitle}</div><div style="margin-top:16px;font-size: ${isThumb?width*0.032:width*0.018}px; opacity:0.9;">${safeOutcome}</div></div></foreignObject>
  <g transform="translate(${width*0.08}, ${height*0.72})"><text x="0" y="0" font-family="Inter" font-weight="700" font-size="${width*0.018}px" fill="#0f172a">✓ Complete OS • ✓ 60+ Prompts • ✓ 30-Day Checklist • ✓ Bonus Vault</text><text x="0" y="${height*0.12}px" font-family="Inter" font-weight="600" font-size="${width*0.015}px" fill="#6366f1">DIGITAL FACTORY • SVG PREMIUM</text></g>
</svg>`;
}
async function svgToPngDataUrl(browser, svg, width, height) {
  const page = await browser.newPage(); await page.setViewport({ width, height });
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;">${svg}</body></html>`;
  await page.setContent(html); const screenshot = await page.screenshot({ type: 'png', clip: { x:0, y:0, width, height } }); await page.close();
  return `data:image/png;base64,${screenshot.toString('base64')}`;
}
async function saveDataUrlToFile(dataUrl, filePath) {
  const base64 = dataUrl.split(',')[1]; fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
}
function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&quot;','"':'&quot;'}[c]));
}
