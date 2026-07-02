import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AvailabilityEvent, WatchStore, WatchedBook } from './types.js';

const DEFAULT_STORE: WatchStore = {
    books: [],
    events: [],
};

export class WatchlistStore {
    private readonly filePath: string;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(dataDir: string) {
        this.filePath = path.join(dataDir, 'watchlist.json');
    }

    async init(): Promise<void> {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        try {
            await readFile(this.filePath, 'utf8');
        } catch {
            await this.write(DEFAULT_STORE);
        }
    }

    private async read(): Promise<WatchStore> {
        const raw = await readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as WatchStore;
        return {
            books: parsed.books ?? [],
            events: parsed.events ?? [],
        };
    }

    private async write(store: WatchStore): Promise<void> {
        await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.writeQueue.then(task, task);
        this.writeQueue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    async listBooks(): Promise<WatchedBook[]> {
        const store = await this.read();
        return store.books;
    }

    async addBook(input: { recordId: string; title?: string; note?: string }): Promise<WatchedBook> {
        return this.enqueue(async () => {
            const store = await this.read();
            const existing = store.books.find((book) => book.recordId === input.recordId);
            if (existing) {
                if (input.title) {
                    existing.title = input.title;
                }
                if (input.note) {
                    existing.note = input.note;
                }
                await this.write(store);
                return existing;
            }

            const book: WatchedBook = {
                recordId: input.recordId,
                title: input.title,
                note: input.note,
                addedAt: new Date().toISOString(),
            };
            store.books.push(book);
            await this.write(store);
            return book;
        });
    }

    async removeBook(recordId: string): Promise<boolean> {
        return this.enqueue(async () => {
            const store = await this.read();
            const before = store.books.length;
            store.books = store.books.filter((book) => book.recordId !== recordId);
            if (store.books.length === before) {
                return false;
            }
            await this.write(store);
            return true;
        });
    }

    async updateBooks(books: WatchedBook[]): Promise<void> {
        await this.enqueue(async () => {
            const store = await this.read();
            store.books = books;
            await this.write(store);
        });
    }

    async appendEvent(event: AvailabilityEvent): Promise<void> {
        await this.enqueue(async () => {
            const store = await this.read();
            store.events.unshift(event);
            store.events = store.events.slice(0, 200);
            await this.write(store);
        });
    }

    async listEvents(limit = 50): Promise<AvailabilityEvent[]> {
        const store = await this.read();
        return store.events.slice(0, limit);
    }
}
