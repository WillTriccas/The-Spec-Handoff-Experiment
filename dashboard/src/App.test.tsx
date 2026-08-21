import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

describe('pre-measurement dashboard', () => {
  it('does not present fabricated measured outcomes', () => {
    render(<App />);
    expect(screen.getAllByText(/not-evaluated/i).length).toBeGreaterThan(0);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('0/2')).toBeTruthy();
  });

  it('shows the exact two-lane plan in engineering view', () => {
    render(<App />);
    fireEvent.click(screen.getByText('Engineering'));
    expect(screen.getAllByText('opus-spec').length).toBeGreaterThan(0);
    expect(screen.getAllByText('mai-spec').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Lane'), { target: { value: 'mai-spec' } });
    expect(screen.getAllByText('mai-spec').length).toBeGreaterThan(0);
  });
});
