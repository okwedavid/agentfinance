const fetch = require('node-fetch');
(async () => {
  const res = await fetch('http://localhost:4000/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin2', password: 'admin2' })
  });
  const data = await res.json();
  console.log(data);
})();
