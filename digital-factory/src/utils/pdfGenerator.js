import fs from 'fs';
import path from 'path';

/**
 * PDF Generator - LIGHTWEIGHT WINDOWS BUILD
 * Tries puppeteer if available, otherwise keeps HTML (premium) and creates placeholder PDF.
 * n8n's HTML to PDF node will generate real PDF in production workflow.
 * No canvas, no heavy native deps.
 */

export async function generatePDFFromHTML(htmlPath, pdfPath) {
  if (!fs.existsSync(htmlPath)) {
    console.warn(`HTML not found for PDF: ${htmlPath}`);
    return null;
  }
  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const html = fs.readFileSync(htmlPath, 'utf8');
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 }).catch(()=>page.setContent(html));
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
    await browser.close();
    console.log(`📄 PDF created: ${pdfPath}`);
    return pdfPath;
  } catch (e) {
    console.warn(`⚠️ Puppeteer PDF failed or not installed (${e.message}), fallback: keeping HTML as premium deliverable`);
    try {
      fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const htmlFallbackPath = pdfPath.replace('.pdf', '.html');
      if (!fs.existsSync(htmlFallbackPath)) fs.writeFileSync(htmlFallbackPath, htmlContent, 'utf8');
      const placeholderPDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>
endobj
4 0 obj
<< /Length 100 >>
stream
BT /F1 12 Tf 50 770 Td (Premium content in HTML version) Tj 50 750 Td (Open User_Guide.html) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000056 00000 n 
0000000111 00000 n 
0000000350 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
600
%%EOF`;
      fs.writeFileSync(pdfPath, placeholderPDF, 'utf8');
      console.log(`📄 Placeholder PDF: ${pdfPath} + real content in ${htmlFallbackPath}`);
      return pdfPath;
    } catch (e2) {
      console.error(`PDF fallback failed: ${e2.message}`);
      return htmlPath;
    }
  }
}

export async function batchHTMLToPDF(pairs) {
  const results = [];
  for (const { htmlPath, pdfPath } of pairs) {
    try {
      const res = await generatePDFFromHTML(htmlPath, pdfPath);
      if (res) results.push(res);
    } catch (e) {
      console.warn(`Batch PDF skip ${pdfPath}: ${e.message}`);
    }
  }
  return results;
}
