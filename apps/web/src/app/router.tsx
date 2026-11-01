import { createBrowserRouter, Navigate } from 'react-router';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { FoodsPage } from '@/features/foods/FoodsPage';
import { InsightsPage } from '@/features/insights/InsightsPage';
import { MorePage } from '@/features/settings/MorePage';
import { TodayPage } from '@/features/today/TodayPage';
import { WeightPage } from '@/features/weight/WeightPage';
import { AppShell } from './layout/AppShell';
import { NotFoundPage } from './NotFoundPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/today" replace /> },
          { path: 'today', element: <TodayPage /> },
          { path: 'foods', element: <FoodsPage /> },
          { path: 'insights', element: <InsightsPage /> },
          { path: 'weight', element: <WeightPage /> },
          { path: 'more', element: <MorePage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
