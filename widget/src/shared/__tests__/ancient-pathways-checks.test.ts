/**
 * The quality-check card is read by the owner, not by an engineer. Studio printed
 * the checker's own line ("quiet-window RMS 0.00287 (dialogue-only measures
 * 0.00000)") and he asked twice what to do about it.
 */

import { explainCheck, explainedCheckNames, failureSummary } from '../ancient-pathways-checks';

// Every check the Ancient Pathways doctor can report, from its @check decorators
// (scripts/doctor.py, read 2026-09-15). A new check there must get wording here.
const DOCTOR_CHECKS = [
  'rigs resolve', 'guest identity honest', 'no captions in sprites',
  'no chroma residual in sprites', 'no shadowed definitions', 'heads in frame',
  'composition varies', 'score bed on disk', 'master has music', 'master length',
  'mouths move', 'sprite dimensions plausible', 'plates full resolution',
  'master has foley', 'episode assets present', 'cutscenes reach',
  'no panel headings in sprites', 'flappy has no scratch', 'mouth in lower face',
];

test('every check the doctor can report has plain wording', () => {
  const missing = DOCTOR_CHECKS.filter(name => !explainCheck(name));
  expect(missing).toEqual([]);
});

test('the wording says what is wrong and what to do, without the checker jargon', () => {
  for (const name of DOCTOR_CHECKS) {
    const e = explainCheck(name)!;
    expect(e.title.length).toBeGreaterThan(8);
    expect(e.meaning.length).toBeGreaterThan(20);
    expect(e.fix.length).toBeGreaterThan(10);
    for (const text of [e.title, e.meaning, e.fix]) {
      expect(text).not.toMatch(/RMS|LUFS|residual|envelope|percentile|t=|px\b/i);
    }
  }
});

test('the three the owner actually hit read as problems he can act on', () => {
  expect(explainCheck('master has music')).toMatchObject({
    title: 'The finished video has no music',
  });
  expect(explainCheck('master has foley')!.title).toMatch(/no sound effects/i);
  expect(explainCheck('no panel headings in sprites')!.fix).toMatch(/cut that pose/i);
});

test('an unknown check is not swallowed', () => {
  expect(explainCheck('some future check')).toBeNull();
  expect(explainCheck('')).toBeNull();
});

test('check names are matched however the doctor cases them', () => {
  expect(explainCheck('Master Has Music')).not.toBeNull();
  expect(explainCheck('  master has foley  ')).not.toBeNull();
});

test('the summary counts problems in words, singular and plural', () => {
  expect(failureSummary(1)).toBe('1 problem found');
  expect(failureSummary(3)).toBe('3 problems found');
  expect(failureSummary(3)).not.toMatch(/check\(s\)/);
});

test('the explained set stays in step with the doctor', () => {
  expect(explainedCheckNames().sort()).toEqual([...DOCTOR_CHECKS].sort());
});
