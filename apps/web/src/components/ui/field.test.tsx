import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field } from './field';
import { Segmented } from './segmented';

afterEach(cleanup);

describe('Field', () => {
  it('labels a single control with <label for>', () => {
    render(
      <Field label="Height" description="In centimetres">
        {(c) => <input id={c.id} aria-describedby={c['aria-describedby']} />}
      </Field>,
    );
    const input = screen.getByLabelText('Height');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAccessibleDescription('In centimetres');
    expect(screen.getByText('Height').tagName).toBe('LABEL');
  });

  it('labels a group through aria-labelledby and leaves no orphan <label for>', () => {
    render(
      <Field label="Sex" group error="Pick one">
        {(c) => (
          <Segmented
            aria-labelledby={c['aria-labelledby']}
            aria-describedby={c['aria-describedby']}
            value="male"
            onChange={() => undefined}
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
            ]}
          />
        )}
      </Field>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Sex' });
    expect(group).toHaveAccessibleDescription('Pick one');
    expect(screen.getByText('Sex').tagName).toBe('SPAN');
    expect(document.querySelector('label[for]')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Pick one');
  });
});
