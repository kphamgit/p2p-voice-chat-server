# SM-2 vocabulary review — port from django-no-redis

Implement the spaced-repetition vocabulary review on this server, matching the behaviour of
the Django app at `~/Desktop/django-no-redis`. The Prisma models `Card`, `CardReview` and
`ReviewLog` already exist and mirror the Django ones; no schema changes are needed.

Reference implementation (read these when something here is unclear):

| What | Django file |
|---|---|
| SM-2, grading rules, time limits | `api/spaced_repetition.py` |
| Endpoints (`_build_question`, `answer_card`, `get_all_due_cards`, `get_review_log`, `add_sense_card_to_review`) | `api/views.py` |
| Student review UI | `~/Desktop/phuyenenglish.com/src/components/CardReview.tsx`, `SingleCardReview.tsx` |
| Teacher log UI | `~/Desktop/phuyenenglish.net/src/components/ReviewLogModal.tsx` |

This server has its own frontends (`p2p-voice-chat-client` for students,
`p2p-voice-chat-admin` for admins), so its schedules are independent of the Django app's.

## 1. Scheduling: `applySm2(review, quality, now)`

`quality` is 0..5. Mutates the `CardReview` and returns `lapsed = quality < 4`.

```python
review.repetitions += 1
if review.repetitions == 1:   interval = 1
elif review.repetitions == 2: interval = 6
else:                         interval = round(review.interval * review.easiness)

easiness = review.easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
review.easiness = max(easiness, 1.3)          # updated on EVERY grade, lapses included

if quality < 4:                               # lapse
    interval = 1
    review.repetitions = 1

review.interval = interval
review.next_review_at = start_of_review_day(now, interval)
```

Deliberate differences from textbook SM-2. Keep them so the two apps match:
- **The lapse threshold is `< 4`, not `< 3`.**
- **Easiness changes on every grade.** The interval is computed with the *old* easiness, before it's updated.
- **A lapse sets repetitions to 1, not 0.** So the next good answer gives a 6-day interval.
- **Due dates are calendar days.** `start_of_review_day(now, n)` is midnight in Asia/Ho_Chi_Minh, n days after `now`'s local day. Vietnam is a fixed UTC+7 with no DST, so local midnight is 17:00 UTC on the previous day. A card is due when `nextReviewAt <= now`, or when `nextReviewAt` is null.

## 2. Grading a multiple-choice answer

The student sees the word, then 4 definitions. The clock starts when the options appear, after the word's audio has played.

```ts
const ANSWER_TIME_LIMIT_MS = 12_000; // hard limit: no answer by then = timeout
const FAST_ANSWER_MS = 5_000;        // correct under this = "knew it instantly"
```

| Result | Condition (checked in this order) | Quality |
|---|---|---|
| `dont_know` | the student pressed "I don't know" | 2 |
| `timeout` | `choice == "timeout"` **or** `latencyMs > ANSWER_TIME_LIMIT_MS` | 1 |
| `wrong` | the chosen key isn't the correct one | 1 |
| `correct` | `latencyMs < FAST_ANSWER_MS` | 5 |
| `correct` | otherwise | 4 |

- **Why "I don't know" gets 2 and a wrong answer 1:** being honest should never be worse than guessing.
- **Return a human-readable `reason`** along with the grade. Copy the strings from `grade_answer` in `spaced_repetition.py`, for example `Correct in 3.2 s, under the 5 s "fast" mark → grade 5.`
- **Explain the 12 s and 5 s limits** in a code comment. Copy the comment block above `ANSWER_TIME_LIMIT_MS` in `spaced_repetition.py`; the user wants that explanation kept.

## 3. Questions and answer keys

The client must not be able to tell which option is correct.

- **Options:** the card's own definition plus up to 3 wrong ones, then shuffled. Never send an `isCorrect` flag.
- **Where wrong definitions come from:** distinct definitions of other cards that have a non-empty definition.
  - Prefer the **same part of speech**, and fill from the others if there aren't enough.
  - **Skip cards with the same word** (`text`, case-insensitive), because another sense of the word can read like a correct answer.
- **Keys:** each question gets a random `nonce`, e.g. 8 random bytes as hex.
  - The correct option's key is `HMAC-SHA256(secret, "${userId}:${cardId}:${nonce}")`, cut to 16 hex characters.
  - Wrong options' keys are 16 random hex characters, so all keys look alike.
  - Use a dedicated env var such as `CARD_ANSWER_SECRET`, and compare keys with `crypto.timingSafeEqual`.
- **Correct definition:** not sent with the question. The answer endpoint returns it after the student answers.
- **Cards with an empty definition** can't be quizzed. Leave them out of the due list; they stay due.

## 4. Endpoints

All require auth (`requireAuth`). "Admin" means `requireRole('admin')`, the equivalent of Django's `is_staff`.

| Method & path | Purpose |
|---|---|
| `GET /cards/due` | The student's due cards, from their `CardReview` rows. Response: `{ dueCards: [{ id, text, partOfSpeech, nonce, options: [{ key, definition }], easiness, interval, repetitions, nextReviewAt }], timeLimitMs, fastAnswerMs }`. The client uses `timeLimitMs`/`fastAnswerMs` for the countdown. An admin may pass `?userId=`; then also include `definition` in each card. |
| `GET /cards/:id/question` | A fresh question (new nonce, wrong answers and order). Used for practice repeats. |
| `POST /cards/:id/answer` | Body `{ nonce, choice, latencyMs, chosenDefinition }`, where `choice` is an option key, `"dont_know"` or `"timeout"`. Clamp `latencyMs` to ≥ 0 and reject a missing nonce (400). |
| `POST /cards/from-sense/:senseId/add-to-review` | Creates the `Card` from the sense if none exists (`text` = head word, `definition`, `partOfSpeech` = POS name). Then creates a `CardReview` with `nextReviewAt = start_of_review_day(now, 1)`, so the first quiz is tomorrow. Returns the card plus `created`. Idempotent. |
| `GET /cards/review-log?userId=&cardId=` | **Admin only.** The latest 500 `ReviewLog` rows for that user, newest first, each with the card's `text`, `partOfSpeech` and `definition`. Response: `{ entries, limit }`. |

**`POST /cards/:id/answer` in detail.** These rules are the important ones:
1. Check the key, and grade it with section 2.
2. `upsert` the `CardReview`.
3. **The server decides whether the answer counts:** `graded = nextReviewAt is null || nextReviewAt <= now`.
   - If graded: run `applySm2` and save, then append ` Next review in N day(s).` to `reason`.
   - If not graded: append ` Practice only: this card was already graded today.` and leave the schedule unchanged.
4. **Never take a `practice` flag from the client.** If you did, a student could send a practice answer to learn the right key and then resubmit it for a grade. Grading moves the card to tomorrow or later, so every later answer that day is automatically practice.
5. Write one `ReviewLog` row for **every** answer, practice included. Store `chosenDefinition` only when the result is `wrong` (cap it at 2000 characters). Also store the interval and easiness after this answer, and the current `ANSWER_TIME_LIMIT_MS`/`FAST_ANSWER_MS`.
6. Respond with `{ graded, correct, correctKey, definition, quality, reason, lapsed: quality < 4 }`.

## 5. Student frontend (`p2p-voice-chat-client`)

**Review session.** When the student logs in and `GET /cards/due` returns cards, open the review. For each card:
1. Show the word and play its audio. Show the options when the audio ends, fails or is blocked, or after 5 s at most.
2. Start the clock when the options appear. Show a countdown bar that is green until the 5 s fast mark and amber after it. At 12 s, auto-submit `choice: "timeout"`.
3. Show the 4 options plus an "I don't know" button. Show a short hint line: *"Answer within 5 s for top marks; after 12 s it counts as not known."*
4. After answering:
   - turn the correct option (`correctKey`) green and a wrong pick red;
   - play the word again;
   - show the `reason`;
   - wait for a "Next" click, which isn't timed.
5. **If `lapsed`**, add the card to the end of the session queue as a retry. A retry fetches a fresh question from `GET /cards/:id/question`, and keeps coming back until it's answered with grade 4 or more. The server already treats retries as practice.
6. **Make sure a card can only be answered once.** A click can race the timeout. In the Django version, a ref blocks the second submit.

**First click on a new word.** When `add-to-review` returns `created: true`, show a **study card**: the word, its audio and its definition, plus "✓ Added to your review list. You'll be quizzed on it from tomorrow." Don't grade it.

## 6. Admin frontend (`p2p-voice-chat-admin`)

**Where:** in `ListUsers.tsx`, add a **Review Log** button per student that opens a modal. Copy `ReviewLogModal.tsx` from `phuyenenglish.net`.

**Summary line:**
- number of answers, split into graded and practice;
- % correct;
- % fast;
- median time of correct answers.

**Word filter:** a text box that narrows the table to one word.

**Table, newest first:**
- **When**
- **Word** (with its part of speech)
- **Result:** for a wrong answer, add *Picked: "…"* underneath.
- **Time:** green if fast, amber if slower, red if timed out. Under the time, show that row's own limits.
- **Grade**
- **Graded / Practice**
- **Next interval:** "—" for practice rows.

Add a short note explaining the grading, and say when the list is cut off at the limit.

## 7. Checks worth testing

- **Grades:**

  | Answer | Grade |
  |---|---|
  | correct in 2 s | 5 |
  | correct in 8 s | 4 |
  | correct in 13 s | 1 (timeout) |
  | "I don't know" | 2 |
  | wrong | 1 |

- **Sequences:**
  - Always grade 5: easiness 2.6 → 2.9, intervals 1, 6, 16, 45.
  - Grades 2, 4, 0, 4, 4, 4: intervals 1, 6, 1, 6, 8, 11, easiness ending at 1.38.
- **Due date:** an answer at 20:00 Vietnam time with a 1-day interval is due at 00:00 Vietnam time the next day.
- **Answer keys:**
  - A key from one nonce doesn't match under another nonce.
  - Resubmitting the right key after a graded wrong answer gives `graded: false` and leaves the schedule unchanged.
- **Due list:**
  - Contains no `definition` for the student.
  - Skips cards whose definition is empty.
  - Leaves out other senses of the same word as wrong options.
- **Review log:** a student gets 403, an admin gets 200, and a missing `userId` gets 400.
