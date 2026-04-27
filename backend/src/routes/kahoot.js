import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

let io = null;
const sessionState = new Map();

export const setKahootSocket = (socketServer) => {
  io = socketServer;
};

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const buildPublicSession = (session) => ({
  id: session.id,
  pin: session.pin,
  title: session.title,
  status: session.status,
});

const generatePin = () => `${Math.floor(100000 + Math.random() * 900000)}`;

const createUniquePin = async () => {
  for (let i = 0; i < 10; i += 1) {
    const pin = generatePin();
    const exists = await query(
      `
        SELECT 1
        FROM kahoot_sessions
        WHERE pin = $1
          AND status IN ('draft', 'live')
        LIMIT 1
      `,
      [pin]
    );

    if (exists.rowCount === 0) {
      return pin;
    }
  }

  throw new Error('Unable to generate unique PIN');
};

const getSessionByPin = async (pin) => {
  const result = await query(
    `
      SELECT id, title, pin, status, teacher_id
      FROM kahoot_sessions
      WHERE pin = $1
      LIMIT 1
    `,
    [pin]
  );

  return result.rows[0] || null;
};

const getOwnedSession = async (sessionId, teacherId) => {
  const result = await query(
    `
      SELECT id, title, pin, status
      FROM kahoot_sessions
      WHERE id = $1
        AND teacher_id = $2
      LIMIT 1
    `,
    [sessionId, teacherId]
  );

  return result.rows[0] || null;
};

const getSessionById = async (sessionId) => {
  const result = await query(
    `
      SELECT id, title, pin, status, teacher_id
      FROM kahoot_sessions
      WHERE id = $1
      LIMIT 1
    `,
    [sessionId]
  );

  return result.rows[0] || null;
};

const getQuestions = async (sessionId) => {
  const result = await query(
    `
      SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option, time_limit_seconds, points, created_at
      FROM kahoot_questions
      WHERE session_id = $1
      ORDER BY created_at ASC
    `,
    [sessionId]
  );

  return result.rows;
};

const getParticipantCount = async (sessionId) => {
  const result = await query(
    `
      SELECT COUNT(*) AS count
      FROM kahoot_scores
      WHERE session_id = $1
    `,
    [sessionId]
  );

  return toInt(result.rows[0]?.count, 0);
};

const getQuestionAnswerCount = async (sessionId, questionId) => {
  if (!questionId) {
    return 0;
  }

  const result = await query(
    `
      SELECT COUNT(*) AS count
      FROM kahoot_answers
      WHERE session_id = $1
        AND question_id = $2
    `,
    [sessionId, questionId]
  );

  return toInt(result.rows[0]?.count, 0);
};

const getLeaderboardRows = async (sessionId, limit = 20) => {
  const result = await query(
    `
      SELECT player_name, score, updated_at
      FROM kahoot_scores
      WHERE session_id = $1
      ORDER BY score DESC, updated_at ASC
      LIMIT $2
    `,
    [sessionId, limit]
  );

  return result.rows.map((row) => ({
    player_name: row.player_name,
    score: toInt(row.score, 0),
  }));
};

const getLeaderboardWithStats = async (sessionId, limit = 20) => {
  const result = await query(
    `
      SELECT
        s.player_name,
        s.score,
        COALESCE(stats.correct_answers, 0) AS correct_answers,
        COALESCE(stats.incorrect_answers, 0) AS incorrect_answers,
        s.updated_at
      FROM kahoot_scores s
      LEFT JOIN (
        SELECT
          player_name,
          SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) AS correct_answers,
          SUM(CASE WHEN is_correct THEN 0 ELSE 1 END) AS incorrect_answers
        FROM kahoot_answers
        WHERE session_id = $1
        GROUP BY player_name
      ) stats
        ON stats.player_name = s.player_name
      WHERE s.session_id = $1
      ORDER BY s.score DESC, s.updated_at ASC
      LIMIT $2
    `,
    [sessionId, limit]
  );

  return result.rows.map((row) => ({
    player_name: row.player_name,
    score: toInt(row.score, 0),
    correct_answers: toInt(row.correct_answers, 0),
    incorrect_answers: toInt(row.incorrect_answers, 0),
  }));
};

const getParticipantRows = async (sessionId, limit = 100) => {
  const rows = await getLeaderboardWithStats(sessionId, limit);
  return rows;
};

const getPlayerSummary = async (sessionId, playerName) => {
  const normalizedPlayer = String(playerName || '').trim();
  if (!normalizedPlayer) {
    return null;
  }

  const scoreResult = await query(
    `
      SELECT player_name, score
      FROM kahoot_scores
      WHERE session_id = $1
        AND lower(player_name) = lower($2)
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [sessionId, normalizedPlayer]
  );

  if (scoreResult.rowCount === 0) {
    return null;
  }

  const answerStatsResult = await query(
    `
      SELECT
        SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) AS correct_answers,
        SUM(CASE WHEN is_correct THEN 0 ELSE 1 END) AS incorrect_answers
      FROM kahoot_answers
      WHERE session_id = $1
        AND lower(player_name) = lower($2)
    `,
    [sessionId, normalizedPlayer]
  );

  return {
    playerName: scoreResult.rows[0].player_name,
    score: toInt(scoreResult.rows[0].score, 0),
    correctAnswers: toInt(answerStatsResult.rows[0]?.correct_answers, 0),
    incorrectAnswers: toInt(answerStatsResult.rows[0]?.incorrect_answers, 0),
  };
};

const toPublicQuestion = (question) => ({
  id: question.id,
  questionText: question.question_text,
  optionA: question.option_a,
  optionB: question.option_b,
  optionC: question.option_c,
  optionD: question.option_d,
  timeLimitSeconds: question.time_limit_seconds,
  points: question.points,
});

const setCurrentQuestionState = (sessionId, questionId) => {
  sessionState.set(sessionId, {
    questionId,
    questionStartedAt: Date.now(),
  });
};

const getQuestionRemainingSeconds = (questionStartedAt, questionTimeLimit) => {
  const limitSeconds = Math.max(0, toInt(questionTimeLimit, 0));

  if (!questionStartedAt) {
    return limitSeconds;
  }

  const elapsedSeconds = Math.floor((Date.now() - Number(questionStartedAt)) / 1000);
  return Math.max(0, limitSeconds - elapsedSeconds);
};

const resolveCurrentQuestionState = async (sessionId) => {
  const questions = await getQuestions(sessionId);

  if (questions.length === 0) {
    return {
      questions,
      question: null,
      index: -1,
      total: 0,
      remainingSeconds: 0,
    };
  }

  let state = sessionState.get(sessionId);

  if (!state?.questionId) {
    setCurrentQuestionState(sessionId, questions[0].id);
    state = sessionState.get(sessionId);
  }

  let index = questions.findIndex((question) => question.id === state.questionId);
  if (index < 0) {
    setCurrentQuestionState(sessionId, questions[0].id);
    state = sessionState.get(sessionId);
    index = 0;
  }

  const question = questions[index];
  const remainingSeconds = getQuestionRemainingSeconds(state.questionStartedAt, question.time_limit_seconds);

  return {
    questions,
    question,
    index,
    total: questions.length,
    remainingSeconds,
  };
};

const normalizeOption = (value) => String(value || '').trim().toUpperCase();

const getRankFromLeaderboard = (leaderboard, playerName) => {
  const normalizedName = String(playerName || '').trim().toLowerCase();
  if (!normalizedName) {
    return null;
  }

  const index = leaderboard.findIndex(
    (item) => String(item.player_name || '').trim().toLowerCase() === normalizedName
  );

  return index >= 0 ? index + 1 : null;
};

const emitLeaderboard = async (sessionId, pin) => {
  if (!io) {
    return;
  }

  const rows = await getLeaderboardRows(sessionId, 20);
  io.to(`kahoot-pin:${pin}`).emit('kahoot:leaderboard', rows);
  io.to(`kahoot-session:${sessionId}`).emit('kahoot:leaderboard', rows);
};

const emitCurrentQuestion = (sessionId, pin, question) => {
  if (!io) {
    return;
  }

  io.to(`kahoot-pin:${pin}`).emit('kahoot:question', question);
  io.to(`kahoot-session:${sessionId}`).emit('kahoot:question', question);
};

const emitQuestionStats = (sessionId, pin, payload) => {
  if (!io) {
    return;
  }

  io.to(`kahoot-pin:${pin}`).emit('kahoot:question-stats', payload);
  io.to(`kahoot-session:${sessionId}`).emit('kahoot:question-stats', payload);
};

router.post('/join', async (req, res, next) => {
  try {
    const { pin, playerName } = req.body || {};
    const normalizedPin = String(pin || '').trim();
    const normalizedPlayerName = String(playerName || '').trim();

    if (!normalizedPin || !normalizedPlayerName) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'pin and playerName are required',
      });
    }

    const session = await getSessionByPin(normalizedPin);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Session not found',
      });
    }

    if (session.status === 'finished') {
      return res.status(409).json({
        success: false,
        error: 'SESSION_FINISHED',
        message: 'This session is already finished',
      });
    }

    await query(
      `
        INSERT INTO kahoot_scores (session_id, player_name, score)
        VALUES ($1, $2, 0)
        ON CONFLICT (session_id, player_name)
        DO UPDATE SET updated_at = NOW()
      `,
      [session.id, normalizedPlayerName]
    );

    const participantCount = await getParticipantCount(session.id);
    await emitLeaderboard(session.id, session.pin);

    return res.json({
      success: true,
      data: {
        session: buildPublicSession(session),
        participantCount,
        playerName: normalizedPlayerName,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/live/:pin/current-question', async (req, res, next) => {
  try {
    const session = await getSessionByPin(req.params.pin);
    const playerName = String(req.query.playerName || '').trim();

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Session not found',
      });
    }

    const participantCount = await getParticipantCount(session.id);

    if (session.status === 'draft') {
      const questions = await getQuestions(session.id);

      return res.json({
        success: true,
        data: {
          session: buildPublicSession(session),
          question: null,
          progress: {
            current: 0,
            total: questions.length,
          },
          remainingSeconds: 0,
          participantCount,
          answerCount: 0,
          alreadyAnswered: false,
        },
      });
    }

    if (session.status === 'finished') {
      const questions = await getQuestions(session.id);
      const leaderboard = await getLeaderboardWithStats(session.id, 20);
      const playerSummary = playerName ? await getPlayerSummary(session.id, playerName) : null;
      const rank = playerSummary
        ? getRankFromLeaderboard(leaderboard, playerSummary.playerName)
        : null;

      return res.json({
        success: true,
        data: {
          session: buildPublicSession(session),
          question: null,
          progress: {
            current: questions.length,
            total: questions.length,
          },
          remainingSeconds: 0,
          participantCount,
          answerCount: 0,
          alreadyAnswered: true,
          leaderboard,
          playerSummary,
          rank,
        },
      });
    }

    const currentState = await resolveCurrentQuestionState(session.id);
    if (!currentState.question) {
      return res.json({
        success: true,
        data: {
          session: buildPublicSession(session),
          question: null,
          progress: {
            current: 0,
            total: 0,
          },
          remainingSeconds: 0,
          participantCount,
          answerCount: 0,
          alreadyAnswered: false,
        },
      });
    }

    const answerCount = await getQuestionAnswerCount(session.id, currentState.question.id);
    let alreadyAnswered = false;

    if (playerName) {
      const answeredCheck = await query(
        `
          SELECT 1
          FROM kahoot_answers
          WHERE session_id = $1
            AND question_id = $2
            AND lower(player_name) = lower($3)
          LIMIT 1
        `,
        [session.id, currentState.question.id, playerName]
      );

      alreadyAnswered = answeredCheck.rowCount > 0;
    }

    const playerSummary = playerName ? await getPlayerSummary(session.id, playerName) : null;
    let rank = null;
    if (playerSummary) {
      const leaderboard = await getLeaderboardRows(session.id, 300);
      rank = getRankFromLeaderboard(leaderboard, playerSummary.playerName);
    }

    return res.json({
      success: true,
      data: {
        session: buildPublicSession(session),
        question: toPublicQuestion(currentState.question),
        progress: {
          current: currentState.index + 1,
          total: currentState.total,
        },
        remainingSeconds: currentState.remainingSeconds,
        participantCount,
        answerCount,
        alreadyAnswered,
        playerSummary,
        rank,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/live/:pin/answer', async (req, res, next) => {
  try {
    const { playerName, questionId, selectedOption } = req.body || {};
    const normalizedPlayerName = String(playerName || '').trim();
    const normalizedQuestionId = String(questionId || '').trim();

    if (!normalizedPlayerName || !normalizedQuestionId || !selectedOption) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'pin, playerName, questionId, selectedOption are required',
      });
    }

    const session = await getSessionByPin(req.params.pin);
    if (!session || session.status !== 'live') {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'No live session with this PIN',
      });
    }

    const currentState = await resolveCurrentQuestionState(session.id);
    if (!currentState.question || currentState.question.id !== normalizedQuestionId) {
      return res.status(409).json({
        success: false,
        error: 'QUESTION_CLOSED',
        message: 'This question is no longer active',
      });
    }

    if (currentState.remainingSeconds <= 0) {
      return res.status(409).json({
        success: false,
        error: 'QUESTION_CLOSED',
        message: 'Question timer is over',
      });
    }

    const normalizedOption = normalizeOption(selectedOption);
    if (!['A', 'B', 'C', 'D'].includes(normalizedOption)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_OPTION',
        message: 'selectedOption must be A, B, C or D',
      });
    }

    const duplicateCheck = await query(
      `
        SELECT id
        FROM kahoot_answers
        WHERE session_id = $1
          AND question_id = $2
          AND lower(player_name) = lower($3)
        LIMIT 1
      `,
      [session.id, currentState.question.id, normalizedPlayerName]
    );

    if (duplicateCheck.rowCount > 0) {
      return res.status(409).json({
        success: false,
        error: 'ALREADY_ANSWERED',
        message: 'This player already answered current question',
      });
    }

    const isCorrect = normalizeOption(currentState.question.correct_option) === normalizedOption;
    const pointsAwarded = isCorrect ? toInt(currentState.question.points, 0) : 0;

    await query(
      `
        INSERT INTO kahoot_answers (
          session_id,
          question_id,
          player_name,
          selected_option,
          is_correct,
          points_awarded
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        session.id,
        currentState.question.id,
        normalizedPlayerName,
        normalizedOption,
        isCorrect,
        pointsAwarded,
      ]
    );

    await query(
      `
        INSERT INTO kahoot_scores (session_id, player_name, score)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, player_name)
        DO UPDATE SET
          score = kahoot_scores.score + EXCLUDED.score,
          updated_at = NOW()
      `,
      [session.id, normalizedPlayerName, pointsAwarded]
    );

    const participantCount = await getParticipantCount(session.id);
    const answerCount = await getQuestionAnswerCount(session.id, currentState.question.id);
    const playerSummary = await getPlayerSummary(session.id, normalizedPlayerName);
    const leaderboardRows = await getLeaderboardRows(session.id, 300);
    const rank = playerSummary
      ? getRankFromLeaderboard(leaderboardRows, playerSummary.playerName)
      : null;

    await emitLeaderboard(session.id, session.pin);
    emitQuestionStats(session.id, session.pin, {
      questionId: currentState.question.id,
      answerCount,
      participantCount,
      totalNeeded: participantCount,
    });

    return res.json({
      success: true,
      data: {
        isCorrect,
        pointsAwarded,
        participantCount,
        answerCount,
        remainingSeconds: currentState.remainingSeconds,
        playerSummary,
        rank,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/answer', async (req, res, next) => {
  try {
    const { pin, playerName, isCorrect = false } = req.body || {};

    if (!pin || !playerName) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'pin and playerName are required',
      });
    }

    const session = await getSessionByPin(pin);
    if (!session || session.status !== 'live') {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'No live session with this PIN',
      });
    }

    const points = isCorrect ? 100 : 0;

    await query(
      `
        INSERT INTO kahoot_scores (session_id, player_name, score)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, player_name)
        DO UPDATE SET
          score = kahoot_scores.score + EXCLUDED.score,
          updated_at = NOW()
      `,
      [session.id, playerName, points]
    );

    await emitLeaderboard(session.id, session.pin);

    return res.json({ success: true, data: { pointsAwarded: points } });
  } catch (error) {
    return next(error);
  }
});

router.get('/leaderboard/:pin', async (req, res, next) => {
  try {
    const pin = req.params.pin;

    const sessionResult = await query(
      'SELECT id FROM kahoot_sessions WHERE pin = $1 LIMIT 1',
      [pin]
    );

    if (sessionResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Session not found',
      });
    }

    const leaderboard = await getLeaderboardWithStats(sessionResult.rows[0].id, 100);

    return res.json({ success: true, data: leaderboard });
  } catch (error) {
    return next(error);
  }
});

router.use(authenticateToken, requireAdmin);

router.get('/sessions', async (req, res, next) => {
  try {
    const result = await query(
      `
        SELECT id, title, pin, status, created_at
        FROM kahoot_sessions
        WHERE teacher_id = $1
        ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions', async (req, res, next) => {
  try {
    const { title } = req.body || {};

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'title is required',
      });
    }

    const pin = await createUniquePin();

    const result = await query(
      `
        INSERT INTO kahoot_sessions (teacher_id, title, pin)
        VALUES ($1, $2, $3)
        RETURNING id, title, pin, status, created_at
      `,
      [req.user.id, title, pin]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions/:id/questions', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      questionText,
      optionA,
      optionB,
      optionC,
      optionD,
      correctOption,
      timeLimitSeconds = 30,
      points = 100,
    } = req.body || {};

    const normalizedCorrect = normalizeOption(correctOption);

    if (!questionText || !optionA || !optionB || !optionC || !optionD || !normalizedCorrect) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'Question and all options are required',
      });
    }

    if (!['A', 'B', 'C', 'D'].includes(normalizedCorrect)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_OPTION',
        message: 'correctOption must be A, B, C, or D',
      });
    }

    const session = await getOwnedSession(id, req.user.id);

    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session not found' });
    }

    const result = await query(
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, question_text, correct_option, time_limit_seconds, points
      `,
      [id, questionText, optionA, optionB, optionC, optionD, normalizedCorrect, timeLimitSeconds, points]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/sessions/:id/questions', async (req, res, next) => {
  try {
    const session = await getOwnedSession(req.params.id, req.user.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session not found' });
    }

    const questions = await getQuestions(session.id);
    return res.json({
      success: true,
      data: questions.map((question) => ({
        id: question.id,
        questionText: question.question_text,
        optionA: question.option_a,
        optionB: question.option_b,
        optionC: question.option_c,
        optionD: question.option_d,
        correctOption: question.correct_option,
        timeLimitSeconds: question.time_limit_seconds,
        points: question.points,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions/:id/start', async (req, res, next) => {
  try {
    const ownedSession = await getOwnedSession(req.params.id, req.user.id);
    if (!ownedSession) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session not found' });
    }

    const questions = await getQuestions(ownedSession.id);
    if (questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'NO_QUESTION',
        message: 'Session has no questions yet',
      });
    }

    const result = await query(
      `
        UPDATE kahoot_sessions
        SET status = 'live'
        WHERE id = $1
          AND teacher_id = $2
        RETURNING id, title, pin, status
      `,
      [ownedSession.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session not found' });
    }

    const session = result.rows[0];
    await query('DELETE FROM kahoot_answers WHERE session_id = $1', [session.id]);
    await query(
      `
        UPDATE kahoot_scores
        SET score = 0,
            updated_at = NOW()
        WHERE session_id = $1
      `,
      [session.id]
    );

    const currentQuestion = questions[0];
    setCurrentQuestionState(session.id, currentQuestion.id);
    const participantCount = await getParticipantCount(session.id);

    if (io) {
      io.to(`kahoot-pin:${session.pin}`).emit('kahoot:started', session);
      io.to(`kahoot-session:${session.id}`).emit('kahoot:started', session);

      emitCurrentQuestion(session.id, session.pin, toPublicQuestion(currentQuestion));
      await emitLeaderboard(session.id, session.pin);
      emitQuestionStats(session.id, session.pin, {
        questionId: currentQuestion.id,
        answerCount: 0,
        participantCount,
        totalNeeded: participantCount,
      });
    }

    return res.json({
      success: true,
      data: {
        ...session,
        currentQuestion: currentQuestion ? toPublicQuestion(currentQuestion) : null,
        progress: {
          current: currentQuestion ? 1 : 0,
          total: questions.length,
        },
        remainingSeconds: currentQuestion ? toInt(currentQuestion.time_limit_seconds, 0) : 0,
        participantCount,
        answerCount: 0,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/sessions/:id/current-question', async (req, res, next) => {
  try {
    const session = await getOwnedSession(req.params.id, req.user.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session not found' });
    }

    const participantCount = await getParticipantCount(session.id);

    if (session.status !== 'live') {
      const questions = await getQuestions(session.id);
      const currentProgress = session.status === 'finished' ? questions.length : 0;

      return res.json({
        success: true,
        data: {
          session: buildPublicSession(session),
          question: null,
          progress: {
            current: currentProgress,
            total: questions.length,
          },
          remainingSeconds: 0,
          participantCount,
          answerCount: 0,
        },
      });
    }

    const currentState = await resolveCurrentQuestionState(session.id);
    const answerCount = await getQuestionAnswerCount(session.id, currentState.question?.id);

    return res.json({
      success: true,
      data: {
        session: buildPublicSession(session),
        question: currentState.question ? toPublicQuestion(currentState.question) : null,
        progress: {
          current: currentState.question ? currentState.index + 1 : 0,
          total: currentState.total,
        },
        remainingSeconds: currentState.remainingSeconds,
        participantCount,
        answerCount,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/sessions/:id/monitor', async (req, res, next) => {
  try {
    const session = await getOwnedSession(req.params.id, req.user.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session not found' });
    }

    const participants = await getParticipantRows(session.id, 200);
    const participantCount = participants.length;
    const questions = await getQuestions(session.id);

    let currentQuestion = null;
    let progress = { current: 0, total: questions.length };
    let remainingSeconds = 0;
    let answerCount = 0;

    if (session.status === 'live') {
      const currentState = await resolveCurrentQuestionState(session.id);
      currentQuestion = currentState.question ? toPublicQuestion(currentState.question) : null;
      progress = {
        current: currentState.question ? currentState.index + 1 : 0,
        total: currentState.total,
      };
      remainingSeconds = currentState.remainingSeconds;
      answerCount = await getQuestionAnswerCount(session.id, currentState.question?.id);
    }

    if (session.status === 'finished') {
      progress = {
        current: questions.length,
        total: questions.length,
      };
    }

    return res.json({
      success: true,
      data: {
        session: buildPublicSession(session),
        currentQuestion,
        progress,
        remainingSeconds,
        participantCount,
        answerCount,
        participants,
        leaderboard: participants.slice(0, 10),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions/:id/next-question', async (req, res, next) => {
  try {
    const session = await getOwnedSession(req.params.id, req.user.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session not found' });
    }

    if (session.status !== 'live') {
      return res.status(409).json({
        success: false,
        error: 'SESSION_NOT_LIVE',
        message: 'Session must be live before moving to next question',
      });
    }

    const currentState = await resolveCurrentQuestionState(session.id);
    if (currentState.total === 0) {
      return res.status(404).json({
        success: false,
        error: 'NO_QUESTION',
        message: 'Session has no questions yet',
      });
    }

    const nextIndex = currentState.index + 1;

    if (nextIndex >= currentState.total) {
      const finishedResult = await query(
        `
          UPDATE kahoot_sessions
          SET status = 'finished'
          WHERE id = $1
            AND teacher_id = $2
          RETURNING id, title, pin, status
        `,
        [session.id, req.user.id]
      );

      sessionState.delete(session.id);
      const finalLeaderboard = await getLeaderboardWithStats(session.id, 20);

      if (io && finishedResult.rowCount > 0) {
        const finishedSession = finishedResult.rows[0];
        io.to(`kahoot-pin:${finishedSession.pin}`).emit('kahoot:finished', finishedSession);
        io.to(`kahoot-session:${finishedSession.id}`).emit('kahoot:finished', finishedSession);
      }

      await emitLeaderboard(session.id, session.pin);

      return res.json({
        success: true,
        data: {
          finished: true,
          question: null,
          message: 'Session finished',
          leaderboard: finalLeaderboard,
        },
      });
    }

    const nextQuestion = currentState.questions[nextIndex];
    setCurrentQuestionState(session.id, nextQuestion.id);
    const participantCount = await getParticipantCount(session.id);

    emitCurrentQuestion(session.id, session.pin, toPublicQuestion(nextQuestion));
    emitQuestionStats(session.id, session.pin, {
      questionId: nextQuestion.id,
      answerCount: 0,
      participantCount,
      totalNeeded: participantCount,
    });

    return res.json({
      success: true,
      data: {
        finished: false,
        question: toPublicQuestion(nextQuestion),
        progress: {
          current: nextIndex + 1,
          total: currentState.total,
        },
        remainingSeconds: toInt(nextQuestion.time_limit_seconds, 0),
        answerCount: 0,
        participantCount,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions/:id/finish', async (req, res, next) => {
  try {
    const result = await query(
      `
        UPDATE kahoot_sessions
        SET status = 'finished'
        WHERE id = $1
          AND teacher_id = $2
        RETURNING id, title, pin, status
      `,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session not found' });
    }

    const session = result.rows[0];
    sessionState.delete(session.id);
    const leaderboard = await getLeaderboardWithStats(session.id, 20);

    if (io) {
      io.to(`kahoot-pin:${session.pin}`).emit('kahoot:finished', session);
      io.to(`kahoot-session:${session.id}`).emit('kahoot:finished', session);
    }

    await emitLeaderboard(session.id, session.pin);

    return res.json({
      success: true,
      data: {
        session,
        leaderboard,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/sessions/:id/leaderboard', async (req, res, next) => {
  try {
    const session = await getSessionById(req.params.id);

    if (!session || session.teacher_id !== req.user.id) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session not found' });
    }

    const leaderboard = await getLeaderboardWithStats(req.params.id, 200);

    return res.json({ success: true, data: leaderboard });
  } catch (error) {
    return next(error);
  }
});

export default router;
