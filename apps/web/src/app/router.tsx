import { createBrowserRouter, Navigate } from 'react-router';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { DishEditorPage } from '@/features/dishes/DishEditorPage';
import { FoodEditorPage } from '@/features/foods/FoodEditorPage';
import { FoodsPage } from '@/features/foods/FoodsPage';
import { InsightsPage } from '@/features/insights/InsightsPage';
import { MealTemplateEditorPage } from '@/features/meals/MealTemplateEditorPage';
import { CategoriesPage } from '@/features/settings/CategoriesPage';
import { MealSlotsPage } from '@/features/settings/MealSlotsPage';
import { MorePage } from '@/features/settings/MorePage';
import { TodayPage, TodayRedirect } from '@/features/today/TodayPage';
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
]);
