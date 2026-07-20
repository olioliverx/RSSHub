# Shanghai Library Book Availability — Project Handoff

**For:** Full-scale review by Fable  
**Repo:** [olioliverx/RSSHub](https://github.com/olioliverx/RSSHub) (fork)  
**Deployment:** Vercel Production  
**Integration:** [RSS-to-Telegram-Bot](https://github.com/Rongronggg9/RSS-to-Telegram-Bot) on VPS

---

## 1. Mission

Build **personal book-borrow alerts** for [Shanghai Library VuFind OPAC](https://vufind.library.sh.cn) using the user's existing stack — no custom app, no library login.

| Requirement                               | How we meet it                                               |
| ----------------------------------------- | ------------------------------------------------------------ |
| Track favorites without logging in        | Public status API + record UUID from favorites URL           |
| Add/remove via Telegram                   | `/sub` and `/unsub` on RSS-to-Telegram-Bot                   |
| Notify when a book **becomes borrowable** | RSS item only on availability transition                     |
| Use original Chinese status text          | `Accept-Language: zh-CN`; titles like `社会契约论 — 已归还`  |
| No repeat alerts every ~60 min            | Stable `guid` + in-memory state cache                        |
| Run on Vercel serverless                  | Single RSSHub route; resilient fetch for cross-border issues |

**Out of scope (by design):**

- Library account login
- Built-in Telegram in RSSHub
- Standalone `shlibrary-watch` service (removed)
- "Notify on any status change" (discussed; not implemented)

---

## 2. Architecture

```
User copies record UUID from My Favorites (one-time)
        ↓
/sub https://<rsshub-domain>/shlibrary/record/<uuid>
        ↓
RSS-to-Telegram-Bot polls RSSHub ~every 60 min (feed `<ttl>60</ttl>`)
        ↓
RSSHub → POST vufind.library.sh.cn/AJAX/JSON?method=getItemStatuses
        ↓
Parse per-copy status from full_status HTML (zh-CN)
        ↓
Compare with cached state → emit RSS item only on new borrowability
        ↓
Telegram notification
        ↓
/unsub when done
```

**Identifier:** Record UUID from  
`https://vufind.library.sh.cn/Record/<uuid>`  
**Not** status strings like `已归还`.

---

## 3. What Was Built

### 3.1 RSSHub route (production path)

| File                                | Role                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| `lib/routes/shlibrary/namespace.ts` | Namespace: 上海图书馆                                         |
| `lib/routes/shlibrary/utils.ts`     | API client, status parsing, title resolution, Chinese headers |
| `lib/routes/shlibrary/record.ts`    | Route handler, cache-based alert logic                        |

**Route:** `/shlibrary/record/:id`  
**Example:** `/shlibrary/record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9`

**Query parameters:**

| Param         | Default      | Purpose                                                  |
| ------------- | ------------ | -------------------------------------------------------- |
| _(none)_      | `mode=alert` | Alert when book becomes borrowable; empty feed otherwise |
| `mode=status` | —            | Debug: always return current status (not for Telegram)   |
| `title=`      | —            | Manual title when metadata API fails from Vercel         |

### 3.2 Alert logic (`mode=alert`, default)

1. Fetch status via `POST /AJAX/JSON?method=getItemStatuses` with `id[]=<uuid>`
2. Parse per-copy rows from `full_status` HTML (`fullLocation`, `fullCallnumber`, `fullAvailability`)
3. **Borrowable** if status matches: 已归还, 可借, 在馆, 在架, Available, etc.
4. **Not borrowable** if matches: 编目中, 借出, 流转中, Cataloging, Checked out, etc.
5. If **not borrowable** → update cache, return **empty feed**
6. If **borrowable** and same as last notification (`availabilityKey`) → **empty feed**
7. If **newly borrowable** or availability changed → **one RSS item** with stable `guid`

**Cache keys:** `shlibrary:state:<recordId>` (30 days), `shlibrary:title:<recordId>` (7 days)

### 3.3 Pull request history

| PR     | Title                                                        | Status     | Summary                                                                                 |
| ------ | ------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------- |
| **#1** | feat(shlibrary): add Shanghai Library availability RSS route | **Merged** | Initial 3-file route                                                                    |
| **#2** | Set up Cursor Cloud dev environment                          | Closed     | Not merged                                                                              |
| **#3** | fix: stop repeat Telegram alerts and duplicate message body  | **Merged** | Stable guid, empty feed on unchanged state                                              |
| **#4** | fix: use Shanghai Library Chinese status labels              | **Merged** | `Accept-Language: zh-CN`, Chinese titles                                                |
| **#5** | fix: Vercel fetch failures                                   | **Merged** | Status-first; title non-fatal; `config.trueUA`; timeout/retry; optional `?title=`       |
| **#6** | docs: add project handoff                                    | Superseded | Doc landed via the review/cleanup PR below instead                                      |
| **#7** | chore(shlibrary): review cleanup                             | —          | Fable full-scale review pass: cheerio parsing, `ofetch`, unit tests, this doc (see §10) |

**Removed:** `services/shlibrary-watch/` — user uses Vercel + bot only.

---

## 4. Key Discoveries (Shanghai Library)

1. **Favorites** (`/MyResearch/Favorites`) require login; there is no public favorites RSS.
2. **Public status API works without login:**  
   `POST /AJAX/JSON?method=getItemStatuses` with `id[]=<uuid>`
3. **Search RSS** (`sort=last_indexed`) tracks catalog re-index, not live circulation — unsuitable for borrow alerts.
4. **Chinese labels** need `Accept-Language: zh-CN`; otherwise API returns English "Available".
5. **Top-level availability label can mislead**; per-copy `full_status` is authoritative.
6. **Vercel → `vufind.library.sh.cn`:** `GET /api/v1/record` (title) may fail with `fetch failed`; status POST often still works (PR #5 addresses this).

---

## 5. User Workflow (final)

**Subscribe:**

```
/sub https://YOUR-RSSHUB-DOMAIN/shlibrary/record/<record-uuid>
```

**Optional title if metadata fails:**

```
/sub https://YOUR-RSSHUB-DOMAIN/shlibrary/record/<uuid>?title=书名
```

**Unsubscribe:**

```
/unsub https://YOUR-RSSHUB-DOMAIN/shlibrary/record/<record-uuid>
```

**Deploy:** Merge to fork `master` → Vercel Production (not Preview branches).

---

## 6. Known Limitations

| Topic                             | Notes                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| In-memory cache on Vercel         | Cold starts / multiple instances may occasionally duplicate alerts; user accepts this |
| No Redis                          | State is best-effort across serverless instances                                      |
| Title API from overseas           | Mitigated by PR #5; fallback to UUID or `?title=`                                     |
| Both APIs blocked from Vercel     | Would need proxy or China-adjacent hosting                                            |
| `mode=change` (any status change) | Discussed, not implemented                                                            |
| Fork CI                           | May show red X; Vercel build passes                                                   |

---

## 7. Test Cases Used

| Book               | Record ID                              | Status observed    | Use case                        |
| ------------------ | -------------------------------------- | ------------------ | ------------------------------- |
| 废墟是一座桥       | `67b350c3-8fa8-42a4-ae13-7ab92e4c89e9` | 编目中（暂不借阅） | Waiting for availability        |
| 社会契约论         | `31e720f1-0663-4362-8537-8f6b8ec7a0ed` | 已归还             | Repeat-notification bug         |
| 刘索拉：你别无选择 | `055a48a1-715e-4d73-a0e1-46d5e4947d23` | —                  | Vercel record API fetch failure |

---

## 8. Suggested Scope for Fable Full-Scale Review

### Correctness

- Status parsing from `full_status` HTML
- Borrowability regex rules (`AVAILABLE_PATTERN` / `UNAVAILABLE_PATTERN`)
- Alert transition logic: unavailable → available, re-borrow after 借出, already-available on first `/sub`
- `guid` stability and deduplication across bot polls

### Reliability

- Vercel/serverless + in-memory cache behavior
- PR #5: status fetched before title; title failure non-fatal
- Timeout/retry via `config.requestTimeout` / `config.requestRetry`
- Cold-start duplicate alert risk

### Security

- No secrets; public API only
- Abuse surface of optional `?title=` query param
- Input validation on `recordId`

### RSSHub conventions

- `config.trueUA`, route metadata, `allowEmpty: true`
- Maintainers, categories, radar, example path
- Compliance with project `AGENTS.md` review guidelines

### UX

- Telegram message format (title + description)
- Duplicate body content (fixed in PR #3)
- Chinese labels end-to-end

### Deployment

- Fork-only changes; isolation from other RSSHub routes
- Post-merge: redeploy Vercel Production, re-test `/sub` URLs

### Future (optional)

- `?mode=change` for any status transition
- Redis/external cache for production hardening

---

## 9. Current State

- **Production code:** `lib/routes/shlibrary/*` on fork `master` (PRs #1–#5 merged)
- **Full-scale review:** Done — findings and fixes in §10 (review/cleanup PR)
- **Next step:** Merge the review/cleanup PR, redeploy Vercel Production, re-test `/sub` URLs
- **No open code task** unless the user requests `mode=change`

---

## 10. Fable Full-Scale Review Results

Reviewed against §8 scope and the repository `AGENTS.md` guidelines.

### Verdict

The core design is sound: transition-based alerting with stable `guid`s, status API as source of truth, non-fatal title resolution, `allowEmpty: true`. No security issues — the route only calls public read-only endpoints, and the `?title=` hint only affects the requester's own feed rendering.

### Fixes applied in the review/cleanup PR

| Area                            | Before                                                                                                                                                 | After                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User-Agent (route-breaking)** | `config.trueUA` (`RSSHub/1.0 ...`) — the library WAF now answers **403 Forbidden** to it, so both APIs failed                                          | Browser-like `config.ua`; `antiCrawler: true` set on the route                                                                                                    |
| JSON parsing                    | The status endpoint answers with `content-type: application/javascript`, which `ofetch` does not auto-parse                                            | Explicit `parseResponse: JSON.parse`                                                                                                                              |
| `full_status` parsing           | Regex over raw HTML; broke on attribute/column-order changes and left entities like `&amp;` encoded                                                    | cheerio-based parsing of `td.fullLocation` / `td.fullCallnumber` / `td.fullAvailability`, entities decoded                                                        |
| HTTP client                     | Legacy `got` compatibility wrapper                                                                                                                     | Repo-standard `ofetch` (built-in retry + proxy-on-retry) with `config.requestTimeout` kept                                                                        |
| Title cache                     | A failed title lookup cached the record UUID as the "title" for 7 days                                                                                 | Only successful lookups are cached; failures fall back to the UUID per request                                                                                    |
| State writes                    | `cache.set` fire-and-forget — on serverless the function could return before the write landed, causing duplicate alerts                                | `await`-ed writes                                                                                                                                                 |
| Fetch ordering                  | Status then title, sequential                                                                                                                          | `Promise.all` — same failure semantics (title never throws), one round-trip faster                                                                                |
| Route metadata                  | `title` listed in `parameters` although it is a query string, not a path parameter (violates AGENTS.md rule 47)                                        | Moved to the route description alongside `mode=status`                                                                                                            |
| Dead code                       | Unused `BookStatus.title` field and `titleHint` parameter on `fetchBookStatus`; redundant `processing中` regex branch; duplicated copy-line formatting | Removed / deduplicated                                                                                                                                            |
| Tests                           | None                                                                                                                                                   | `lib/routes/shlibrary/utils.test.ts` — borrowability rules (including "借出（可预约）" staying unavailable), HTML parsing, state derivation, description building |

### Live verification (dev server against the real API)

- 社会契约论 (`31e720f1…`, 已归还): first alert poll emits one item `社会契约论 — 已归还` with a stable `guid`; a fresh handler run afterwards emits zero items (state dedupe works; identical responses within the route cache window are harmless because the `guid` is unchanged).
- 废墟是一座桥 (`67b350c3…`, 编目中): alert poll emits zero items; feed title resolves from the record API.
- `mode=status` and `?title=` both behave as documented.
- Unit tests: 14/14 pass; `eslint`, `oxfmt`, and `tsc` clean for the touched files.

### Intentionally NOT changed

- `?mode=` / `?title=` stay query parameters (AGENTS.md prefers path params) — changing them would break the user's live `/sub` subscriptions.
- `pubDate` is the transition detection time (`checkedAt`); the bot dedupes on `guid`, so a cold-start regeneration with a newer `pubDate` does not re-notify.
- In-memory cache remains best-effort on Vercel; Redis is still the hardening option if duplicate alerts ever become annoying.

### Branch housekeeping

Merged branches `cursor/shlibrary-fix-alerts-5cd9`, `cursor/shlibrary-zh-status-5cd9`, and `cursor/shlibrary-fetch-fix-5cd9` deleted (the stray post-merge commit on `fix-alerts` was byte-identical to the merged `zh-status` tip). This document was folded into the review/cleanup PR, superseding PR #6 — `cursor/shlibrary-handoff-doc-5cd9` can be deleted (which closes PR #6) once this PR merges.
