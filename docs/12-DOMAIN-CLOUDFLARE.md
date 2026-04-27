# OracleStreet Domain and Cloudflare Wiring

## Assigned domain

OracleStreet is assigned to:

- Primary domain: `stuffprettygood.com`
- WWW alias: `www.stuffprettygood.com`
- Current VPS IP: `187.124.147.49`

## Current phase

Domain is being wired to the VPS before buying/using a new dedicated domain. HTTP-first verification is acceptable while the product is still in IP/domain smoke-test mode. TLS/HTTPS should be added after DNS is stable.

## Cloudflare DNS target

Cloudflare zone: `stuffprettygood.com`

Expected DNS records for OracleStreet web access:

```text
A     stuffprettygood.com      187.124.147.49
A     www.stuffprettygood.com  187.124.147.49
```

Keep existing MX/TXT email-forwarding records unless Boss explicitly changes mail routing. OracleStreet's outbound PMTA work is not the same as receiving mailbox/DNS routing.

## VPS Nginx

OracleStreet deploys should ensure the VPS Nginx site has:

```nginx
server_name stuffprettygood.com www.stuffprettygood.com 187.124.147.49 _;
```

Frontend remains served from `/var/www/oraclestreet`; API remains proxied from `/api/` to `127.0.0.1:4000`.

## Verification commands

```bash
curl -I http://stuffprettygood.com/
curl http://stuffprettygood.com/api/health
curl http://stuffprettygood.com/api/email/config
```

Protected readiness endpoint after admin login:

```bash
curl http://stuffprettygood.com/api/web/domain-readiness
```

The endpoint reports expected apex/www A records, primary/fallback health URLs, TLS mode planning, and smoke-test commands without performing DNS probes, enabling HTTPS, or unlocking email sending.

Fallback IP checks:

```bash
curl -I http://187.124.147.49/
curl http://187.124.147.49/api/health
```

## Later TLS step

After DNS is stable, add HTTPS via either:

1. Cloudflare proxy + appropriate SSL mode, or
2. origin TLS with Certbot on the VPS.

Do not enable production-scale email sending merely because the domain is wired. PMTA sending still requires the safety gates in `docs/10-POWERMTA-INTEGRATION.md` and `docs/11-TESTING-AND-QA.md`.
