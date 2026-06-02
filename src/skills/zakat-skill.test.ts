import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSkillFile } from './loader.js';

describe('zakat-calculation skill', () => {
  test('SKILL.md parses with correct metadata and uses calculate_zakat', () => {
    const path = join(import.meta.dir, 'zakat-calculation', 'SKILL.md');
    const skill = parseSkillFile(readFileSync(path, 'utf-8'), path, 'builtin');
    expect(skill.name).toBe('zakat-calculation');
    expect(skill.description.toLowerCase()).toContain('zakat');
    expect(skill.instructions).toContain('calculate_zakat');
  });
});
