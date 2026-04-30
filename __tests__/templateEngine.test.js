/**
 * Unit tests: Template Engine
 *
 * Tests {{variable}} rendering, fallback values,
 * variable extraction, and template validation.
 */

import { describe, test, expect } from '@jest/globals';
import {
  renderTemplate,
  extractVariables,
  validateTemplate,
  previewTemplate,
} from '../extension/src/core/templating/templateEngine.js';

// ─── renderTemplate ────────────────────────────────────────────────────────

describe('renderTemplate()', () => {
  test('replaces a single variable', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'Alice' })).toBe('Hello Alice!');
  });

  test('replaces multiple variables', () => {
    const result = renderTemplate('Hi {{name}}, you live in {{city}}.', {
      name: 'Bob',
      city: 'Paris',
    });
    expect(result).toBe('Hi Bob, you live in Paris.');
  });

  test('uses fallback when variable is missing', () => {
    expect(renderTemplate('Hi {{name|Friend}}!', {})).toBe('Hi Friend!');
  });

  test('uses fallback when variable is empty string', () => {
    expect(renderTemplate('Hi {{name|there}}!', { name: '' })).toBe('Hi there!');
  });

  test('uses variable value over fallback when value is set', () => {
    expect(renderTemplate('Hi {{name|there}}!', { name: 'Carol' })).toBe('Hi Carol!');
  });

  test('returns empty string for missing variable without fallback', () => {
    expect(renderTemplate('Hello {{name}}!', {})).toBe('Hello !');
  });

  test('returns empty string for null/undefined template', () => {
    expect(renderTemplate(null)).toBe('');
    expect(renderTemplate(undefined)).toBe('');
    expect(renderTemplate('')).toBe('');
  });

  test('leaves text without placeholders unchanged', () => {
    const msg = 'Hello World!';
    expect(renderTemplate(msg, { name: 'Alice' })).toBe(msg);
  });

  test('handles numeric variable values', () => {
    expect(renderTemplate('Order #{{id}}', { id: 42 })).toBe('Order #42');
  });

  test('handles multiline templates', () => {
    const template = 'Hi {{name}},\n\nYour order is ready.';
    expect(renderTemplate(template, { name: 'Dave' })).toBe(
      'Hi Dave,\n\nYour order is ready.'
    );
  });
});

// ─── extractVariables ─────────────────────────────────────────────────────

describe('extractVariables()', () => {
  test('extracts all variable names', () => {
    const vars = extractVariables('Hi {{name}}, city: {{city}}');
    expect(vars).toEqual(expect.arrayContaining(['name', 'city']));
    expect(vars).toHaveLength(2);
  });

  test('deduplicates repeated variables', () => {
    const vars = extractVariables('{{name}} and {{name}} again');
    expect(vars).toHaveLength(1);
  });

  test('returns empty array for template with no variables', () => {
    expect(extractVariables('Hello there!')).toEqual([]);
  });

  test('returns empty array for null/undefined/empty', () => {
    expect(extractVariables(null)).toEqual([]);
    expect(extractVariables('')).toEqual([]);
  });

  test('handles variables with fallback syntax', () => {
    const vars = extractVariables('Hi {{name|Friend}} from {{city|Unknown}}');
    expect(vars).toEqual(expect.arrayContaining(['name', 'city']));
  });
});

// ─── validateTemplate ─────────────────────────────────────────────────────

describe('validateTemplate()', () => {
  test('returns valid when all variables are mapped', () => {
    const result = validateTemplate('Hi {{name}} from {{city}}', {
      phone: 'phone_col',
      name: 'name_col',
      city: 'city_col',
    });
    expect(result.valid).toBe(true);
    expect(result.missingVariables).toHaveLength(0);
  });

  test('returns invalid when a variable is missing from mapping', () => {
    const result = validateTemplate('Hi {{name}} from {{city}}', {
      phone: 'phone_col',
      name: 'name_col',
    });
    expect(result.valid).toBe(false);
    expect(result.missingVariables).toContain('city');
  });

  test('excludes phone from available variables', () => {
    const result = validateTemplate('Hi {{name}}', {
      phone: 'phone_col',
      name: 'name_col',
    });
    expect(result.availableVariables).not.toContain('phone');
  });

  test('returns valid for empty template', () => {
    const result = validateTemplate('', { phone: 'phone_col' });
    expect(result.valid).toBe(true);
  });
});

// ─── previewTemplate ──────────────────────────────────────────────────────

describe('previewTemplate()', () => {
  test('delegates to renderTemplate', () => {
    const result = previewTemplate('Hello {{name}}!', { name: 'Eve' });
    expect(result).toBe('Hello Eve!');
  });
});
