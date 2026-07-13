import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionDialog } from './CompletionDialog';

function DialogHarness({
  error,
  onConfirm = vi.fn(),
}: {
  error?: string;
  onConfirm?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>開啟完成確認</button>
      <CompletionDialog
        busy={false}
        error={error}
        journeyTitle="花蓮海岸公路"
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={onConfirm}
      />
    </>
  );
}

describe('CompletionDialog', () => {
  afterEach(cleanup);

  it('names the journey, traps focus, closes on Escape, and restores opener focus', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: '開啟完成確認' });

    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: '完成旅程' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('「花蓮海岸公路」完成後會立即出現在世界地圖與播放器。');
    const cancel = within(dialog).getByRole('button', { name: '返回預覽' });
    const confirm = within(dialog).getByRole('button', { name: '確認完成旅程' });
    expect(cancel).toHaveFocus();

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(confirm).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('confirms once and presents a recoverable completion error', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DialogHarness error="旅程內容已更新，請重新載入後再完成。" onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: '開啟完成確認' }));
    const dialog = screen.getByRole('dialog', { name: '完成旅程' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('旅程內容已更新，請重新載入後再完成。');

    await user.click(within(dialog).getByRole('button', { name: '確認完成旅程' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: '完成旅程' })).toBeInTheDocument();
  });
});
