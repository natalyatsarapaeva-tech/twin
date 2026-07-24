# Авторизация и Блокноты — настройка

Wave 8 добавила вход по аккаунту и «Блокноты» (Notebooks) — отдельные каталоги
задач, как в проекте **twin-things**. Реализация повторяет его архитектуру:
общие ES-модули `js/firebase.js`, `js/twin-core.js`, `js/store.js`.

## Что появилось

- **Вход** (Google или email+пароль) — экран на `index.html`, остальные страницы
  редиректят на него, если пользователь не авторизован.
- **Блокноты** — данные каждого блокнота лежат в `notebooks/{nid}/…` и доступны
  только его участникам. Свитчер блокнотов — кнопка в шапке `index.html`.
- **Совместный доступ** — у блокнота есть 6-значный код приглашения; по нему
  другой человек присоединяется (роль `editor`).
- **Миграция** — при первом входе старые задачи из коллекций верхнего уровня
  (`tasks/`, `contexts/`, `meta/`) автоматически переносятся в первый блокнот
  «Мой блокнот» (см. `migrateLegacyData` в `js/store.js`).

## Модель данных (Firestore)

```
users/{uid}                     — {displayName, email, createdAt}
users/{uid}/notebooks/{nid}     — индекс «мои блокноты» {role, name, joinedAt}
notebooks/{nid}                 — {name, ownerUid, joinCode, createdAt}
notebooks/{nid}/members/{uid}   — источник прав {role: owner|editor}
notebooks/{nid}/tasks/{id}      — задачи (было: tasks/)
notebooks/{nid}/contexts/*      — user | tag-* (было: contexts/)
notebooks/{nid}/meta/*          — tags | notificationSettings (было: meta/)
```

## Настройка Firebase (один раз)

Проект тот же — `natas-kitchen`. Нужно включить Auth:

1. **Firebase Console → Authentication → Sign-in method** — включить провайдеры
   **Google** и **Email/Password**.
2. **Authentication → Settings → Authorized domains** — добавить домен GitHub
   Pages (`natalyatsarapaeva-tech.github.io`) и `localhost`.
3. **Порядок деплоя правил важен из-за миграции:**
   - сначала войти в приложение хотя бы одним аккаунтом (пока база в test mode) —
     миграция перенесёт старые задачи в первый блокнот;
   - затем задеплоить `firestore.rules` (Console → Firestore → Rules или
     `firebase deploy --only firestore:rules`).

## Известный follow-up: Cloudflare Worker

`worker/task-intake-worker.js` (email/Slack intake) всё ещё пишет в коллекцию
`tasks/` верхнего уровня. Чтобы входящие задачи попадали в конкретный блокнот,
воркеру нужно знать `nid` (например, задать `DEFAULT_NOTEBOOK_ID` в секретах и
писать в `notebooks/{nid}/tasks`). Это отдельная задача — UI-часть от неё не
зависит.
