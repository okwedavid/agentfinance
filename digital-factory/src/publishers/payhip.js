/**
 * Payhip Publisher via API
 * Docs: https://payhip.com/api
 */
export async function publishToPayhip(slug) {
  const apiKey = process.env.PAYHIP_API_KEY;
  const email = process.env.PAYHIP_EMAIL;
  if (!apiKey || !email) throw new Error('Payhip credentials missing');

  console.log(`Payhip publishing ${slug} - Manual step: Payhip API is limited, use n8n HTTP Request to POST https://payhip.com/api/v1/products`);

  // Example n8n HTTP Request config:
  // Method POST, URL https://payhip.com/api/v1/products
  // Header Authorization: Bearer API_KEY
  // Body product name, price etc.

  return { note: 'Use n8n Payhip node - API requires manual file upload via dashboard for digital files' };
}
