import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AccessibleDialog } from './AccessibleDialog';

function SingleDialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      <button type="button">Outside control</button>
      <AccessibleDialog open={open} onDismiss={() => setOpen(false)} title="Focus boundary">
        <button type="button">First control</button>
        <button type="button">Last control</button>
      </AccessibleDialog>
    </>
  );
}

function NestedDialogHarness() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setParentOpen(true)}>Open parent</button>
      <AccessibleDialog open={parentOpen} onDismiss={() => setParentOpen(false)} title="Parent dialog">
        <button type="button" onClick={() => setChildOpen(true)}>Open child</button>
        <button type="button">Parent action</button>
        <AccessibleDialog open={childOpen} onDismiss={() => setChildOpen(false)} title="Child dialog">
          <button type="button">Child action</button>
        </AccessibleDialog>
      </AccessibleDialog>
    </>
  );
}

describe('AccessibleDialog', () => {
  afterEach(cleanup);

  it('wraps backward and forward while containing focus that lands outside', async () => {
    const user = userEvent.setup();
    render(<SingleDialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('dialog', { name: 'Focus boundary' });
    const first = within(dialog).getByRole('button', { name: 'First control' });
    const last = within(dialog).getByRole('button', { name: 'Last control' });
    expect(first).toHaveFocus();

    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();

    screen.getByRole('button', { name: 'Outside control' }).focus();
    expect(first).toHaveFocus();
  });

  it('lets only the topmost nested dialog handle Escape and restores focus through the stack', async () => {
    const user = userEvent.setup();
    render(<NestedDialogHarness />);
    const parentOpener = screen.getByRole('button', { name: 'Open parent' });

    await user.click(parentOpener);
    const childOpener = within(screen.getByRole('dialog', { name: 'Parent dialog' }))
      .getByRole('button', { name: 'Open child' });
    await user.click(childOpener);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Child dialog' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeInTheDocument();
    expect(childOpener).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(parentOpener).toHaveFocus();
  });

  it('ignores a lower backdrop while a child is open and dismisses only the child backdrop', async () => {
    const user = userEvent.setup();
    render(<NestedDialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Open parent' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Parent dialog' }))
      .getByRole('button', { name: 'Open child' }));
    const backdrops = [...document.querySelectorAll<HTMLElement>('.dialog-backdrop')];
    expect(backdrops).toHaveLength(2);

    fireEvent.mouseDown(backdrops[0]);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    fireEvent.mouseDown(backdrops[1]);
    expect(screen.queryByRole('dialog', { name: 'Child dialog' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeInTheDocument();
  });

  it('removes nested stack entries before a rapid unmount and reopen', async () => {
    const user = userEvent.setup();
    const nested = render(<NestedDialogHarness />);
    await user.click(screen.getByRole('button', { name: 'Open parent' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Parent dialog' }))
      .getByRole('button', { name: 'Open child' }));

    nested.unmount();
    render(<SingleDialogHarness />);
    const freshOpener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(freshOpener);
    expect(screen.getByRole('dialog', { name: 'Focus boundary' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(freshOpener).toHaveFocus();
  });
});
