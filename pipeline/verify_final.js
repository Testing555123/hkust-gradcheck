async page => {
  await page.locator('[role=dialog] [role=combobox][aria-label="主修"]').click({timeout: 10000});
  await page.waitForTimeout(500);
  const opts = await page.locator('[role=option]').count();
  await page.locator('[role=option]').filter({hasText: 'Computer Science'}).first().click({timeout: 8000});
  await page.waitForTimeout(400);
  await page.locator('[role=dialog] button').filter({hasText: /进入|Enter/}).first().click({timeout: 8000});
  await page.waitForTimeout(1500);
  const remaining = await page.locator('[role=dialog]').count();
  await page.getByRole('tab').nth(2).click({timeout: 10000});
  await page.waitForTimeout(800);
  const t = await page.locator('[role=tabpanel][data-state=active]').innerText();
  return JSON.stringify({
    options: opts,
    dialogClosed: remaining === 0,
    program: t.slice(0, 50),
    noteRendered: t.includes('官方说明'),
    comp2611: t.includes('COMP2611'),
    areaBlocks: (t.match(/Area/g) || []).length,
    electivesRule: t.includes('at least 3 courses should be taken from 1 area'),
  });
}
