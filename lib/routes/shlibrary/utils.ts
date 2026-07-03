import got from '@/utils/got';

const BASE_URL = 'https://vufind.library.sh.cn';
const STATUS_URL = `${BASE_URL}/AJAX/JSON?method=getItemStatuses`;

export type AvailabilityState = 'available' | 'unavailable' | 'unknown';

export interface CopyStatus {
    location: string;
    callNumber: string;
    status: string;
    borrowable: boolean;
}

export interface BookStatus {
    recordId: string;
    title: string;
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
    return value
        .replaceAll(/<[^>]+>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
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

    return copies;
}

function buildSummary(state: AvailabilityState, borrowableCopies: CopyStatus[], allCopies: CopyStatus[], fallback: string): string {
    if (state === 'available') {
        const details = borrowableCopies
            .slice(0, 4)
            .map((copy) => {
                const location = copy.location || 'Unknown location';
                const callNumber = copy.callNumber ? ` (${copy.callNumber})` : '';
                return `${location}${callNumber}: ${copy.status}`;
            })
            .join('<br/>');
        return details || fallback || 'Available to borrow';
    }
    if (allCopies.length > 0) {
        return allCopies
            .slice(0, 4)
            .map((copy) => {
                const location = copy.location || 'Unknown location';
                const callNumber = copy.callNumber ? ` (${copy.callNumber})` : '';
                return `${location}${callNumber}: ${copy.status}`;
            })
            .join('<br/>');
    }
    return fallback || 'Not available to borrow';
}

export async function fetchRecordTitle(recordId: string): Promise<string> {
    const { data } = await got(`${BASE_URL}/api/v1/record`, {
        searchParams: {
            id: recordId,
        },
    });
    const payload = data as RecordResponse;
    return payload.records?.[0]?.title ?? recordId;
}

export async function fetchBookStatus(recordId: string, titleHint?: string): Promise<BookStatus> {
    const body = new URLSearchParams();
    body.append('id[]', recordId);

    const { data } = await got.post(STATUS_URL, {
        body: body.toString(),
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
    });

    const payload = data as ItemStatusResponse;
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

export function buildStatusDescription(status: BookStatus): string {
    const copies = status.state === 'available' ? status.borrowableCopies : status.allCopies;
    if (copies.length === 0) {
        return `<p>${status.summary}</p>`;
    }

    const copyHtml = copies
        .slice(0, 6)
        .map((copy) => {
            const location = copy.location || 'Unknown location';
            const callNumber = copy.callNumber ? ` (${copy.callNumber})` : '';
            return `<li>${location}${callNumber}: ${copy.status}</li>`;
        })
        .join('');

    return `<ul>${copyHtml}</ul>`;
}
