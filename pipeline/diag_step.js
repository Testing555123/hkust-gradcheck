async page => {
  await page.reload();
  await page.waitForTimeout(3500);
  const body = await page.evaluate(() => document.body.innerText);
  const overview = body; // 默认 overview tab
  // 切到要求明细页
  await page.getByRole('tab').nth(2).click({timeout: 10000});
  await page.waitForTimeout(1000);
  const req = await page.evaluate(() => document.body.innerText);
  // 切到课程选择页
  await page.getByRole('tab').nth(1).click({timeout: 10000});
  await page.waitForTimeout(800);
  const courses = await page.evaluate(() => document.body.innerText);
  return JSON.stringify({
    overviewHasMinorCard: overview.includes('Minor Program in Chemistry'),
    overviewHasSchoolCard: overview.includes('School Requirements - School of Science'),
    overviewHasAttached: overview.includes('附加要求'),
    reqHasSchoolTree: req.includes('School Requirements - School of Science'),
    reqHasMinorTree: req.includes('Minor Program in Chemistry'),
    coursesHasMinorCourse: courses.includes('CHEM'),
  });
}
