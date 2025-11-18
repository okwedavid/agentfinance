import fetch from "node-fetch";

async function check(url, name) {
  try {
    const res = await fetch(url);
    if (res.ok) console.log(`✅ ${name} OK`);
    else console.log(`❌ ${name} FAIL: ${res.status}`);
  } catch (e) {
    console.log(`❌ ${name} ERROR: ${e.message}`);
  }
}

await check("http://localhost:4000/health", "Backend");
await check("http://localhost:5000/health", "WebSocket");
await check("http://localhost:3000", "Frontend UI");
console.log("Run Redis & DB checks manually for deeper diagnostics.");
