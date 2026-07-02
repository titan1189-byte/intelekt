# Облік майна з Google Sheets

Локальна апка для читання Google таблиці, сортування позицій за статусами та зміни статусу прямо з інтерфейсу.

## Що вміє

- читає рядки з Google Sheets у діапазоні `A:I`;
- розпізнає статуси: `На складі`, `Ремонт`, `Пошкоджені`, `Втрачені`;
- показує лічильники, фільтри і пошук;
- змінює статус у колонці `F` Google таблиці.

## Налаштування

1. Скопіюйте `.env.example` у `.env`.
2. Заповніть `GOOGLE_SHEET_ID`.
3. За потреби вкажіть `GOOGLE_SHEET_GID` або `GOOGLE_SHEET_NAME`.
4. Покладіть OAuth файл `credentials.json` у цю папку.
5. Запустіть:

```powershell
npm start
```

6. Відкрийте `http://127.0.0.1:3100`.

Під час першого запуску апка попросить авторизацію Google і створить `token.json`.

Якщо використовується старий `token.json`, створений тільки для читання таблиці, видаліть його і зайдіть через Google ще раз. Для зміни статусів потрібен доступ `spreadsheets`.

## Очікувана структура таблиці

Апка орієнтується на колонки:

- `A`: №
- `B`: Назва майна
- `C`: Заводський номер
- `D`: К-сть
- `E`: Од. виміру
- `F`: Статус
- `G`: Фактичні пошкодження / примітка
- `H`: Обставини пошкодження
- `I`: Дата можливого виходу з ремонту
#intelekt

## Production sheet access

Google Sheets shares access at spreadsheet-file level. To show only allowed
worksheet tabs inside this app, create `.data/sheet-access.json` from
`sheet-access.example.json`.

Example:

```json
{
  "default": [],
  "users": {
    "commander@example.com": ["968282677"],
    "operator@example.com": ["1021102017", "1 РУБпАК"],
    "*": []
  }
}
```

Use Google user email as the key. Values can be sheet `gid` numbers or sheet
titles. When `sheet-access.json` exists, users not listed there see no tabs
unless `default` or `users["*"]` allows them.

## Apps Script report button

The app can run the existing Google Apps Script report functions from the
active sheet. Set `GOOGLE_APPS_SCRIPT_ID` in `.env` to the Apps Script project
ID, enable the Google Apps Script API in Google Cloud, then open `/reauth` once
so the user grants the added `script.scriptapp` scope.

For sheet `2 РУБпАК`, the app calls `надіслатиЗвіт_2РУБпАК` by default. Spaces
are removed from the sheet title. If a sheet needs a custom function name, set
`REPORT_FUNCTION_MAP` to a JSON object in `.env`, for example:

```json
{"2 РУБпАК":"надіслатиЗвіт_2РУБпАК"}
```

If the Apps Script function returns a WhatsApp URL as a string, or as
`{ "url": "..." }`, the app opens it in a new tab.

## Firebase production

Production is prepared for Firebase Hosting + Cloud Functions. Hosting serves
`public/`, while `/api/**`, `/auth/google`, `/oauth2callback`, `/logout`, and
`/reauth` are routed to the `app` Cloud Function.

Setup:

1. Create a Firebase project and enable Firestore.
2. Copy `.firebaserc.example` to `.firebaserc` and set your Firebase project id,
   or deploy with `firebase deploy --project your-project-id`.
3. Copy `.env.firebase.example` to `.env.your-project-id` and fill values.
4. In Google Cloud OAuth client, add:
   `https://your-firebase-project-id.web.app/oauth2callback`
   to Authorized redirect URIs.
5. Enable APIs in Google Cloud: Google Sheets API and Google Apps Script API.
6. Deploy:

```powershell
npm run deploy
```

Use `/reauth` after deploy so users grant the production OAuth scopes. In
production, OAuth sessions and refresh tokens are stored in Firestore instead
of `.data/auth-store.json`.
