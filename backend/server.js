import http from 'node:http';
import { createHandler } from './app.js';

const host = process.env.ORACLESTREET_BACKEND_HOST || '127.0.0.1';
const port = Number(process.env.ORACLESTREET_BACKEND_PORT || 4000);

const server = http.createServer(createHandler());

server.listen(port, host, () => {
  console.log(`OracleStreet backend listening on http://${host}:${port}`);
});
