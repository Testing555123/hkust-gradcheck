async page => {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(3500);
  // 0. 顶栏 ProfileBadge 打开 Onboarding
  await page.locator('header button[title]').first().click({timeout: 15000});
  const dlg = page.locator('[role=dialog]').first();
  await dlg.waitFor({timeout: 10000});
  // 1. 选学年 2024-25（MINOR/SREQ 产物齐全）
  await page.locator('[role=dialog] [role=combobox]').nth(0).click({timeout: 8000});
  await page.waitForTimeout(400);
  await page.locator('[role=option]').filter({hasText: '2024-25'}).first().click({timeout: 8000});
  await page.waitForTimeout(400);
  // 2. 选主修 MATH（理学院）
  await page.locator('[role=dialog] [role=combobox]').nth(1).click({timeout: 8000});
  await page.waitForTimeout(500);
  await page.locator('[role=option]').filter({hasText: 'MATH · BSc in Mathematics'}).first().click({timeout: 8000});
  await page.waitForTimeout(500);
  const afterMath = await dlg.innerText();
  const schoolNow = afterMath.includes('理学院');
  const schoolTip = afterMath.includes('School Requirements: School of Science');
  // 3. 展开选填区（若已展开则跳过点击）+ 搜索勾选 Chemistry 辅修
  const toggle = page.locator('[data-testid="onboarding-optional-toggle"]');
  const alreadyOpen = (await toggle.getAttribute('aria-expanded')) === 'true';
  if (!alreadyOpen) await toggle.click({timeout: 8000});
  await page.waitForTimeout(400);
  const searchBox = page.locator('[role=dialog] input').first();
  await searchBox.waitFor({timeout: 8000});
  await searchBox.fill('Chemistry');
  await page.waitForTimeout(400);
  await page.locator('[role=dialog] label').filter({hasText: 'Minor Program in Chemistry'}).first().click();
  await page.waitForTimeout(300);
  // 4. 进入
  await page.locator('[data-testid="onboarding-submit"]').click({timeout: 8000});
  await page.waitForTimeout(2500);
  // 5. 总览页：附加要求卡片（辅修 + 学院要求）
  const overview = await page.locator('[role=tabpanel][data-state=active]').innerText();
  const hasMinorCard = overview.includes('Minor Program in Chemistry');
  const hasSchoolCard = overview.includes('School Requirements: School of Science');
  const hasAttachedSection = overview.includes('附加要求');
  // 6. 刷新持久化
  await page.reload();
  await page.waitForTimeout(3500);
  const after = await page.locator('[role=tabpanel][data-state=active]').innerText();
  const persisted = after.includes('Minor Program in Chemistry') && after.includes('School Requirements: School of Science');
  return JSON.stringify({schoolNow, schoolTip, alreadyOpen, hasMinorCard, hasSchoolCard, hasAttachedSection, persisted});
}
