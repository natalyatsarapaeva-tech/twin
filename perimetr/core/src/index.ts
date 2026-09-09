// Чистое ядро «Периметра». Ни сети, ни базы, ни DOM — только логика ТЗ.
// Импортируется и воркером, и SPA: счётчики на экране и проверки на сервере
// обязаны быть одной функцией (критерий приёмки 12).

export * from './types.ts';
export * from './config.ts';
export * from './text.ts';
export * from './json.ts';
export * from './score.ts';
export * from './dedup.ts';
export * from './blockers.ts';
export * from './checks.ts';
export * from './audit.ts';
export * from './budget.ts';
export * from './sanitize.ts';
