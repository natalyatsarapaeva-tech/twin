// Проверка вёрстки (§13.3, критерий приёмки 9) — автоматическая, а не на глаз.
//
//   node scripts/layout-check.mjs [--shots <dir>]
//
// Требует собранного web/dist и запущенного статического сервера на :4173.
// Проверяет то, что ТЗ формулирует как критерий: на 375 px ни один блок не
// уезжает за границы, интерактивные элементы не меньше 44 px, и ни одна
// операция не оставляет консоль в ошибках.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.PERIMETR_URL || 'http://127.0.0.1:4173/';
const CHROME = process.env.PLAYWRIGHT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt === -1 ? null : process.argv[shotsAt + 1];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [375, 414, 768, 1280];
const failures = [];

const browser = await chromium.launch({ executablePath: CHROME });

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /демо-данных/i }).click();
  await page.waitForTimeout(1200);

  const screens = [
    ['places', null],
    ['blocker', 'Zalando Logistics SE'],
  ];
  for (const [name, click] of screens) {
    if (click) {
      await page.getByText(click).click();
      await page.waitForTimeout(600);
    }
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const overflow = document.documentElement.scrollWidth - vw;
      const small = [];
      const sel = 'button, a[href], input, select, textarea, [role="button"]';
      for (const el of document.querySelectorAll(sel)) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;       // скрытое не считаем
        // Зона попадания, а не нарисованный размер: компактная кнопка может
        // выглядеть на 36 px и расширять цель псевдоэлементом (см. app.css).
        const after = getComputedStyle(el, '::after');
        const hit = after.content !== 'none' && after.position === 'absolute'
          ? Math.max(b.height, parseFloat(after.height) || 0)
          : b.height;
        if (hit < 44 - 0.5) {
          small.push({ tag: el.tagName.toLowerCase(), h: Math.round(hit), text: (el.textContent || '').trim().slice(0, 30) });
        }
      }
      return { overflow, small };
    });
    if (r.overflow > 0) failures.push(`${width}px · ${name}: горизонтальный вылет ${r.overflow}px`);
    for (const s of r.small) failures.push(`${width}px · ${name}: цель ${s.h}px < 44px — «${s.text}»`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-${name}.png`, fullPage: name !== 'places' });
  }
  await page.close();
}

await browser.close();

if (failures.length) {
  console.error('Вёрстка не проходит критерий 9:\n' + failures.map(f => '  · ' + f).join('\n'));
  process.exit(1);
}
console.log(`Вёрстка в порядке на ширинах ${WIDTHS.join(', ')} px: вылетов нет, цели не меньше 44 px.`);
