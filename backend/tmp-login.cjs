const fetch = require('node-fetch');
(async () => {
  const res = await fetch('http://localhost:4000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  const data = await res.json();
  console.log(data.token || data);
})();
