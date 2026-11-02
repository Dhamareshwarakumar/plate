import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazy, Suspense } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorPage } from './RouteErrorPage';

/** A page chunk whose download failed, the way Vite reports it. */
const BrokenPage = lazy(() =>
  Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/x.js')),
);

function Crash(): never {
  throw new Error('render exploded');
}

function Shell() {
  return (
    <div>
      <nav>tab bar</nav>
      <Suspense fallback={<p>loading…</p>}>
        <Outlet />
      </Suspense>
    </div>
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        errorElement: <RouteErrorPage />,
        children: [
          {
            errorElement: <RouteErrorPage inShell />,
            children: [
              { path: '/chunk', element: <BrokenPage /> },
              { path: '/crash', element: <Crash /> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RouteErrorPage', () => {
  it('shows a reload action inside the shell when a page chunk cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAt('/chunk');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This part of Plate didn't load");
    expect(alert).toHaveTextContent(/Reloading fetches the current version/);
    // The shell around the page is still there.
    expect(screen.getByText('tab bar')).toBeInTheDocument();

    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('catches a render error with a generic message and logs the detail', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAt('/crash');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveTextContent(/your data on the server is unaffected/);
    expect(logged.mock.calls.some(([first]) => first instanceof Error)).toBe(true);
  });
});
