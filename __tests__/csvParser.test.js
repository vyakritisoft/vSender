/**
 * Unit tests: normalizePhone & validateAndMap
 *
 * Tests phone normalization to E.164 and the field-mapping
 * validation logic from csvParser.js.
 */

import { describe, test, expect } from '@jest/globals';
import { normalizePhone, validateAndMap } from '../extension/src/core/parser/csvParser.js';

// ─── normalizePhone ────────────────────────────────────────────────────────

describe('normalizePhone()', () => {
  test('returns valid for a clean international number', () => {
    const result = normalizePhone('+15550001234');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('15550001234');
  });

  test('strips formatting characters', () => {
    const result = normalizePhone('+1 (555) 000-1234');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('15550001234');
  });

  test('handles 00 international prefix', () => {
    const result = normalizePhone('00971501234567');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('971501234567');
  });

  test('prepends default country code to local number', () => {
    const result = normalizePhone('5550001234', '1');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('15550001234');
  });

  test('returns invalid for empty string', () => {
    const result = normalizePhone('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Empty phone number');
  });

  test('returns invalid for null', () => {
    const result = normalizePhone(null);
    expect(result.valid).toBe(false);
  });

  test('returns invalid for too-short number', () => {
    const result = normalizePhone('123');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too short/i);
  });

  test('returns invalid for too-long number', () => {
    const result = normalizePhone('+12345678901234567890'); // > 15 digits
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/length/i);
  });

  test('preserves original in result', () => {
    const original = '+44 7911 123456';
    const result = normalizePhone(original);
    expect(result.original).toBe(original);
  });
});

// ─── validateAndMap ────────────────────────────────────────────────────────

describe('validateAndMap()', () => {
  const makeParsedData = (rows) => ({
    headers: ['phone', 'name', 'city'],
    rows: rows.map((data, i) => ({ rowIndex: i + 2, data })),
    errors: [],
  });

  const fieldMapping = { phone: 'phone', name: 'name' };

  test('maps valid rows to contacts', () => {
    const parsed = makeParsedData([
      { phone: '+15550001111', name: 'Alice', city: 'NYC' },
      { phone: '+15550002222', name: 'Bob', city: 'LA' },
    ]);
    const { contacts, stats } = validateAndMap(parsed, fieldMapping);
    expect(contacts).toHaveLength(2);
    expect(stats.valid).toBe(2);
    expect(contacts[0].phone).toBe('15550001111');
    expect(contacts[0].variables.name).toBe('Alice');
  });

  test('excludes rows with invalid phones', () => {
    const parsed = makeParsedData([
      { phone: 'bad', name: 'Charlie' },
      { phone: '+15550003333', name: 'Dave' },
    ]);
    const { contacts, errors, stats } = validateAndMap(parsed, fieldMapping);
    expect(contacts).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(stats.invalid).toBe(1);
  });

  test('removes duplicate phone numbers', () => {
    const parsed = makeParsedData([
      { phone: '+15550004444', name: 'Eve' },
      { phone: '+15550004444', name: 'Eve Clone' },
    ]);
    const { contacts, errors, stats } = validateAndMap(parsed, fieldMapping);
    expect(contacts).toHaveLength(1);
    expect(stats.duplicates).toBe(1);
    expect(errors.some((e) => e.error === 'Duplicate phone number')).toBe(true);
  });

  test('throws if phone field mapping is missing', () => {
    const parsed = makeParsedData([{ phone: '+15550005555', name: 'Frank' }]);
    expect(() => validateAndMap(parsed, { name: 'name' })).toThrow('Phone field mapping is required');
  });

  test('propagates parse-time errors from parsedData.errors', () => {
    const parsed = makeParsedData([{ phone: '+15550006666', name: 'Grace' }]);
    parsed.errors = [{ row: 100, error: 'Row limit reached' }];
    const { errors } = validateAndMap(parsed, fieldMapping);
    expect(errors.some((e) => e.error === 'Row limit reached')).toBe(true);
  });

  test('applies default country code', () => {
    const parsed = makeParsedData([{ phone: '5550007777', name: 'Hank' }]);
    const { contacts } = validateAndMap(parsed, fieldMapping, '1');
    expect(contacts[0].phone).toBe('15550007777');
  });
});
