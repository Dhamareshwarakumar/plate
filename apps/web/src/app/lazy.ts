import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type PropsOf<T> = T extends ComponentType<infer P> ? P : never;

/**
 * `React.lazy` for a named export, so feature pages keep their named exports and still land in
 * their own chunk: `lazyNamed(() => import('@/features/foods/FoodsPage'), 'FoodsPage')`.
 * Two wrappers over the same module share one chunk (`TodayPage` + `TodayRedirect`).
 */
export function lazyNamed<M, K extends keyof M>(
  loader: () => Promise<M>,
  exportName: K,
): LazyExoticComponent<ComponentType<PropsOf<M[K]>>> {
  return lazy(async () => {
    const component = (await loader())[exportName] as ComponentType<PropsOf<M[K]>>;
    return { default: component };
  });
}
