import { describe, expect, it } from 'vitest';
import { applyTheme, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('follows the system when the preference is system', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });
  it('ignores the system for explicit preferences', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('toggles the dark class and updates theme-color', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);

    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(meta.content).toBe('#0b0b0f');

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(meta.content).toBe('#f6f6f7');
  });
});
