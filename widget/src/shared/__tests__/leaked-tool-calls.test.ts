/**
 * Catching a reply that describes tool calls instead of making them.
 *
 * Every fixture below is copied from a real HomeBot conversation in which the
 * assistant reported **Done** having executed nothing.
 */

import {
  detectLeakedToolCalls,
  hasLeakedToolCalls,
  stripLeakedToolCalls,
  describeLeak,
} from '../leaked-tool-calls';

// ── Real transcripts ────────────────────────────────────────────────────────

const MOONSHOT_LEAK =
  "I'll run a safe test suite on the available developer tools. " +
  '<|tool_calls_section_begin|> <|tool_call_begin|> functions.run_terminal_command:0 ' +
  '<|tool_call_argument_begin|> {"command": "echo \\"test\\"", "explanation": "Testing"} ' +
  '<|tool_call_end|> <|tool_call_begin|> functions.list_directory:1 ' +
  '<|tool_call_argument_begin|> {"path": "C:\\\\Users\\\\adenk"} <|tool_call_end|> ' +
  '<|tool_calls_section_end|>';

const XML_LEAK =
  'That was the raw tool invocation syntax you saw—let me actually run those tests now:\n' +
  '<function_calls> <invoke name="run_terminal_command"> ' +
  '<parameter name="command">echo "test"</parameter> </invoke> ' +
  '<invoke name="project_tree"> <parameter name="path">C:\\Users\\adenk</parameter> ' +
  '</invoke> </function_calls>';

const SELF_CLOSING_LEAK =
  "Sure, let's do some internal tests using available tools. " +
  '<functions:invoke name="get_system_info"/> <functions:invoke name="list_processes"/>';

const QWEN_JSON_LEAK =
  'Let me check that for you.\n' +
  '<tool_call>{"name": "search_files", "arguments": {"pattern": "*.ts"}}</tool_call>';

describe('detecting the three formats seen in the wild', () => {
  test('Moonshot/Kimi native tokens', () => {
    const calls = detectLeakedToolCalls(MOONSHOT_LEAK);
    expect(calls.map(c => c.tool)).toEqual(
      expect.arrayContaining(['run_terminal_command', 'list_directory'])
    );
    expect(calls[0].format).toBe('moonshot-tokens');
  });

  test('Anthropic-shaped XML', () => {
    const calls = detectLeakedToolCalls(XML_LEAK);
    expect(calls.map(c => c.tool)).toEqual(
      expect.arrayContaining(['run_terminal_command', 'project_tree'])
    );
  });

  test('self-closing functions:invoke — what the LOCAL model copied from history', () => {
    // qwen2.5:7b produced this after seeing the cloud model's leaked syntax
    // earlier in the same conversation. The pattern spreads between turns.
    const calls = detectLeakedToolCalls(SELF_CLOSING_LEAK);
    expect(calls.map(c => c.tool)).toEqual(
      expect.arrayContaining(['get_system_info', 'list_processes'])
    );
  });

  test('Qwen/Hermes tool_call JSON', () => {
    expect(detectLeakedToolCalls(QWEN_JSON_LEAK).map(c => c.tool)).toContain('search_files');
  });

  test('the same call leaked repeatedly is reported once', () => {
    const doubled = SELF_CLOSING_LEAK + ' ' + SELF_CLOSING_LEAK;
    expect(detectLeakedToolCalls(doubled)).toHaveLength(2);
  });
});

describe('not crying wolf', () => {
  // A detector that fires on ordinary text would be worse than none: it would
  // put a scary warning under perfectly good answers until people ignored it.

  test('an ordinary answer is clean', () => {
    expect(hasLeakedToolCalls('Hey! What\'s up?')).toBe(false);
    expect(hasLeakedToolCalls('I read the file and it contains three functions.')).toBe(false);
  });

  test('empty and whitespace are clean', () => {
    expect(hasLeakedToolCalls('')).toBe(false);
    expect(hasLeakedToolCalls('   \n  ')).toBe(false);
  });

  test('talking ABOUT tools is not leaking one', () => {
    expect(hasLeakedToolCalls('You can use the run_terminal_command tool for that.')).toBe(false);
    expect(hasLeakedToolCalls('The functions in that module are well named.')).toBe(false);
  });

  test('HTML and code in an answer are not tool calls', () => {
    expect(hasLeakedToolCalls('<div class="invoke">hello</div>')).toBe(false);
    expect(hasLeakedToolCalls('const invoke = (name) => name;')).toBe(false);
  });

  test('a real tool RESULT being summarised is clean', () => {
    // After a genuine tool call the model narrates what it found. That must
    // never be mistaken for a leak.
    expect(hasLeakedToolCalls('I ran the command and it printed "Terminal tool test successful".')).toBe(false);
  });
});

describe('stripping it out of what the user reads', () => {
  test('removes the whole Moonshot section', () => {
    const clean = stripLeakedToolCalls(MOONSHOT_LEAK);
    expect(clean).not.toContain('tool_call_begin');
    expect(clean).not.toContain('functions.');
    expect(clean).toContain("I'll run a safe test suite");
  });

  test('removes the XML wrapper and keeps the sentence', () => {
    const clean = stripLeakedToolCalls(XML_LEAK);
    expect(clean).not.toContain('<invoke');
    expect(clean).not.toContain('<parameter');
    expect(clean).toContain('let me actually run those tests now');
  });

  test('removes self-closing invokes', () => {
    const clean = stripLeakedToolCalls(SELF_CLOSING_LEAK);
    expect(clean).not.toContain('invoke');
    expect(clean).toContain("let's do some internal tests");
  });

  test('a truncated stream leaves no half-tag behind', () => {
    // Streaming can cut mid-markup; the leftovers must not reach the screen.
    const clean = stripLeakedToolCalls('Working on it <|tool_call_begin|> functions.foo');
    expect(clean).not.toContain('<|');
  });

  test('ordinary text is returned unchanged', () => {
    const text = 'Here is a normal answer with <b>bold</b> in it.';
    expect(stripLeakedToolCalls(text)).toBe(text);
  });
});

describe('what the user gets told', () => {
  test('names the tools it tried to use', () => {
    const msg = describeLeak(detectLeakedToolCalls(MOONSHOT_LEAK));
    expect(msg).toContain('run_terminal_command');
    expect(msg).toContain('list_directory');
  });

  test('says plainly that nothing ran', () => {
    // The whole failure is that "Done" was a lie. The correction has to be
    // unambiguous, not softened.
    const msg = describeLeak(detectLeakedToolCalls(XML_LEAK));
    expect(msg).toMatch(/nothing was actually run/i);
    expect(msg).toMatch(/did not do what it says/i);
  });

  test('says nothing when there is nothing to say', () => {
    expect(describeLeak([])).toBe('');
  });
});
