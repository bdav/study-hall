import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DeckHeader } from './DeckHeader';
import { cameFromCourse } from '@/lib/decks';

function renderDeckHeader(
  deckName: string,
  deckId: string,
  activeTab: 'study' | 'stats',
) {
  return render(
    <MemoryRouter>
      <DeckHeader deckName={deckName} deckId={deckId} activeTab={activeTab} />
    </MemoryRouter>,
  );
}

describe('DeckHeader', () => {
  it('renders the deck name as a heading', () => {
    renderDeckHeader('World Capitals', 'deck-1', 'study');

    expect(
      screen.getByRole('heading', { name: /world capitals/i }),
    ).toBeInTheDocument();
  });

  it('renders Study and Stats tabs', () => {
    renderDeckHeader('World Capitals', 'deck-1', 'study');

    expect(screen.getByRole('tab', { name: /study/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /stats/i })).toBeInTheDocument();
  });

  it('passes activeTab to DeckTabs', () => {
    renderDeckHeader('World Capitals', 'deck-1', 'stats');

    expect(screen.getByRole('tab', { name: /stats/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /study/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  const italianCourse = { id: 'course-1', title: 'Italian' };

  /** The deck's pages, reached from `state`, each showing its header. */
  function renderDeckPages(state: unknown) {
    const page = (activeTab: 'study' | 'cards' | 'stats') => (
      <DeckHeader
        deckName="Italian"
        deckId="deck-1"
        activeTab={activeTab}
        course={italianCourse}
      />
    );
    return render(
      <MemoryRouter initialEntries={[{ pathname: '/decks/deck-1', state }]}>
        <Routes>
          <Route path="/decks/:deckId" element={page('study')} />
          <Route path="/decks/:deckId/cards" element={page('cards')} />
          <Route path="/decks/:deckId/stats" element={page('stats')} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('links a Course Deck back to its course when its course page led there', () => {
    renderDeckPages(cameFromCourse('course-1'));

    expect(screen.getByRole('link', { name: /^italian$/i })).toHaveAttribute(
      'href',
      '/courses/course-1',
    );
  });

  it('links a Course Deck back to Flashcards when anywhere else led there', () => {
    renderDeckPages(null);

    expect(screen.getByRole('link', { name: /^flashcards$/i })).toHaveAttribute(
      'href',
      '/flashcards',
    );
    expect(
      screen.queryByRole('link', { name: /^italian$/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps where the deck was reached from across the deck's tabs", async () => {
    const user = userEvent.setup();
    renderDeckPages(cameFromCourse('course-1'));

    await user.click(screen.getByRole('tab', { name: /cards/i }));
    await user.click(screen.getByRole('tab', { name: /stats/i }));

    expect(screen.getByRole('tab', { name: /stats/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('link', { name: /^italian$/i })).toHaveAttribute(
      'href',
      '/courses/course-1',
    );
  });

  it('links back to Flashcards, naming an archived course without linking to it', () => {
    render(
      <MemoryRouter>
        <DeckHeader
          deckName="Italian"
          deckId="deck-1"
          activeTab="study"
          course={{
            id: 'course-1',
            title: 'Italian',
            archivedAt: '2026-10-29T00:00:00Z',
          }}
        />
      </MemoryRouter>,
    );

    // Back to Flashcards, where the deck is; the archived course is named
    expect(screen.getByRole('link', { name: /^flashcards$/i })).toHaveAttribute(
      'href',
      '/flashcards',
    );
    expect(
      screen.queryByRole('link', { name: /italian/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('From the archived course Italian'),
    ).toBeInTheDocument();
  });

  it('links a standalone deck back to Flashcards', () => {
    renderDeckHeader('World Capitals', 'deck-1', 'study');

    expect(screen.getByRole('link', { name: /^flashcards$/i })).toHaveAttribute(
      'href',
      '/flashcards',
    );
  });

  it('takes a title in place of the deck name, such as an editable one', () => {
    render(
      <MemoryRouter>
        <DeckHeader
          deckName="World Capitals"
          deckId="deck-1"
          activeTab="cards"
          title={<h1>Edit World Capitals</h1>}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: 'Edit World Capitals' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /cards/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
