import { marked } from 'marked';
import fs from 'fs';
import path from 'path';

// Premium styled HTML template for PDFs
export function markdownToStyledHTML(markdown, title = 'Document') {
  const body = marked.parse(markdown);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400&display=swap');
:root { --primary: #6366f1; --dark: #0f172a; --muted: #64748b; --accent: #f59e0b; --bg: #ffffff; }
* { box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; color: var(--dark); line-height: 1.7; max-width: 800px; margin: 0 auto; padding: 48px 32px; background: var(--bg); }
h1 { font-size: 32px; font-weight: 800; line-height: 1.2; margin: 48px 0 16px; color: var(--dark); border-bottom: 3px solid var(--primary); padding-bottom: 12px; }
h2 { font-size: 24px; font-weight: 700; margin: 36px 0 12px; color: #1e293b; }
h3 { font-size: 18px; font-weight: 600; margin: 24px 0 8px; color: #334155; }
p { margin: 12px 0; color: #334155; }
a { color: var(--primary); text-decoration: none; }
ul, ol { padding-left: 24px; }
li { margin: 8px 0; }
code { font-family: 'JetBrains Mono', monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
pre { background: #0f172a; color: #e2e8f0; padding: 20px; border-radius: 12px; overflow-x: auto; }
pre code { background: transparent; color: inherit; }
blockquote { border-left: 4px solid var(--primary); padding: 12px 20px; background: #f8fafc; margin: 20px 0; border-radius: 0 8px 8px 0; font-style: italic; }
table { width: 100%; border-collapse: collapse; margin: 20px 0; }
th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
th { background: #f8fafc; font-weight: 600; }
.cover-header { text-align: center; padding: 40px 0 32px; border-bottom: 2px solid #f1f5f9; margin-bottom: 32px; }
.cover-header h1 { border: none; margin: 0; font-size: 36px; }
.cover-header .tagline { color: var(--muted); font-size: 18px; margin-top: 8px; }
.badge { display: inline-block; background: var(--primary); color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.check { color: #10b981; font-weight: bold; }
.footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: center; color: var(--muted); font-size: 13px; }
@media print { body { padding: 24px; } }
</style>
</head>
<body>
<div class="cover-header">
  <span class="badge">Premium System</span>
  <h1>${title}</h1>
  <div class="tagline">Outcome-driven, actionable, no fluff</div>
</div>
${body}
<div class="footer">
  <p>This document is part of a premium digital product. Personal use only. © 2026 Digital Factory</p>
  <p>Generated with AI Product Factory • Professional Grade</p>
</div>
</body>
</html>`;
}

export async function writeHTMLFile(dir, filename, markdown, title) {
  const html = markdownToStyledHTML(markdown, title);
  const fullPath = path.join(dir, filename);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, html, 'utf8');
  return fullPath;
}
