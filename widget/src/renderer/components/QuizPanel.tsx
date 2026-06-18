import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { QuizQuestion, QuizDifficulty, QuizProgress } from '../../shared/types';
import '../styles/quiz-panel.css';

const TOPICS = [
  { id: 'python', label: 'Python', icon: '🐍' },
  { id: 'javascript', label: 'JavaScript', icon: '⚡' },
  { id: 'typescript', label: 'TypeScript', icon: '🔷' },
  { id: 'react', label: 'React', icon: '⚛️' },
  { id: 'html-css', label: 'HTML & CSS', icon: '🎨' },
  { id: 'sql', label: 'SQL', icon: '🗄️' },
  { id: 'git', label: 'Git', icon: '📦' },
  { id: 'data-structures', label: 'Data Structures', icon: '🏗️' },
  { id: 'algorithms', label: 'Algorithms', icon: '🧮' },
  { id: 'csharp', label: 'C#', icon: '🟣' },
  { id: 'java', label: 'Java', icon: '☕' },
  { id: 'rust', label: 'Rust', icon: '🦀' },
];

const DIFFICULTIES: { id: QuizDifficulty; label: string; desc: string }[] = [
  { id: 'beginner', label: 'Beginner', desc: 'Syntax, basics, simple concepts' },
  { id: 'intermediate', label: 'Intermediate', desc: 'Functions, patterns, error handling' },
  { id: 'advanced', label: 'Advanced', desc: 'Algorithms, edge cases, performance' },
];

const QUESTION_COUNTS = [5, 10, 15, 20];

const DEFAULT_PROGRESS: QuizProgress = {
  totalQuizzes: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  topicScores: {},
  streak: 0,
  bestStreak: 0,
};

const QuizPanel: React.FC = () => {
  // Setup state
  const [topic, setTopic] = useState<string | null>(null);
  const [customTopic, setCustomTopic] = useState('');
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('beginner');
  const [questionCount, setQuestionCount] = useState(10);
  const [studyFromNotes, setStudyFromNotes] = useState(false);

  // Quiz state
  const [phase, setPhase] = useState<'setup' | 'loading' | 'quiz' | 'review' | 'results'>('setup');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Progress tracking
  const [progress, setProgress] = useState<QuizProgress>(DEFAULT_PROGRESS);
  const progressLoaded = useRef(false);

  // Load saved progress on mount
  useEffect(() => {
    if (progressLoaded.current) return;
    progressLoaded.current = true;
    window.electron?.loadQuizProgress?.().then(result => {
      if (result?.success && result.data) {
        setProgress(result.data);
      }
    }).catch(() => {});
  }, []);

  const saveProgress = useCallback((updated: QuizProgress) => {
    setProgress(updated);
    window.electron?.saveQuizProgress?.(updated).catch(() => {});
  }, []);

  const handleStartQuiz = useCallback(async () => {
    const effectiveTopic = studyFromNotes ? (customTopic.trim() || topic) : topic;
    if (!effectiveTopic) return;
    setPhase('loading');
    setLoadError(null);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setAnswered(false);
    setAnswers([]);
    setScore(0);
    setStreak(0);

    let result;
    if (studyFromNotes) {
      result = await window.electron?.generateQuizFromRag?.({
        topic: effectiveTopic,
        difficulty,
        questionCount,
      });
    } else {
      result = await window.electron?.generateQuiz?.({
        topic: effectiveTopic,
        difficulty,
        questionCount,
      });
    }

    if (result?.success && result.questions?.length) {
      setQuestions(result.questions);
      setAnswers(new Array(result.questions.length).fill(null));
      setPhase('quiz');
    } else {
      setLoadError(result?.error || 'Failed to generate quiz. Is Ollama running?');
      setPhase('setup');
    }
  }, [topic, customTopic, difficulty, questionCount, studyFromNotes]);

  const handleSelectAnswer = useCallback((index: number) => {
    if (answered) return;
    setSelectedAnswer(index);
  }, [answered]);

  const handleSubmitAnswer = useCallback(() => {
    if (selectedAnswer === null || answered) return;
    setAnswered(true);
    const correct = selectedAnswer === questions[currentIndex].correctIndex;
    const newAnswers = [...answers];
    newAnswers[currentIndex] = selectedAnswer;
    setAnswers(newAnswers);
    if (correct) {
      setScore(s => s + 1);
      setStreak(s => s + 1);
    } else {
      setStreak(0);
    }
  }, [selectedAnswer, answered, questions, currentIndex, answers]);

  const handleNext = useCallback(() => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(i => i + 1);
      setSelectedAnswer(null);
      setAnswered(false);
    } else {
      // Quiz complete — update progress
      // score already includes the last answer (updated in handleSubmitAnswer), so don't add it again
      const topicKey = topic || 'unknown';
      const existing = progress.topicScores[topicKey] || { correct: 0, total: 0 };
      const updated: QuizProgress = {
        totalQuizzes: progress.totalQuizzes + 1,
        totalCorrect: progress.totalCorrect + score,
        totalAnswered: progress.totalAnswered + questions.length,
        topicScores: {
          ...progress.topicScores,
          [topicKey]: {
            correct: existing.correct + score,
            total: existing.total + questions.length,
          },
        },
        streak: streak,
        bestStreak: Math.max(progress.bestStreak, streak),
        lastQuizDate: new Date().toISOString(),
      };
      saveProgress(updated);
      setPhase('results');
    }
  }, [currentIndex, questions, topic, progress, score, streak, selectedAnswer, saveProgress]);

  const handleReviewQuestion = useCallback((index: number) => {
    setCurrentIndex(index);
    setPhase('review');
  }, []);

  const handleBackToSetup = useCallback(() => {
    setPhase('setup');
    setQuestions([]);
    setTopic(null);
  }, []);

  const currentQ = questions[currentIndex];
  const finalScore: number = phase === 'results'
    ? answers.reduce<number>((s, a, i) => s + (a === questions[i]?.correctIndex ? 1 : 0), 0)
    : score;
  const pct = questions.length > 0 ? Math.round((finalScore / questions.length) * 100) : 0;

  // ── Setup Screen ──
  if (phase === 'setup') {
    return (
      <div className="quiz-container">
        <div className="quiz-header">
          <h2 className="quiz-title">Learn to Code</h2>
          <p className="quiz-subtitle">Interactive quizzes powered by your local AI</p>
        </div>

        {/* Progress summary */}
        {progress.totalQuizzes > 0 && (
          <div className="quiz-stats-bar">
            <div className="quiz-stat">
              <span className="quiz-stat-value">{progress.totalQuizzes}</span>
              <span className="quiz-stat-label">Quizzes</span>
            </div>
            <div className="quiz-stat">
              <span className="quiz-stat-value">{progress.totalAnswered > 0 ? Math.round((progress.totalCorrect / progress.totalAnswered) * 100) : 0}%</span>
              <span className="quiz-stat-label">Accuracy</span>
            </div>
            <div className="quiz-stat">
              <span className="quiz-stat-value">{progress.bestStreak}</span>
              <span className="quiz-stat-label">Best Streak</span>
            </div>
          </div>
        )}

        {/* Topic selection */}
        <div className="quiz-section">
          <h3 className="quiz-section-title">Choose a Topic</h3>
          <div className="quiz-topic-grid">
            {TOPICS.map(t => (
              <button
                key={t.id}
                className={`quiz-topic-card ${topic === t.id ? 'selected' : ''}`}
                onClick={() => setTopic(t.id)}
              >
                <span className="quiz-topic-icon">{t.icon}</span>
                <span className="quiz-topic-label">{t.label}</span>
                {progress.topicScores[t.id] && (
                  <span className="quiz-topic-score">
                    {Math.round((progress.topicScores[t.id].correct / progress.topicScores[t.id].total) * 100)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Difficulty */}
        <div className="quiz-section">
          <h3 className="quiz-section-title">Difficulty</h3>
          <div className="quiz-difficulty-row">
            {DIFFICULTIES.map(d => (
              <button
                key={d.id}
                className={`quiz-difficulty-btn ${difficulty === d.id ? 'selected' : ''}`}
                onClick={() => setDifficulty(d.id)}
              >
                <span className="quiz-diff-label">{d.label}</span>
                <span className="quiz-diff-desc">{d.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Question count */}
        <div className="quiz-section">
          <h3 className="quiz-section-title">Questions</h3>
          <div className="quiz-count-row">
            {QUESTION_COUNTS.map(c => (
              <button
                key={c}
                className={`quiz-count-btn ${questionCount === c ? 'selected' : ''}`}
                onClick={() => setQuestionCount(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Study from Notes toggle */}
        <div className="quiz-section">
          <h3 className="quiz-section-title">Source</h3>
          <button
            type="button"
            className={`quiz-difficulty-btn quiz-source-toggle ${studyFromNotes ? 'selected' : ''}`}
            onClick={() => setStudyFromNotes(prev => !prev)}
          >
            <span className="quiz-diff-label">{studyFromNotes ? 'Study from My Notes' : 'General Knowledge'}</span>
            <span className="quiz-diff-desc">{studyFromNotes ? 'Questions generated from your RAG-indexed documents' : 'Click to switch to Study Buddy mode (quiz from your notes)'}</span>
          </button>
          {studyFromNotes && (
            <div className="quiz-source-note">
              <input
                type="text"
                className="quiz-topic-input"
                placeholder="Enter a topic to quiz on (e.g. &quot;photosynthesis&quot;, &quot;React hooks&quot;)..."
                value={customTopic}
                onChange={e => setCustomTopic(e.target.value)}
              />
              <p className="quiz-source-hint">
                Questions will be generated from your indexed documents. Drop study notes into the RAG panel first.
              </p>
            </div>
          )}
        </div>

        {loadError && (
          <div className="quiz-error">{loadError}</div>
        )}

        <button
          className="quiz-start-btn"
          disabled={studyFromNotes ? !(customTopic.trim() || topic) : !topic}
          onClick={handleStartQuiz}
        >
          {studyFromNotes ? 'Study from Notes' : 'Start Quiz'}
        </button>
      </div>
    );
  }

  // ── Loading Screen ──
  if (phase === 'loading') {
    return (
      <div className="quiz-container">
        <div className="quiz-loading">
          <div className="quiz-spinner" />
          <p className="quiz-loading-text">Generating your quiz...</p>
          <p className="quiz-loading-sub">AI is crafting {questionCount} {difficulty} questions about {TOPICS.find(t => t.id === topic)?.label || topic || 'your topic'}</p>
          <p className="quiz-loading-hint">This may take 15–30 seconds depending on your GPU</p>
        </div>
      </div>
    );
  }

  // ── Results Screen ──
  if (phase === 'results') {
    const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
    const emoji = pct >= 80 ? '🎉' : pct >= 60 ? '👍' : pct >= 40 ? '💪' : '📚';
    return (
      <div className="quiz-container">
        <div className="quiz-results">
          <div className="quiz-results-emoji">{emoji}</div>
          <h2 className="quiz-results-title">Quiz Complete!</h2>
          <div className="quiz-results-grade">{grade}</div>
          <div className="quiz-results-score">{finalScore} / {questions.length} correct ({pct}%)</div>

          <div className="quiz-results-details">
            <div className="quiz-result-stat">
              <span className="quiz-result-label">Topic</span>
              <span className="quiz-result-value">{TOPICS.find(t => t.id === topic)?.label}</span>
            </div>
            <div className="quiz-result-stat">
              <span className="quiz-result-label">Difficulty</span>
              <span className="quiz-result-value">{difficulty}</span>
            </div>
            <div className="quiz-result-stat">
              <span className="quiz-result-label">Best Streak</span>
              <span className="quiz-result-value">{Math.max(progress.bestStreak, streak)}</span>
            </div>
          </div>

          {/* Question review list */}
          <div className="quiz-review-list">
            <h3 className="quiz-section-title">Review Answers</h3>
            {questions.map((q, i) => {
              const correct = answers[i] === q.correctIndex;
              return (
                <button
                  key={q.id}
                  className={`quiz-review-item ${correct ? 'correct' : 'incorrect'}`}
                  onClick={() => handleReviewQuestion(i)}
                >
                  <span className="quiz-review-icon">{correct ? '✓' : '✗'}</span>
                  <span className="quiz-review-text">Q{i + 1}: {q.question.slice(0, 60)}{q.question.length > 60 ? '...' : ''}</span>
                </button>
              );
            })}
          </div>

          <div className="quiz-results-actions">
            <button className="quiz-btn-secondary" onClick={handleBackToSetup}>New Quiz</button>
            <button className="quiz-btn-primary" onClick={handleStartQuiz}>Retry Same Topic</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Review Mode (single question after results) ──
  if (phase === 'review' && currentQ) {
    const userAnswer = answers[currentIndex];
    const correct = userAnswer === currentQ.correctIndex;
    return (
      <div className="quiz-container">
        <div className="quiz-review-header">
          <button className="quiz-back-btn" onClick={() => setPhase('results')}>← Back to Results</button>
          <span className="quiz-review-badge">Question {currentIndex + 1} of {questions.length}</span>
        </div>
        <div className="quiz-question-card">
          <div className={`quiz-type-badge ${currentQ.type}`}>{currentQ.type.replace('-', ' ')}</div>
          <p className="quiz-question-text">{currentQ.question}</p>
          {currentQ.code && (
            <pre className="quiz-code-block"><code>{currentQ.code}</code></pre>
          )}
          <div className="quiz-options">
            {currentQ.options.map((opt, i) => (
              <div
                key={i}
                className={`quiz-option review ${i === currentQ.correctIndex ? 'correct' : ''} ${i === userAnswer && !correct ? 'wrong' : ''}`}
              >
                <span className="quiz-option-letter">{String.fromCharCode(65 + i)}</span>
                <span className="quiz-option-text">{opt}</span>
                {i === currentQ.correctIndex && <span className="quiz-option-badge">✓ Correct</span>}
                {i === userAnswer && !correct && <span className="quiz-option-badge wrong">✗ Your answer</span>}
              </div>
            ))}
          </div>
          <div className="quiz-explanation">
            <strong>Explanation:</strong> {currentQ.explanation}
          </div>
        </div>
      </div>
    );
  }

  // ── Active Quiz ──
  if (!currentQ) return null;

  return (
    <div className="quiz-container">
      {/* Progress bar */}
      <div className="quiz-progress-header">
        <div className="quiz-progress-info">
          <span className="quiz-progress-count">Question {currentIndex + 1} / {questions.length}</span>
          <span className="quiz-progress-score">Score: {score} {streak >= 3 && <span className="quiz-streak">🔥 {streak} streak!</span>}</span>
        </div>
        <div className="quiz-progress-track">
          <div className="quiz-progress-fill" style={{ width: `${((currentIndex + (answered ? 1 : 0)) / questions.length) * 100}%` }} />
        </div>
      </div>

      {/* Question card */}
      <div className="quiz-question-card">
        <div className={`quiz-type-badge ${currentQ.type}`}>{currentQ.type.replace('-', ' ')}</div>
        <p className="quiz-question-text">{currentQ.question}</p>
        {currentQ.code && (
          <pre className="quiz-code-block"><code>{currentQ.code}</code></pre>
        )}

        {/* Options */}
        <div className="quiz-options">
          {currentQ.options.map((opt, i) => {
            let cls = 'quiz-option';
            if (answered) {
              if (i === currentQ.correctIndex) cls += ' correct';
              else if (i === selectedAnswer) cls += ' wrong';
            } else if (i === selectedAnswer) {
              cls += ' selected';
            }
            return (
              <button
                key={i}
                className={cls}
                onClick={() => handleSelectAnswer(i)}
                disabled={answered}
              >
                <span className="quiz-option-letter">{String.fromCharCode(65 + i)}</span>
                <span className="quiz-option-text">{opt}</span>
                {answered && i === currentQ.correctIndex && <span className="quiz-option-badge">✓</span>}
                {answered && i === selectedAnswer && i !== currentQ.correctIndex && <span className="quiz-option-badge wrong">✗</span>}
              </button>
            );
          })}
        </div>

        {/* Explanation (shown after answering) */}
        {answered && (
          <div className={`quiz-feedback ${selectedAnswer === currentQ.correctIndex ? 'correct' : 'incorrect'}`}>
            <div className="quiz-feedback-header">
              {selectedAnswer === currentQ.correctIndex ? '✓ Correct!' : '✗ Incorrect'}
            </div>
            <p className="quiz-feedback-text">{currentQ.explanation}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="quiz-actions">
          {!answered ? (
            <button className="quiz-btn-primary" disabled={selectedAnswer === null} onClick={handleSubmitAnswer}>
              Submit Answer
            </button>
          ) : (
            <button className="quiz-btn-primary" onClick={handleNext}>
              {currentIndex < questions.length - 1 ? 'Next Question →' : 'See Results'}
            </button>
          )}
          <button className="quiz-btn-secondary" onClick={handleBackToSetup}>Quit Quiz</button>
        </div>
      </div>
    </div>
  );
};

export default QuizPanel;
