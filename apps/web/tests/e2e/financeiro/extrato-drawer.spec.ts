import path from 'node:path';
import { expect, test } from '@playwright/test';

import { waitForPageReady } from './helpers/api';
import { seedAdminAndLogin } from './helpers/auth';

test.describe('Extrato - drawer de detalhes', () => {
  test.use({ viewport: { width: 1440, height: 1200 } });

  test('abre como painel lateral compacto com boa hierarquia visual e sem colapso horizontal', async ({ page }) => {
    await seedAdminAndLogin(page);

    await page.goto('/financeiro/extrato?debugFixture=sample-ledger');
    await waitForPageReady(page, 'Extrato');

    await page.getByRole('row').filter({ hasText: 'Taxa da cobrança' }).first().click();

    const drawer = page.getByTestId('extrato-details-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Movimentação confirmada')).toBeVisible();

    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox?.width ?? 0).toBeGreaterThanOrEqual(420);
    expect(drawerBox?.width ?? 0).toBeLessThanOrEqual(440);

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect((drawerBox?.x ?? 0) + (drawerBox?.width ?? 0)).toBeGreaterThan((viewport?.width ?? 0) - 48);

    const descriptionOverflow = await page.getByTestId('drawer-description').evaluate((node) => {
      return node.scrollWidth > node.clientWidth + 1;
    });
    expect(descriptionOverflow).toBeFalsy();

    const rowMetrics = await page.getByTestId('detail-row').evaluateAll((nodes) => {
      return nodes.map((node) => {
        const container = node.getBoundingClientRect();
        const left = node.children[0]?.getBoundingClientRect();
        const right = node.children[1]?.getBoundingClientRect();

        return {
          overlaps: Boolean(left && right && left.right > right.left),
          overflowsLeft: Boolean(left && left.left < container.left - 1),
          overflowsRight: Boolean(right && right.right > container.right + 1),
        };
      });
    });

    for (const metric of rowMetrics) {
      expect(metric.overlaps).toBeFalsy();
      expect(metric.overflowsLeft).toBeFalsy();
      expect(metric.overflowsRight).toBeFalsy();
    }

    await page.screenshot({
      path: path.resolve(process.cwd(), 'test-results/extrato-drawer-visual.png'),
      fullPage: true,
    });
  });
});