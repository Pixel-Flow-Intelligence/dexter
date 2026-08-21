import { describe, expect, test } from 'bun:test';
import {
  extractFilingItemsFromText,
  htmlToPlainText,
} from './sec.js';

describe('sec filing item extraction', () => {
  test('htmlToPlainText strips tags and decodes entities', () => {
    const plain = htmlToPlainText('<p>Item 1A. Risk Factors</p><div>Apple&#8217;s business</div>');
    expect(plain).toContain('Item 1A. Risk Factors');
    expect(plain).toMatch(/Apple.s business/);
  });

  test('extractFilingItemsFromText prefers substantial body over TOC', () => {
    const text = `
Item 1A. Risk Factors 5
Item 7. MD&A 20
Item 1A. Risk Factors
The following risk factors could materially affect results.
Currency risk. Competition risk.
Item 7. Management Discussion
Revenue grew year over year due to services.
`.trim();

    const items = extractFilingItemsFromText(text, { minBodyChars: 40 });
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));

    expect(byName['Item-1A']?.content).toContain('Currency risk');
    expect(byName['Item-7']?.content).toContain('Revenue grew');
    expect(byName['Item-1A']?.content).not.toMatch(/^5$/);
  });

  test('normalize-style names Item-1A and Part-1,Item-2 keys', () => {
    const text = `
Item 1. Business
Company designs phones and computers for consumers worldwide.
Item 2. Properties
Headquarters is in Cupertino California with offices globally.
`.trim();
    const items = extractFilingItemsFromText(text, { minBodyChars: 40 });
    expect(items.map((i) => i.name).sort()).toEqual(['Item-1', 'Item-2']);
  });
});
