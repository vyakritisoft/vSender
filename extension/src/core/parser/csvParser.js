/**
 * CSV/XLSX Parser
 * 
 * Parses CSV and XLSX files, validates schema,
 * normalizes phone numbers to E.164 format,
 * and handles invalid rows gracefully.
 * 
 * Uses Papa Parse for CSV and SheetJS for XLSX.
 */

/**
 * Parse a file (CSV or XLSX) into structured contact data
 * @param {File} file - File object from input
 * @returns {Promise<Object>} { headers, rows, errors }
 */
export async function parseFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();

  if (extension === 'csv' || extension === 'txt') {
    return parseCSV(file);
  } else if (extension === 'xlsx' || extension === 'xls') {
    return parseXLSX(file);
  } else {
    throw new Error(`Unsupported file format: .${extension}. Please use CSV or XLSX.`);
  }
}

/**
 * Parse CSV file
 * @param {File} file
 * @returns {Promise<Object>}
 */
function parseCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const result = parseCSVText(text);
        resolve(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(message));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Parse raw CSV text into structured data
 * @param {string} text - Raw CSV content
 * @returns {Object} { headers, rows, errors }
 */
const ROW_CAP = 2000;

function parseCSVText(text) {
  const records = parseCSVRecords(text);

  if (records.length < 2) {
    throw new Error('CSV file must have at least a header row and one data row');
  }

  const totalRecords = records.length - 1;
  const recordsToProcess = records.slice(0, ROW_CAP + 1);
  const headers = recordsToProcess[0];
  const rows = [];
  const errors = [];

  if (totalRecords > ROW_CAP) {
    errors.push({ row: ROW_CAP + 1, error: `Row limit reached. Only the first ${ROW_CAP} contacts were imported.` });
  }

  for (let i = 1; i < recordsToProcess.length; i++) {
    try {
      const values = records[i];

      if (values.length === 0 || (values.length === 1 && !values[0])) {
        continue; // Skip empty rows
      }

      const row = {};
      headers.forEach((header, idx) => {
        row[header.trim()] = (values[idx] || '').trim();
      });

      rows.push({ rowIndex: i + 1, data: row });
    } catch (err) {
      errors.push({ row: i + 1, error: err.message });
    }
  }

  return { headers: headers.map(h => h.trim()), rows, errors };
}

/**
 * Parse CSV text into raw records while preserving multiline quoted cells
 * @param {string} text
 * @returns {string[][]}
 */
function parseCSVRecords(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '');
  const records = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  const pushField = () => {
    currentRow.push(currentField);
    currentField = '';
  };

  const pushRow = () => {
    const hasContent = currentRow.some(field => String(field || '').trim() !== '');
    if (hasContent) {
      records.push(currentRow);
    }
    currentRow = [];
  };

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (char === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      pushField();
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      pushField();
      pushRow();

      if (char === '\r' && normalized[i + 1] === '\n') {
        i++;
      }
    } else {
      currentField += char;
    }
  }

  if (inQuotes) {
    throw new Error('CSV parsing error: unmatched quote in file');
  }

  if (currentField !== '' || currentRow.length > 0) {
    pushField();
    pushRow();
  }

  return records;
}

/**
 * Parse XLSX file using SheetJS
 * @param {File} file
 * @returns {Promise<Object>}
 */
async function parseXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        // SheetJS (XLSX) must be loaded via libs/
        const xlsx = globalThis.XLSX;
        if (!xlsx) {
          // Fallback: try basic parsing
          reject(new Error('XLSX library not loaded. Please use CSV format or ensure SheetJS is available.'));
          return;
        }

        const data = new Uint8Array(e.target.result);
        const workbook = xlsx.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = xlsx.utils.sheet_to_json(firstSheet, { header: 1, raw: false });

        if (jsonData.length < 2) {
          reject(new Error('XLSX file must have at least a header row and one data row'));
          return;
        }

        const totalRecords = jsonData.length - 1;
        const dataToProcess = jsonData.slice(0, ROW_CAP + 1);
        const headers = dataToProcess[0].map(h => String(h || '').trim());
        const rows = [];
        const errors = [];

        if (totalRecords > ROW_CAP) {
          errors.push({ row: ROW_CAP + 1, error: `Row limit reached. Only the first ${ROW_CAP} contacts were imported.` });
        }

        for (let i = 1; i < dataToProcess.length; i++) {
          try {
            const values = dataToProcess[i];
            if (!values || values.length === 0) continue;

            const row = {};
            headers.forEach((header, idx) => {
              row[header] = String(values[idx] || '').trim();
            });
            rows.push({ rowIndex: i + 1, data: row });
          } catch (err) {
            errors.push({ row: i + 1, error: err.message });
          }
        }

        resolve({ headers, rows, errors });
      } catch (err) {
        reject(new Error(`XLSX parsing error: ${err.message}`));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read XLSX file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Normalize a phone number to E.164 format
 * @param {string} phone - Raw phone number
 * @param {string} [defaultCountryCode=''] - Default country code (e.g., '1' for US)
 * @returns {Object} { valid, normalized, original, error }
 */
export function normalizePhone(phone, defaultCountryCode = '') {
  if (!phone) {
    return { valid: false, normalized: null, original: phone, error: 'Empty phone number' };
  }

  // Remove all non-digit characters except leading +
  const raw = phone.toString().trim();
  let cleaned = raw;
  const hasPlus = cleaned.startsWith('+');
  const hasIntlPrefix = cleaned.startsWith('00');
  const normalizedDefaultCode = String(defaultCountryCode || '').replace(/\D/g, '');

  if (hasIntlPrefix) {
    cleaned = cleaned.slice(2);
  }
  cleaned = cleaned.replace(/\D/g, '');

  // If number is too short, try adding country code
  if (cleaned.length < 7) {
    return { valid: false, normalized: null, original: phone, error: 'Phone number too short' };
  }

  const isExplicitInternational = hasPlus || hasIntlPrefix;

  // If it doesn't start with an explicit international prefix, add the default code.
  if (!isExplicitInternational && normalizedDefaultCode) {
    const localNumber = cleaned.replace(/^0+/, '') || cleaned;
    if (localNumber.length <= 10 && !localNumber.startsWith(normalizedDefaultCode)) {
      cleaned = normalizedDefaultCode + localNumber;
    } else {
      cleaned = localNumber;
    }
  }

  // Validate length (E.164: 7-15 digits)
  if (cleaned.length < 7 || cleaned.length > 15) {
    return { valid: false, normalized: null, original: phone, error: `Invalid phone length: ${cleaned.length} digits` };
  }

  return { valid: true, normalized: cleaned, original: phone, error: null };
}

/**
 * Validate and process parsed data with field mapping
 * @param {Object} parsedData - Output from parseFile
 * @param {Object} fieldMapping - { phone: 'column_name', name: 'column_name', ... }
 * @param {string} defaultCountryCode - Default country code
 * @returns {Object} { contacts, errors, stats }
 */
export function validateAndMap(parsedData, fieldMapping, defaultCountryCode = '') {
  const contacts = [];
  const errors = [];
  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  const seenPhones = new Set();

  const phoneField = fieldMapping.phone;

  if (!phoneField) {
    throw new Error('Phone field mapping is required');
  }

  const trimmedDefaultCountryCode = String(defaultCountryCode || '').trim();

  for (const row of parsedData.rows) {
    const rawPhone = row.data[phoneField];
    const phoneResult = normalizePhone(rawPhone, trimmedDefaultCountryCode);

    if (!phoneResult.valid) {
      errors.push({
        row: row.rowIndex,
        phone: rawPhone,
        error: phoneResult.error
      });
      invalidCount++;
      continue;
    }

    // Duplicate check
    if (seenPhones.has(phoneResult.normalized)) {
      errors.push({
        row: row.rowIndex,
        phone: rawPhone,
        error: 'Duplicate phone number'
      });
      duplicateCount++;
      continue;
    }

    seenPhones.add(phoneResult.normalized);

    // Build variables from remaining mapped fields
    const variables = {};
    for (const [varName, columnName] of Object.entries(fieldMapping)) {
      if (varName !== 'phone' && columnName) {
        variables[varName] = row.data[columnName] || '';
      }
    }

    contacts.push({
      phone: phoneResult.normalized,
      variables,
      media: null // Media attached globally from popup
    });

    validCount++;
  }

  return {
    contacts,
    errors: [...(parsedData.errors || []), ...errors],
    stats: {
      totalRows: parsedData.rows.length,
      valid: validCount,
      invalid: invalidCount,
      duplicates: duplicateCount,
      parseErrors: (parsedData.errors || []).length
    }
  };
}
