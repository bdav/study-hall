import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DeckHeader } from './DeckHeader';

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

  it('links a Course Deck back to its course', () => {
    render(
      <MemoryRouter>
        <DeckHeader
          deckName="Italian"
          deckId="deck-1"
          activeTab="study"
          course={{ id: 'course-1', title: 'Italian' }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /^italian$/i })).toHaveAttribute(
      'href',
      '/courses/course-1',
    );
  });

  it('names an archived course without linking to it', () => {
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

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getByText('From the archived course Italian'),
    ).toBeInTheDocument();
  });

  it('has no back link on a standalone deck', () => {
    renderDeckHeader('World Capitals', 'deck-1', 'study');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
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
