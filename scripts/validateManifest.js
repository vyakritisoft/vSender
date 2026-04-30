#!/usr/bin/env node
/**
 * validateManifest.js
 *
 * Validates that extension/manifest.json conforms to
 * Chrome Extension Manifest V3 requirements.
 * Exits with code 1 on failure so CI catches it.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, '..', 'extension', 'manifest.json');

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (err) {
  console.error(`❌ Failed to read/parse manifest.json: ${err.message}`);
  process.exit(1);
}

const errors = [];

// ── Required fields ───────────────────────────────────────────────────────
if (manifest.manifest_version !== 3) {
  errors.push(`manifest_version must be 3 (got ${manifest.manifest_version})`);
}
if (!manifest.name || typeof manifest.name !== 'string') {
  errors.push('Missing or invalid "name" field');
}
if (!manifest.version || !/^\d+\.\d+(\.\d+)?(\.\d+)?$/.test(manifest.version)) {
  errors.push(`Invalid "version" format: "${manifest.version}" (expected semver-like, e.g. 1.2.3)`);
}
if (!manifest.description) {
  errors.push('Missing "description" field');
}

// ── Background ────────────────────────────────────────────────────────────
if (manifest.background) {
  if (!manifest.background.service_worker) {
    errors.push('"background" must define "service_worker" in MV3');
  }
  if (manifest.background.scripts) {
    errors.push('"background.scripts" is MV2 syntax — use "service_worker" instead');
  }
}

// ── Permissions ───────────────────────────────────────────────────────────
const FORBIDDEN_MV3_PERMISSIONS = ['background', 'clipboardRead', 'clipboardWrite'];
const permissions = manifest.permissions || [];
const forbidden = permissions.filter((p) => FORBIDDEN_MV3_PERMISSIONS.includes(p));
if (forbidden.length > 0) {
  errors.push(`Forbidden MV3 permissions: ${forbidden.join(', ')}`);
}

// ── Icons ─────────────────────────────────────────────────────────────────
if (!manifest.icons || !manifest.icons['128']) {
  errors.push('Missing 128px icon entry in "icons"');
}

// ── Content Security Policy ───────────────────────────────────────────────
if (manifest.content_security_policy) {
  const csp = JSON.stringify(manifest.content_security_policy);
  if (csp.includes("'unsafe-eval'") || csp.includes("'unsafe-inline'")) {
    errors.push("CSP must not include 'unsafe-eval' or 'unsafe-inline'");
  }
}

// ── Report ────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('❌ Manifest validation failed:');
  errors.forEach((e) => console.error(`   • ${e}`));
  process.exit(1);
} else {
  console.log(`✅ manifest.json is valid (MV3, v${manifest.version})`);
}
