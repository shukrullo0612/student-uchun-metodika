# EduSkill Lab

Bu loyiha elektron talim resurslari asosida oqituvchilar uchun boshqaruv paneli:

- Xavfsiz login (backend auth)
- Kurslar, oquvchilar, topshiriqlar CRUD
- Quiz moduli
- Kahoot uslubidagi sessionlar
- Wordwall uslubidagi mashqlar
- Oquvchilar uchun alohida public sahifalar (Quiz/Kahoot/Wordwall)

## Tez ishga tushirish

PowerShellda `npm` policy xatosi chiqsa, `npm` o'rniga `npm.cmd` ishlating.

1. Backend dependency ornatish:
   - `npm run install:backend`

2. API ishga tushirish (tez usul, in-memory DB):
   - `npm run api:dev`

3. Frontend:
   - `index.html` ni Live Server orqali oching (masalan `http://127.0.0.1:5500`).

## Persistent PostgreSQL rejimi (ixtiyoriy)

1. `backend/.env.example` ni `backend/.env` qilib oling
2. `USE_PGMEM=false` qiling
3. Postgres ishga tushiring:
   - `npm run db:up`
4. Migration va seed:
   - `npm run db:migrate`
   - `npm run db:seed`

## Oqituvchi panelidan foydalanish

1. `index.html` orqali login qiling.
2. Dashboardda:
   - `Kurslar`, `Oquvchilar`, `Topshiriqlar` bo'limlarida CRUD amallarini bajaring.
   - `Quizlar` bo'limida quiz yarating va publish qiling.
   - `Kahoot` bo'limida session yarating, savol qo'shing, live start qiling.
   - `Wordwall` bo'limida set yarating va element qo'shing.
3. Har bir modulda `Oquvchi havolasi` tugmasi bor.

## Oquvchi sahifalari

- `quiz-play.html?quizId=<QUIZ_ID>`
- `kahoot-play.html?pin=<PIN>`
- `wordwall-play.html?setId=<SET_ID>`

Bu sahifalar orqali oquvchi test/mashqni mustaqil bajaradi.

## Login

- `goibnazarovshukrullo@gmail.com` / `admin123`
- `dilraborustamova048@gmail.com` / `dilrabo6880`

## Oquvchi uchun public sahifalar

- Quiz: `quiz-play.html?quizId=<quiz_id>`
- Kahoot: `kahoot-play.html?pin=<session_pin>`
- Wordwall: `wordwall-play.html?setId=<set_id>`

Bu havolalarni dashboard ichida `Nusxa` yoki `Oquvchi havolasi` tugmalari orqali olasiz.

## Asosiy endpoint

- Health: `GET http://localhost:3001/api/health`

## Hujjatlar

- `docs/ARCHITECTURE.md`
- `docs/LOCAL_SETUP.md`
- `docs/API_SPEC.md`
- `docs/DEPLOYMENT.md`
