import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSkillFile } from './loader.js';

describe('sukuk-screening skill', () => {
  test('SKILL.md parses with correct metadata and references the sukuk tools', () => {
    const path = join(import.meta.dir, 'sukuk-screening', 'SKILL.md');
    const skill = parseSkillFile(readFileSync(path, 'utf-8'), path, 'builtin');
    expect(skill.name).toBe('sukuk-screening');
    expect(skill.description.toLowerCase()).toContain('sukuk');
    expect(skill.instructions).toContain('search_sukuk');
    expect(skill.instructions).toContain('get_sukuk');
  });
});
