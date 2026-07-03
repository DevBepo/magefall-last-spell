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
    await Promise.all(pages.map(page => expect(page.getByRole('button', { name: 'Criar sala' })).toBeVisible()));
    await pages[0]!.locator('#player-name').fill('Host'); await pages[0]!.getByRole('button', { name: 'Criar sala' }).click();
    const roomCode = (await pages[0]!.locator('#copy-code').textContent())!.trim();
    for (let i = 1; i < pages.length; i++) {
      await pages[i]!.locator('#player-name').fill(`Player ${i + 1}`); await pages[i]!.locator('#room-code').fill(roomCode); await pages[i]!.getByRole('button', { name: 'Entrar em sala' }).click();
    }
    await Promise.all(pages.map(page => expect(page.getByText('Escolha seu último feitiço')).toBeVisible()));

    await pages[0]!.locator('[data-mage="fire"]').click();
    await pages[1]!.locator('[data-mage="fire"]').click();
    await expect(pages[1]!.locator('[data-mage="fire"]')).toBeEnabled();
    await pages[2]!.locator('[data-mage="shadow"]').click();
    await pages[3]!.locator('[data-mage="light"]').click();
    await pages[0]!.getByRole('button', { name: 'Iniciar partida' }).click();

    await Promise.all(pages.map(page => expect(page.getByText('Guardião de Pedra', { exact: true })).toBeVisible()));

    for (let level = 1; level <= 3; level++) {
      await pages[0]!.keyboard.press('KeyK');
      await Promise.all(pages.map(page => expect(page.getByText('Escolha uma relíquia')).toBeVisible()));
      if (level === 3) {
        const activeIds = new Set(['blink-rune', 'healing-shard', 'repulse-orb', 'time-crystal']);
        for (const page of pages) expect((await page.locator('[data-item]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.item))).every(id => activeIds.has(id!))).toBe(true);
      }
      await Promise.all(pages.map(page => page.locator('[data-item]').first().click()));
      if (level < 3) await Promise.all(pages.map(page => expect(page.getByText(level === 1 ? 'Serpente de Cristal' : 'Arquimago do Vazio', { exact: true })).toBeVisible()));
    }

    await Promise.all(pages.map(page => expect(page.getByText('4 MAGOS VIVOS')).toBeVisible()));
    for (const page of pages) await expect(page.locator('.inventory span[title]')).toHaveCount(3);

    await pages[0]!.keyboard.press('KeyK');
    await expect(pages[0]!.getByText('Vitória arcana!')).toBeVisible();
    await Promise.all(pages.slice(1).map(page => expect(page.getByText('Derrota', { exact: true })).toBeVisible()));
    await pages[0]!.getByRole('button', { name: 'Voltar ao lobby' }).click();
    await Promise.all(pages.map(page => expect(page.getByText('Escolha seu último feitiço')).toBeVisible()));
    expect(consoleErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

test('duas salas privadas não compartilham lobby', async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  try {
    await Promise.all(pages.map(page => page.goto('/?test=1&players=2')));
    for (const [hostIndex, guestIndex, name] of [[0, 1, 'Sala A'], [2, 3, 'Sala B']] as const) {
      await pages[hostIndex]!.locator('#player-name').fill(name); await pages[hostIndex]!.getByRole('button', { name: 'Criar sala' }).click();
      const code = (await pages[hostIndex]!.locator('#copy-code').textContent())!.trim();
      await pages[guestIndex]!.locator('#player-name').fill(`Convidado ${name}`); await pages[guestIndex]!.locator('#room-code').fill(code); await pages[guestIndex]!.getByRole('button', { name: 'Entrar em sala' }).click();
    }
    await expect(pages[0]!.getByText('Sala B', { exact: true })).toHaveCount(0); await expect(pages[2]!.getByText('Sala A', { exact: true })).toHaveCount(0);
    await pages[0]!.locator('[data-mage="ice"]').click(); await pages[1]!.locator('[data-mage="ice"]').click();
    await expect(pages[2]!.locator('.lobby-panel').getByText('Ice', { exact: true })).toHaveCount(0);
    await pages[2]!.locator('[data-mage="fire"]').click(); await pages[3]!.locator('[data-mage="fire"]').click();
    await pages[0]!.getByRole('button', { name: 'Iniciar partida' }).click(); await pages[2]!.getByRole('button', { name: 'Iniciar partida' }).click();
    for (let level = 1; level <= 3; level++) {
      await pages[0]!.keyboard.press('KeyK'); await pages[2]!.keyboard.press('KeyK');
      await Promise.all(pages.map(page => expect(page.getByText('Escolha uma relíquia')).toBeVisible()));
      await Promise.all(pages.map(page => page.locator('[data-item]').first().click()));
    }
    await Promise.all(pages.map(page => expect(page.getByText('2 MAGOS VIVOS')).toBeVisible()));
    await pages[0]!.keyboard.press('KeyK'); await expect(pages[0]!.getByText('Vitória arcana!')).toBeVisible();
    await expect(pages[2]!.getByText('2 MAGOS VIVOS')).toBeVisible();
    await pages[0]!.getByRole('button', { name: 'Voltar ao lobby' }).click();
    await expect(pages[0]!.getByText('Escolha seu último feitiço')).toBeVisible();
    await expect(pages[2]!.getByText('2 MAGOS VIVOS')).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
