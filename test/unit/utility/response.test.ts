import { describe, expect, it } from 'vitest';
import { fail, ok } from '../../../src/utility/response';

describe('ok', () => {
    it('wraps data in a success envelope', () => {
        expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
    });

    it('keeps meta a sibling of data', () => {
        expect(ok([1, 2], { page: 2 })).toEqual({ success: true, data: [1, 2], meta: { page: 2 } });
    });

    it('omits meta when not provided', () => {
        expect(Object.keys(ok(null))).toEqual(['success', 'data']);
    });
});

describe('fail', () => {
    it('wraps a message in an error envelope', () => {
        expect(fail('boom')).toEqual({ success: false, error: { message: 'boom' } });
    });

    it('carries structured details', () => {
        expect(fail('Validation failed', [{ field: 'a', message: 'Required' }])).toEqual({
            success: false,
            error: { message: 'Validation failed', details: [{ field: 'a', message: 'Required' }] },
        });
    });

    it('omits details when not provided', () => {
        expect(fail('x').error).not.toHaveProperty('details');
    });
});
