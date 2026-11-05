# Deployment guide

This repository is prepared for a static Cloudflare Pages frontend, a Render FastAPI service, and an external PostgreSQL database. No hosting resources have been created by this change. Deployments still require access to your Cloudflare, Render, and database dashboards.

## Provider and cost check

Provider documentation and pricing were checked on **2026-11-05**. Prices and free-tier allowances can change; confirm the linked provider pages before creating resources.

| Service | Current option relevant to this project | Suitability |
|---|---|---|
| Cloudflare Pages | Free plan: 500 builds/month; Pages defaults to SPA routing when there is no root `404.html`. | Suitable for a static portfolio/demo frontend. |
| Render Web Service | A Free service is available, but sleeps after 15 minutes idle, may take about a minute to wake, and has an ephemeral filesystem. | Demo only. Do not store civic reports in its filesystem. |
| Render Postgres Free | Free databases are limited to 1 GB, expire after 30 days, and are deleted after the 14-day post-expiry grace period; there are no backups. | Not suitable for permanent civic data. |
| Neon Free PostgreSQL | $0/month, 1 GB per project, 100 compute-hours per project, automatic scale-to-zero after five minutes, and 5 GB public network transfer per project. | Practical for a public demonstration with low traffic; not a production availability or backup guarantee. |
| Neon Launch PostgreSQL | Usage-based: current published rates include $0.106/CU-hour and $0.35/GB-month storage; Neon estimates about $15/month for a small database workload. | A possible paid persistent option. Set spending alerts and re-check pricing first. |

This is not a request to create or upgrade a paid resource. Render's Free Postgres has data-loss-by-expiration risk, so this guide uses an external PostgreSQL URL. For a portfolio demo, a Neon Free database can avoid that fixed 30-day expiry, but still has quotas, scale-to-zero delay, and no production SLA. Choose a paid database only after reviewing its current billing and backup terms.

Official references:

- [Render pricing](https://render.com/pricing), [web services](https://render.com/docs/web-services), [free instances](https://render.com/docs/free), and [PostgreSQL](https://render.com/docs/postgresql)
- [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [SPA serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/), and [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Neon pricing](https://neon.com/pricing) and [Neon plans](https://neon.com/docs/introduction/plans)

## 1. Prepare PostgreSQL

1. Create a PostgreSQL project with the provider and plan you selected.
2. Copy its connection URL from the provider dashboard. Keep it private; do not commit it or put it in a frontend variable.
3. Keep the existing SQLite file as a backup. ThermoRoute does not automatically copy local SQLite records into PostgreSQL. If those records are needed in the hosted instance, export/import them as a separate, verified step before switching traffic.
4. Confirm the PostgreSQL URL includes the provider's SSL settings when required (for example, `sslmode=require`).

## 2. Deploy the backend to Render

The root `render.yaml` defines a free-plan Render web service, but deliberately does **not** create a database resource. During Blueprint setup or in the Render dashboard, set:

| Variable | Value |
|---|---|
| `APP_ENV` | `production` (set by the Blueprint) |
| `DATABASE_URL` | PostgreSQL connection URL from step 1 |
| `CIVIC_ADMIN_TOKEN` | A long, randomly generated secret; store it only in Render |
| `CORS_ORIGINS` | Exact Cloudflare Pages origin, e.g. `https://<project>.pages.dev` |

Render uses `backend/` as the service root, installs `backend/requirements.txt`, binds Uvicorn to `0.0.0.0:$PORT`, and checks `/api/health`. In production, the service refuses to pass health checks or serve civic endpoints if PostgreSQL is missing or unreachable. If choosing a paid Render web service or database, verify its current price in Render before confirming creation.

For local development, leave `DATABASE_URL` empty to keep the existing SQLite behavior. `CIVIC_ADMIN_TOKEN` is required only for moderator actions; civic report submission and reading remain public by design.

## 3. Deploy the frontend to Cloudflare Pages

Create a Pages project linked to the repository with:

- **Root directory:** repository root (the directory containing `package.json`)
- **Build command:** `npm ci && npm run build`
- **Build output directory:** `dist`
- **Node.js:** 20
- **Environment variable:** `VITE_API_URL=https://<your-render-service>.onrender.com`

`VITE_API_URL` is public and is baked into the frontend build; never place an admin token, API key, or database URL there. Set the same variable for production and preview environments only when those deployments should call the corresponding backend.

Cloudflare Pages provides SPA fallback automatically because this project does not ship a root `404.html`; no custom redirect file is required.

## 4. Verify the deployment

1. Open `https://<your-render-service>.onrender.com/api/health`. It should return HTTP 200 and `status: healthy`. A PostgreSQL outage or missing production URL should return HTTP 503.
2. Open the Pages URL, inspect the browser Network panel, and verify API calls target the configured Render URL rather than the Pages host or a localhost URL.
3. Submit a clearly labelled test civic observation. Confirm it remains `unverified` and is still present after a backend redeploy/restart.
4. Confirm status updates and deletion are unavailable without a moderator token, and work only after entering the backend-configured token in the Civic module. Do not expose the token during a demo.
5. Test the app on a narrow mobile viewport, and verify map, geocoder, routing, and forecast errors are visible when public providers are unavailable.
6. Review Render and database usage, backup policy, CORS origin, and free-tier quotas before sharing the URL broadly.

## 5. CI and local verification

GitHub Actions runs on pushes and pull requests using the project lockfiles:

```powershell
npm ci
npm audit --omit=dev
npm run check:version
npm run lint
npm run type-check
npm run build
py -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
py -m compileall -q backend
py -m pytest -q
```

Do not push any changes or connect a deployment to automatic production deploys until you have reviewed and approved the repository changes.
