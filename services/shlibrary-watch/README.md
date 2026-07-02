# Shanghai Library Book Watch

Monitor books on [Shanghai Library VuFind](https://vufind.library.sh.cn) without logging in. Add record IDs from your favorites page, get periodic availability checks, and receive alerts via **Telegram** and/or **RSS**.

No library login is required. You only need the public record ID from URLs like:

`https://vufind.library.sh.cn/Record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9`

## Quick start

```bash
cd services/shlibrary-watch
pnpm install

export SHLIBRARY_WATCH_TOKEN="choose-a-long-random-token"
export TELEGRAM_BOT_TOKEN="optional"
export TELEGRAM_CHAT_ID="optional"
export CHECK_INTERVAL_MINUTES=30
export PUBLIC_BASE_URL="https://your-host.example.com"

pnpm start
```

## Add a book

```bash
curl -X POST http://127.0.0.1:3928/api/books \
  -H "Authorization: Bearer $SHLIBRARY_WATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://vufind.library.sh.cn/Record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9",
    "title": "废墟是一座桥"
  }'
```

You can also pass `"recordId": "<uuid>"` directly.

## Remove a book

```bash
curl -X DELETE http://127.0.0.1:3928/api/books/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9 \
  -H "Authorization: Bearer $SHLIBRARY_WATCH_TOKEN"
```

## List watched books

```bash
curl http://127.0.0.1:3928/api/books
```

## RSS feeds

| Feed | URL | Purpose |
|------|-----|---------|
| Availability alerts | `/rss` | New items when a watched book **becomes** borrowable |
| Current status snapshot | `/rss/status` | Latest status of all watched books (refreshed on each fetch) |

Subscribe `/rss` in your RSS reader for passive notifications. The service also polls in the background and can push to Telegram immediately when status changes.

## Telegram setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the bot token.
2. Send any message to your bot, then open:
   `https://api.telegram.org/bot<token>/getUpdates`
   to find your `chat_id`.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

## Manual check

```bash
curl -X POST http://127.0.0.1:3928/api/check \
  -H "Authorization: Bearer $SHLIBRARY_WATCH_TOKEN"
```

## How it works

1. You copy record IDs from your logged-in favorites page (one-time, manual).
2. The service stores them in `data/watchlist.json`.
3. Every `CHECK_INTERVAL_MINUTES` (default 30, minimum 5), it calls the public VuFind endpoint:
   `POST /AJAX/JSON?method=getItemStatuses`
4. When a book transitions from unavailable → available, it:
   - appends an event to the RSS feed (`/rss`)
   - sends a Telegram message (if configured)

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SHLIBRARY_WATCH_TOKEN` | yes (for add/remove) | — | Bearer token for write APIs |
| `TELEGRAM_BOT_TOKEN` | no | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | no | — | Telegram chat ID |
| `CHECK_INTERVAL_MINUTES` | no | `30` | Poll frequency |
| `PORT` | no | `3928` | HTTP port |
| `PUBLIC_BASE_URL` | no | `http://127.0.0.1:3928` | Used in RSS links |
| `DATA_DIR` | no | `./data` | Watchlist storage directory |

## Workflow with favorites

1. Open [My Favorites](https://vufind.library.sh.cn/MyResearch/Favorites) while logged in.
2. For each book you want to track, copy the link from the title.
3. `POST /api/books` with that URL.
4. When you no longer care about a book, `DELETE /api/books/:recordId`.

## Notes

- Status is checked per **copy** (location + call number). Any borrowable copy triggers an alert.
- Statuses like **编目中 (Cataloging)** are treated as not borrowable.
- The top-level VuFind `Available` label can be misleading; this service reads per-copy status from the detailed holdings table.
- Data is stored locally in `data/watchlist.json`. Back it up if you redeploy.
