export const createHandler = () => {
  const send = (res, status, payload) => {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(body);
  };

  return (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return send(res, 200, {
        ok: true,
        service: 'oraclestreet-backend',
        scope: 'affiliate-email-cms',
        emailProvider: process.env.ORACLESTREET_MAIL_PROVIDER || 'dry-run',
        time: new Date().toISOString()
      });
    }

    if (url.pathname === '/api/email/config' || url.pathname === '/email/config') {
      return send(res, 200, {
        ok: true,
        provider: process.env.ORACLESTREET_MAIL_PROVIDER || 'dry-run',
        sendMode: 'safe-test-only',
        powerMtaConfigured: Boolean(process.env.ORACLESTREET_POWERMTA_HOST),
        realSendingEnabled: process.env.ORACLESTREET_REAL_EMAIL_ENABLED === 'true'
      });
    }

    return send(res, 404, {
      ok: false,
      error: 'not_found',
      message: 'OracleStreet API baseline is running.'
    });
  };
};
