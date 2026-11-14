// SM-2 spaced-repetition scheduling and multiple-choice grading for the
// vocabulary review. Ported from the Django app (api/spaced_repetition.py) and
// kept identical to it, including where it differs from textbook SM-2:
//   - quality is graded 0..5
//   - the lapse threshold is `quality < 4` (NOT the textbook `< 3`): any grade
//     below 4 resets the interval to 1 day and repetitions to 1 (not 0, so the
//     next good answer gives a 6-day interval).
//   - easiness is adjusted on EVERY grade, lapses included, so hard cards get a
//     lower easiness and their intervals grow more slowly. The interval is
//     computed with the easiness from before this grade.
//   - cards come due at the START of the day in Vietnam time, not at the exact
//     time of day they were last reviewed, so a card due "tomorrow" shows up all
//     of tomorrow.

// The schedule fields of a CardReview that SM-2 reads and changes.
export interface Sm2State {
  easiness: number;
  interval: number; // days
  repetitions: number;
  nextReviewAt: Date | null;
}

// Python's round(): halves go to the even neighbour (round(2.5) = 2), unlike
// Math.round. Used so intervals match the Django app's exactly.
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Updates `review` in place for a grade (`quality`, 0..5) given at `now`.
// Returns true if the card lapsed (quality < 4) and needs more practice.
export function applySm2(review: Sm2State, quality: number, now: Date = new Date()): boolean {
  review.repetitions = (review.repetitions || 0) + 1;

  let interval: number;
  if (review.repetitions === 1) interval = 1;
  else if (review.repetitions === 2) interval = 6;
  else interval = roundHalfEven(review.interval * review.easiness);

  const easiness = review.easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  review.easiness = Math.max(easiness, 1.3);

  if (quality < 4) {
    // Having difficulty recalling: restart the schedule.
    interval = 1;
    review.repetitions = 1;
  }

  review.interval = interval;
  review.nextReviewAt = startOfReviewDay(now, interval);
  return quality < 4;
}

// The students' time zone, whose midnight starts a new review day:
// Asia/Ho_Chi_Minh, a fixed UTC+7 with no daylight saving time.
const REVIEW_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

// Midnight (Vietnam time) of the day `daysAhead` days after `date`'s Vietnam day.
export function startOfReviewDay(date: Date, daysAhead: number): Date {
  const local = new Date(date.getTime() + REVIEW_TZ_OFFSET_MS); // its UTC fields are the Vietnam date
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysAhead);
  return new Date(localMidnight - REVIEW_TZ_OFFSET_MS);
}

// --- Grading a multiple-choice answer -----------------------------------------------
//
// The student sees the word (after its audio plays) plus 4 definitions, and the clock
// starts when the options appear. The SM-2 grade comes from correctness + response time:
//
//   ANSWER_TIME_LIMIT_MS (12 s) -- the hard limit. If no option is picked within 12 s the
//       card counts as not known (grade 1, a lapse): the answer is shown and the card comes
//       back tomorrow. 12 s is meant to be enough to read 4 short definitions and pick the
//       one you recognize, but not enough to work it out slowly by elimination.
//       The frontend counts down and auto-submits at 12 s; the backend also treats any
//       reported time over 12 s as a timeout.
//
//   FAST_ANSWER_MS (5 s) -- splits correct answers into "knew it instantly" vs "had to
//       think". Correct within 5 s = grade 5 (easiness +0.1: the word's intervals grow
//       faster). Correct in 5-12 s = grade 4 (easiness unchanged: intervals still grow,
//       at the normal rate).
//
//   Both are starting guesses, not measured values: tune them once real response
//   times are available. Long definitions take longer to read, so a slow-but-correct
//   answer on a long card may be reading time, not weak recall.
//
// Grades (applySm2 treats < 4 as a lapse):
//   5  correct, under FAST_ANSWER_MS
//   4  correct, FAST_ANSWER_MS .. ANSWER_TIME_LIMIT_MS
//   2  "I don't know"   -- a lapse, but a smaller easiness drop (-0.32) than a wrong
//                          answer, so being honest is never worse than guessing
//   1  wrong, or timed out (-0.54)
export const ANSWER_TIME_LIMIT_MS = 12_000;
export const FAST_ANSWER_MS = 5_000;

// Special answer choices (instead of an option key).
export const DONT_KNOW = "dont_know";
export const TIMEOUT = "timeout";

// ReviewLog.result values.
export type ReviewResult = "correct" | "wrong" | typeof DONT_KNOW | typeof TIMEOUT;

export interface Grade {
  result: ReviewResult;
  quality: number;
  reason: string; // why this grade, shown to the student after answering
}

// Grades one multiple-choice answer. `correct`: whether the chosen option is the
// card's definition; `choice`: the option key, DONT_KNOW or TIMEOUT;
// `latencyMs`: time from the options appearing to the answer (measured by the client).
export function gradeAnswer(correct: boolean, choice: string, latencyMs: number): Grade {
  const seconds = (latencyMs / 1000).toFixed(1);
  const limitS = Math.floor(ANSWER_TIME_LIMIT_MS / 1000);
  const fastS = Math.floor(FAST_ANSWER_MS / 1000);
  if (choice === DONT_KNOW) {
    return { result: DONT_KNOW, quality: 2, reason: 'You chose "I don\'t know" → grade 2.' };
  }
  if (choice === TIMEOUT || latencyMs > ANSWER_TIME_LIMIT_MS) {
    return { result: TIMEOUT, quality: 1, reason: `No answer within the ${limitS} s limit → grade 1.` };
  }
  if (!correct) {
    return { result: "wrong", quality: 1, reason: `Wrong answer after ${seconds} s → grade 1.` };
  }
  if (latencyMs < FAST_ANSWER_MS) {
    return { result: "correct", quality: 5, reason: `Correct in ${seconds} s, under the ${fastS} s "fast" mark → grade 5.` };
  }
  return {
    result: "correct",
    quality: 4,
    reason: `Correct in ${seconds} s, slower than the ${fastS} s "fast" mark but within the ${limitS} s limit → grade 4.`,
  };
}
