import { X509Certificate } from 'node:crypto';
import tls from 'node:tls';

import { describe, expect, it } from 'vitest';

import { extraCaList, isrgRootYrPem } from '@/utils/extra-ca';

describe('extra CA', () => {
    it('embeds ISRG Root YR and keeps the Node trust store', () => {
        const cert = new X509Certificate(isrgRootYrPem);
        expect(cert.subject).toContain('CN=Root YR');
        expect(cert.issuer).toContain('CN=Root YR');
        expect(extraCaList).toHaveLength(tls.rootCertificates.length + 1);
        expect(extraCaList.at(-1)).toBe(isrgRootYrPem);
    });
});
