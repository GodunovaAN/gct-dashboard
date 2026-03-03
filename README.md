# Document Signature App (UA)

MVP вебзастосунок для публічного підписання PDF-документа представниками організацій.

## Що реалізовано

- Авторизація:
  - Google OAuth (якщо задані `GOOGLE_CLIENT_ID/SECRET`)
  - LinkedIn OAuth (якщо задані `LINKEDIN_CLIENT_ID/SECRET`)
  - Email-код (demo-режим: код повертається у відповідь API)
- Інтерфейс після входу:
  - PDF-документ
  - бокова панель зі списком підписантів у реальному часі
  - форма `Погоджуюся` з вказанням організації та позиції (`Підтримую`/`Не підтримую`)
- Одноразове голосування з акаунта:
  - якщо підпис вже є, повторно проголосувати не можна
  - якщо користувач вийшов без підпису, може повернутися і проголосувати
- Адмін-функції (за email із `ADMIN_EMAILS`):
  - видалення підписів у списку
  - завантаження нового PDF

## Запуск

1. Встановіть залежності:

```bash
npm install
```

2. Створіть `.env` на основі `.env.example`:

```bash
cp .env.example .env
```

3. Запустіть:

```bash
npm run dev
```

4. Відкрийте:

[http://localhost:3000](http://localhost:3000)

## Файли

- Сервер: `/Users/Nastya/Documents/New project/server.js`
- UI: `/Users/Nastya/Documents/New project/public/index.html`
- Стилі: `/Users/Nastya/Documents/New project/public/styles.css`
- Клієнтська логіка: `/Users/Nastya/Documents/New project/public/script.js`
- База даних: `/Users/Nastya/Documents/New project/data/app.db`
- Документ: `/Users/Nastya/Documents/New project/data/document.pdf`

## GCT Dashboard

Додано окрему сторінку дашборда за реєстраційною формою воркшопу:

- Сторінка: `/Users/Nastya/Documents/New project/public/dashboard.html`
- Стилі: `/Users/Nastya/Documents/New project/public/dashboard.css`
- Логіка: `/Users/Nastya/Documents/New project/public/dashboard.js`
- Дані: `/Users/Nastya/Documents/New project/public/data/gct_workshop_data.json`
- Конвертація XLSX -> JSON: `/Users/Nastya/Documents/New project/scripts/build_gct_dataset.py`

Оновлення JSON із нового Excel:

```bash
python3 scripts/build_gct_dataset.py "/шлях/до/файлу.xlsx" public/data/gct_workshop_data.json --sheet "Аркуш1"
```

Після запуску сервера дашборд доступний за адресою:

[http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html)

## Deploy to Render

У проєкт додано blueprint-файл:

- `/Users/Nastya/Documents/New project/render.yaml`

Кроки:

1. Завантажте репозиторій у GitHub.
2. У Render оберіть `New +` -> `Blueprint`.
3. Оберіть цей репозиторій, Render автоматично знайде `render.yaml`.
4. Під час першого деплою заповніть змінні:
   - `APP_BASE_URL` (наприклад `https://your-service.onrender.com`)
   - `ADMIN_EMAILS`
   - за потреби OAuth: `GOOGLE_*`, `LINKEDIN_*`
5. Після деплою:
   - застосунок: `https://your-service.onrender.com/`
   - дашборд: `https://your-service.onrender.com/dashboard.html`

Примітка: у `render.yaml` використовується `plan: starter`, бо для SQLite/PDF потрібен Persistent Disk (`/var/data`).

## Важливо для production

- Замінити demo email-code на реальну відправку листів.
- Увімкнути `secure` cookies за HTTPS.
- Додати аудит-лог адмін-видалень.
- Додати rate limit на auth endpoints.
