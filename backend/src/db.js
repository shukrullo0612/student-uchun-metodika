import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { newDb, DataType } from 'pg-mem';
import config from './config.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const seedTeachers = async (queryFn) => {
  const teachers = [
    {
      email: 'goibnazarovshukrullo@gmail.com',
      password: 'admin123',
      fullName: 'Shukrullo Goibnazarov',
    },
    {
      email: 'dilraborustamova048@gmail.com',
      password: 'dilrabo6880',
      fullName: 'Dilrabo Rustamova',
    },
  ];

  for (const teacher of teachers) {
    const passwordHash = await bcrypt.hash(teacher.password, 12);
    await queryFn(
      `
        INSERT INTO users (email, password_hash, full_name, role)
        VALUES ($1, $2, $3, 'admin')
        ON CONFLICT (email)
        DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          full_name = EXCLUDED.full_name,
          role = 'admin',
          updated_at = NOW()
      `,
      [teacher.email, passwordHash, teacher.fullName]
    );
  }
};

const seedStarterData = async (queryFn) => {
  const generateWordwallPin = () => `${Math.floor(10000 + Math.random() * 90000)}`;

  const getWordwallPin = async () => {
    for (let i = 0; i < 30; i += 1) {
      const pin = generateWordwallPin();
      const exists = await queryFn('SELECT 1 FROM wordwall_sets WHERE pin = $1 LIMIT 1', [pin]);
      if (exists.rowCount === 0) {
        return pin;
      }
    }

    throw new Error('Unable to generate unique Wordwall PIN');
  };

  const teacherResult = await queryFn(
    `
      SELECT id
      FROM users
      WHERE role IN ('admin', 'teacher')
      ORDER BY created_at ASC
      LIMIT 1
    `
  );

  if (teacherResult.rowCount === 0) {
    return;
  }

  const teacherId = teacherResult.rows[0].id;

  const courseCount = await queryFn(
    'SELECT COUNT(*)::int AS count FROM courses WHERE teacher_id = $1',
    [teacherId]
  );

  if (courseCount.rows[0].count === 0) {
    await queryFn(
      `
        INSERT INTO courses (teacher_id, title, description, status)
        VALUES
          ($1, 'Mustaqil ishlash konikmalari', 'Asosiy kurs', 'Faol'),
          ($1, 'Elektron resurslar asosida talim', 'Interaktiv kurs', 'Faol')
      `,
      [teacherId]
    );
  }

  const firstCourse = await queryFn(
    `
      SELECT id
      FROM courses
      WHERE teacher_id = $1
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [teacherId]
  );

  const courseId = firstCourse.rows[0]?.id || null;

  const studentCount = await queryFn(
    'SELECT COUNT(*)::int AS count FROM students WHERE teacher_id = $1',
    [teacherId]
  );

  if (studentCount.rows[0].count === 0) {
    await queryFn(
      `
        INSERT INTO students (teacher_id, full_name, email, group_name)
        VALUES
          ($1, 'Ali Ahmedov', 'ali.ahmedov@mail.com', '9-A'),
          ($1, 'Fotima Isomova', 'fotima.isomova@mail.com', '9-B'),
          ($1, 'Husan Karimov', 'husan.karimov@mail.com', '9-A')
      `,
      [teacherId]
    );
  }

  const assignmentCount = await queryFn(
    'SELECT COUNT(*)::int AS count FROM assignments WHERE teacher_id = $1',
    [teacherId]
  );

  if (assignmentCount.rows[0].count === 0) {
    await queryFn(
      `
        INSERT INTO assignments (
          teacher_id,
          course_id,
          title,
          total_tasks,
          completed_tasks,
          due_date
        )
        VALUES
          ($1, $2, 'Diagnostika savollari', 24, 18, CURRENT_DATE),
          ($1, $2, 'Loyiha ishlanishi', 24, 22, CURRENT_DATE),
          ($1, $2, 'Yakuniy test', 24, 21, CURRENT_DATE)
      `,
      [teacherId, courseId]
    );
  }

  const quizCount = await queryFn(
    'SELECT COUNT(*)::int AS count FROM quizzes WHERE teacher_id = $1',
    [teacherId]
  );

  if (quizCount.rows[0].count === 0) {
    const quiz = await queryFn(
      `
        INSERT INTO quizzes (teacher_id, course_id, title, time_limit_minutes, is_published)
        VALUES ($1, $2, 'Mustaqil ishlash testi', 15, true)
        RETURNING id
      `,
      [teacherId, courseId]
    );

    const quizId = quiz.rows[0].id;
    const question = await queryFn(
      `
        INSERT INTO quiz_questions (quiz_id, question_text, points)
        VALUES ($1, 'Mustaqil ishning asosiy maqsadi nima?', 10)
        RETURNING id
      `,
      [quizId]
    );

    const questionId = question.rows[0].id;
    await queryFn(
      `
        INSERT INTO quiz_options (question_id, option_text, is_correct, option_order)
        VALUES
          ($1, 'Oquvchini passiv qilish', false, 1),
          ($1, 'Oquvchini mustaqil fikrlashga orgatish', true, 2),
          ($1, 'Faqat nazorat qilish', false, 3),
          ($1, 'Faqat test yechish', false, 4)
      `,
      [questionId]
    );
  }

  const kahootCount = await queryFn(
    'SELECT COUNT(*)::int AS count FROM kahoot_sessions WHERE teacher_id = $1',
    [teacherId]
  );

  if (kahootCount.rows[0].count === 0) {
    const session = await queryFn(
      `
        INSERT INTO kahoot_sessions (teacher_id, title, pin, status)
        VALUES ($1, 'Interaktiv live session', '123456', 'draft')
        RETURNING id
      `,
      [teacherId]
    );

    const sessionId = session.rows[0].id;
    await queryFn(
      `
        INSERT INTO kahoot_questions (
          session_id,
          question_text,
          option_a,
          option_b,
          option_c,
          option_d,
          correct_option,
          time_limit_seconds,
          points
        )
        VALUES
          ($1, 'Mustaqil talim uchun eng togri yondashuv qaysi?',
           'Faqat maruza',
           'Amaliy topshiriqlar',
           'Faqat test',
           'Faqat video',
           'B', 30, 100)
      `,
      [sessionId]
    );
  }

  const wordwallCount = await queryFn(
    'SELECT COUNT(*)::int AS count FROM wordwall_sets WHERE teacher_id = $1',
    [teacherId]
  );

  if (wordwallCount.rows[0].count === 0) {
    const pin = await getWordwallPin();
    const set = await queryFn(
      `
        INSERT INTO wordwall_sets (teacher_id, title, template_type, clue_mode, pin)
        VALUES ($1, 'Asosiy terminlar', 'matching', 'without', $2)
        RETURNING id
      `,
      [teacherId, pin]
    );

    const setId = set.rows[0].id;
    await queryFn(
      `
        INSERT INTO wordwall_items (set_id, prompt, answer)
        VALUES
          ($1, 'Mustaqil ish', 'Oquvchi mustaqil faoliyati'),
          ($1, 'Monitoring', 'Natijalarni kuzatish'),
          ($1, 'Diagnostika', 'Boshlangich holatni aniqlash')
      `,
      [setId]
    );
  }
};

const initializePgMem = async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  const pgMem = db.adapters.createPg();
  const memPool = new pgMem.Pool();

  const migrationsDir = path.join(__dirname, '../db/migrations');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const migrationPath = path.join(migrationsDir, file);
    let migrationSql = fs.readFileSync(migrationPath, 'utf8');
    migrationSql = migrationSql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/gi, '');
    await memPool.query(migrationSql);
  }

  const queryFn = (text, params = []) => memPool.query(text, params);
  await seedTeachers(queryFn);
  await seedStarterData(queryFn);

  return memPool;
};

const initializePool = async () => {
  if (config.usePgMem) {
    console.log('[db] Using in-memory PostgreSQL (pg-mem) mode');
    return initializePgMem();
  }

  console.log('[db] Using external PostgreSQL mode');
  return new Pool({
    connectionString: config.databaseUrl,
  });
};

export const pool = await initializePool();

export const query = (text, params = []) => pool.query(text, params);

export const testConnection = async () => {
  const result = await query('SELECT NOW() AS now');
  return result.rows[0]?.now;
};
