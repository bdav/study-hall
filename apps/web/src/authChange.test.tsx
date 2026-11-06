import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';
import { routes } from './router';

/**
 * Logging in and out against the real router, providers and query cache,
 * with only the API faked, as what goes wrong here is in what the cache
 * still holds as the pages change.
 */
function fakeApi({ signedIn = true } = {}) {
  const api = { signedIn, courseTitle: 'Greek', refused: [] as string[] };

  function answer(path: string) {
    if (path === 'auth.me') {
      return {
        user: api.signedIn
          ? { id: 'user-1', email: 'me@example.com', canUseAI: false }
          : null,
      };
    }
    if (path === 'auth.login' || path === 'auth.signup') {
      api.signedIn = true;
      return { user: { id: 'user-1', email: 'me@example.com' } };
    }
    if (path === 'auth.logout') {
      api.signedIn = false;
      return { success: true };
    }
    if (path === 'course.list') {
      return [
        {
          id: 'course-1',
          title: api.courseTitle,
          goal: 'Read it',
          syllabusAccepted: true,
          completedLessonCount: 0,
          lessonCount: 3,
        },
      ];
    }
    return [];
  }

  vi.stubGlobal('fetch', async (url: string) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const paths = new URL(url).pathname.replace('/trpc/', '').split(',');
    const results = paths.map((path) => {
      if (!api.signedIn && !path.startsWith('auth.')) {
        api.refused.push(path);
        return {
          error: {
            message: 'Not logged in',
            code: -32001,
            data: { code: 'UNAUTHORIZED', httpStatus: 401, path },
          },
        };
      }
      return { result: { data: answer(path) } };
    });
    return new Response(JSON.stringify(results), {
      status: 207,
      headers: { 'content-type': 'application/json' },
    });
  });

  return api;
}

/** Opens the app, and records all it shows, however briefly. */
function openApp() {
  const shown = new Set<string>();
  const observer = new MutationObserver(() => {
    shown.add(document.body.textContent ?? '');
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  render(
    <AppProviders>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: ['/courses'] })}
      />
    </AppProviders>,
  );
  return {
    everShown: (text: string) => [...shown].some((t) => t.includes(text)),
    forgetShown: () => shown.clear(),
  };
}

/** A refused query's failure settles when its retry would come, at 1s. */
function failuresToSettle() {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 1100)));
}

async function logIn() {
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'me@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
}

async function logOut() {
  fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
  await screen.findByRole('heading', { name: 'Log In' });
}

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
});

describe('logging in and out', () => {
  it('asks for nothing it would be refused while logging out', async () => {
    const api = fakeApi();
    openApp();

    await screen.findByText('Greek');
    await logOut();
    await failuresToSettle();

    expect(api.refused).toEqual([]);
  });

  it('shows no failure from before logging back in', async () => {
    fakeApi();
    const app = openApp();

    await screen.findByText('Greek');
    await logOut();
    await failuresToSettle();
    await logIn();
    await screen.findByText('Greek');

    expect(app.everShown('Error loading')).toBe(false);
  });

  it('shows no failure from a session that ended on its own', async () => {
    const api = fakeApi();
    const app = openApp();

    await screen.findByText('Greek');
    api.signedIn = false;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await screen.findByRole('heading', { name: 'Log In' });
    await failuresToSettle();
    await logIn();
    await screen.findByText('Greek');

    expect(app.everShown('Error loading')).toBe(false);
  });

  it("never shows one account's courses to the next", async () => {
    const api = fakeApi();
    const app = openApp();

    await screen.findByText('Greek');
    await logOut();
    api.courseTitle = 'Welsh';
    app.forgetShown();
    await logIn();
    await screen.findByText('Welsh');

    expect(app.everShown('Greek')).toBe(false);
  });
});
