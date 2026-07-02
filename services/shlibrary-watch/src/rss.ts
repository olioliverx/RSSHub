import type { AvailabilityEvent, CopyStatus } from './types.js';

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function formatCopies(copies: CopyStatus[]): string {
    if (copies.length === 0) {
        return '<p>No borrowable copy details returned.</p>';
    }
    const rows = copies
        .map((copy) => {
            const location = escapeXml(copy.location || 'Unknown location');
            const callNumber = escapeXml(copy.callNumber || '-');
            const status = escapeXml(copy.status || '-');
            return `<li><strong>${location}</strong> ${callNumber} — ${status}</li>`;
        })
        .join('');
    return `<ul>${rows}</ul>`;
}

export function buildAvailabilityRss(options: {
    baseUrl: string;
    events: AvailabilityEvent[];
}): string {
    const { baseUrl, events } = options;
    const feedLink = `${baseUrl}/rss`;
    const items = events
        .map((event) => {
            const description = `<p>${escapeXml(event.summary)}</p>${formatCopies(event.copies)}`;
            return `<item>
  <title>${escapeXml(`${event.title} is available to borrow`)}</title>
  <link>${escapeXml(event.link)}</link>
  <guid isPermaLink="false">${escapeXml(event.id)}</guid>
  <pubDate>${new Date(event.occurredAt).toUTCString()}</pubDate>
  <description>${description}</description>
</item>`;
        })
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Shanghai Library Availability Alerts</title>
  <link>${escapeXml(feedLink)}</link>
  <description>Notifications when watched Shanghai Library books become available to borrow.</description>
  <language>zh-CN</language>
  ${items}
</channel>
</rss>`;
}

export function buildStatusRss(options: {
    baseUrl: string;
    books: Array<{
        recordId: string;
        title: string;
        link: string;
        state: string;
        summary: string;
        checkedAt: string;
        copies: CopyStatus[];
    }>;
}): string {
    const { baseUrl, books } = options;
    const feedLink = `${baseUrl}/rss/status`;
    const items = books
        .map((book) => {
            const description = `<p>State: ${escapeXml(book.state)}</p><p>${escapeXml(book.summary)}</p>${formatCopies(book.copies)}`;
            return `<item>
  <title>${escapeXml(`${book.title} — ${book.state}`)}</title>
  <link>${escapeXml(book.link)}</link>
  <guid isPermaLink="false">${escapeXml(`status-${book.recordId}-${book.checkedAt}`)}</guid>
  <pubDate>${new Date(book.checkedAt).toUTCString()}</pubDate>
  <description>${description}</description>
</item>`;
        })
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Shanghai Library Watch Status</title>
  <link>${escapeXml(feedLink)}</link>
  <description>Current availability status for watched Shanghai Library books.</description>
  <language>zh-CN</language>
  ${items}
</channel>
</rss>`;
}
