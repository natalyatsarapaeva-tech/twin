// Собирает web/dist в ОДИН html-файл: интерфейс «Периметра» открывается по
// ссылке, без сервера и без бэкенда (демо-режим на экране входа).
// Дизайн не переписывается — инлайнится ровно то, что собрал Vite.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../web/dist/', import.meta.url).pathname;
const OUT = process.argv[2] || '/tmp/perimetr-preview.html';

const assets = readdirSync(join(DIST, 'assets'));
const css = readFileSync(join(DIST, 'assets', assets.find(f => f.endsWith('.css'))), 'utf8');
const js = readFileSync(join(DIST, 'assets', assets.find(f => f.endsWith('.js'))), 'utf8');

const html = `<title>Периметр</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Spectral:wght@400;500;600&display=swap">
<style>
/* Приложение нарисовано в одном визуальном мире и красит фон само; сообщаем
   об этом хосту, чтобы системные контролы не приехали из тёмной темы. */
:root { color-scheme: light; }
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;

writeFileSync(OUT, html);
console.log(`${OUT} — ${(html.length / 1024).toFixed(0)} КБ`);
