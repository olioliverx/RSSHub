import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('sanitize-html CJS load', () => {
    it('can be required when Node disallows require(ESM)', () => {
        // Vercel Functions currently pass --no-experimental-require-module, so
        // CJS sanitize-html cannot load ESM-only htmlparser2@12. Pinning
        // htmlparser2 to 10.1.0 keeps this require() working.
        const output = execFileSync(process.execPath, ['--no-experimental-require-module', '-e', "process.stdout.write(require('sanitize-html')('<p>ok</p><script>x</script>'))"], { encoding: 'utf8' });
        expect(output).toBe('<p>ok</p>');
    });
});
