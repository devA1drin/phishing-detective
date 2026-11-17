// System Usability Scale (Brooke, 1996): standard 10 items, 1 = Strongly disagree … 5 = Strongly agree.
// Wording uses "system" as in the original instrument.
export const SUS_ITEMS = [
  'I think that I would like to use this system frequently.',
  'I found the system unnecessarily complex.',
  'I thought the system was easy to use.',
  'I think that I would need the support of a technical person to be able to use this system.',
  'I found the various functions in this system were well integrated.',
  'I thought there was too much inconsistency in this system.',
  'I would imagine that most people would learn to use this system very quickly.',
  'I found the system very cumbersome to use.',
  'I felt very confident using the system.',
  'I needed to learn a lot of things before I could get going with this system.',
];

/** SUS score 0-100: odd items (score − 1), even items (5 − score), sum × 2.5. */
export function susScore(answers) {
  if (!Array.isArray(answers) || answers.length !== 10 || answers.some((a) => ![1, 2, 3, 4, 5].includes(a))) return null;
  const sum = answers.reduce((acc, a, i) => acc + (i % 2 === 0 ? a - 1 : 5 - a), 0);
  return sum * 2.5;
}

/** Adjective rating (Bangor, Kortum & Miller, 2009) and acceptability. */
export function susGrade(score) {
  if (score == null) return null;
  const adjective = score >= 85.6 ? 'Excellent' : score >= 72.6 ? 'Good' : score >= 52 ? 'OK' : score >= 39.2 ? 'Poor' : 'Awful';
  const acceptability = score >= 70 ? 'Acceptable' : score >= 50 ? 'Marginal' : 'Not acceptable';
  return { adjective, acceptability };
}

// ISO/IEC 25010 product quality model: the eight main characteristics,
// worded for student evaluators. Likert 1-5 (Strongly disagree … Strongly agree).
export const ISO_ITEMS = [
  { id: 'fs1', characteristic: 'Functional Suitability', text: 'The game provides all the functions I need to practice spotting phishing (cases, clues, feedback, quizzes).' },
  { id: 'fs2', characteristic: 'Functional Suitability', text: 'The results, scores and feedback shown by the game are correct.' },
  { id: 'pe1', characteristic: 'Performance Efficiency', text: 'Pages and cases load quickly.' },
  { id: 'pe2', characteristic: 'Performance Efficiency', text: 'The game responds immediately when I answer or click clues.' },
  { id: 'co1', characteristic: 'Compatibility', text: 'The game works well on my device and browser (phone, tablet or computer).' },
  { id: 'co2', characteristic: 'Compatibility', text: 'The game works alongside other apps and tabs without problems.' },
  { id: 'us1', characteristic: 'Usability', text: 'The game is easy to learn and use.' },
  { id: 'us2', characteristic: 'Usability', text: 'The design is attractive, readable and clear.' },
  { id: 're1', characteristic: 'Reliability', text: 'The game ran without errors or crashes.' },
  { id: 're2', characteristic: 'Reliability', text: 'My progress and scores were saved correctly.' },
  { id: 'se1', characteristic: 'Security', text: 'I feel my account and answers are protected (PIN, no real personal data).' },
  { id: 'se2', characteristic: 'Security', text: 'The game asked for my consent and explained how my data is used.' },
  { id: 'ma1', characteristic: 'Maintainability', text: 'New cases and updates appear without disrupting my use of the game.' },
  { id: 'ma2', characteristic: 'Maintainability', text: 'Problems, if any, seem easy for the developers to identify and fix.' },
  { id: 'po1', characteristic: 'Portability', text: 'I can use the game on different devices without installing anything.' },
  { id: 'po2', characteristic: 'Portability', text: 'The layout adapts well to different screen sizes.' },
];

/** Common Likert interpretation scale used in PH theses (4-point intervals of 0.8). */
export function likertLabel(mean) {
  if (mean == null) return null;
  if (mean >= 4.21) return 'Strongly Agree (Excellent)';
  if (mean >= 3.41) return 'Agree (Very Good)';
  if (mean >= 2.61) return 'Neutral (Good)';
  if (mean >= 1.81) return 'Disagree (Fair)';
  return 'Strongly Disagree (Poor)';
}
