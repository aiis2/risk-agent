/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Dialog, DialogContent } from '../Dialog';

afterEach(() => {
  cleanup();
});

describe('DialogContent', () => {
  it('applies viewport height and vertical scrolling defaults', () => {
    render(
      <Dialog open>
        <DialogContent title="测试弹窗" description="用于验证默认滚动策略。">
          <div>内容</div>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(dialog.className).toContain('overflow-y-auto');
  });
});