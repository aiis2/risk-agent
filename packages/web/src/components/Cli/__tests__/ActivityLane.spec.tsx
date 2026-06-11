/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityLane } from '../ActivityLane';

describe('ActivityLane', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('PointerEvent', MouseEvent);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a latest pulse card and semantic event sections', () => {
    render(
      <ActivityLane
        isOpen
        onToggle={() => {}}
        events={[
          { id: 'evt_1', type: 'routed', label: 'route analysis', timestamp: Date.now() - 5000 },
          { id: 'evt_2', type: 'tool_start', label: 'tool query_database', timestamp: Date.now() - 4000 },
          { id: 'evt_3', type: 'waiting_user', label: 'awaiting input', timestamp: Date.now() - 3000 },
          { id: 'evt_4', type: 'verifier_finished', label: 'verifier pass', timestamp: Date.now() - 2000 },
          { id: 'evt_5', type: 'run_completed', label: 'session complete', timestamp: Date.now() - 1000 },
        ]}
      />,
    );

    expect(screen.getByText('Latest Pulse')).toBeTruthy();
    expect(screen.getByText('Task Flow')).toBeTruthy();
    expect(screen.getByText('Execution')).toBeTruthy();
    expect(screen.getByText('Outcome')).toBeTruthy();
    expect(screen.getByText('attention 1')).toBeTruthy();
    expect(screen.getByText('result 2')).toBeTruthy();
    const latestSection = screen.getByText('Latest Pulse').closest('section');
    expect(latestSection?.textContent).toContain('session complete');
  });

  it('supports filtering and collapsing activity sections', async () => {
    const user = userEvent.setup();
    render(
      <ActivityLane
        isOpen
        onToggle={() => {}}
        events={[
          { id: 'evt_1', type: 'routed', label: 'route analysis', timestamp: Date.now() - 3000 },
          { id: 'evt_2', type: 'waiting_user', label: 'awaiting input', timestamp: Date.now() - 2000 },
          { id: 'evt_3', type: 'run_failed', label: 'session failed', timestamp: Date.now() - 1000 },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Toggle Task Flow section' }));
    expect(screen.queryByText('route analysis')).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Filter activity' }), 'failed');
    expect(screen.getByText('session failed')).toBeTruthy();
    const latestSection = screen.getByText('Latest Pulse').closest('section');
    expect(latestSection?.textContent).toContain('failed');
  });

  it('persists collapsed sections across remounts', async () => {
    const user = userEvent.setup();
    const props = {
      isOpen: true,
      onToggle: () => {},
      events: [
        { id: 'evt_1', type: 'routed', label: 'route analysis', timestamp: Date.now() - 3000 },
        { id: 'evt_2', type: 'tool_start', label: 'tool query_database', timestamp: Date.now() - 2000 },
      ],
    };

    const { unmount } = render(<ActivityLane {...props} />);

    await user.click(screen.getByRole('button', { name: 'Toggle Task Flow section' }));
    expect(screen.queryByText('route analysis')).toBeNull();

    unmount();

    render(<ActivityLane {...props} />);

    expect(screen.queryByText('route analysis')).toBeNull();
  });

  it('hides the closed lane without translating it outside the page bounds', () => {
    render(
      <ActivityLane
        isOpen={false}
        onToggle={() => {}}
        events={[
          { id: 'evt_1', type: 'routed', label: 'route analysis', timestamp: Date.now() },
        ]}
      />,
    );

    const lane = screen.getByLabelText('Activity lane');
    expect(lane.className).toContain('invisible');
    expect(lane.className).not.toContain('translate-x-full');
    expect(lane.getAttribute('aria-hidden')).toBe('true');
  });
});
