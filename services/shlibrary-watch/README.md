# Shanghai Library Book Watch (optional self-hosted service)

> **Using RSSHub on Vercel?** You probably do **not** need this service.
> Use the RSSHub route instead: `/shlibrary/record/:id`
> See the section below.

This folder is an **optional** self-hosted companion for users who want a local watchlist API and background polling without relying on RSS-to-Telegram-Bot to poll RSSHub.

## Recommended: RSSHub + RSS-to-Telegram-Bot (Vercel)

If RSSHub is already deployed (e.g. on Vercel) and you run [RSS-to-Telegram-Bot](https://github.com/Rongronggg9/RSS-to-Telegram-Bot) on a VPS, this is the simplest setup:

### 1. Get the record ID from your favorites

Log in to [My Favorites](https://vufind.library.sh.cn/MyResearch/Favorites), open a book, and copy the UUID from the URL:

`https://vufind.library.sh.cn/Record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9`
└──────────── this part ────────────┘

### 2. Subscribe in RSS-to-Telegram-Bot

Replace `your-rsshub.app` with your RSSHub domain:

```
/sub https://your-rsshub.app/shlibrary/record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9
```

Your bot will poll RSSHub periodically. When the book **becomes borrowable**, RSSHub emits a new feed item and the bot pushes it to Telegram.

### 3. Unsubscribe when done

```
/unsub https://your-rsshub.app/shlibrary/record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9
```

### Add / remove = subscribe / unsubscribe

There is no separate web UI. **RSS-to-Telegram-Bot is the interface:**

| What you want      | What to do                                             |
| ------------------ | ------------------------------------------------------ |
| Track a new book   | `/sub https://your-rsshub.app/shlibrary/record/<uuid>` |
| Stop tracking      | `/unsub` the same URL                                  |
| List subscriptions | Use your RSS-to-Telegram-Bot commands (e.g. `/list`)   |

One Telegram subscription = one book. Track ten books = ten `/sub` commands.

### Debug current status (optional)

Append `?mode=status` to see the current holdings snapshot. **Do not** use this mode for Telegram subscriptions — it may repeat notifications.

```
https://your-rsshub.app/shlibrary/record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9?mode=status
```

---

## Optional: this self-hosted service

Use this only if you want a local JSON watchlist and a combined RSS feed without managing one subscription per book.

```bash
cd services/shlibrary-watch
pnpm install
export SHLIBRARY_WATCH_TOKEN="choose-a-long-random-token"
export CHECK_INTERVAL_MINUTES=30
pnpm start
```

See the API section in the previous version of this README via `GET /` on port 3928.

Telegram is **not** built in — point RSS-to-Telegram-Bot at `http://your-host:3928/rss` if you use this service.
