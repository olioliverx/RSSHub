import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveAvailabilityState, isCopyBorrowable, parseCopyStatuses } from './shlibrary.js';

describe('isCopyBorrowable', () => {
    it('treats cataloging as unavailable', () => {
        assert.equal(isCopyBorrowable('Cataloging (not for borrowing temporarily)'), false);
        assert.equal(isCopyBorrowable('编目中（暂不外借）'), false);
    });

    it('treats available copies as borrowable', () => {
        assert.equal(isCopyBorrowable('Available'), true);
        assert.equal(isCopyBorrowable('可借'), true);
    });

    it('treats checked out copies as unavailable', () => {
        assert.equal(isCopyBorrowable('Checked Out'), false);
        assert.equal(isCopyBorrowable('借出'), false);
    });
});

describe('parseCopyStatuses', () => {
    it('parses desktop holdings table rows', () => {
        const html = `
<table>
  <tr>
    <td class="fullLocation">-上海图书馆淮海路馆基藏书库</td>
    <td class="fullCallnumber">K54/4911#1</td>
    <td class="fullAvailability"><span class="text-success">Available</span></td>
  </tr>
  <tr>
    <td class="fullLocation">-上海图书馆东馆</td>
    <td class="fullCallnumber">K54/4911#2</td>
    <td class="fullAvailability"><span class="text-danger">Cataloging (not for borrowing temporarily)</span></td>
  </tr>
</table>`;

        const copies = parseCopyStatuses(html);
        assert.equal(copies.length, 2);
        assert.equal(copies[0]?.borrowable, true);
        assert.equal(copies[1]?.borrowable, false);
        assert.equal(deriveAvailabilityState(copies), 'available');
    });
});
