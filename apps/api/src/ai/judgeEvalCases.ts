import { type ExerciseEvaluation } from '@prisma/client';
import { type EvaluatedExercise } from './exerciseEvaluation.js';

/**
 * One answer the judge should evaluate a known way. A borderline case can
 * accept more than one evaluation.
 */
export type JudgeCase = {
  name: string;
  exercise: EvaluatedExercise;
  answer: string;
  expected: ExerciseEvaluation[];
};

function explanation(
  prompt: string,
  essentialPoints: string[],
  supplementaryPoints: string[] = [],
): EvaluatedExercise {
  return {
    type: 'FREE_FORM_EXPLANATION',
    prompt,
    expectedAnswers: [],
    essentialPoints,
    supplementaryPoints,
    expectedPoints: [],
  };
}

/** An explanation generated before essential points (ADR-0006). */
function olderExplanation(
  prompt: string,
  expectedPoints: string[],
): EvaluatedExercise {
  return {
    type: 'FREE_FORM_EXPLANATION',
    prompt,
    expectedAnswers: [],
    essentialPoints: [],
    supplementaryPoints: [],
    expectedPoints,
  };
}

function openShortAnswer(
  prompt: string,
  expectedAnswers: string[],
): EvaluatedExercise {
  return {
    type: 'SHORT_ANSWER',
    prompt,
    expectedAnswers,
    essentialPoints: [],
    supplementaryPoints: [],
    expectedPoints: [],
  };
}

const AGREEMENT_PROMPT =
  "Explain why we say 'Le ho viste' (about le amiche) but 'Le ho scritto' (to Anna). What is the rule for participle agreement with pronouns in the passato prossimo?";

const agreement = explanation(
  AGREEMENT_PROMPT,
  [
    'With avere, the past participle agrees in gender and number with a direct object pronoun lo, la, li or le placed before the verb, so le (le amiche) gives viste',
    'An indirect object pronoun never causes agreement, so le meaning "to her" (a Anna) leaves scritto unchanged',
  ],
  [
    'Ne before the verb can also cause agreement with the quantity it stands for',
    'With mi, ti, ci and vi as direct objects, agreement is optional',
    "With an elided pronoun (l'ho vista), the participle's ending shows the gender the pronoun no longer does",
  ],
);

const HASH_PROMPT =
  'Why might you store users in a hash map keyed by ID rather than a sorted array, and what do you give up?';

const hashMap = explanation(
  HASH_PROMPT,
  [
    'A hash map finds a key in constant time on average, where a sorted array needs a binary search in logarithmic time',
    "A hash map keeps no order among its keys, so it can't list keys in order or answer range queries efficiently",
  ],
  [
    'Many keys colliding can slow hash map lookups towards linear time',
    'A hash map usually uses more memory than an array',
  ],
);

const WAR_PROMPT =
  'Why did the assassination of Archduke Franz Ferdinand in 1914 lead to a general European war rather than a local conflict between Austria-Hungary and Serbia?';

const war = explanation(
  WAR_PROMPT,
  [
    'Alliances and commitments drew in the other great powers: Russia backed Serbia, Germany backed Austria-Hungary, and France and then Britain went to war against Germany',
  ],
  [
    "Germany's war plan meant war with Russia also meant attacking France, through Belgium, which brought Britain in",
    "Austria-Hungary's ultimatum to Serbia was designed to be rejected",
  ],
);

export const JUDGE_CASES: JudgeCase[] = [
  // The two answers that prompted ADR-0006, on their original answer keys
  {
    name: 'Italian agreement, older answer key: complete answer without the extras',
    exercise: olderExplanation(AGREEMENT_PROMPT, [
      "In 'Le ho viste' le is a direct object pronoun (le amiche) placed before the verb, so the participle agrees in gender and number (viste)",
      "In 'Le ho scritto' le is an indirect pronoun (a Anna), and indirect pronouns never trigger agreement, so the participle stays scritto",
      'Agreement happens only when the direct pronoun lo/la/li/le (or ne with a quantity) comes before the verb',
      "Elision (l'ho vista) hides the gender, and the participle shows it",
    ]),
    answer:
      "In the passato prossimo with avere, the past participle agrees with a preceding direct object pronoun (lo, la, li, le), but not with an indirect object pronoun. In Le ho viste, le means 'them' (direct), while in Le ho scritto, le means 'to her' (indirect).",
    expected: ['CORRECT'],
  },
  {
    name: 'Italian combined pronouns, older answer key: complete answer without the extras',
    exercise: olderExplanation(
      "Explain how combined pronouns work in Italian, using 'glielo dico' and 'me lo dai' as examples. How does it compare with Spanish?",
      [
        'The indirect pronoun comes first, then the direct pronoun, then the verb, as in Spanish',
        'Mi, ti, ci, vi change to me, te, ce, ve before lo, la, li, le, ne',
        'Gli (to him/them) and le (to her) both become glie- and join the direct pronoun in one word: glielo, gliela, glieli, gliele, gliene',
        'The form glielo does not show whether it means him, her or them, so context decides, whereas Spanish uses se lo',
        "With infinitives the pair attaches to the end (dirtelo, dargliela), and before ho/ha the pronoun elides (gliel'ho)",
      ],
    ),
    answer:
      "In Italian, combined pronouns place the indirect object before the direct object: glielo dico = 'I tell it to him/her' (gli/le + lo), and me lo dai = 'You give it to me' (mi + lo). Spanish works similarly (se lo digo, me lo das), but Italian combines gli/le into glie- instead of changing them to se, and changes mi to me before another pronoun.",
    expected: ['CORRECT'],
  },

  // Essential and supplementary points
  {
    name: 'Italian agreement: complete answer without supplementary points',
    exercise: agreement,
    answer:
      "In the passato prossimo with avere, the past participle agrees with a preceding direct object pronoun (lo, la, li, le), but not with an indirect object pronoun. In Le ho viste, le means 'them' (direct), while in Le ho scritto, le means 'to her' (indirect).",
    expected: ['CORRECT'],
  },
  {
    name: 'Italian agreement: same ideas in plain words, no grammar terms',
    exercise: agreement,
    answer:
      "When 'le' stands for the people you saw and comes before 'ho', the participle copies their gender and number, so it's viste for the female friends. In 'Le ho scritto', 'le' means 'to her', the person receiving the writing, so there's nothing for the participle to match and it stays scritto.",
    expected: ['CORRECT'],
  },
  {
    name: 'Italian agreement: explains only the direct case',
    exercise: agreement,
    answer:
      'Viste agrees because le is a direct object pronoun before the verb, standing for le amiche, so the participle takes their feminine plural ending.',
    expected: ['PARTIALLY_CORRECT'],
  },
  {
    name: 'Italian agreement: wrong reasoning throughout',
    exercise: agreement,
    answer:
      "Viste ends in -e because vedere is an irregular verb, and scritto doesn't change because scrivere is regular.",
    expected: ['INCORRECT'],
  },
  {
    name: 'Italian agreement: right rule plus a false claim',
    exercise: agreement,
    answer:
      "The participle agrees with a direct object pronoun before the verb, so le ho viste, but not with an indirect one, so le ho scritto. The same agreement happens with essere verbs only when there's a pronoun.",
    expected: ['PARTIALLY_CORRECT'],
  },

  // Another subject: programming
  {
    name: 'Hash map: both trade-offs, nothing more',
    exercise: hashMap,
    answer:
      'A hash map finds a user by ID in O(1) on average, while a sorted array needs binary search, O(log n). But the hash map has no order, so listing users by ID or finding a range of IDs is hard.',
    expected: ['CORRECT'],
  },
  {
    name: 'Hash map: only the speed',
    exercise: hashMap,
    answer:
      'Lookups are O(1) on average with a hash map instead of O(log n) with binary search on the array.',
    expected: ['PARTIALLY_CORRECT'],
  },
  {
    name: 'Hash map: misconception',
    exercise: hashMap,
    answer:
      "A hash map is better because it keeps its keys sorted automatically, so you don't give anything up.",
    expected: ['INCORRECT'],
  },

  // Another subject: history
  {
    name: 'First World War: alliances, without the war plans',
    exercise: war,
    answer:
      "Europe's great powers were tied together by alliances. When Austria-Hungary went to war with Serbia, Russia mobilised to protect Serbia, Germany stood by Austria-Hungary, and France and Britain were drawn in against Germany.",
    expected: ['CORRECT'],
  },
  {
    name: 'First World War: factual error',
    exercise: war,
    answer:
      'Because Franz Ferdinand was the German emperor, Germany declared war on Serbia straight away.',
    expected: ['INCORRECT'],
  },

  // An older answer key must not make the judge lenient either
  {
    name: 'Italian agreement, older answer key: explains only the direct case',
    exercise: olderExplanation(AGREEMENT_PROMPT, [
      "In 'Le ho viste' le is a direct object pronoun (le amiche) placed before the verb, so the participle agrees in gender and number (viste)",
      "In 'Le ho scritto' le is an indirect pronoun (a Anna), and indirect pronouns never trigger agreement, so the participle stays scritto",
      'Agreement happens only when the direct pronoun lo/la/li/le (or ne with a quantity) comes before the verb',
      "Elision (l'ho vista) hides the gender, and the participle shows it",
    ]),
    answer:
      'Viste agrees because le is a direct object pronoun before the verb, standing for le amiche, so the participle takes their feminine plural ending.',
    expected: ['PARTIALLY_CORRECT'],
  },

  // How points can be shown, and what never counts
  {
    name: 'Hash map: both points shown only through examples',
    exercise: hashMap,
    answer:
      'If I look up user 48213, the hash map jumps straight to it, while the array has to keep halving the range until it finds it. But if I want every user with an ID between 1000 and 2000 in order, the array just gives me that slice, and the hash map has to check every entry.',
    expected: ['CORRECT'],
  },
  {
    name: 'Hash map: only supplementary points',
    exercise: hashMap,
    answer:
      'Hash maps can slow down a lot when many keys collide, and they use more memory than an array.',
    expected: ['INCORRECT'],
  },
  {
    name: 'First World War: alliances plus a correct extra the rubric leaves out',
    exercise: war,
    answer:
      'Alliances turned a local war into a European one: Russia backed Serbia, Germany backed Austria-Hungary, and France and Britain ended up fighting Germany. Years of nationalism and an arms race had already raised tensions.',
    expected: ['CORRECT'],
  },

  // Open short answers stay correct or incorrect
  {
    name: 'Translation: valid alternative word order',
    exercise: openShortAnswer("Translate: I haven't seen him yet", [
      "Non l'ho ancora visto",
    ]),
    answer: "Non l'ho visto ancora",
    expected: ['CORRECT'],
  },
  {
    name: 'Translation: wrong tense',
    exercise: openShortAnswer("Translate: I haven't seen him yet", [
      "Non l'ho ancora visto",
    ]),
    answer: 'Non lo vedo ancora',
    expected: ['INCORRECT'],
  },
];
