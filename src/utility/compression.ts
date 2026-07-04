import { brotliCompress, brotliDecompress, gunzip, gzip } from 'node:zlib';
import snappy from 'snappy';

export enum Compressor {
    SNAPPY = 'snappy',
    GZIP = 'gzip',
    BROTLI = 'brotli',
}

export async function compress(text: string, lib: Compressor): Promise<Buffer> {
    if (typeof text !== 'string') throw new Error('Provide a valid string to compress.');
    switch (lib) {
        case Compressor.SNAPPY: {
            const compressed = await snappy.compress(text);
            return Buffer.from(compressed);
        }
        case Compressor.BROTLI:
            return new Promise((resolve, reject) =>
                brotliCompress(text, {}, (error, output) => (error ? reject(error) : resolve(output))),
            );
        case Compressor.GZIP:
            return new Promise((resolve, reject) =>
                gzip(text, (error, output) => (error ? reject(error) : resolve(output))),
            );
        default:
            throw new Error('Provide a valid compressor.');
    }
}

export async function decompress(value: Buffer, lib: Compressor): Promise<string> {
    if (!(value instanceof Buffer)) throw new Error('Provide a valid Buffer to decompress.');
    switch (lib) {
        case Compressor.SNAPPY: {
            const output = await snappy.uncompress(value, { asBuffer: false });
            return output as string;
        }
        case Compressor.BROTLI:
            return new Promise((resolve, reject) =>
                brotliDecompress(value, {}, (error, output) => (error ? reject(error) : resolve(output.toString()))),
            );
        case Compressor.GZIP:
            return new Promise((resolve, reject) =>
                gunzip(value, (error, output) => (error ? reject(error) : resolve(output.toString()))),
            );
        default:
            throw new Error('Provide a valid compressor.');
    }
}
