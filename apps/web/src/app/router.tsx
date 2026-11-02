import { createBrowserRouter, Navigate } from 'react-router';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { lazyNamed } from './lazy';
import { AppShell } from './layout/AppShell';
import { RootLayout } from './layout/RootLayout';
import { NotFoundPage } from './NotFoundPage';

// Every page is its own chunk (NFR: eager payload < 250 kB gzip, checked by tools/check-bundle.mjs).
// The guard, the shell and the 404 page stay in the entry chunk because they render first.
const LoginPage = lazyNamed(() => import('@/features/auth/LoginPage'), 'LoginPage');
const TodayPage = lazyNamed(() => import('@/features/today/TodayPage'), 'TodayPage');
const TodayRedirect = lazyNamed(() => import('@/features/today/TodayPage'), 'TodayRedirect');
const FoodsPage = lazyNamed(() => import('@/features/foods/FoodsPage'), 'FoodsPage');
const FoodEditorPage = lazyNamed(() => import('@/features/foods/FoodEditorPage'), 'FoodEditorPage');
const DishEditorPage = lazyNamed(
  () => import('@/features/dishes/DishEditorPage'),
  'DishEditorPage',
);
const MealTemplateEditorPage = lazyNamed(
  () => import('@/features/meals/MealTemplateEditorPage'),
  'MealTemplateEditorPage',
);
const InsightsPage = lazyNamed(() => import('@/features/insights/InsightsPage'), 'InsightsPage');
const WeightPage = lazyNamed(() => import('@/features/weight/WeightPage'), 'WeightPage');
const MorePage = lazyNamed(() => import('@/features/settings/MorePage'), 'MorePage');
const CategoriesPage = lazyNamed(
  () => import('@/features/settings/CategoriesPage'),
  'CategoriesPage',
);
const MealSlotsPage = lazyNamed(() => import('@/features/settings/MealSlotsPage'), 'MealSlotsPage');

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <Navigate to="/today" replace /> },
              { path: 'today', element: <TodayRedirect /> },
              { path: 'today/:day', element: <TodayPage /> },
              {
                path: 'foods',
                element: <FoodsPage />,
                children: [
                  { path: 'new', element: <FoodEditorPage /> },
                  { path: 'dishes', element: <Navigate to="/foods?tab=dishes" replace /> },
                  { path: 'dishes/new', element: <DishEditorPage /> },
                  { path: 'dishes/:id', element: <DishEditorPage /> },
                  { path: 'meals', element: <Navigate to="/foods?tab=meals" replace /> },
                  { path: 'meals/new', element: <MealTemplateEditorPage /> },
                  { path: 'meals/:id', element: <MealTemplateEditorPage /> },
                  { path: ':id', element: <FoodEditorPage /> },
                ],
              },
              { path: 'insights', element: <InsightsPage /> },
              { path: 'weight', element: <WeightPage /> },
              { path: 'more', element: <MorePage /> },
              { path: 'more/categories', element: <CategoriesPage /> },
              { path: 'more/meal-slots', element: <MealSlotsPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
