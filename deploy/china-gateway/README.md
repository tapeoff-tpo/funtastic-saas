# China access gateway

This gateway runs on a Hong Kong virtual machine and presents a custom hostname
to users in China. It proxies all application traffic to the existing Vercel
production deployment, so no application data or Supabase credentials live on
the gateway.

## Prerequisites

- A custom domain name, such as `cn.example.com`
- A Hong Kong virtual machine with a public IPv4 address
- TCP ports 80 and 443, and UDP port 443 open in the cloud firewall
- An A record for the chosen hostname pointing to the virtual machine
- Docker Engine and Docker Compose installed on the virtual machine

## Start

1. Copy `.env.example` to `.env` and replace all example values.
2. Run `docker compose up -d` from this directory.
3. Check `https://<APP_DOMAIN>/api/health` from a browser.

Caddy automatically requests and renews the TLS certificate after DNS resolves
to the virtual machine.

## Application configuration

Deploy the matching application change to Vercel before enabling the gateway.
The change removes the last browser-to-Supabase request, so Chinese browsers
only communicate with the Hong Kong hostname.

Set Vercel `NEXT_SERVER_ACTIONS_ALLOWED_ORIGINS` to the gateway hostname, then
redeploy Vercel after changing the variable. For Cafe24 OAuth, also set Vercel
`NEXT_PUBLIC_APP_URL` to the public gateway URL and register
`<gateway-url>/api/cafe24/callback` as the Cafe24 callback URL.

## Scope

This is the rapid Hong Kong route. It can improve mainland China access but is
not a substitute for a China-mainland deployment or ICP/PSB filing. A mainland
deployment requires a China cloud account, a domain eligible for filing, and
the corresponding filings.
