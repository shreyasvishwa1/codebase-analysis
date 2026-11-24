"""The System Usability Scale (SUS): its ten statements, the score of one response and the
summary of all responses.

SUS (J. Brooke, 1996) asks ten statements, each answered from 1 (strongly disagree) to
5 (strongly agree); odd statements are positive and even ones negative. A response scores
0-100: each odd answer contributes (answer - 1), each even one (5 - answer), and the sum is
multiplied by 2.5. Scores are graded on Sauro and Lewis's curved grading scale, on which 68
is the average across hundreds of studies (J. Sauro and J. R. Lewis, "Quantifying the User
Experience", 2nd ed., 2016). "System" is replaced by "app" in the statements, a change that
does not affect the scale (Bangor, Kortum and Miller, 2008).
"""

import csv
import io
import statistics
from collections.abc import Sequence
from datetime import datetime
from typing import Any

STATEMENTS: tuple[str, ...] = (
    "I think that I would like to use this app frequently.",
    "I found the app unnecessarily complex.",
    "I thought the app was easy to use.",
    "I think that I would need the support of a technical person to be able to use this app.",
    "I found the various functions in this app were well integrated.",
    "I thought there was too much inconsistency in this app.",
    "I would imagine that most people would learn to use this app very quickly.",
    "I found the app very cumbersome to use.",
    "I felt very confident using the app.",
    "I needed to learn a lot of things before I could get going with this app.",
)
LOWEST_ANSWER = 1  # strongly disagree
HIGHEST_ANSWER = 5  # strongly agree
AVERAGE_SCORE = 68.0

# Sauro and Lewis's curved grading scale: the lowest score of each grade.
GRADES: tuple[tuple[float, str], ...] = (
    (84.1, "A+"),
    (80.8, "A"),
    (78.9, "A-"),
    (77.2, "B+"),
    (74.1, "B"),
    (72.6, "B-"),
    (71.1, "C+"),
    (65.0, "C"),
    (62.7, "C-"),
    (51.7, "D"),
    (0.0, "F"),
)
GRADE_GROUPS = ("A", "B", "C", "D", "F")


def is_positive(number: int) -> bool:
    """Odd statements (1, 3, 5, 7, 9) are positive; agreeing with them is good."""
    return number % 2 == 1


def valid(answers: Sequence[int]) -> bool:
    return len(answers) == len(STATEMENTS) and all(
        isinstance(a, int) and not isinstance(a, bool) and LOWEST_ANSWER <= a <= HIGHEST_ANSWER
        for a in answers
    )


def score(answers: Sequence[int]) -> float:
    """The SUS score (0-100, in steps of 2.5) of one complete response."""
    if not valid(answers):
        raise ValueError("a response has ten answers from 1 to 5")
    total = sum(
        (answer - LOWEST_ANSWER) if is_positive(number) else (HIGHEST_ANSWER - answer)
        for number, answer in enumerate(answers, start=1)
    )
    return total * 2.5


def grade(value: float) -> str:
    """The letter grade of a score (or of a mean score) on the curved grading scale."""
    rounded = round(value, 1)
    return next(label for lowest, label in GRADES if rounded >= lowest)


def summarize(responses: Sequence[Sequence[int]]) -> dict[str, Any]:
    """Counts, the mean score and its grade, the spread, each statement's mean answer and how
    many responses fall in each grade group. Empty fields are None when there are no
    responses (and the standard deviation needs two)."""
    scores = [score(answers) for answers in responses]
    count = len(scores)
    mean = statistics.fmean(scores) if scores else None
    items = [
        {
            "number": number,
            "statement": statement,
            "positive": is_positive(number),
            "mean": round(statistics.fmean(r[number - 1] for r in responses), 2) if responses else None,
        }
        for number, statement in enumerate(STATEMENTS, start=1)
    ]
    groups = {letter: 0 for letter in GRADE_GROUPS}
    for value in scores:
        groups[grade(value)[0]] += 1
    return {
        "responses": count,
        "mean": round(mean, 1) if mean is not None else None,
        "grade": grade(mean) if mean is not None else None,
        "median": round(statistics.median(scores), 1) if scores else None,
        "standard_deviation": round(statistics.stdev(scores), 1) if count >= 2 else None,
        "lowest": min(scores) if scores else None,
        "highest": max(scores) if scores else None,
        "average_benchmark": AVERAGE_SCORE,
        "items": items,
        "grades": groups,
    }


CSV_COLUMNS = ("respondent", *(f"q{n}" for n in range(1, len(STATEMENTS) + 1)), "score", "date")


def responses_csv(responses: Sequence[tuple[datetime, Sequence[int]]]) -> str:
    """The responses as anonymous CSV rows, oldest first: a running respondent number, the ten
    answers, the score and the day (no account, name or time of day)."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for number, (created_at, answers) in enumerate(responses, start=1):
        writer.writerow([number, *answers, f"{score(answers):g}", created_at.date().isoformat()])
    return out.getvalue()
