import express from 'express';
import { query, pool } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
const ROOM_CODE_REGEX = /^\d{5}$/;
const DEFAULT_LIVE_QUESTION_SECONDS = 30;
let liveSchemaReadyPromise = null;

const ensureLiveSchema = async () => {
  if (liveSchemaReadyPromise) {
    return liveSchemaReadyPromise;
  }

  liveSchemaReadyPromise = (async () => {
    try {
      await query('SELECT 1 FROM quiz_live_sessions LIMIT 1');
      await query('SELECT 1 FROM quiz_live_participants LIMIT 1');
      await query('SELECT 1 FROM quiz_live_answers LIMIT 1');
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('does not exist') || message.includes('relation') || message.includes('table')) {
        const schemaError = new Error("Live quiz jadvallari topilmadi. Backend serverni qayta ishga tushiring.");
        schemaError.code = 'LIVE_SCHEMA_MISSING';
        schemaError.statusCode = 500;
        throw schemaError;
      }
      throw error;
    }
  })().catch((error) => {
    liveSchemaReadyPromise = null;
    throw error;
  });

  return liveSchemaReadyPromise;
};

const generateRoomCode = () => `${Math.floor(10000 + Math.random() * 90000)}`;

const createUniqueRoomCode = async () => {
  await ensureLiveSchema();

  for (let i = 0; i < 30; i += 1) {
    const code = generateRoomCode();
    const existing = await query(
      `
        SELECT 1
        FROM quiz_live_sessions
        WHERE room_code = $1
          AND status IN ('waiting', 'live')
        LIMIT 1
      `,
      [code]
    );

    if (existing.rowCount === 0) {
      return code;
    }
  }

  throw new Error('Unable to generate room code');
};

const getCurrentQuestionByIndex = async (quizId, index) => {
  if (!quizId || index <= 0) {
    return null;
  }

  const questionResult = await query(
    `
      SELECT id, question_text, points
      FROM quiz_questions
      WHERE quiz_id = $1
      ORDER BY created_at ASC
      LIMIT 1
      OFFSET $2
    `,
    [quizId, index - 1]
  );

  if (questionResult.rowCount === 0) {
    return null;
  }

  const question = questionResult.rows[0];
  const optionsResult = await query(
    `
      SELECT id, option_text, option_order, is_correct
      FROM quiz_options
      WHERE question_id = $1
      ORDER BY option_order ASC
    `,
    [question.id]
  );

  return {
    id: question.id,
    questionText: question.question_text,
    points: question.points,
    options: optionsResult.rows.map((option) => ({
      id: option.id,
      optionText: option.option_text,
      optionOrder: option.option_order,
      isCorrect: option.is_correct,
    })),
  };
};

const getSessionCoreByCode = async (code) => {
  await ensureLiveSchema();

  const result = await query(
    `
      SELECT s.id, s.quiz_id, s.room_code, s.status, s.current_question_index,
             s.question_started_at, s.question_time_seconds, s.created_at,
             q.title AS quiz_title,
             COALESCE(qq.total_questions, 0)::int AS total_questions
      FROM quiz_live_sessions s
      JOIN quizzes q ON q.id = s.quiz_id
      LEFT JOIN (
        SELECT quiz_id, COUNT(*)::int AS total_questions
        FROM quiz_questions
        GROUP BY quiz_id
      ) qq ON qq.quiz_id = s.quiz_id
      WHERE s.room_code = $1
      LIMIT 1
    `,
    [code]
  );

  return result.rows[0] || null;
};

const getSessionCoreById = async (sessionId) => {
  await ensureLiveSchema();

  const result = await query(
    `
      SELECT s.id, s.quiz_id, s.room_code, s.status, s.current_question_index,
             s.question_started_at, s.question_time_seconds, s.created_at,
             q.title AS quiz_title,
             COALESCE(qq.total_questions, 0)::int AS total_questions
      FROM quiz_live_sessions s
      JOIN quizzes q ON q.id = s.quiz_id
      LEFT JOIN (
        SELECT quiz_id, COUNT(*)::int AS total_questions
        FROM quiz_questions
        GROUP BY quiz_id
      ) qq ON qq.quiz_id = s.quiz_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [sessionId]
  );

  return result.rows[0] || null;
};

const buildRemainingSeconds = (questionStartedAt, limitSeconds) => {
  const limit = Number(limitSeconds);
  if (!Number.isFinite(limit) || limit <= 0) {
    return null;
  }

  if (!questionStartedAt) {
    return limit;
  }

  const startedAtMs = new Date(questionStartedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return limit;
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  return Math.max(0, limit - elapsed);
};

const hashToUint32 = (value) => {
  const input = String(value || '');
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const shuffleOptionsWithSeed = (options, seed) => {
  const source = Array.isArray(options) ? options : [];
  if (source.length <= 1) {
    return source.map((option, index) => ({
      ...option,
      optionOrder: Number(option.optionOrder || index + 1),
    }));
  }

  return source
    .map((option, index) => ({
      ...option,
      _rank: hashToUint32(`${seed}:${option.id}:${index}`),
      _fallbackOrder: Number(option.optionOrder || index + 1),
    }))
    .sort((a, b) => (a._rank - b._rank) || (a._fallbackOrder - b._fallbackOrder))
    .map((option, index) => {
      const { _rank, _fallbackOrder, ...clean } = option;
      return {
        ...clean,
        optionOrder: index + 1,
      };
    });
};

const getCurrentQuestionForSession = async (sessionId, quizId, index) => {
  const question = await getCurrentQuestionByIndex(quizId, index);
  if (!question) {
    return null;
  }

  return {
    ...question,
    options: shuffleOptionsWithSeed(question.options, `${sessionId}:${question.id}`),
  };
};

const getQuestionAnswerProgress = async (sessionId, questionId) => {
  if (!sessionId || !questionId) {
    return {
      participantsCount: 0,
      answeredParticipantsCount: 0,
      allParticipantsAnswered: false,
    };
  }

  const progressResult = await query(
    `
      SELECT
        COALESCE((
          SELECT COUNT(*)::int
          FROM quiz_live_participants
          WHERE session_id = $1
        ), 0)::int AS participants_count,
        COALESCE((
          SELECT COUNT(DISTINCT participant_id)::int
          FROM quiz_live_answers
          WHERE session_id = $1
            AND question_id = $2
        ), 0)::int AS answered_participants_count
    `,
    [sessionId, questionId]
  );

  const participantsCount = Number(progressResult.rows[0]?.participants_count || 0);
  const answeredParticipantsCount = Number(progressResult.rows[0]?.answered_participants_count || 0);

  return {
    participantsCount,
    answeredParticipantsCount,
    allParticipantsAnswered: participantsCount > 0 && answeredParticipantsCount >= participantsCount,
  };
};

const UZB_HISTORY_QUIZ_TITLE = 'UZB tarix';

const UZB_HISTORY_QUESTION_BANK = [
  {
    questionText: "O'zbekiston Respublikasining Konstitutsiyasi qachon qabul qilingan?",
    options: ['1992-yil 8-dekabrda', '1991-yil 1-sentabrda', '1993-yil 10-yanvarda', '1990-yil 21-oktabrda'],
  },
  {
    questionText: "Sohibqiron Amir Temur qaysi shaharni o'z saltanatining poytaxti etib belgilagan?",
    options: ['Samarqand', 'Buxoro', 'Toshkent', 'Xiva'],
  },
  {
    questionText: "O'zbek tili qachon davlat tili maqomini olgan?",
    options: ['1989-yil 21-oktabrda', '1991-yil 31-avgustda', '1992-yil 2-iyulda', '1990-yil 20-iyunda'],
  },
  {
    questionText: '"Al-jabr" (Algebra) faniga asos solgan buyuk matematik olim kim?',
    options: ['Muhammad al-Xorazmiy', "Ahmad Farg'oniy", 'Abu Rayhon Beruniy', "Mirzo Ulug'bek"],
  },
  {
    questionText: 'Eng qadimgi yozma manbamiz "Avesto" qaysi dinning muqaddas kitobi hisoblanadi?',
    options: ['Zardushtiylik', 'Islom', 'Buddaviylik', 'Xristianlik'],
  },
  {
    questionText: 'Samarqanddagi mashhur Registon ansamblining markaziy qismida joylashgan eng birinchi madrasa qaysi?',
    options: ["Ulug'bek madrasasi", 'Sherdor madrasasi', 'Tillakori madrasasi', "Ko'kaldosh madrasasi"],
  },
  {
    questionText: "O'zbekiston Respublikasining Davlat bayrog'i qachon qabul qilingan?",
    options: ['1991-yil 18-noyabrda', '1992-yil 2-iyulda', '1991-yil 1-sentabrda', '1993-yil 15-dekabrda'],
  },
  {
    questionText: '"Yulduzlar jadvali" (Ziji Ko\'ragoniy) asarining muallifi, astronom olim va hukmdor kim?',
    options: ["Mirzo Ulug'bek", 'Zahiriddin Muhammad Bobur', 'Amir Temur', 'Alisher Navoiy'],
  },
  {
    questionText: "O'zbek klassik adabiyoti va o'zbek tilining asoschisi deb kimni tan olamiz?",
    options: ['Alisher Navoiy', 'Bobur', 'Ogahiy', 'Furqat'],
  },
  {
    questionText: 'Hindistonda "Boburiylar sulolasi"ga (Buyuk Mo\'g\'ullar imperiyasi) kim asos solgan?',
    options: ['Zahiriddin Muhammad Bobur', 'Jaloliddin Manguberdi', "Mirzo Ulug'bek", 'Humoyun Mirzo'],
  },
  {
    questionText: "O'zbekiston Respublikasining Davlat gerbi qachon qabul qilingan?",
    options: ['1992-yil 2-iyulda', '1991-yil 18-noyabrda', '1992-yil 8-dekabrda', '1994-yil 1-iyulda'],
  },
  {
    questionText: 'Mo\'g\'ullarga qarshi mardona kurashgan va "Vatan ozodligi yo\'lida qurbon bo\'lgan" xalq qahramoni kim?',
    options: ['Jaloliddin Manguberdi', 'Amir Temur', 'Alisher Navoiy', 'Abdulla Qodiriy'],
  },
];

const normalizeCompareText = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const ensureQuestionOptions = async (client, questionId, expectedOptions) => {
  const existingOptions = await client.query(
    `
      SELECT option_text, is_correct, option_order
      FROM quiz_options
      WHERE question_id = $1
      ORDER BY option_order ASC
    `,
    [questionId]
  );

  const isSame =
    existingOptions.rowCount === expectedOptions.length
    && existingOptions.rows.every((row, index) => {
      return (
        normalizeCompareText(row.option_text) === normalizeCompareText(expectedOptions[index])
        && Boolean(row.is_correct) === (index === 0)
        && Number(row.option_order) === index + 1
      );
    });

  if (isSame) {
    return;
  }

  await client.query('DELETE FROM quiz_options WHERE question_id = $1', [questionId]);

  for (let index = 0; index < expectedOptions.length; index += 1) {
    await client.query(
      `
        INSERT INTO quiz_options (question_id, option_text, is_correct, option_order)
        VALUES ($1, $2, $3, $4)
      `,
      [questionId, expectedOptions[index], index === 0, index + 1]
    );
  }
};

const ensureUzbHistoryQuizForTeacher = async (teacherId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingQuiz = await client.query(
      `
        SELECT id
        FROM quizzes
        WHERE teacher_id = $1
          AND LOWER(title) = LOWER($2)
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [teacherId, UZB_HISTORY_QUIZ_TITLE]
    );

    let quizId = existingQuiz.rows[0]?.id || null;

    if (!quizId) {
      const firstCourse = await client.query(
        `
          SELECT id
          FROM courses
          WHERE teacher_id = $1
          ORDER BY created_at ASC
          LIMIT 1
        `,
        [teacherId]
      );

      const createdQuiz = await client.query(
        `
          INSERT INTO quizzes (teacher_id, course_id, title, time_limit_minutes, is_published)
          VALUES ($1, $2, $3, 20, true)
          RETURNING id
        `,
        [teacherId, firstCourse.rows[0]?.id || null, UZB_HISTORY_QUIZ_TITLE]
      );

      quizId = createdQuiz.rows[0].id;
    }

    const existingQuestions = await client.query(
      `
        SELECT id, question_text
        FROM quiz_questions
        WHERE quiz_id = $1
      `,
      [quizId]
    );

    const questionMap = new Map(
      existingQuestions.rows.map((row) => [normalizeCompareText(row.question_text), row.id])
    );

    for (const item of UZB_HISTORY_QUESTION_BANK) {
      const key = normalizeCompareText(item.questionText);
      let questionId = questionMap.get(key);

      if (!questionId) {
        const inserted = await client.query(
          `
            INSERT INTO quiz_questions (quiz_id, question_text, points)
            VALUES ($1, $2, 10)
            RETURNING id
          `,
          [quizId, item.questionText]
        );

        questionId = inserted.rows[0].id;
        questionMap.set(key, questionId);
      }

      await ensureQuestionOptions(client, questionId, item.options);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

router.get('/:id/public', async (req, res, next) => {
  try {
    const quizResult = await query(
      `
        SELECT q.id, q.title, q.time_limit_minutes, q.is_published, c.title AS course_title
        FROM quizzes q
        LEFT JOIN courses c ON c.id = q.course_id
        WHERE q.id = $1
          AND q.is_published = true
        LIMIT 1
      `,
      [req.params.id]
    );

    if (quizResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Quiz not found',
      });
    }

    const questionsResult = await query(
      `
        SELECT id, question_text, points
        FROM quiz_questions
        WHERE quiz_id = $1
        ORDER BY created_at ASC
      `,
      [req.params.id]
    );

    const optionsResult = await query(
      `
        SELECT qo.id, qo.question_id, qo.option_text, qo.option_order
        FROM quiz_options qo
        JOIN quiz_questions qq ON qq.id = qo.question_id
        WHERE qq.quiz_id = $1
        ORDER BY qq.created_at ASC, qo.option_order ASC
      `,
      [req.params.id]
    );

    const optionsByQuestion = optionsResult.rows.reduce((acc, row) => {
      const list = acc.get(row.question_id) || [];
      list.push({
        id: row.id,
        optionText: row.option_text,
        optionOrder: row.option_order,
      });
      acc.set(row.question_id, list);
      return acc;
    }, new Map());

    const requestSeed = `${Date.now()}:${Math.random().toString(36).slice(2)}`;

    const data = {
      ...quizResult.rows[0],
      questions: questionsResult.rows.map((question) => ({
        id: question.id,
        questionText: question.question_text,
        points: question.points,
        options: shuffleOptionsWithSeed(
          optionsByQuestion.get(question.id) || [],
          `${requestSeed}:${question.id}`
        ),
      })),
    };

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/attempt', async (req, res, next) => {
  try {
    const { playerName, answers = [] } = req.body || {};
    const quizId = req.params.id;

    if (!playerName || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'playerName and answers[] are required',
      });
    }

    const correctResult = await query(
      `
        SELECT qo.question_id, qo.id AS option_id, qq.points
        FROM quiz_options qo
        JOIN quiz_questions qq ON qq.id = qo.question_id
        WHERE qq.quiz_id = $1
          AND qo.is_correct = true
      `,
      [quizId]
    );

    const correctMap = new Map();
    let totalPoints = 0;

    for (const row of correctResult.rows) {
      correctMap.set(row.question_id, row.option_id);
      totalPoints += row.points;
    }

    const answerMap = new Map(
      answers
        .filter((item) => item.questionId && item.optionId)
        .map((item) => [item.questionId, item.optionId])
    );

    let earnedPoints = 0;
    let correctAnswers = 0;

    for (const [questionId, optionId] of correctMap.entries()) {
      if (answerMap.get(questionId) === optionId) {
        const points = correctResult.rows.find((row) => row.question_id === questionId)?.points || 0;
        earnedPoints += points;
        correctAnswers += 1;
      }
    }

    const insertResult = await query(
      `
        INSERT INTO quiz_attempts (
          quiz_id,
          teacher_id,
          player_name,
          score,
          total_points,
          correct_answers,
          answers_json
        )
        SELECT q.id, q.teacher_id, $2, $3, $4, $5, $6::jsonb
        FROM quizzes q
        WHERE q.id = $1
        RETURNING id, quiz_id, player_name, score, total_points, correct_answers, submitted_at
      `,
      [quizId, playerName, earnedPoints, totalPoints, correctAnswers, JSON.stringify(answers)]
    );

    if (insertResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Quiz not found',
      });
    }

    return res.json({ success: true, data: insertResult.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/live/join', authenticateToken, async (req, res, next) => {
  try {
    if (req.user?.role !== 'student') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: "Bu endpoint faqat o'quvchilar uchun",
      });
    }

    const code = String(req.body?.code || '').trim();
    if (!ROOM_CODE_REGEX.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CODE',
        message: '5 xonali kod kiriting',
      });
    }

    const session = await getSessionCoreByCode(code);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Bunday quiz xonasi topilmadi',
      });
    }

    if (session.status === 'finished') {
      return res.status(400).json({
        success: false,
        error: 'SESSION_FINISHED',
        message: 'Bu quiz sessiyasi yakunlangan',
      });
    }

    const playerName = String(req.user?.name || req.user?.email || 'Oquvchi').trim();
    const participant = await query(
      `
        INSERT INTO quiz_live_participants (session_id, user_id, player_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, user_id)
        DO UPDATE SET player_name = EXCLUDED.player_name
        RETURNING id, session_id, player_name, score, joined_at
      `,
      [session.id, req.user.id, playerName]
    );

    return res.json({
      success: true,
      data: {
        sessionId: session.id,
        code: session.room_code,
        status: session.status,
        quizTitle: session.quiz_title,
        participant: participant.rows[0],
      },
      message: "Hotirjam bo'ling, sizning so'rovingiz qabul qilindi. Tez orada quiz testlar boshlanadi.",
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/live/:code/state', authenticateToken, async (req, res, next) => {
  try {
    if (req.user?.role !== 'student') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: "Bu endpoint faqat o'quvchilar uchun",
      });
    }

    const code = String(req.params.code || '').trim();
    if (!ROOM_CODE_REGEX.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CODE',
        message: '5 xonali kod kiriting',
      });
    }

    const session = await getSessionCoreByCode(code);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session topilmadi' });
    }

    const participantResult = await query(
      `
        SELECT id, player_name, score, joined_at
        FROM quiz_live_participants
        WHERE session_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [session.id, req.user.id]
    );

    if (participantResult.rowCount === 0) {
      return res.status(403).json({
        success: false,
        error: 'NOT_JOINED',
        message: 'Avval ushbu code bilan sessiyaga qoshiling',
      });
    }

    const participant = participantResult.rows[0];
    const totalQuestions = Number(session.total_questions || 0);
    const summaryResult = await query(
      `
        SELECT COUNT(*)::int AS answered_count,
               COALESCE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END), 0)::int AS correct_answers
        FROM quiz_live_answers
        WHERE session_id = $1
          AND participant_id = $2
      `,
      [session.id, participant.id]
    );
    const answeredCount = Number(summaryResult.rows[0]?.answered_count || 0);
    const correctAnswers = Number(summaryResult.rows[0]?.correct_answers || 0);
    const incorrectAnswers = Math.max(0, answeredCount - correctAnswers);

    let question = null;
    let alreadyAnswered = false;
    let remainingSeconds = null;
    let canGoNext = false;
    let answerProgress = {
      participantsCount: 0,
      answeredParticipantsCount: 0,
      allParticipantsAnswered: false,
    };

    if (session.status === 'live' && Number(session.current_question_index) > 0) {
      const current = await getCurrentQuestionForSession(
        session.id,
        session.quiz_id,
        Number(session.current_question_index)
      );
      if (current) {
        question = {
          id: current.id,
          questionText: current.questionText,
          points: current.points,
          options: current.options.map((option) => ({
            id: option.id,
            optionText: option.optionText,
            optionOrder: option.optionOrder,
          })),
        };

        const answerCheck = await query(
          `
            SELECT id
            FROM quiz_live_answers
            WHERE session_id = $1
              AND question_id = $2
              AND participant_id = $3
            LIMIT 1
          `,
          [session.id, current.id, participant.id]
        );
        alreadyAnswered = answerCheck.rowCount > 0;

        answerProgress = await getQuestionAnswerProgress(session.id, current.id);
      }

      remainingSeconds = buildRemainingSeconds(
        session.question_started_at,
        Number(session.question_time_seconds || DEFAULT_LIVE_QUESTION_SECONDS)
      );
      canGoNext = Boolean(question) && alreadyAnswered;
    }

    const leaderboardResult = await query(
      `
        SELECT player_name, score
        FROM quiz_live_participants
        WHERE session_id = $1
        ORDER BY score DESC, joined_at ASC
        LIMIT 10
      `,
      [session.id]
    );

    return res.json({
      success: true,
      data: {
        sessionId: session.id,
        quizTitle: session.quiz_title,
        code: session.room_code,
        status: session.status,
        totalQuestions,
        currentQuestionIndex: Number(session.current_question_index || 0),
        questionTimeSeconds: Number(session.question_time_seconds || DEFAULT_LIVE_QUESTION_SECONDS),
        remainingSeconds,
        question,
        alreadyAnswered,
        canGoNext,
        answerProgress,
        summary: {
          answeredCount,
          correctAnswers,
          incorrectAnswers,
        },
        participant,
        leaderboard: leaderboardResult.rows,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/live/:code/next', authenticateToken, async (req, res, next) => {
  try {
    if (req.user?.role !== 'student') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: "Bu endpoint faqat o'quvchilar uchun",
      });
    }

    const code = String(req.params.code || '').trim();
    if (!ROOM_CODE_REGEX.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CODE',
        message: '5 xonali kod kiriting',
      });
    }

    const session = await getSessionCoreByCode(code);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session topilmadi' });
    }

    if (session.status === 'finished') {
      return res.json({
        success: true,
        data: {
          status: 'finished',
          sessionId: session.id,
          code: session.room_code,
          currentQuestionIndex: Number(session.current_question_index || 0),
          totalQuestions: Number(session.total_questions || 0),
        },
      });
    }

    if (session.status !== 'live') {
      return res.status(400).json({
        success: false,
        error: 'SESSION_NOT_LIVE',
        message: 'Quiz hali boshlanmagan',
      });
    }

    const participantResult = await query(
      `
        SELECT id
        FROM quiz_live_participants
        WHERE session_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [session.id, req.user.id]
    );

    if (participantResult.rowCount === 0) {
      return res.status(403).json({
        success: false,
        error: 'NOT_JOINED',
        message: 'Avval sessiyaga qoshiling',
      });
    }

    const participantId = participantResult.rows[0].id;
    const currentIndex = Number(session.current_question_index || 0);
    const totalQuestions = Number(session.total_questions || 0);

    const currentQuestion = await getCurrentQuestionByIndex(session.quiz_id, currentIndex);
    if (!currentQuestion) {
      return res.status(400).json({
        success: false,
        error: 'NO_ACTIVE_QUESTION',
        message: 'Hozir aktiv savol topilmadi',
      });
    }

    const answerCheck = await query(
      `
        SELECT id
        FROM quiz_live_answers
        WHERE session_id = $1
          AND question_id = $2
          AND participant_id = $3
        LIMIT 1
      `,
      [session.id, currentQuestion.id, participantId]
    );

    if (answerCheck.rowCount === 0) {
      return res.status(400).json({
        success: false,
        error: 'CANNOT_GO_NEXT_YET',
        message: 'Avval javobni tanlang va yuboring',
      });
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex > totalQuestions) {
      await query(
        `
          UPDATE quiz_live_sessions
          SET status = 'finished',
              finished_at = NOW(),
              question_started_at = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [session.id]
      );

      return res.json({
        success: true,
        data: {
          status: 'finished',
          sessionId: session.id,
          code: session.room_code,
          currentQuestionIndex: currentIndex,
          totalQuestions,
        },
        message: 'Quiz yakunlandi',
      });
    }

    const updateResult = await query(
      `
        UPDATE quiz_live_sessions
        SET current_question_index = $1,
            question_started_at = NOW(),
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, room_code, status, current_question_index, question_time_seconds
      `,
      [nextIndex, session.id]
    );

    return res.json({
      success: true,
      data: {
        status: updateResult.rows[0].status,
        sessionId: updateResult.rows[0].id,
        code: updateResult.rows[0].room_code,
        currentQuestionIndex: Number(updateResult.rows[0].current_question_index || nextIndex),
        totalQuestions,
        questionTimeSeconds: Number(updateResult.rows[0].question_time_seconds || DEFAULT_LIVE_QUESTION_SECONDS),
      },
      message: 'Keyingi savol boshlandi',
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/live/:code/answer', authenticateToken, async (req, res, next) => {
  try {
    if (req.user?.role !== 'student') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: "Bu endpoint faqat o'quvchilar uchun",
      });
    }

    const code = String(req.params.code || '').trim();
    const optionId = String(req.body?.optionId || '').trim();

    if (!ROOM_CODE_REGEX.test(code) || !optionId) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'code va optionId talab qilinadi',
      });
    }

    const session = await getSessionCoreByCode(code);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session topilmadi' });
    }

    if (session.status !== 'live') {
      return res.status(400).json({
        success: false,
        error: 'SESSION_NOT_LIVE',
        message: 'Quiz hali boshlanmagan yoki tugagan',
      });
    }

    const participantResult = await query(
      `
        SELECT id, player_name, score
        FROM quiz_live_participants
        WHERE session_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [session.id, req.user.id]
    );

    if (participantResult.rowCount === 0) {
      return res.status(403).json({
        success: false,
        error: 'NOT_JOINED',
        message: 'Avval sessiyaga qoshiling',
      });
    }

    const participant = participantResult.rows[0];
    const question = await getCurrentQuestionForSession(
      session.id,
      session.quiz_id,
      Number(session.current_question_index)
    );
    if (!question) {
      return res.status(400).json({
        success: false,
        error: 'NO_ACTIVE_QUESTION',
        message: 'Hozircha aktiv savol yoq',
      });
    }

    const existing = await query(
      `
        SELECT id
        FROM quiz_live_answers
        WHERE session_id = $1
          AND question_id = $2
          AND participant_id = $3
        LIMIT 1
      `,
      [session.id, question.id, participant.id]
    );

    if (existing.rowCount > 0) {
      return res.json({
        success: true,
        data: {
          accepted: false,
          alreadyAnswered: true,
          score: participant.score,
        },
      });
    }

    const selectedOption = question.options.find((option) => option.id === optionId);
    if (!selectedOption) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_OPTION',
        message: 'Tanlangan variant notogri',
      });
    }

    const correctOption = question.options.find((option) => option.isCorrect);
    const isCorrect = correctOption ? correctOption.id === optionId : false;
    const remaining = buildRemainingSeconds(session.question_started_at, session.question_time_seconds);

    // Allow answering even if timer hit 0; only speed bonus is removed.
    const timeBonus = remaining === null ? 0 : Math.max(0, remaining);
    const awarded = isCorrect ? Number(question.points || 10) + timeBonus : 0;

    await query(
      `
        INSERT INTO quiz_live_answers (
          session_id,
          question_id,
          participant_id,
          option_id,
          is_correct,
          points_awarded
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [session.id, question.id, participant.id, optionId, isCorrect, awarded]
    );

    const updatedParticipant = await query(
      `
        UPDATE quiz_live_participants
        SET score = score + $1
        WHERE id = $2
        RETURNING id, player_name, score
      `,
      [awarded, participant.id]
    );

    return res.json({
      success: true,
      data: {
        accepted: true,
        alreadyAnswered: false,
        isCorrect,
        awarded,
        score: updatedParticipant.rows[0]?.score || participant.score,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/live/:code/my-attempt', authenticateToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.user?.role !== 'student') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: "Bu endpoint faqat o'quvchilar uchun",
      });
    }

    const code = String(req.params.code || '').trim();
    if (!ROOM_CODE_REGEX.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CODE',
        message: '5 xonali kod kiriting',
      });
    }

    const session = await getSessionCoreByCode(code);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session topilmadi' });
    }

    const participantResult = await query(
      `
        SELECT id, player_name
        FROM quiz_live_participants
        WHERE session_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [session.id, req.user.id]
    );

    if (participantResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NO_RESULT',
        message: 'O\'chirish uchun quiz natijasi topilmadi',
      });
    }

    const participant = participantResult.rows[0];

    await client.query('BEGIN');

    const deletedAnswers = await client.query(
      `
        DELETE FROM quiz_live_answers
        WHERE session_id = $1
          AND participant_id = $2
      `,
      [session.id, participant.id]
    );

    const deletedParticipant = await client.query(
      `
        DELETE FROM quiz_live_participants
        WHERE id = $1
        RETURNING id, player_name
      `,
      [participant.id]
    );

    const remainingParticipantsResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM quiz_live_participants
        WHERE session_id = $1
      `,
      [session.id]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      data: {
        sessionId: session.id,
        code: session.room_code,
        participantId: deletedParticipant.rows[0]?.id || participant.id,
        playerName: deletedParticipant.rows[0]?.player_name || participant.player_name,
        deletedAnswers: deletedAnswers.rowCount,
        remainingParticipants: Number(remainingParticipantsResult.rows[0]?.count || 0),
      },
      message: 'Quiz natijasi o\'chirildi',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.use(authenticateToken, requireAdmin);

router.get('/:id/live/session', async (req, res, next) => {
  try {
    await ensureLiveSchema();

    const quizId = String(req.params.id);
    const sessionResult = await query(
      `
        SELECT id, room_code, status, current_question_index, question_time_seconds,
               started_at, question_started_at, finished_at, created_at
        FROM quiz_live_sessions
        WHERE quiz_id = $1
        ORDER BY
          CASE WHEN status IN ('waiting', 'live') THEN 0 ELSE 1 END,
          created_at DESC
        LIMIT 1
      `,
      [quizId]
    );

    if (sessionResult.rowCount === 0) {
      return res.json({ success: true, data: null });
    }

    const session = sessionResult.rows[0];
    const participantsResult = await query(
      `
        SELECT COUNT(*)::int AS count
        FROM quiz_live_participants
        WHERE session_id = $1
      `,
      [session.id]
    );

    return res.json({
      success: true,
      data: {
        sessionId: session.id,
        code: session.room_code,
        status: session.status,
        currentQuestionIndex: Number(session.current_question_index || 0),
        questionTimeSeconds: Number(session.question_time_seconds || DEFAULT_LIVE_QUESTION_SECONDS),
        participantsCount: Number(participantsResult.rows[0]?.count || 0),
        remainingSeconds: buildRemainingSeconds(session.question_started_at, session.question_time_seconds),
        createdAt: session.created_at,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/live/session', async (req, res, next) => {
  try {
    await ensureLiveSchema();

    const quizId = String(req.params.id);
    const timePerQuestion = Math.max(
      5,
      Math.min(120, Number(req.body?.timePerQuestion || DEFAULT_LIVE_QUESTION_SECONDS))
    );

    const quizResult = await query(
      `
        SELECT q.id, q.title
        FROM quizzes q
        WHERE q.id = $1
        LIMIT 1
      `,
      [quizId]
    );

    if (quizResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'QUIZ_NOT_FOUND',
        message: 'Quiz topilmadi',
      });
    }

    const questionsCountResult = await query(
      `
        SELECT COUNT(*)::int AS count
        FROM quiz_questions
        WHERE quiz_id = $1
      `,
      [quizId]
    );
    const totalQuestions = Number(questionsCountResult.rows[0]?.count || 0);
    if (totalQuestions === 0) {
      return res.status(400).json({
        success: false,
        error: 'NO_QUESTIONS',
        message: "Quizda kamida 1 ta savol bo'lishi kerak",
      });
    }

    await query(
      `
        UPDATE quiz_live_sessions
        SET status = 'finished', updated_at = NOW()
        WHERE quiz_id = $1
          AND status IN ('waiting', 'live')
      `,
      [quizId]
    );

    const code = await createUniqueRoomCode();
    const insertResult = await query(
      `
        INSERT INTO quiz_live_sessions (
          quiz_id,
          room_code,
          status,
          current_question_index,
          question_time_seconds,
          started_by,
          started_at,
          question_started_at,
          finished_at
        )
        VALUES ($1, $2, 'waiting', 0, $3, $4, NULL, NULL, NULL)
        RETURNING id, room_code, status, question_time_seconds, current_question_index, created_at
      `,
      [quizId, code, timePerQuestion, req.user.id]
    );

    return res.status(201).json({
      success: true,
      data: {
        sessionId: insertResult.rows[0].id,
        code: insertResult.rows[0].room_code,
        status: insertResult.rows[0].status,
        questionTimeSeconds: insertResult.rows[0].question_time_seconds,
        currentQuestionIndex: insertResult.rows[0].current_question_index,
        totalQuestions,
        quizTitle: quizResult.rows[0].title,
      },
      message: 'Jonli sessiya yaratildi',
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/live/:sessionId/start', async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getSessionCoreById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Session topilmadi',
      });
    }

    if (session.status === 'finished') {
      return res.status(400).json({
        success: false,
        error: 'SESSION_FINISHED',
        message: 'Session allaqachon tugagan',
      });
    }

    const totalQuestions = Number(session.total_questions || 0);
    if (totalQuestions === 0) {
      return res.status(400).json({
        success: false,
        error: 'NO_QUESTIONS',
        message: 'Savollar topilmadi',
      });
    }

    const nextIndex = session.status === 'live'
      ? Math.max(1, Number(session.current_question_index || 1))
      : 1;
    const updateResult = await query(
      `
        UPDATE quiz_live_sessions
        SET status = 'live',
            current_question_index = $1,
            started_at = COALESCE(started_at, NOW()),
            question_started_at = NOW(),
            finished_at = NULL,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, room_code, status, current_question_index, question_time_seconds, quiz_id
      `,
      [nextIndex, sessionId]
    );

    const updated = updateResult.rows[0];
    const question = await getCurrentQuestionByIndex(updated.quiz_id, Number(updated.current_question_index));

    return res.json({
      success: true,
      data: {
        sessionId: updated.id,
        code: updated.room_code,
        status: updated.status,
        currentQuestionIndex: Number(updated.current_question_index),
        questionTimeSeconds: Number(updated.question_time_seconds),
        totalQuestions,
        questionId: question?.id || null,
      },
      message: session.status === 'live' ? 'Taymer qayta boshlandi' : 'Quiz boshlandi',
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/live/:sessionId/next', async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getSessionCoreById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND', message: 'Session topilmadi' });
    }

    if (session.status !== 'live') {
      return res.status(400).json({
        success: false,
        error: 'SESSION_NOT_LIVE',
        message: 'Session live holatda emas',
      });
    }

    const remainingSeconds = buildRemainingSeconds(
      session.question_started_at,
      Number(session.question_time_seconds || DEFAULT_LIVE_QUESTION_SECONDS)
    );
    if (remainingSeconds !== null && remainingSeconds > 0) {
      return res.status(400).json({
        success: false,
        error: 'WAIT_FOR_TIMER',
        message: `Savol vaqti tugamaguncha kuting (${remainingSeconds}s)`,
      });
    }

    const totalQuestions = Number(session.total_questions || 0);
    const currentIndex = Number(session.current_question_index || 0);
    const nextIndex = currentIndex + 1;

    if (nextIndex > totalQuestions) {
      await query(
        `
          UPDATE quiz_live_sessions
          SET status = 'finished',
              finished_at = NOW(),
              question_started_at = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [sessionId]
      );

      return res.json({
        success: true,
        data: {
          sessionId,
          code: session.room_code,
          status: 'finished',
          currentQuestionIndex: currentIndex,
          totalQuestions,
        },
        message: 'Session yakunlandi',
      });
    }

    const updateResult = await query(
      `
        UPDATE quiz_live_sessions
        SET current_question_index = $1,
            question_started_at = NOW(),
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, room_code, status, current_question_index, question_time_seconds, quiz_id
      `,
      [nextIndex, sessionId]
    );

    const updated = updateResult.rows[0];
    const question = await getCurrentQuestionByIndex(updated.quiz_id, Number(updated.current_question_index));

    return res.json({
      success: true,
      data: {
        sessionId: updated.id,
        code: updated.room_code,
        status: updated.status,
        currentQuestionIndex: Number(updated.current_question_index),
        totalQuestions,
        questionTimeSeconds: Number(updated.question_time_seconds),
        questionId: question?.id || null,
      },
      message: 'Keyingi savolga otdi',
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/live/:sessionId/finish', async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getSessionCoreById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND', message: 'Session topilmadi' });
    }

    await query(
      `
        UPDATE quiz_live_sessions
        SET status = 'finished',
            finished_at = NOW(),
            question_started_at = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [sessionId]
    );

    return res.json({
      success: true,
      data: {
        sessionId,
        code: session.room_code,
        status: 'finished',
      },
      message: 'Session toxtatildi',
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/live/:sessionId/monitor', async (req, res, next) => {
  try {
    await ensureLiveSchema();

    const sessionId = String(req.params.sessionId);
    const session = await getSessionCoreById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND', message: 'Session topilmadi' });
    }

    const participantsResult = await query(
      `
        SELECT p.id,
               p.player_name,
               p.score,
               p.joined_at,
               u.full_name AS user_full_name,
               u.email AS user_email,
               COALESCE(stats.answered_count, 0)::int AS answered_count,
               COALESCE(stats.correct_answers, 0)::int AS correct_answers,
               (COALESCE(stats.answered_count, 0)::int - COALESCE(stats.correct_answers, 0)::int) AS incorrect_answers
        FROM quiz_live_participants p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN (
          SELECT participant_id,
                 COUNT(*)::int AS answered_count,
                 COALESCE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END), 0)::int AS correct_answers
          FROM quiz_live_answers
          WHERE session_id = $1
          GROUP BY participant_id
        ) stats ON stats.participant_id = p.id
        WHERE p.session_id = $1
        ORDER BY p.score DESC, p.joined_at ASC
      `,
      [sessionId]
    );

    const answersCountResult = await query(
      `
        SELECT COUNT(*)::int AS count
        FROM quiz_live_answers
        WHERE session_id = $1
          AND question_id = (
            SELECT qq.id
            FROM quiz_questions qq
            WHERE qq.quiz_id = $2
            ORDER BY qq.created_at ASC
            OFFSET $3 LIMIT 1
          )
      `,
      [sessionId, session.quiz_id, Math.max(0, Number(session.current_question_index || 1) - 1)]
    );

    return res.json({
      success: true,
      data: {
        sessionId: session.id,
        code: session.room_code,
        quizTitle: session.quiz_title,
        status: session.status,
        totalQuestions: Number(session.total_questions || 0),
        currentQuestionIndex: Number(session.current_question_index || 0),
        questionTimeSeconds: Number(session.question_time_seconds || DEFAULT_LIVE_QUESTION_SECONDS),
        remainingSeconds: buildRemainingSeconds(session.question_started_at, session.question_time_seconds),
        participants: participantsResult.rows,
        participantsCount: participantsResult.rowCount,
        currentQuestionAnswersCount: Number(answersCountResult.rows[0]?.count || 0),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    await ensureUzbHistoryQuizForTeacher(req.user.id);

    const result = await query(
      `
        SELECT q.id, q.title, q.course_id, q.time_limit_minutes, q.is_published, q.created_at,
               c.title AS course_title,
               COALESCE(qq.question_count, 0)::int AS question_count,
               COALESCE(qa.plays_count, 0)::int AS plays_count
        FROM quizzes q
        LEFT JOIN courses c ON c.id = q.course_id
        LEFT JOIN (
          SELECT quiz_id, COUNT(*)::int AS question_count
          FROM quiz_questions
          GROUP BY quiz_id
        ) qq ON qq.quiz_id = q.id
        LEFT JOIN (
          SELECT quiz_id, COUNT(*)::int AS plays_count
          FROM quiz_attempts
          GROUP BY quiz_id
        ) qa ON qa.quiz_id = q.id
        ORDER BY q.created_at DESC
      `
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const quizResult = await query(
      `
        SELECT q.id, q.title, q.time_limit_minutes, q.is_published, q.created_at,
               c.title AS course_title
        FROM quizzes q
        LEFT JOIN courses c ON c.id = q.course_id
        WHERE q.id = $1
        LIMIT 1
      `,
      [req.params.id]
    );

    if (quizResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Quiz not found',
      });
    }

    const questionsResult = await query(
      `
        SELECT id, question_text, points
        FROM quiz_questions
        WHERE quiz_id = $1
        ORDER BY created_at ASC
      `,
      [req.params.id]
    );

    const optionsResult = await query(
      `
        SELECT qo.id, qo.question_id, qo.option_text, qo.option_order, qo.is_correct
        FROM quiz_options qo
        JOIN quiz_questions qq ON qq.id = qo.question_id
        WHERE qq.quiz_id = $1
        ORDER BY qq.created_at ASC, qo.option_order ASC
      `,
      [req.params.id]
    );

    const optionsByQuestion = optionsResult.rows.reduce((acc, row) => {
      const list = acc.get(row.question_id) || [];
      list.push({
        id: row.id,
        optionText: row.option_text,
        optionOrder: row.option_order,
        isCorrect: row.is_correct,
      });
      acc.set(row.question_id, list);
      return acc;
    }, new Map());

    return res.json({
      success: true,
      data: {
        ...quizResult.rows[0],
        questions: questionsResult.rows.map((question) => ({
          id: question.id,
          questionText: question.question_text,
          points: question.points,
          options: optionsByQuestion.get(question.id) || [],
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { title, courseId = null, timeLimitMinutes = 15 } = req.body || {};

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'title is required',
      });
    }

    const result = await query(
      `
        INSERT INTO quizzes (teacher_id, course_id, title, time_limit_minutes)
        VALUES ($1, $2, $3, $4)
        RETURNING id, title, course_id, time_limit_minutes, is_published, created_at
      `,
      [req.user.id, courseId, title, timeLimitMinutes]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { title, courseId, timeLimitMinutes, isPublished } = req.body || {};
    const updates = [];
    const values = [];

    if (typeof title === 'string' && title.trim()) {
      values.push(title.trim());
      updates.push(`title = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'courseId')) {
      const normalizedCourseId = courseId || null;
      values.push(normalizedCourseId);
      updates.push(`course_id = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'timeLimitMinutes')) {
      const parsed = Number.parseInt(String(timeLimitMinutes), 10);
      values.push(Number.isNaN(parsed) ? 15 : parsed);
      updates.push(`time_limit_minutes = $${values.length}`);
    }

    if (typeof isPublished === 'boolean') {
      values.push(isPublished);
      updates.push(`is_published = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'At least one field is required',
      });
    }

    values.push(req.params.id);

    const result = await query(
      `
        UPDATE quizzes
        SET ${updates.join(', ')}
        WHERE id = $${values.length}
        RETURNING id, title, course_id, time_limit_minutes, is_published, created_at
      `,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Quiz not found',
      });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query(
      `
        DELETE FROM quizzes
        WHERE id = $1
        RETURNING id
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Quiz not found',
      });
    }

    return res.json({ success: true, data: { id: req.params.id } });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/questions', async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { questionText, points = 10, options = [] } = req.body || {};

    if (!questionText || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'questionText and at least 2 options are required',
      });
    }

    const correctCount = options.filter((option) => option.isCorrect).length;
    if (correctCount !== 1) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'Exactly one option must be correct',
      });
    }

    await client.query('BEGIN');

    const ownership = await client.query('SELECT id FROM quizzes WHERE id = $1 LIMIT 1', [req.params.id]);

    if (ownership.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Quiz not found',
      });
    }

    const questionResult = await client.query(
      `
        INSERT INTO quiz_questions (quiz_id, question_text, points)
        VALUES ($1, $2, $3)
        RETURNING id, question_text, points
      `,
      [req.params.id, questionText, points]
    );

    const question = questionResult.rows[0];

    const insertedOptions = [];
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      const optionResult = await client.query(
        `
          INSERT INTO quiz_options (question_id, option_text, is_correct, option_order)
          VALUES ($1, $2, $3, $4)
          RETURNING id, option_text, is_correct, option_order
        `,
        [question.id, option.text, Boolean(option.isCorrect), index + 1]
      );
      insertedOptions.push(optionResult.rows[0]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      data: {
        ...question,
        options: insertedOptions,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.put('/:id/questions/:questionId', async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { questionText, points = 10, options = [] } = req.body || {};

    if (!questionText || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'questionText and at least 2 options are required',
      });
    }

    const correctCount = options.filter((option) => option.isCorrect).length;
    if (correctCount !== 1) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'Exactly one option must be correct',
      });
    }

    await client.query('BEGIN');

    const ownership = await client.query(
      `
        SELECT qq.id
        FROM quiz_questions qq
        JOIN quizzes q ON q.id = qq.quiz_id
        WHERE qq.id = $1
          AND qq.quiz_id = $2
        LIMIT 1
      `,
      [req.params.questionId, req.params.id]
    );

    if (ownership.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Question not found',
      });
    }

    const questionResult = await client.query(
      `
        UPDATE quiz_questions
        SET question_text = $1,
            points = $2
        WHERE id = $3
        RETURNING id, question_text, points
      `,
      [questionText, points, req.params.questionId]
    );

    await client.query('DELETE FROM quiz_options WHERE question_id = $1', [req.params.questionId]);

    const insertedOptions = [];
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      const optionResult = await client.query(
        `
          INSERT INTO quiz_options (question_id, option_text, is_correct, option_order)
          VALUES ($1, $2, $3, $4)
          RETURNING id, option_text, is_correct, option_order
        `,
        [req.params.questionId, option.text, Boolean(option.isCorrect), index + 1]
      );
      insertedOptions.push(optionResult.rows[0]);
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      data: {
        ...questionResult.rows[0],
        options: insertedOptions,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.delete('/:id/questions/:questionId', async (req, res, next) => {
  try {
    const result = await query(
      `
        DELETE FROM quiz_questions
        WHERE id = $1
          AND quiz_id = $2
          AND quiz_id IN (SELECT id FROM quizzes WHERE id = $2)
        RETURNING id
      `,
      [req.params.questionId, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Question not found',
      });
    }

    return res.json({ success: true, data: { id: req.params.questionId } });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/publish', async (req, res, next) => {
  try {
    const result = await query(
      `
        UPDATE quizzes
        SET is_published = true
        WHERE id = $1
        RETURNING id, is_published
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Quiz not found',
      });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/attempts', async (req, res, next) => {
  try {
    const result = await query(
      `
        SELECT id, player_name, score, total_points, correct_answers, submitted_at
        FROM quiz_attempts
        WHERE quiz_id = $1
        ORDER BY submitted_at DESC
      `,
      [req.params.id]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

export default router;
