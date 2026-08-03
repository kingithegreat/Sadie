/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import QuizPanel from '../components/QuizPanel';

jest.mock('../styles/quiz-panel.css', () => ({}), { virtual: true });

const q = (question: string, correctIndex = 0) => ({
  id: `q-${question}`,
  type: 'multiple-choice',
  question,
  code: '',
  options: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
  correctIndex,
  explanation: 'Because.',
});

function setupElectron(questions: ReturnType<typeof q>[]) {
  const saveQuizProgress = jest.fn().mockResolvedValue({ success: true });
  (window as any).electron = {
    loadQuizProgress: jest.fn().mockResolvedValue({ success: true, data: null }),
    saveQuizProgress,
    generateQuiz: jest.fn().mockResolvedValue({ success: true, questions }),
    generateQuizFromRag: jest.fn().mockResolvedValue({ success: true, questions }),
  };
  return { saveQuizProgress };
}

async function startQuiz() {
  fireEvent.click(screen.getByText('Python'));
  await act(async () => {
    fireEvent.click(screen.getByText('Start Quiz'));
  });
  await waitFor(() => expect(screen.getByText(/Question 1 \//)).toBeInTheDocument());
}

/** Answer the current question with option at `index`, then advance. */
async function answerAndNext(index: number) {
  const letters = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
  fireEvent.click(screen.getAllByText(letters[index])[0]);
  fireEvent.click(screen.getByText('Submit Answer'));
  await act(async () => {
    fireEvent.click(screen.getByText(/Next Question|See Results/));
  });
}

describe('QuizPanel streak recording', () => {
  afterEach(() => {
    delete (window as any).electron;
    jest.clearAllMocks();
  });

  test('best streak records the best run WITHIN the quiz, not the streak at quiz end', async () => {
    // 3 questions: correct, correct, then WRONG on the last — a 2-streak
    // followed by a miss. The old code saved bestStreak = 0 here.
    const { saveQuizProgress } = setupElectron([
      q('First question about lists?'),
      q('Second question about dicts?'),
      q('Third question about sets?'),
    ]);
    render(<QuizPanel />);
    await startQuiz();

    await answerAndNext(0); // correct
    await answerAndNext(0); // correct — streak 2
    await answerAndNext(1); // wrong — streak resets to 0, quiz ends

    await waitFor(() => expect(saveQuizProgress).toHaveBeenCalledTimes(1));
    const saved = saveQuizProgress.mock.calls[0][0];
    expect(saved.bestStreak).toBe(2);
    expect(saved.streak).toBe(0); // current streak genuinely ended at 0
    expect(saved.totalCorrect).toBe(2);
    expect(saved.totalAnswered).toBe(3);
  });

  test('progress is saved under the topic that was quizzed', async () => {
    const { saveQuizProgress } = setupElectron([q('Only question, long enough?')]);
    render(<QuizPanel />);
    await startQuiz();
    await answerAndNext(0);

    await waitFor(() => expect(saveQuizProgress).toHaveBeenCalledTimes(1));
    const saved = saveQuizProgress.mock.calls[0][0];
    expect(saved.topicScores.python).toEqual({ correct: 1, total: 1 });
  });
});
