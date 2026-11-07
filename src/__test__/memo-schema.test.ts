import { describe, expect, it } from 'vitest';
import { memoInsertSchema, memoSchema, memoUpdateSchema } from '../memos/memo.schema.js';

const id = '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10';

describe('memoInsertSchema', () => {
	it('trims the title and defaults the body', () => {
		expect(memoInsertSchema.parse({ title: '  Idea  ' })).toEqual({ title: 'Idea', body: '' });
	});

	it('drops server-owned columns instead of accepting them', () => {
		const parsed = memoInsertSchema.parse({ title: 'a', id, createdAt: '2020-01-01' });
		expect(parsed).toEqual({ title: 'a', body: '' });
	});

	it.each([{ title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, {}])('rejects %o', (b) => {
		expect(memoInsertSchema.safeParse(b).success).toBe(false);
	});
});

describe('memoUpdateSchema', () => {
	it('accepts a single field and trims the title', () => {
		expect(memoUpdateSchema.parse({ title: '  b  ' })).toEqual({ title: 'b' });
		expect(memoUpdateSchema.parse({ body: 'x' })).toEqual({ body: 'x' });
	});

	it('drops server-owned columns', () => {
		expect(memoUpdateSchema.parse({ body: 'x', id })).toEqual({ body: 'x' });
	});

	it.each([{}, { id }, { title: '' }, { body: 'x'.repeat(50_001) }])('rejects %o', (b) => {
		expect(memoUpdateSchema.safeParse(b).success).toBe(false);
	});
});

describe('memoSchema', () => {
	it('accepts a well-formed row and rejects a bad one', () => {
		const row = { id, title: 'a', body: '', createdAt: new Date() };
		expect(memoSchema.safeParse(row).success).toBe(true);
		expect(memoSchema.safeParse({ ...row, id: 'nope' }).success).toBe(false);
		expect(memoSchema.safeParse({ ...row, title: null }).success).toBe(false);
	});
});
