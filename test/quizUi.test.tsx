import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActivityToggle } from "../src/ui/ActivityToggle";
import { QuizProgress, QuizResults } from "../src/ui/QuizResults";
import type { QuizState } from "../src/state/quiz";

const empty: QuizState = { answers: [], score: 0, possible: 0, attempted: 0, complete: false, categories: [], recommendation: null };

describe("quiz UI", () => {
  it("renders and disables the activity toggle", () => {
    const html = renderToStaticMarkup(<ActivityToggle value="quiz" disabled onChange={vi.fn()} />);
    expect(html).toContain("Conversation");
    expect(html).toContain("Quiz");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-checked="true"');
  });

  it("shows progress without a numeric score", () => {
    const html = renderToStaticMarkup(<QuizProgress quiz={{ ...empty, attempted: 2 }} />);
    expect(html).toContain("Question 3 of 5");
    expect(html).not.toContain("score");
  });

  it("shows an honest empty early-disconnect result", () => {
    const html = renderToStaticMarkup(<QuizResults quiz={empty} />);
    expect(html).toContain("Quiz incomplete");
    expect(html).toContain("No answers were graded");
  });
});
