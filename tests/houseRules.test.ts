/**
 * houseRules.test.ts
 *
 * Enforces the reserved-palette rule:
 *   tronCyan may ONLY appear in executable code inside:
 *     - src/assets/vehicles/bike.ts          (the bike itself)
 *     - src/fx/**                            (sandevistan + lightPools FX)
 *     - src/theme.ts                         (palette definition — the one place allowed to define it)
 *
 * Any other src/**\/*.ts file whose NON-COMMENT source contains `tronCyan` fails.
 * Comments that say "never use tronCyan" are documentation, not violations.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const SRC_DIR = resolve('src');

/** Normalise path separators for cross-platform comparison. */
function norm(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Returns true if the file is in one of the sanctioned locations where
 * tronCyan is intentionally used in executable code.
 */
function isSanctioned(filePath: string): boolean {
  const n = norm(filePath);
  // The bike — the one vehicle with tron-cyan headlights/accents.
  if (n.endsWith('assets/vehicles/bike.ts')) return true;
  // FX modules: sandevistan trail + light pools (cyan ghost/spark effects).
  if (n.includes('/fx/')) return true;
  // The palette definition itself — theme.ts DEFINES tronCyan.
  if (n.endsWith('src/theme.ts')) return true;
  return false;
}

/**
 * Strip TypeScript/JavaScript comments from source text so that
 * documentation like "// never use tronCyan" does not trigger the rule.
 * Uses a simple state machine that handles:
 *   - Single-line comments  (//)
 *   - Block comments        (/* ... *‌/)
 *   - String literals       ('', "", ``)  — skips their content
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    // String literals — copy verbatim so `tronCyan` inside a string is kept.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        const c2 = src[i];
        out += c2;
        i++;
        if (c2 === '\\') {
          // Escaped char — include next char too.
          if (i < n) { out += src[i]; i++; }
        } else if (c2 === quote) {
          break;
        }
      }
      continue;
    }

    // Potential comment start.
    if (ch === '/' && i + 1 < n) {
      const next = src[i + 1];
      if (next === '/') {
        // Single-line comment — skip to end of line.
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (next === '*') {
        // Block comment — skip to *‌/.
        i += 2;
        while (i + 1 < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2; // skip closing */
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

describe('house rules', () => {
  it('tronCyan is only used by the bike, its FX modules, and the palette definition', () => {
    const allFiles = walk(SRC_DIR);

    const offenders = allFiles.filter(
      (f) => !isSanctioned(f) && /tronCyan/.test(stripComments(readFileSync(f, 'utf8'))),
    );

    if (offenders.length > 0) {
      console.error('tronCyan found in executable code of unsanctioned files:');
      for (const f of offenders) console.error(' ', norm(f));
    }

    expect(offenders).toEqual([]);
  });
});
