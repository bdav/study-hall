import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../apps/api/src/auth/password.js';

type AttemptInput = Prisma.CardAttemptCreateManyInput;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SEED_DECK_IDS = [
  'seed-deck-world-capitals',
  'seed-deck-basic-math',
  'seed-deck-spanish-vocab',
  'seed-deck-programming',
];

interface CardInput {
  front: string;
  answers: string[]; // first is primary
}

async function createDeckWithCards(
  deckId: string,
  userId: string,
  name: string,
  description: string,
  cards: CardInput[],
) {
  const deck = await prisma.deck.create({
    data: {
      id: deckId,
      name,
      description,
      userId,
    },
  });

  const createdCards = [];
  for (let i = 0; i < cards.length; i++) {
    const { front, answers } = cards[i];
    const card = await prisma.card.create({
      data: {
        deckId: deck.id,
        front,
        position: i,
        canonicalAnswers: {
          create: answers.map((text, j) => ({
            text,
            normalizedText: text.toLowerCase().trim(),
            isPrimary: j === 0,
          })),
        },
      },
      include: { canonicalAnswers: true },
    });

    // Eagerly create CardProgress for the deck owner
    await prisma.cardProgress.create({
      data: {
        userId,
        cardId: card.id,
        deckId: deck.id,
      },
    });

    createdCards.push(card);
  }

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
      { front: 'What is the capital of France?', answers: ['Paris'] },
      { front: 'What is the capital of Japan?', answers: ['Tokyo'] },
      { front: 'What is the capital of Brazil?', answers: ['Brasília', 'Brasilia'] },
      { front: 'What is the capital of Australia?', answers: ['Canberra'] },
      { front: 'What is the capital of Canada?', answers: ['Ottawa'] },
      { front: 'What is the capital of Egypt?', answers: ['Cairo'] },
      { front: 'What is the capital of South Korea?', answers: ['Seoul'] },
      { front: 'What is the capital of Argentina?', answers: ['Buenos Aires'] },
      {
        front: 'What is the capital of South Africa (executive)?',
        answers: ['Pretoria'],
      },
      { front: 'What is the capital of Thailand?', answers: ['Bangkok'] },
    ],
  );

  // --- Deck 2: Basic Math (multi-answer example) ---
  const math = await createDeckWithCards(
    'seed-deck-basic-math',
    user.id,
    'Basic Math',
    'Arithmetic and simple math facts',
    [
      { front: '7 × 8', answers: ['56'] },
      { front: '144 ÷ 12', answers: ['12'] },
      { front: '√81', answers: ['9'] },
      { front: '15² (15 squared)', answers: ['225'] },
      { front: '2⁸ (2 to the 8th power)', answers: ['256'] },
      { front: 'What is 17 + 38?', answers: ['55'] },
      { front: 'What is 1000 - 387?', answers: ['613'] },
    ],
  );

  // --- Deck 3: Spanish Vocabulary ---
  const spanish = await createDeckWithCards(
    'seed-deck-spanish-vocab',
    user.id,
    'Spanish Vocabulary',
    'Common Spanish words and phrases',
    [
      { front: 'Hello', answers: ['Hola'] },
      { front: 'Thank you', answers: ['Gracias'] },
      { front: 'Goodbye', answers: ['Adiós', 'Adios'] },
      { front: 'Please', answers: ['Por favor'] },
      { front: 'How are you?', answers: ['¿Cómo estás?', 'Como estas'] },
      { front: 'Good morning', answers: ['Buenos días', 'Buenos dias'] },
      { front: "I don't understand", answers: ['No entiendo'] },
      {
        front: 'Where is the bathroom?',
        answers: ['¿Dónde está el baño?', 'Donde esta el bano'],
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
        answers: ['HyperText Transfer Protocol'],
      },
      {
        front: 'What is the time complexity of binary search?',
        answers: ['O(log n)'],
      },
      {
        front: 'What does SQL stand for?',
        answers: ['Structured Query Language'],
      },
      {
        front: 'What is a closure?',
        answers: ['A function that captures variables from its enclosing scope'],
      },
      {
        front: 'What does REST stand for?',
        answers: ['Representational State Transfer'],
      },
    ],
  );

  // --- Sample Study Sessions ---

  // Session 1: World Capitals — completed, mixed grades
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

  const capitalsAttempts: AttemptInput[] = capitals.cards.flatMap((card, i): AttemptInput[] => {
    const primaryAnswer = card.canonicalAnswers.find((a) => a.isPrimary)!;
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
          recallGrade: 'GOOD' as const,
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
        recallGrade: i < 5 ? ('NAILED' as const) : ('GOOD' as const),
        attemptNumber: 1,
      },
    ];
  });

  await prisma.cardAttempt.createMany({ data: capitalsAttempts });
  console.log('Seeded study session 1: World Capitals (completed, mixed grades)');

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
      userAnswer: card.canonicalAnswers.find((a) => a.isPrimary)!.text,
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

  const spanishAttempts: AttemptInput[] = spanish.cards.flatMap((card, i): AttemptInput[] => {
    const primaryAnswer = card.canonicalAnswers.find((a) => a.isPrimary)!;
    if (i < 4) {
      return [
        {
          studySessionId: session3.id,
          cardId: card.id,
          userAnswer: primaryAnswer.text,
          recallGrade: 'GOOD' as const,
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
          recallGrade: 'PARTIALLY_CORRECT' as const,
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
        recallGrade: 'GOOD' as const,
        attemptNumber: 2,
        isRetry: true,
      },
    ];
  });

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
