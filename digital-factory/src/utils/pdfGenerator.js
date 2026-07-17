import fs from 'fs';
import path from 'path';

/**
 * PDF Generator
 * On Windows without puppeteer dependencies, fallback to HTML->PDF via printing instructions.
 * This implementation tries puppeteer, if fails, it keeps HTML and creates placeholder PDF marker.
 */

export async function generatePDFFromHTML(htmlPath, pdfPath) {
  try {
    // Try puppeteer
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    const html = fs.readFileSync(htmlPath, 'utf8');
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
    });
    await browser.close();
    console.log(`📄 PDF created: ${pdfPath}`);
    return pdfPath;
  } catch (e) {
    console.warn(`⚠️ Puppeteer failed (${e.message}), fallback: copying HTML as PDF placeholder and keeping HTML`);
    // Fallback: just copy HTML to pdf path folder and create simple txt marker
    // In production n8n you would use HTML to PDF node
    try {
      fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
      // For compatibility, we write a minimal PDF-like file but actually HTML
      // n8n's HTML to PDF node would be used in workflow
      const fallbackContent = fs.readFileSync(htmlPath, 'utf8');
      // Write HTML content to PDF path with html ext fallback
      fs.writeFileSync(pdfPath.replace('.pdf', '.html'), fallbackContent, 'utf8');
      // Create a tiny valid PDF placeholder
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
<< /Length 44 >>
stream
BT /F1 12 Tf 50 800 Td (See HTML version) Tj ET
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
500
%%EOF`;
      fs.writeFileSync(pdfPath, placeholderPDF, 'utf8');
      console.log(`📄 Placeholder PDF created: ${pdfPath} (real content in HTML)`);
      return pdfPath;
    } catch (e2) {
      console.error(`PDF fallback failed: ${e2.message}`);
      throw e2;
    }
  }
}

export async function batchHTMLToPDF(pairs) {
  // pairs = [{htmlPath, pdfPath}]
  const results = [];
  for (const { htmlPath, pdfPath } of pairs) {
    const res = await generatePDFFromHTML(htmlPath, pdfPath);
    results.push(res);
  }
  return results;
}
