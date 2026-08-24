/** @jest-environment jsdom */

/**
 * Saying so when the quiz is shorter than you asked for.
 *
 * Reported live: "quiz was meant to give me 5 questions and it gave me 3".
 *
 * The generator returned `success: true` with three questions and the panel
 * showed "Question 1 / 3" — a number that is correct about what arrived and
 * silent about what was requested. Only a ZERO-length result was ever treated
 * as an error, so a short quiz was indistinguishable from a full one.
 *
 * These assert the panel SHOWS the shortfall, because a `shortfall` field
 * nothing renders is the same defect one layer down.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import QuizPanel from '../components/QuizPanel';

jest.mock('../styles/quiz-panel.css', () => ({}), { virtual: true });

const q = (question: string) => ({
  id: `q-${question}`,
  type: 'multiple-choice',
  question,
  code: '',
  options: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
  correctIndex: 0,
  explanation: 'Because.',
});

function setupElectron(result: Record<string, unknown>) {
  (window as any).electron = {
    loadQuizProgress: jest.fn().mockResolvedValue({ success: true, data: null }),
    saveQuizProgress: jest.fn().mockResolvedValue({ success: true }),
    generateQuiz: jest.fn().mockResolvedValue(result),
    generateQuizFromRag: jest.fn().mockResolvedValue(result),
  };
}

async function startQuiz() {
  fireEvent.click(screen.getByText('Python'));
  await act(async () => { fireEvent.click(screen.getByText('Start Quiz')); });
  await waitFor(() => expect(screen.getByText(/Question 1 \//)).toBeInTheDocument());
}

afterEach(() => {
  delete (window as any).electron;
  jest.clearAllMocks();
});

test('a short quiz says how many of how many came out', async () => {
  setupElectron({
    success: true,
    questions: [q('one'), q('two'), q('three')],
    requested: 5,
    shortfall: 2,
    notice: 'Only 3 of the 5 questions came out usable this time — the rest were repeats or malformed. Try again, or pick a broader topic.',
  });

  render(<QuizPanel />);
  await startQuiz();

  const notice = screen.getByTestId('quiz-shortfall');
  expect(notice.textContent).toMatch(/Only 3 of the 5/);
});

test('a full quiz says nothing — the notice is for the exception', async () => {
  setupElectron({
    success: true,
    questions: [q('one'), q('two')],
    requested: 2,
    shortfall: 0,
  });

  render(<QuizPanel />);
  await startQuiz();

  expect(screen.queryByTestId('quiz-shortfall')).toBeNull();
});

test('an older response with no shortfall field shows no notice', async () => {
  // Backwards compatibility: the fields are additive, and their absence must
  // not be read as "something went wrong".
  setupElectron({ success: true, questions: [q('one'), q('two')] });

  render(<QuizPanel />);
  await startQuiz();

  expect(screen.queryByTestId('quiz-shortfall')).toBeNull();
});

test('the quiz still runs — a short quiz is playable, not an error', async () => {
  setupElectron({
    success: true,
    questions: [q('one')],
    requested: 5,
    shortfall: 4,
    notice: 'Only 1 of the 5 questions came out usable this time.',
  });

  render(<QuizPanel />);
  await startQuiz();

  // The notice sits alongside a working quiz rather than replacing it.
  expect(screen.getByTestId('quiz-shortfall')).toBeInTheDocument();
  expect(screen.getByText(/Question 1 \/ 1/)).toBeInTheDocument();
  expect(screen.getAllByText('Alpha')[0]).toBeInTheDocument();
});
