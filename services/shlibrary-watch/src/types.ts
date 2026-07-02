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

export interface WatchedBook {
    recordId: string;
    title?: string;
    note?: string;
    addedAt: string;
    lastCheckedAt?: string;
    lastState?: AvailabilityState;
    lastSummary?: string;
    availableSince?: string;
    lastNotifiedAt?: string;
}

export interface AvailabilityEvent {
    id: string;
    recordId: string;
    title: string;
    link: string;
    summary: string;
    copies: CopyStatus[];
    occurredAt: string;
}

export interface WatchStore {
    books: WatchedBook[];
    events: AvailabilityEvent[];
}
