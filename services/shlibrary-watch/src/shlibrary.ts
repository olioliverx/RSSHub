import type { AvailabilityState, BookStatus, CopyStatus } from './types.js';

const BASE_URL = 'https://vufind.library.sh.cn';
const STATUS_URL = `${BASE_URL}/AJAX/JSON?method=getItemStatuses`;

interface ItemStatusResponse {
    data?: {
        statuses?: Array<{
            id: string;
            availability?: string;
            availability_message?: string;
            full_status?: string;
        }>;
    };
}

const UNAVAILABLE_PATTERN = /cataloging|not for borrowing|编目|借出|checked out|processing|processing中|修补|装订|遗失|missing|withdrawn|declared lost|预约|on order|订购中|验收|典藏/i;
const AVAILABLE_PATTERN = /available|可借|在馆|在架|on shelf|可阅览/i;

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

function stripHtml(value: string): string {
    return value.replaceAll(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

export function parseCopyStatuses(fullStatusHtml: string): CopyStatus[] {
    const copies: CopyStatus[] = [];
    const rowPattern = /<tr>[\s\S]*?<td class="fullLocation">([\s\S]*?)<\/td>[\s\S]*?<td class="fullCallnumber">([\s\S]*?)<\/td>[\s\S]*?<td class="fullAvailability">([\s\S]*?)<\/td>/g;

    for (const match of fullStatusHtml.matchAll(rowPattern)) {
        const location = stripHtml(match[1] ?? '');
        const callNumber = stripHtml(match[2] ?? '');
        const status = stripHtml(match[3] ?? '');
        if (!location && !callNumber && !status) {
            continue;
        }
        copies.push({
            location,
            callNumber,
            status,
            borrowable: isCopyBorrowable(status),
        });
    }

    if (copies.length > 0) {
        return copies;
    }

    const mobilePattern = /Status[\s\S]*?<span>([\s\S]*?)<\/span>/g;
    for (const match of fullStatusHtml.matchAll(mobilePattern)) {
        const status = stripHtml(match[1] ?? '');
        if (!status) {
            continue;
        }
        copies.push({
            location: '',
            callNumber: '',
            status,
            borrowable: isCopyBorrowable(status),
        });
    }

    return copies;
}

function buildSummary(state: AvailabilityState, borrowableCopies: CopyStatus[], allCopies: CopyStatus[], fallback: string): string {
    if (state === 'available') {
        const details = borrowableCopies
            .slice(0, 3)
            .map((copy) => {
                const location = copy.location ? `${copy.location}` : 'Unknown location';
                const callNumber = copy.callNumber ? ` (${copy.callNumber})` : '';
                return `${location}${callNumber}: ${copy.status}`;
            })
            .join('\n');
        return details || fallback || 'Available to borrow';
    }
    if (allCopies.length > 0) {
        return allCopies
            .slice(0, 4)
            .map((copy) => {
                const location = copy.location ? `${copy.location}` : 'Unknown location';
                const callNumber = copy.callNumber ? ` (${copy.callNumber})` : '';
                return `${location}${callNumber}: ${copy.status}`;
            })
            .join('\n');
    }
    return fallback || 'Not available to borrow';
}

export async function fetchBookStatus(recordId: string, titleHint?: string): Promise<BookStatus> {
    const body = new URLSearchParams();
    body.append('id[]', recordId);

    const response = await fetch(STATUS_URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'shlibrary-watch/1.0',
        },
        body,
    });

    if (!response.ok) {
        throw new Error(`Shanghai Library status request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ItemStatusResponse;
    const status = payload.data?.statuses?.[0];
    if (!status) {
        throw new Error(`No status returned for record ${recordId}`);
    }

    const allCopies = parseCopyStatuses(status.full_status ?? '');
    const borrowableCopies = allCopies.filter((copy) => copy.borrowable);
    const state = deriveAvailabilityState(allCopies);
    const fallback = stripHtml(status.availability_message ?? '');

    return {
        recordId,
        title: titleHint ?? recordId,
        link: `${BASE_URL}/Record/${recordId}`,
        state,
        borrowableCopies,
        allCopies,
        summary: buildSummary(state, borrowableCopies, allCopies, fallback),
        checkedAt: new Date().toISOString(),
    };
}

export async function fetchBookStatuses(recordIds: string[], titleById: Map<string, string | undefined>): Promise<Map<string, BookStatus>> {
    if (recordIds.length === 0) {
        return new Map();
    }

    const body = new URLSearchParams();
    for (const recordId of recordIds) {
        body.append('id[]', recordId);
    }

    const response = await fetch(STATUS_URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'shlibrary-watch/1.0',
        },
        body,
    });

    if (!response.ok) {
        throw new Error(`Shanghai Library status request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ItemStatusResponse;
    const results = new Map<string, BookStatus>();

    for (const status of payload.data?.statuses ?? []) {
        const allCopies = parseCopyStatuses(status.full_status ?? '');
        const borrowableCopies = allCopies.filter((copy) => copy.borrowable);
        const state = deriveAvailabilityState(allCopies);
        const fallback = stripHtml(status.availability_message ?? '');

        results.set(status.id, {
            recordId: status.id,
            title: titleById.get(status.id) ?? status.id,
            link: `${BASE_URL}/Record/${status.id}`,
            state,
            borrowableCopies,
            allCopies,
            summary: buildSummary(state, borrowableCopies, allCopies, fallback),
            checkedAt: new Date().toISOString(),
        });
    }

    return results;
}
