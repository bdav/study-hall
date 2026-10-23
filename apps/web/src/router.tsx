import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from 'react-router-dom';
import CoursesPage from './pages/CoursesPage';
import NewCoursePage from './pages/NewCoursePage';
import CoursePage from './pages/CoursePage';
import AiUsagePage from './pages/AiUsagePage';
import DeckListPage from './pages/DeckListPage';
import StudyPage from './pages/StudyPage';
import StatsPage from './pages/StatsPage';
import DeckStatsPage from './pages/DeckStatsPage';
import DeckCardsPage from './pages/DeckCardsPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RouteErrorFallback } from './components/RouteErrorFallback';

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: <LoginPage />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/signup',
    element: <SignupPage />,
    errorElement: <RouteErrorFallback />,
  },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorFallback />,
    children: [
      {
        element: <Layout />,
        errorElement: <RouteErrorFallback />,
        children: [
          // `/` is kept free for a later view above both areas
          {
            path: '/',
            element: <Navigate to="/courses" replace />,
          },
          {
            path: '/courses',
            element: <CoursesPage />,
          },
          {
            path: '/courses/new',
            element: <NewCoursePage />,
          },
          {
            path: '/courses/:courseId',
            element: <CoursePage />,
          },
          {
            path: '/ai-usage',
            element: <AiUsagePage />,
          },
          {
            path: '/flashcards',
            element: <DeckListPage />,
          },
          {
            path: '/decks/:deckId',
            element: <StudyPage />,
          },
          {
            path: '/decks/:deckId/cards',
            element: <DeckCardsPage />,
          },
          {
            path: '/decks/:deckId/stats',
            element: <DeckStatsPage />,
          },
          {
            path: '/stats',
            element: <StatsPage />,
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
