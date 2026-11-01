import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { createQueryClient } from './providers/query-client';
import { router } from './router';

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          {/* Motion springs follow prefers-reduced-motion, like the CSS animations in globals.css. */}
          <MotionConfig reducedMotion="user">
            <RouterProvider router={router} />
            <ThemedToaster />
          </MotionConfig>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="top-center"
      offset={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
      toastOptions={{ classNames: { toast: 'rounded-control! border-border! shadow-card!' } }}
    />
  );
}
