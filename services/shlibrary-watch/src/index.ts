import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { buildAvailabilityRss, buildStatusRss } from './rss.js';
import { fetchBookStatus, fetchBookStatuses } from './shlibrary.js';
import type { AvailabilityEvent, WatchedBook } from './types.js';
import { WatchlistStore } from './watchlist.js';

/* eslint-disable no-console -- standalone service logs to stdout */

const port = Number.parseInt(process.env.PORT ?? '3928', 10);
const checkIntervalMinutes = Number.parseInt(process.env.CHECK_INTERVAL_MINUTES ?? '30', 10);
const adminToken = process.env.SHLIBRARY_WATCH_TOKEN ?? '';
const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, '');
const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');

const store = new WatchlistStore(dataDir);
const app = new Hono();

function requireAdmin(authHeader: string | undefined): boolean {
    if (!adminToken) {
        return false;
    }
    return authHeader === `Bearer ${adminToken}`;
}

function extractRecordId(input: string): string | null {
    const trimmed = input.trim();
    const fromUrl = trimmed.match(/\/Record\/([0-9a-f-]{36})/i);
    if (fromUrl) {
        return fromUrl[1];
    }
    if (/^[0-9a-f-]{36}$/i.test(trimmed)) {
        return trimmed;
    }
    return null;
}

async function runCheck(): Promise<{ checked: number; newlyAvailable: number }> {
    const books = await store.listBooks();
    if (books.length === 0) {
        return { checked: 0, newlyAvailable: 0 };
    }

    const titleById = new Map(books.map((book) => [book.recordId, book.title]));
    const statuses = await fetchBookStatuses(
        books.map((book) => book.recordId),
        titleById
    );

    let newlyAvailable = 0;
    const updatedBooks: WatchedBook[] = [];
    const newEvents: AvailabilityEvent[] = [];

    for (const book of books) {
        const status = statuses.get(book.recordId);
        const nextBook: WatchedBook = { ...book };

        if (!status) {
            nextBook.lastCheckedAt = new Date().toISOString();
            nextBook.lastState = 'unknown';
            nextBook.lastSummary = 'Status unavailable';
            updatedBooks.push(nextBook);
            continue;
        }

        if (status.title && status.title !== status.recordId) {
            nextBook.title = nextBook.title ?? status.title;
        }

        const becameAvailable = status.state === 'available' && book.lastState !== 'available';

        nextBook.lastCheckedAt = status.checkedAt;
        nextBook.lastState = status.state;
        nextBook.lastSummary = status.summary;

        if (status.state === 'available') {
            nextBook.availableSince = becameAvailable ? status.checkedAt : (book.availableSince ?? status.checkedAt);
        } else {
            nextBook.availableSince = undefined;
        }

        if (becameAvailable) {
            newlyAvailable += 1;
            const event: AvailabilityEvent = {
                id: randomUUID(),
                recordId: status.recordId,
                title: nextBook.title ?? status.recordId,
                link: status.link,
                summary: status.summary,
                copies: status.borrowableCopies,
                occurredAt: status.checkedAt,
            };
            newEvents.push(event);
        }

        updatedBooks.push(nextBook);
    }

    await Promise.all(newEvents.map((event) => store.appendEvent(event)));
    await store.updateBooks(updatedBooks);
    return { checked: books.length, newlyAvailable };
}

app.get('/', (c) =>
    c.json({
        name: 'shlibrary-watch',
        description: 'Monitor Shanghai Library book availability without logging in.',
        endpoints: {
            list: 'GET /api/books',
            add: 'POST /api/books',
            remove: 'DELETE /api/books/:recordId',
            checkNow: 'POST /api/check',
            availabilityRss: 'GET /rss',
            statusRss: 'GET /rss/status',
        },
        docs: 'See services/shlibrary-watch/README.md',
    })
);

app.get('/health', (c) => c.json({ ok: true }));

app.get('/api/books', async (c) => {
    const books = await store.listBooks();
    return c.json({ books });
});

app.post('/api/books', async (c) => {
    if (!requireAdmin(c.req.header('authorization'))) {
        return c.json({ error: 'Unauthorized. Set SHLIBRARY_WATCH_TOKEN and send Authorization: Bearer <token>.' }, 401);
    }

    const body = await c.req.json<{ recordId?: string; title?: string; note?: string; url?: string }>();
    const recordId = extractRecordId(body.url ?? body.recordId ?? '');
    if (!recordId) {
        return c.json({ error: 'Provide recordId (UUID) or a /Record/<uuid> URL.' }, 400);
    }

    let title = body.title?.trim();
    if (!title) {
        try {
            const status = await fetchBookStatus(recordId);
            title = status.title === recordId ? undefined : status.title;
        } catch {
            title = undefined;
        }
    }

    const book = await store.addBook({ recordId, title, note: body.note?.trim() });
    return c.json({ book }, 201);
});

app.delete('/api/books/:recordId', async (c) => {
    if (!requireAdmin(c.req.header('authorization'))) {
        return c.json({ error: 'Unauthorized. Set SHLIBRARY_WATCH_TOKEN and send Authorization: Bearer <token>.' }, 401);
    }

    const recordId = c.req.param('recordId');
    const removed = await store.removeBook(recordId);
    if (!removed) {
        return c.json({ error: 'Book not found in watchlist.' }, 404);
    }
    return c.json({ removed: true, recordId });
});

app.post('/api/check', async (c) => {
    if (!requireAdmin(c.req.header('authorization'))) {
        return c.json({ error: 'Unauthorized. Set SHLIBRARY_WATCH_TOKEN and send Authorization: Bearer <token>.' }, 401);
    }

    const result = await runCheck();
    return c.json(result);
});

app.get('/rss', async (c) => {
    const events = await store.listEvents(100);
    const xml = buildAvailabilityRss({ baseUrl: publicBaseUrl, events });
    return c.body(xml, 200, {
        'content-type': 'application/rss+xml; charset=utf-8',
    });
});

app.get('/rss/status', async (c) => {
    const books = await store.listBooks();
    const titleById = new Map(books.map((book) => [book.recordId, book.title]));
    const statuses = await fetchBookStatuses(
        books.map((book) => book.recordId),
        titleById
    );

    const payload = books
        .map((book) => {
            const status = statuses.get(book.recordId);
            if (!status) {
                return null;
            }
            return {
                recordId: book.recordId,
                title: book.title ?? book.recordId,
                link: status.link,
                state: status.state,
                summary: status.summary,
                checkedAt: status.checkedAt,
                copies: status.allCopies,
            };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

    const xml = buildStatusRss({ baseUrl: publicBaseUrl, books: payload });
    return c.body(xml, 200, {
        'content-type': 'application/rss+xml; charset=utf-8',
    });
});

await store.init();

serve(
    {
        fetch: app.fetch,
        port,
        hostname: '0.0.0.0',
    },
    () => {
        console.log(`shlibrary-watch listening on http://127.0.0.1:${port}`);
        console.log(`Availability RSS: ${publicBaseUrl}/rss`);
        console.log(`Status RSS: ${publicBaseUrl}/rss/status`);
    }
);

const intervalMs = Math.max(checkIntervalMinutes, 5) * 60 * 1000;
setInterval(() => {
    runCheck().then(
        (result) => {
            if (result.checked > 0) {
                console.log(`Checked ${result.checked} book(s); newly available: ${result.newlyAvailable}`);
            }
        },
        (error) => {
            console.error('Scheduled check failed:', error);
        }
    );
}, intervalMs);

runCheck().catch((error) => {
    console.error('Initial check failed:', error);
});
