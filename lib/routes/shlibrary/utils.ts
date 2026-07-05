import { load } from 'cheerio';

import { config } from '@/config';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';

const BASE_URL = 'https://vufind.library.sh.cn';
const STATUS_URL = `${BASE_URL}/AJAX/JSON?method=getItemStatuses`;
const TITLE_CACHE_TTL = 60 * 60 * 24 * 7;

// zh-CN Accept-Language is required, otherwise the API answers with English labels.
// The library WAF rejects the RSSHub UA (config.trueUA) with 403, so use the
// browser-like config.ua instead.
const REQUEST_HEADERS = {
    'accept-language': 'zh-CN,zh;q=0.9',
    'user-agent': config.ua,
};

// Unavailable wins over available: e.g. 借出（已预约） must stay unavailable
const UNAVAILABLE_PATTERN = /cataloging|not for borrowing|编目|借出|checked out|processing|修补|装订|遗失|missing|withdrawn|declared lost|预约|on order|订购中|验收|典藏|流转中/i;
const AVAILABLE_PATTERN = /available|可借|在馆|在架|on shelf|可阅览|已归还/i;

export type AvailabilityState = 'available' | 'unavailable' | 'unknown';

export interface CopyStatus {
    location: string;
    callNumber: string;
    status: string;
    borrowable: boolean;
}

export interface BookStatus {
    recordId: string;
    link: string;
    state: AvailabilityState;
    borrowableCopies: CopyStatus[];
    allCopies: CopyStatus[];
    summary: string;
    checkedAt: string;
}

interface ItemStatusResponse {
    data?: {
        statuses?: Array<{
            id: string;
            availability_message?: string;
            full_status?: string;
        }>;
    };
}

interface RecordResponse {
    records?: Array<{
        title?: string;
    }>;
}

function htmlToText(html: string): string {
    return load(html).root().text().replaceAll(/\s+/g, ' ').trim();
}

export function formatPrimaryStatus(copies: CopyStatus[]): string {
    const statuses = [...new Set(copies.map((copy) => copy.status).filter(Boolean))];
    return statuses.join(' / ') || '状态未知';
}

export function isCopyBorrowable(status: string): boolean {
    const normalized = status.trim();
    if (!normalized) {
        return false;
    }
    if (UNAVAILABLE_PATTERN.test(normalized)) {
        return false;
    }
    return AVAILABLE_PATTERN.test(normalized);
}

export function deriveAvailabilityState(copies: CopyStatus[]): AvailabilityState {
    if (copies.length === 0) {
        return 'unknown';
    }
    if (copies.some((copy) => copy.borrowable)) {
        return 'available';
    }
    return 'unavailable';
}

export function parseCopyStatuses(fullStatusHtml: string): CopyStatus[] {
    const $ = load(fullStatusHtml);
    const copies: CopyStatus[] = [];

    $('tr').each((_, row) => {
        const $row = $(row);
        const location = htmlToText($row.find('td.fullLocation').html() ?? '');
        const callNumber = htmlToText($row.find('td.fullCallnumber').html() ?? '');
        const status = htmlToText($row.find('td.fullAvailability').html() ?? '');
        if (!location && !callNumber && !status) {
            return;
        }
        copies.push({
            location,
            callNumber,
            status,
            borrowable: isCopyBorrowable(status),
        });
    });

    return copies;
}

function formatCopyLine(copy: CopyStatus): string {
    const location = copy.location || 'Unknown location';
    const callNumber = copy.callNumber ? ` (${copy.callNumber})` : '';
    return `${location}${callNumber}: ${copy.status}`;
}

function buildSummary(state: AvailabilityState, borrowableCopies: CopyStatus[], allCopies: CopyStatus[], fallback: string): string {
    const copies = state === 'available' ? borrowableCopies : allCopies;
    const details = copies
        .slice(0, 4)
        .map((copy) => formatCopyLine(copy))
        .join('<br/>');
    return details || fallback || (state === 'available' ? '可借' : '暂不可借');
}

export async function fetchRecordTitle(recordId: string): Promise<string> {
    const data = await ofetch<RecordResponse>(`${BASE_URL}/api/v1/record`, {
        headers: REQUEST_HEADERS,
        query: {
            id: recordId,
        },
        timeout: config.requestTimeout,
    });
    const title = data.records?.[0]?.title;
    if (!title) {
        throw new Error(`No title returned for record ${recordId}`);
    }
    return title;
}

export async function resolveRecordTitle(recordId: string, titleHint?: string): Promise<string> {
    if (titleHint?.trim()) {
        return titleHint.trim();
    }

    try {
        // Only successful lookups are cached, so a transient API failure
        // does not pin the record UUID as the title for a whole week.
        return (await cache.tryGet(`shlibrary:title:${recordId}`, () => fetchRecordTitle(recordId), TITLE_CACHE_TTL)) as string;
    } catch {
        return recordId;
    }
}

export async function fetchBookStatus(recordId: string): Promise<BookStatus> {
    const body = new URLSearchParams();
    body.append('id[]', recordId);

    const data = await ofetch<ItemStatusResponse>(STATUS_URL, {
        method: 'POST',
        headers: REQUEST_HEADERS,
        body,
        timeout: config.requestTimeout,
        // The endpoint answers with content-type application/javascript,
        // so ofetch would not parse the JSON body on its own
        parseResponse: JSON.parse,
    });

    const status = data.data?.statuses?.[0];
    if (!status) {
        throw new Error(`No status returned for record ${recordId}`);
    }

    const allCopies = parseCopyStatuses(status.full_status ?? '');
    const borrowableCopies = allCopies.filter((copy) => copy.borrowable);
    const state = deriveAvailabilityState(allCopies);
    const fallback = htmlToText(status.availability_message ?? '');

    return {
        recordId,
        link: `${BASE_URL}/Record/${recordId}`,
        state,
        borrowableCopies,
        allCopies,
        summary: buildSummary(state, borrowableCopies, allCopies, fallback),
        checkedAt: new Date().toISOString(),
    };
}

export function buildStatusDescription(status: BookStatus): string {
    const copies = status.state === 'available' ? status.borrowableCopies : status.allCopies;
    if (copies.length === 0) {
        return `<p>${status.summary}</p>`;
    }

    const copyHtml = copies
        .slice(0, 6)
        .map((copy) => `<li>${formatCopyLine(copy)}</li>`)
        .join('');

    return `<ul>${copyHtml}</ul>`;
}
