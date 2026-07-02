import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test('quatro magos percorrem a partida sincronizada', async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const consoleErrors: string[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', error => consoleErrors.push(error.message));
      contexts.push(context); pages.push(page);
    }

    await Promise.all(pages.map(page => page.goto('/?test=1&players=4')));
    await Promise.all(pages.map(page => expect(page.getByText('Quatro caminhos. Uma coroa.')).toBeVisible()));

    await pages[0]!.locator('[data-mage="ice"]').click();
    await expect(pages[1]!.locator('[data-mage="ice"]')).toBeDisabled();
    await pages[1]!.locator('[data-mage="fire"]').click();
    await pages[2]!.locator('[data-mage="shadow"]').click();
    await pages[3]!.locator('[data-mage="light"]').click();

    await Promise.all(pages.map(page => expect(page.getByText('Guardião de Pedra', { exact: true })).toBeVisible()));

    for (let level = 1; level <= 3; level++) {
      await pages[0]!.keyboard.press('KeyK');
      await Promise.all(pages.map(page => expect(page.getByText('Escolha uma relíquia')).toBeVisible()));
      await Promise.all(pages.map(page => page.locator('[data-item]').first().click()));
      if (level < 3) await Promise.all(pages.map(page => expect(page.getByText(level === 1 ? 'Serpente de Cristal' : 'Arquimago do Vazio', { exact: true })).toBeVisible()));
    }

    await Promise.all(pages.map(page => expect(page.getByText('4 MAGOS VIVOS')).toBeVisible()));
    for (const page of pages) await expect(page.locator('.inventory span[title]')).toHaveCount(3);

    await pages[0]!.keyboard.press('KeyK');
    await expect(pages[0]!.getByText('Vitória arcana!')).toBeVisible();
    await Promise.all(pages.slice(1).map(page => expect(page.getByText('Derrota', { exact: true })).toBeVisible()));
    await pages[0]!.getByRole('button', { name: 'Jogar novamente' }).click();
    await Promise.all(pages.map(page => expect(page.getByText('Quatro caminhos. Uma coroa.')).toBeVisible()));
    expect(consoleErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
