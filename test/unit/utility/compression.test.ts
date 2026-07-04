import { describe, expect, it } from 'vitest';
import { Compressor, compress, decompress } from '../../../src/utility/compression';

const ALL = [Compressor.SNAPPY, Compressor.GZIP, Compressor.BROTLI];

describe('compression', () => {
    it.each(ALL)('%s round-trips a JSON string losslessly', async (lib) => {
        const original = JSON.stringify({ hello: 'world', nested: { n: 42 } });
        const buffer = await compress(original, lib);
        expect(Buffer.isBuffer(buffer)).toBe(true);
        await expect(decompress(buffer, lib)).resolves.toBe(original);
    });

    it.each(ALL)('%s round-trips unicode', async (lib) => {
        const original = 'héllo wörld — 日本語 🚀';
        await expect(decompress(await compress(original, lib), lib)).resolves.toBe(original);
    });

    it.each(ALL)('%s round-trips the empty string', async (lib) => {
        await expect(decompress(await compress('', lib), lib)).resolves.toBe('');
    });

    it('compress rejects non-string input', async () => {
        await expect(compress(123 as any, Compressor.GZIP)).rejects.toThrow('valid string');
    });

    it('compress rejects an unknown compressor', async () => {
        await expect(compress('text', 'zstd' as Compressor)).rejects.toThrow('valid compressor');
    });

    it('decompress rejects non-Buffer input', async () => {
        await expect(decompress('not a buffer' as any, Compressor.GZIP)).rejects.toThrow('valid Buffer');
    });

    it('decompress rejects a corrupted buffer', async () => {
        await expect(decompress(Buffer.from('definitely not gzip'), Compressor.GZIP)).rejects.toThrow();
    });

    it('decompress with a mismatched algorithm rejects', async () => {
        const gz = await compress('payload', Compressor.GZIP);
        await expect(decompress(gz, Compressor.BROTLI)).rejects.toThrow();
    });
});
