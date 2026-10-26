import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../apps/api/src/auth/password.js';
import { createCards, type NewCard } from '../apps/api/src/services/cards.js';

type AttemptInput = Prisma.CardAttemptCreateManyInput;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SEED_DECK_IDS = [
  'seed-deck-world-capitals',
  'seed-deck-basic-math',
  'seed-deck-spanish-vocab',
  'seed-deck-programming',
];

async function createDeckWithCards(
  deckId: string,
  userId: string,
  name: string,
  description: string,
  cards: NewCard[],
) {
  const deck = await prisma.deck.create({
    data: { id: deckId, name, description, userId },
  });
  const createdCards = await createCards(prisma, {
    deckId: deck.id,
    userId,
    cards,
  });

  console.log(`Seeded deck: ${name} with ${createdCards.length} cards`);
  return { deck, cards: createdCards };
}

async function main() {
  const passwordHash = await hashPassword('password');

  // Create or find the default dev user
  const user = await prisma.user.upsert({
    where: { id: 'seed-user-dev' },
    update: { passwordHash },
    create: {
      id: 'seed-user-dev',
      email: 'dev@example.com',
      passwordHash,
    },
  });

  console.log(`Seeded user: ${user.email} (${user.id}) — password: "password"`);

  // Clean up only known seed decks for idempotent re-runs
  await prisma.deck.deleteMany({
    where: { id: { in: SEED_DECK_IDS } },
  });

  // --- Deck 1: World Capitals ---
  const capitals = await createDeckWithCards(
    'seed-deck-world-capitals',
    user.id,
    'World Capitals',
    'Test your knowledge of world capitals',
    [
      { front: 'What is the capital of France?', canonicalAnswers: ['Paris'] },
      { front: 'What is the capital of Japan?', canonicalAnswers: ['Tokyo'] },
      {
        front: 'What is the capital of Brazil?',
        canonicalAnswers: ['Brasília'],
      },
      {
        front: 'What is the capital of Australia?',
        canonicalAnswers: ['Canberra'],
      },
      { front: 'What is the capital of Canada?', canonicalAnswers: ['Ottawa'] },
      { front: 'What is the capital of Egypt?', canonicalAnswers: ['Cairo'] },
      {
        front: 'What is the capital of South Korea?',
        canonicalAnswers: ['Seoul'],
      },
      {
        front: 'What is the capital of Argentina?',
        canonicalAnswers: ['Buenos Aires'],
      },
      {
        front: 'What is the capital of South Africa (executive)?',
        canonicalAnswers: ['Pretoria'],
      },
      {
        front: 'What is the capital of Thailand?',
        canonicalAnswers: ['Bangkok'],
      },
    ],
  );

  // --- Deck 2: Basic Math ---
  const math = await createDeckWithCards(
    'seed-deck-basic-math',
    user.id,
    'Basic Math',
    'Arithmetic and simple math facts',
    [
      { front: '7 × 8', canonicalAnswers: ['56'] },
      { front: '144 ÷ 12', canonicalAnswers: ['12'] },
      { front: '√81', canonicalAnswers: ['9'] },
      { front: '15² (15 squared)', canonicalAnswers: ['225'] },
      { front: '2⁸ (2 to the 8th power)', canonicalAnswers: ['256'] },
      { front: 'What is 17 + 38?', canonicalAnswers: ['55'] },
      { front: 'What is 1000 - 387?', canonicalAnswers: ['613'] },
    ],
  );

  // --- Deck 3: Spanish Vocabulary ---
  const spanish = await createDeckWithCards(
    'seed-deck-spanish-vocab',
    user.id,
    'Spanish Vocabulary',
    'Common Spanish words and phrases',
    [
      { front: 'Hello', canonicalAnswers: ['Hola'] },
      { front: 'Thank you', canonicalAnswers: ['Gracias'] },
      { front: 'Goodbye', canonicalAnswers: ['Adiós'] },
      { front: 'Please', canonicalAnswers: ['Por favor'] },
      { front: 'How are you?', canonicalAnswers: ['¿Cómo estás?'] },
      { front: 'Good morning', canonicalAnswers: ['Buenos días'] },
      { front: "I don't understand", canonicalAnswers: ['No entiendo'] },
      {
        front: 'Where is the bathroom?',
        canonicalAnswers: ['¿Dónde está el baño?'],
      },
    ],
  );

  // --- Deck 4: Programming Concepts (no study sessions) ---
  await createDeckWithCards(
    'seed-deck-programming',
    user.id,
    'Programming Concepts',
    'CS fundamentals and programming terminology',
    [
      {
        front: 'What does HTTP stand for?',
        canonicalAnswers: ['HyperText Transfer Protocol'],
      },
      {
        front: 'What is the time complexity of binary search?',
        canonicalAnswers: ['O(log n)'],
      },
      {
        front: 'What does SQL stand for?',
        canonicalAnswers: ['Structured Query Language'],
      },
      {
        front: 'What is a closure?',
        canonicalAnswers: [
          'A function that captures variables from its enclosing scope',
        ],
      },
      {
        front: 'What does REST stand for?',
        canonicalAnswers: ['Representational State Transfer'],
      },
    ],
  );

  // --- Sample Study Sessions ---

  // Session 1: World Capitals — completed, two cards missed first
  const session1 = await prisma.studySession.create({
    data: {
      userId: user.id,
      deckId: capitals.deck.id,
      status: 'COMPLETED',
      sessionType: 'STANDARD',
      studyMode: 'STUDY',
      endedAt: new Date(),
    },
  });

  const capitalsAttempts: AttemptInput[] = capitals.cards.flatMap(
    (card, i): AttemptInput[] => {
      const primaryAnswer = card.canonicalAnswers[0];
      const isMissed = i === 2 || i === 7; // Brasília and Buenos Aires missed first
      if (isMissed) {
        return [
          {
            studySessionId: session1.id,
            cardId: card.id,
            userAnswer: 'wrong answer',
            recallGrade: 'MISSED' as const,
            attemptNumber: 1,
          },
          {
            studySessionId: session1.id,
            cardId: card.id,
            userAnswer: primaryAnswer.text,
            recallGrade: 'NAILED' as const,
            attemptNumber: 2,
            isRetry: true,
          },
        ];
      }
      return [
        {
          studySessionId: session1.id,
          cardId: card.id,
          userAnswer: primaryAnswer.text,
          recallGrade: 'NAILED' as const,
          attemptNumber: 1,
        },
      ];
    },
  );

  await prisma.cardAttempt.createMany({ data: capitalsAttempts });
  console.log(
    'Seeded study session 1: World Capitals (completed, two cards missed first)',
  );

  // Session 2: Basic Math — all nailed
  const session2 = await prisma.studySession.create({
    data: {
      userId: user.id,
      deckId: math.deck.id,
      status: 'COMPLETED',
      sessionType: 'QUICK',
      studyMode: 'STUDY',
      endedAt: new Date(),
    },
  });

  await prisma.cardAttempt.createMany({
    data: math.cards.map((card) => ({
      studySessionId: session2.id,
      cardId: card.id,
      userAnswer: card.canonicalAnswers[0].text,
      recallGrade: 'NAILED' as const,
      attemptNumber: 1,
    })),
  });

  console.log('Seeded study session 2: Basic Math (completed, all nailed)');

  // Session 3: Spanish Vocabulary — several misses
  const session3 = await prisma.studySession.create({
    data: {
      userId: user.id,
      deckId: spanish.deck.id,
      status: 'COMPLETED',
      sessionType: 'STANDARD',
      studyMode: 'STUDY',
      endedAt: new Date(),
    },
  });

  const spanishAttempts: AttemptInput[] = spanish.cards.flatMap(
    (card, i): AttemptInput[] => {
      const primaryAnswer = card.canonicalAnswers[0];
      if (i < 4) {
        return [
          {
            studySessionId: session3.id,
            cardId: card.id,
            userAnswer: primaryAnswer.text,
            recallGrade: 'NAILED' as const,
            attemptNumber: 1,
          },
        ];
      }
      if (i === 7) {
        // Card 7 takes 3 attempts
        return [
          {
            studySessionId: session3.id,
            cardId: card.id,
            userAnswer: 'wrong',
            recallGrade: 'MISSED' as const,
            attemptNumber: 1,
          },
          {
            studySessionId: session3.id,
            cardId: card.id,
            userAnswer: 'still wrong',
            recallGrade: 'MISSED' as const,
            attemptNumber: 2,
            isRetry: true,
          },
          {
            studySessionId: session3.id,
            cardId: card.id,
            userAnswer: primaryAnswer.text,
            recallGrade: 'NAILED' as const,
            attemptNumber: 3,
            isRetry: true,
          },
        ];
      }
      return [
        {
          studySessionId: session3.id,
          cardId: card.id,
          userAnswer: 'wrong',
          recallGrade: 'MISSED' as const,
          attemptNumber: 1,
        },
        {
          studySessionId: session3.id,
          cardId: card.id,
          userAnswer: primaryAnswer.text,
          recallGrade: 'NAILED' as const,
          attemptNumber: 2,
          isRetry: true,
        },
      ];
    },
  );

  await prisma.cardAttempt.createMany({ data: spanishAttempts });
  console.log(
    'Seeded study session 3: Spanish Vocabulary (completed, several misses)',
  );

  console.log('\nSeed complete! Log in with: dev@example.com / password');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
