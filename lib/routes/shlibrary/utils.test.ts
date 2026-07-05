import { describe, expect, it } from 'vitest';

import { buildStatusDescription, deriveAvailabilityState, formatPrimaryStatus, isCopyBorrowable, parseCopyStatuses } from './utils';

const fullStatusHtml = `
<table class="table">
  <tr>
    <th>Location</th>
    <th>Call Number</th>
    <th>Availability</th>
  </tr>
  <tr>
    <td class="fullLocation">
      <span>中文书刊外借室&amp;主馆</span>
    </td>
    <td class="fullCallnumber">B222.5/1234</td>
    <td class="fullAvailability">
      <span class="text-success">已归还</span>
    </td>
  </tr>
  <tr>
    <td class="fullLocation">东馆</td>
    <td class="fullCallnumber">B222.5/1234-2</td>
    <td class="fullAvailability"><span class="text-danger">借出（已预约）</span></td>
  </tr>
</table>
`;

describe('shlibrary utils', () => {
    describe('isCopyBorrowable', () => {
        it('treats Chinese available labels as borrowable', () => {
            expect(isCopyBorrowable('已归还')).toBe(true);
            expect(isCopyBorrowable('可借')).toBe(true);
            expect(isCopyBorrowable('在架')).toBe(true);
        });

        it('treats English available labels as borrowable', () => {
            expect(isCopyBorrowable('Available')).toBe(true);
            expect(isCopyBorrowable('On Shelf')).toBe(true);
        });

        it('treats unavailable labels as not borrowable', () => {
            expect(isCopyBorrowable('编目中（暂不借阅）')).toBe(false);
            expect(isCopyBorrowable('借出')).toBe(false);
            expect(isCopyBorrowable('流转中')).toBe(false);
            expect(isCopyBorrowable('Checked Out')).toBe(false);
        });

        it('lets unavailable keywords win over available ones', () => {
            expect(isCopyBorrowable('借出（可预约）')).toBe(false);
        });

        it('treats empty or unknown statuses as not borrowable', () => {
            expect(isCopyBorrowable('')).toBe(false);
            expect(isCopyBorrowable('   ')).toBe(false);
            expect(isCopyBorrowable('神秘状态')).toBe(false);
        });
    });

    describe('parseCopyStatuses', () => {
        it('extracts per-copy rows and decodes HTML entities', () => {
            const copies = parseCopyStatuses(fullStatusHtml);
            expect(copies).toEqual([
                {
                    location: '中文书刊外借室&主馆',
                    callNumber: 'B222.5/1234',
                    status: '已归还',
                    borrowable: true,
                },
                {
                    location: '东馆',
                    callNumber: 'B222.5/1234-2',
                    status: '借出（已预约）',
                    borrowable: false,
                },
            ]);
        });

        it('returns an empty list for empty or unexpected HTML', () => {
            expect(parseCopyStatuses('')).toEqual([]);
            expect(parseCopyStatuses('<div>暂无馆藏信息</div>')).toEqual([]);
        });
    });

    describe('deriveAvailabilityState', () => {
        it('is available when any copy is borrowable', () => {
            expect(deriveAvailabilityState(parseCopyStatuses(fullStatusHtml))).toBe('available');
        });

        it('is unavailable when no copy is borrowable', () => {
            const copies = parseCopyStatuses(fullStatusHtml).map((copy) => ({ ...copy, borrowable: false }));
            expect(deriveAvailabilityState(copies)).toBe('unavailable');
        });

        it('is unknown when there are no copies', () => {
            expect(deriveAvailabilityState([])).toBe('unknown');
        });
    });

    describe('formatPrimaryStatus', () => {
        it('deduplicates status labels', () => {
            const copies = parseCopyStatuses(fullStatusHtml);
            expect(formatPrimaryStatus([copies[0], copies[0]])).toBe('已归还');
            expect(formatPrimaryStatus(copies)).toBe('已归还 / 借出（已预约）');
        });

        it('falls back when no status is present', () => {
            expect(formatPrimaryStatus([])).toBe('状态未知');
        });
    });

    describe('buildStatusDescription', () => {
        it('lists only borrowable copies when the book is available', () => {
            const allCopies = parseCopyStatuses(fullStatusHtml);
            const borrowableCopies = allCopies.filter((copy) => copy.borrowable);
            const description = buildStatusDescription({
                recordId: 'test',
                link: 'https://vufind.library.sh.cn/Record/test',
                state: 'available',
                borrowableCopies,
                allCopies,
                summary: '可借',
                checkedAt: new Date().toISOString(),
            });
            expect(description).toContain('已归还');
            expect(description).not.toContain('借出');
        });

        it('falls back to the summary when there are no copies', () => {
            const description = buildStatusDescription({
                recordId: 'test',
                link: 'https://vufind.library.sh.cn/Record/test',
                state: 'unavailable',
                borrowableCopies: [],
                allCopies: [],
                summary: '暂不可借',
                checkedAt: new Date().toISOString(),
            });
            expect(description).toBe('<p>暂不可借</p>');
        });
    });
});
