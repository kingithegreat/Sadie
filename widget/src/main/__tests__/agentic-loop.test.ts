import { looksMultiStep, buildAgenticSystemPrompt, formatStepProgress } from '../agentic-loop';

describe('agentic-loop', () => {
  describe('looksMultiStep', () => {
    test('detects "then" sequencing', () => {
      expect(looksMultiStep('search for the weather in Auckland then save it to a file')).toBe(true);
    });

    test('detects "first … then" pattern', () => {
      expect(looksMultiStep('first read my resume PDF then summarize the key skills')).toBe(true);
    });

    test('detects "and also" connector', () => {
      expect(looksMultiStep('check my calendar for tomorrow and also set a reminder for 9am')).toBe(true);
    });

    test('detects multiple action domains', () => {
      expect(looksMultiStep('search for the latest news about AI and save a summary to my desktop')).toBe(true);
    });

    test('detects numbered steps', () => {
      expect(looksMultiStep('1. check the weather 2. write it to weather.txt')).toBe(true);
    });

    test('rejects short simple queries', () => {
      expect(looksMultiStep('what is the weather')).toBe(false);
    });

    test('rejects single-action requests', () => {
      expect(looksMultiStep('search for the latest news about artificial intelligence')).toBe(false);
    });

    test('rejects greetings', () => {
      expect(looksMultiStep('hey how are you doing today')).toBe(false);
    });

    test('detects "after that" sequencing', () => {
      expect(looksMultiStep('read my notes.txt file and after that email the summary to john')).toBe(true);
    });

    test('detects "once you" pattern', () => {
      expect(looksMultiStep('get the NBA scores for tonight once you have them save a report to my desktop')).toBe(true);
    });
  });

  describe('buildAgenticSystemPrompt', () => {
    test('returns a non-empty string with key instructions', () => {
      const prompt = buildAgenticSystemPrompt();
      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).toContain('AGENTIC MODE');
      expect(prompt).toContain('tool');
    });
  });

  describe('formatStepProgress', () => {
    test('formats known tool names with friendly verbs', () => {
      const msg = formatStepProgress(0, 'web_search', { query: 'test' });
      expect(msg).toContain('Step 1');
      expect(msg).toContain('Searching the web');
    });

    test('formats unknown tool names with fallback', () => {
      const msg = formatStepProgress(2, 'custom_tool', {});
      expect(msg).toContain('Step 3');
      expect(msg).toContain('custom_tool');
    });
  });
});
