import {
  stripFences,
  extractJsonArray,
  normalizeQuestionText,
  validateQuestion,
  parseQuizBatch,
  dedupeQuestions,
  ParsedQuizQuestion,
  buildAvoidClause,
} from '../quiz/generate';

const goodItem = {
  type: 'multiple-choice',
  question: 'Which array method adds an element to the end?',
  code: '',
  options: ['push', 'pop', 'shift', 'unshift'],
  correctIndex: 0,
  explanation: 'push appends to the end of the array.',
};

function mk(over: Partial<typeof goodItem> & Record<string, unknown> = {}): Record<string, unknown> {
  return { ...goodItem, ...over };
}

describe('stripFences', () => {
  it('removes ```json fences and bare fences', () => {
    expect(stripFences('```json\n[1]\n```')).toBe('[1]');
    expect(stripFences('```\n[1]\n```')).toBe('[1]');
  });
  it('handles null/empty input', () => {
    expect(stripFences('')).toBe('');
  });
});

describe('extractJsonArray', () => {
  it('extracts a plain array', () => {
    expect(extractJsonArray('[1,2,3]')).toBe('[1,2,3]');
  });
  it('stops at the first balanced array despite trailing prose with "]"', () => {
    const raw = '[{"a":1}] Hope that helps! (see also [docs])';
    expect(extractJsonArray(raw)).toBe('[{"a":1}]');
  });
  it('is not confused by brackets inside strings', () => {
    const raw = '[{"question":"What does arr[0] return?"}] trailing';
    expect(extractJsonArray(raw)).toBe('[{"question":"What does arr[0] return?"}]');
  });
  it('handles escaped quotes inside strings', () => {
    const raw = '[{"q":"say \\"hi[\\" now"}] x]';
    expect(extractJsonArray(raw)).toBe('[{"q":"say \\"hi[\\" now"}]');
  });
  it('returns null for truncated output', () => {
    expect(extractJsonArray('[{"a":1},{"b":')).toBeNull();
  });
  it('returns null when no array exists', () => {
    expect(extractJsonArray('Sorry, I cannot do that.')).toBeNull();
  });
});

describe('validateQuestion — rejects instead of patching', () => {
  it('accepts a well-formed item', () => {
    const v = validateQuestion(mk());
    expect(v).not.toBeNull();
    expect(v!.options).toHaveLength(4);
    expect(v!.correctIndex).toBe(0);
  });
  it('rejects missing/short question text', () => {
    expect(validateQuestion(mk({ question: '' }))).toBeNull();
    expect(validateQuestion(mk({ question: 'Why?' }))).toBeNull();
  });
  it('rejects fewer than 4 options — never pads with filler', () => {
    const v = validateQuestion(mk({ options: ['a', 'b'] }));
    expect(v).toBeNull();
  });
  it('rejects more than 4 options', () => {
    expect(validateQuestion(mk({ options: ['a', 'b', 'c', 'd', 'e'] }))).toBeNull();
  });
  it('rejects duplicate options (unanswerable)', () => {
    expect(validateQuestion(mk({ options: ['a', 'a', 'c', 'd'] }))).toBeNull();
  });
  it('rejects blank options rather than counting them', () => {
    expect(validateQuestion(mk({ options: ['a', '', 'c', 'd'] }))).toBeNull();
  });
  it('rejects out-of-range correctIndex with no answer text — never defaults to 0', () => {
    expect(validateQuestion(mk({ correctIndex: 7 }))).toBeNull();
    expect(validateQuestion(mk({ correctIndex: undefined }))).toBeNull();
  });
  it('recovers the index from answer-text fields models use instead', () => {
    const v = validateQuestion(mk({ correctIndex: undefined, answer: 'shift' }));
    expect(v).not.toBeNull();
    expect(v!.correctIndex).toBe(2);
  });
  it('answer text overrides a wrong-but-in-range correctIndex', () => {
    const v = validateQuestion(mk({ correctIndex: 1, correctAnswer: 'Push' }));
    expect(v!.correctIndex).toBe(0); // case-insensitive match wins
  });
  it('rejects answer text matching no option', () => {
    expect(validateQuestion(mk({ correctIndex: undefined, answer: 'splice' }))).toBeNull();
  });
  it('defaults unknown type to multiple-choice and fills empty explanation', () => {
    const v = validateQuestion(mk({ type: 'weird', explanation: '' }));
    expect(v!.type).toBe('multiple-choice');
    expect(v!.explanation).toBe('No explanation provided.');
  });
  it('rejects non-object garbage', () => {
    expect(validateQuestion(null)).toBeNull();
    expect(validateQuestion('question')).toBeNull();
    expect(validateQuestion(42)).toBeNull();
  });
});

describe('parseQuizBatch', () => {
  it('parses a fenced response and drops only the invalid items', () => {
    const raw = '```json\n' + JSON.stringify([
      goodItem,
      mk({ options: ['only', 'two'] }),
      mk({ question: 'Which loop is guaranteed to run at least once?', options: ['for', 'while', 'do-while', 'forEach'], correctIndex: 2 }),
    ]) + '\n```';
    const out = parseQuizBatch(raw);
    expect(out).toHaveLength(2);
  });
  it('returns [] on unparseable / truncated output', () => {
    expect(parseQuizBatch('no json here')).toEqual([]);
    expect(parseQuizBatch('[{"question": "trunca')).toEqual([]);
  });
  it('returns [] when top-level JSON is not an array', () => {
    // no top-level [ at all
    expect(parseQuizBatch('{"questions": 1}')).toEqual([]);
  });
});

describe('dedupeQuestions', () => {
  const q = (text: string): ParsedQuizQuestion => ({
    ...goodItem,
    question: text,
    type: 'multiple-choice',
  });

  it('drops duplicate question text across batches (whitespace/case/punct-insensitive)', () => {
    const out = dedupeQuestions([
      q('What is a closure?'),
      q('  what is a CLOSURE '),
      q('What is hoisting?'),
    ]);
    expect(out).toHaveLength(2);
  });
  it('drops the prompt example questions when a model echoes them', () => {
    const out = dedupeQuestions([
      q('Which keyword defines a function in Python?'),
      q('What does this code print?'),
      q('What is X?'),
      q('What is a genuinely new question about generics?'),
    ]);
    expect(out).toHaveLength(1);
  });
  it('caps at the requested limit', () => {
    const out = dedupeQuestions([q('Q one is long enough?'), q('Q two is long enough?'), q('Q three is long enough?')], 2);
    expect(out).toHaveLength(2);
  });
});

describe('duplicate questions in a finished quiz (live report 2026-08-10)', () => {
  const q = (over: Partial<ParsedQuizQuestion> = {}): ParsedQuizQuestion => ({
    type: 'multiple-choice',
    question: 'What is a closure?',
    code: '',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: 'because',
    ...over,
  });

  describe('dedupe key includes code', () => {
    it('keeps code-output questions that share a stem but differ in code', () => {
      // "What does this code print?" is the natural stem for EVERY code-output
      // question. Keying on text alone deleted all but the first, starving the
      // quiz of valid questions.
      const out = dedupeQuestions([
        q({ type: 'code-output', question: 'What output does this snippet produce?', code: 'print(2 ** 3)' }),
        q({ type: 'code-output', question: 'What output does this snippet produce?', code: 'print(len("abc"))' }),
      ]);
      expect(out).toHaveLength(2);
    });

    it('still drops a genuine duplicate — same stem AND same code', () => {
      const out = dedupeQuestions([
        q({ type: 'code-output', question: 'What does this code print?', code: 'print(1)' }),
        q({ type: 'code-output', question: 'What does this code print?', code: 'print(1)' }),
      ]);
      expect(out).toHaveLength(1);
    });

    it('ignores whitespace differences in code', () => {
      const out = dedupeQuestions([
        q({ question: 'Output?', code: 'a = 1\n  b = 2' }),
        q({ question: 'Output?', code: 'a = 1    b = 2' }),
      ]);
      expect(out).toHaveLength(1);
    });

    it('text-only duplicates are still removed when there is no code', () => {
      expect(dedupeQuestions([q(), q()])).toHaveLength(1);
    });
  });

  describe('buildAvoidClause', () => {
    it('is empty for the first batch, leaving that prompt untouched', () => {
      expect(buildAvoidClause([])).toBe('');
    });

    it('lists what was already asked and forbids rephrasing', () => {
      const clause = buildAvoidClause([q({ question: 'What is a closure?' })]);
      expect(clause).toContain('What is a closure?');
      expect(clause).toMatch(/do not repeat/i);
      expect(clause).toMatch(/rephrase/i);
    });

    it('caps the list so a long quiz cannot flood a small model prompt', () => {
      const many = Array.from({ length: 50 }, (_, i) => q({ question: `Question number ${i}?` }));
      const clause = buildAvoidClause(many, 20);
      expect(clause.split('\n').filter(l => l.startsWith('- '))).toHaveLength(20);
      // Keeps the MOST RECENT, which are the ones a next batch is likeliest
      // to echo.
      expect(clause).toContain('Question number 49?');
      expect(clause).not.toContain('Question number 0?');
    });

    it('skips blank questions rather than emitting empty bullets', () => {
      expect(buildAvoidClause([q({ question: '   ' })])).toBe('');
    });
  });
});

describe('anti-parrot filter is exact, not a blanket ban on the stem', () => {
  const codeQ = (code: string) => ({
    type: 'code-output' as const,
    question: 'What does this code print?',
    code,
    options: ['1', '2', '3', '4'],
    correctIndex: 0,
    explanation: 'x',
  });

  it('still rejects the example verbatim — text AND code', () => {
    expect(dedupeQuestions([codeQ('print(2 ** 3)')])).toHaveLength(0);
  });

  it('accepts the same stem with genuinely different code', () => {
    // Before: the stem was banned outright, so EVERY naturally-phrased
    // code-output question was deleted and quizzes came back thin.
    expect(dedupeQuestions([codeQ('print(len("abc"))')])).toHaveLength(1);
  });

  it('still rejects the other examples, which carry no code', () => {
    const plain = (question: string) => ({
      type: 'multiple-choice' as const,
      question, code: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'x',
    });
    expect(dedupeQuestions([plain('Which keyword defines a function in Python?')])).toHaveLength(0);
    expect(dedupeQuestions([plain('What is X?')])).toHaveLength(0);
  });
});
