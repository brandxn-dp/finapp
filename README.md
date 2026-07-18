# FinApp

Self-hosted finance & budgeting PWA. Import bank transactions automatically (SimpleFIN) or by CSV, let Claude categorize them, get budgets suggested from your actual spending patterns, and compare debt-payoff and saving strategies visually. Modern light/dark UI, installable as an app, one Docker container, all data in a single SQLite file on your server.

## Features

- **Bank auto-import** — connect [SimpleFIN Bridge](https://beta-bridge.simplefin.org) (~$1.50/mo, US/CA banks) once in Settings; sync pulls accounts, balances, and transactions.
- **Bulk CSV import** — column mapping, preview, sign flipping, and duplicate detection built in.
- **AI categorization** — rules and known merchants are matched instantly and free; only genuinely new merchants are sent to Claude (name + amount only), classified once, and remembered forever. Your manual corrections always win and teach the cache.
- **Budget estimation** — recurring-payment detection and per-category monthly medians turn your history into suggested budgets you can apply with one click.
- **Debt planner** — snowball vs avalanche simulated against your real debts: debt-free dates, total interest, payoff order, and balance-over-time chart.
- **Savings insights** — 50/30/20 check, emergency-fund coverage, subscription audit, and an optional AI-written monthly check-in (aggregated stats only — raw transactions never leave your server).
- **PWA** — installable, with light and dark themes that follow your system preference.

## Quick start

A pre-built image is published to GitHub Container Registry on every push to `main`:
`ghcr.io/brandxn-dp/finapp:latest`. Nothing to build — just pull it.

```bash
docker run -d --name finapp \
  -p 8484:8484 \
  -v /mnt/user/appdata/finapp:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  --restart unless-stopped \
  ghcr.io/brandxn-dp/finapp:latest
# open http://<server-ip>:8484
```

Or with compose (uses the published image by default):

```bash
docker compose up -d
```

### Unraid (pull the pre-built image)

Docker tab → **Add Container**:

- **Repository:** `ghcr.io/brandxn-dp/finapp:latest`
- **Network Type:** Bridge
- **Add Port:** container `8484` → host `8484` (TCP)
- **Add Path:** container `/data` → host `/mnt/user/appdata/finapp`
- **Add Variable** (optional): `ANTHROPIC_API_KEY` = your key; `CLAUDE_MODEL` = `claude-opus-4-8`

Apply, then open `http://<unraid-ip>:8484`. To update later, hit **Force Update** on
the container (or use the CA Auto Update Applications plugin) — it re-pulls the latest
image the CI built. No rebuild step, because the image is built for you on GitHub.

### Build from source instead

```bash
docker build -t finapp .
docker run -d --name finapp -p 8484:8484 -v ./data:/data finapp
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | *(unset)* | Enables AI categorization + monthly check-ins. Get one at [console.anthropic.com](https://console.anthropic.com). Without it, rules + merchant memory still work. |
| `CLAUDE_MODEL` | `claude-opus-4-8` | Model for categorization/insights. `claude-haiku-4-5` is the budget option. |
| `PORT` | `8484` | HTTP port. |
| `DATA_DIR` | `/data` | Where `finapp.sqlite` lives — map this to persistent storage. |

### ⚠️ Security

FinApp has **no built-in login** — it is designed for a trusted home LAN. Do not expose the port to the internet directly; if you want remote access, put it behind your reverse proxy's authentication (Authelia, basic auth, Tailscale, etc.).

## Getting your data in

1. **CSV**: Transactions → *Import CSV*. Works with exports from any bank; map the date/amount/payee columns, check the preview, import. Duplicates are skipped automatically, so re-importing overlapping exports is safe.
2. **SimpleFIN**: Settings → *Bank sync* → paste a setup token. After that, *Sync now* pulls new transactions (only settled ones) any time.
3. Hit **Auto-categorize** on the Transactions page. Rules and remembered merchants run free and instantly; anything new goes to Claude in one batch.

## Development

```bash
npm install
npm run dev        # API on :8484, web on :5173 (proxied)
```

`npm run build` builds the PWA and compiles the server; `npm start` runs the production server (serves the built PWA on one port).

## Disclaimer

The insights, budget suggestions, and debt/saving comparisons are educational information about widely-used budgeting methods applied to your numbers — not professional financial advice.
