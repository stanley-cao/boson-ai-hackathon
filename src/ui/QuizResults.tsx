import type { QuizState } from "../state/quiz";

const LABELS = {
  translation: "translation",
  vocabulary: "vocabulary",
  grammar: "grammar",
  comprehension: "comprehension",
} as const;

export function QuizProgress({ quiz }: { quiz: QuizState }) {
  if (quiz.complete) return <p className="quiz-progress">Quiz complete — finish to view your score.</p>;
  return <p className="quiz-progress">Question {Math.min(quiz.attempted + 1, 5)} of 5</p>;
}

export function QuizResults({ quiz }: { quiz: QuizState }) {
  const score = quiz.attempted === 0
    ? "No answers were graded."
    : quiz.complete
      ? `${quiz.score} out of 10`
      : `${quiz.score} out of ${quiz.possible} attempted points`;
  return (
    <section className="quiz-results" aria-labelledby="quiz-results-heading">
      <span className="recap-kicker">{quiz.complete ? "Quiz complete" : "Quiz incomplete"}</span>
      <h2 id="quiz-results-heading">{score}</h2>
      {quiz.recommendation && (
        <p>Recommended focus: <strong>{LABELS[quiz.recommendation]}</strong>.</p>
      )}
      {quiz.answers.length === 0 ? (
        <p className="recap-empty">End after at least one graded answer to see a breakdown.</p>
      ) : (
        <ol className="quiz-answer-list">
          {quiz.answers.map((answer) => (
            <li className="quiz-answer" key={answer.questionNumber}>
              <strong>{answer.questionNumber}. {answer.question}</strong>
              <p><span className="recap-label">Your answer</span> {answer.learnerAnswer}</p>
              <p><span className="recap-label">Reference answer</span> {answer.referenceAnswer}</p>
              <p><strong>{answer.points}/2</strong> — {answer.feedback}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
