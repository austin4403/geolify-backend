/**
 * Input sanitization utilities for GeoQuerry API
 * Mitigates CSV Injection (CWE-1236), Path Traversal (CWE-22), and Control Character Injection
 */

/**
 * Sanitizes a field value for safe inclusion in CSV exports.
 * Prepends a single quote to cells starting with formula trigger characters: = + - @ \t \r
 */
export function sanitizeCsvField(value: any): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let str = String(value);

  // Strip null bytes
  str = str.replace(/\0/g, "");

  // If the cell starts with formula characters, neutralize by prepending single quote
  const formulaTriggers = ["=", "+", "-", "@", "\t", "\r", "%"];
  const trimmed = str.trimStart();
  if (formulaTriggers.some((char) => trimmed.startsWith(char))) {
    str = `'${str}`;
  }

  // Escape inner double quotes by doubling them
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Sanitizes an uploaded file name to prevent path traversal and shell meta-character issues.
 */
export function sanitizeFileName(filename: string): string {
  // Extract only basename to strip any path components
  const baseName = filename.split(/[/\\]/).pop() || "upload";
  
  // Replace unsafe characters with an underscore
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  
  // Ensure non-empty filename
  return safeName.length > 0 ? safeName : "unnamed_file";
}
