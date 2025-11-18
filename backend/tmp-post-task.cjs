const http = require('http');

const data = JSON.stringify({
  agentId: 'cmgwc2l9x00009h1gku770ov7',
  action: 'summarize',
  input: 'Summarize this text'
});

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/tasks/dispatch',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log('BODY', body);
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('ERROR', e);
  process.exit(1);
});

req.write(data);
req.end();
