import http from 'node:http';

const host = process.env.ORACLESTREET_BACKEND_HOST || '127.0.0.1';
const port = Number(process.env.ORACLESTREET_BACKEND_PORT || 4000);

const send = (res, status, payload) => {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health' || url.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      service: 'oraclestreet-backend',
      scope: 'affiliate-email-cms',
      time: new Date().toISOString()
    });
  }

  return send(res, 404, {
    ok: false,
    error: 'not_found',
    message: 'OracleStreet API baseline is running.'
  });
});

server.listen(port, host, () => {
  console.log(`OracleStreet backend listening on http://${host}:${port}`);
});
