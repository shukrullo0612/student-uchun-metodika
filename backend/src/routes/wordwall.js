import express from 'express';
import { query, pool } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
const LIVE_CODE_REGEX = /^\d{5}$/;

let liveSchemaReadyPromise = null;

const ensureLiveSchema = async () => {
  if (liveSchemaReadyPromise) {
    return liveSchemaReadyPromise;
  }

  liveSchemaReadyPromise = (async () => {
    try {
      await query('SELECT 1 FROM wordwall_live_sessions LIMIT 1');
      await query('SELECT 1 FROM wordwall_live_participants LIMIT 1');
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('does not exist') || message.includes('relation') || message.includes('table')) {
        const schemaError = new Error('Wordwall live jadvallari topilmadi. Backendni qayta ishga tushiring.');
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

const generateWordwallPin = () => `${Math.floor(10000 + Math.random() * 90000)}`;

const generateLiveCode = () => `${Math.floor(10000 + Math.random() * 90000)}`;

const getUniqueWordwallPin = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const pin = generateWordwallPin();
    const exists = await query('SELECT 1 FROM wordwall_sets WHERE pin = $1 LIMIT 1', [pin]);
    if (exists.rowCount === 0) {
      return pin;
    }
  }

  throw new Error('Unable to generate unique Wordwall PIN');
};

const getUniqueLiveCode = async () => {
  await ensureLiveSchema();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const code = generateLiveCode();
    const exists = await query('SELECT 1 FROM wordwall_live_sessions WHERE room_code = $1 LIMIT 1', [code]);
    if (exists.rowCount === 0) {
      return code;
    }
  }

  throw new Error('Unable to generate unique Wordwall live code');
};

const getSessionByCode = async (code) => {
  await ensureLiveSchema();

  const result = await query(
    `
      SELECT ls.id, ls.set_id, ls.room_code, ls.status,
             ls.started_at, ls.finished_at, ls.created_at,
             ws.title AS set_title, ws.pin AS set_pin, ws.template_type
      FROM wordwall_live_sessions ls
      JOIN wordwall_sets ws ON ws.id = ls.set_id
      WHERE ls.room_code = $1
      LIMIT 1
    `,
    [code]
  );

  return result.rows[0] || null;
};

const getSessionByIdForTeacher = async (sessionId, teacherId) => {
  await ensureLiveSchema();

  const result = await query(
    `
      SELECT ls.id, ls.set_id, ls.room_code, ls.status,
             ls.started_at, ls.finished_at, ls.created_at,
             ws.title AS set_title, ws.pin AS set_pin, ws.template_type
      FROM wordwall_live_sessions ls
      JOIN wordwall_sets ws ON ws.id = ls.set_id
      WHERE ls.id = $1
        AND ws.teacher_id = $2
      LIMIT 1
    `,
    [sessionId, teacherId]
  );

  return result.rows[0] || null;
};

const getSetByPin = async (pin) => {
  const result = await query(
    `
      SELECT id, title, pin, teacher_id
      FROM wordwall_sets
      WHERE pin = $1
      LIMIT 1
    `,
    [pin]
  );

  return result.rows[0] || null;
};

const getOrCreateLiveSessionForSet = async (setId, roomCode) => {
  await ensureLiveSchema();

  const existing = await query(
    `
      SELECT id, set_id, room_code, status, started_at, finished_at, created_at
      FROM wordwall_live_sessions
      WHERE set_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [setId]
  );

  if (existing.rowCount > 0) {
    const current = existing.rows[0];
    if (current.room_code !== roomCode) {
      const updated = await query(
        `
          UPDATE wordwall_live_sessions
          SET room_code = $2,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, set_id, room_code, status, started_at, finished_at, created_at
        `,
        [current.id, roomCode]
      );

      return updated.rows[0];
    }

    return current;
  }

  const created = await query(
    `
      INSERT INTO wordwall_live_sessions (set_id, room_code, status)
      VALUES ($1, $2, 'waiting')
      RETURNING id, set_id, room_code, status, started_at, finished_at, created_at
    `,
    [setId, roomCode]
  );

  return created.rows[0];
};

const parseMcqPayload = (rawAnswer) => {
  try {
    const parsed = JSON.parse(rawAnswer);
    const options = parsed?.options;
    const hasOptions =
      options &&
      typeof options === 'object' &&
      ['A', 'B', 'C', 'D'].every((key) => typeof options[key] === 'string' && options[key].trim());

    if (parsed?.format === 'mcq' && hasOptions && ['A', 'B', 'C', 'D'].includes(parsed.correctOption)) {
      return {
        options: {
          A: options.A.trim(),
          B: options.B.trim(),
          C: options.C.trim(),
          D: options.D.trim(),
        },
        correctOption: parsed.correctOption,
      };
    }
  } catch (error) {
    return null;
  }

  return null;
};

const normalizeAnagramPhrase = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const normalizeAnagramComparable = (value) =>
  normalizeAnagramPhrase(value)
    .toLowerCase()
    .replace(/\s+/g, '');

const shuffleAnagramWord = (word) => {
  const raw = String(word || '').trim();
  if (raw.length <= 1) {
    return raw;
  }

  let shuffled = raw;
  for (let attempt = 0; attempt < 8 && shuffled.toLowerCase() === raw.toLowerCase(); attempt += 1) {
    const chars = raw.split('');
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    shuffled = chars.join('');
  }

  if (shuffled.toLowerCase() === raw.toLowerCase()) {
    shuffled = raw.split('').reverse().join('');
  }

  return shuffled;
};

const buildPublicAnagramMeta = (answer) => {
  const normalized = normalizeAnagramPhrase(answer);
  if (!normalized) {
    return {
      anagram_seed: '',
      word_lengths: [],
    };
  }

  const words = normalized.split(' ').filter(Boolean);
  const seedWords = words.map((word) => shuffleAnagramWord(word));

  return {
    anagram_seed: seedWords.join(' '),
    word_lengths: words.map((word) => word.length),
  };
};

router.get('/public/:setId', async (req, res, next) => {
  try {
    const setResult = await query(
      `
        SELECT id, title, template_type, clue_mode, pin, created_at
        FROM wordwall_sets
        WHERE id = $1
        LIMIT 1
      `,
      [req.params.setId]
    );

    if (setResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Set not found',
      });
    }

    const itemsResult = await query(
      `
        SELECT id, prompt, answer
        FROM wordwall_items
        WHERE set_id = $1
        ORDER BY created_at ASC
      `,
      [req.params.setId]
    );

    const publicItems = itemsResult.rows.map((item) => {
      const mcq = parseMcqPayload(item.answer);
      if (!mcq) {
        const anagramMeta = buildPublicAnagramMeta(item.answer);
        return {
          id: item.id,
          prompt: item.prompt,
          options: null,
          anagram_seed: anagramMeta.anagram_seed,
          word_lengths: anagramMeta.word_lengths,
          expected_answer: normalizeAnagramPhrase(item.answer),
        };
      }

      return {
        id: item.id,
        prompt: item.prompt,
        options: mcq.options,
      };
    });

    return res.json({
      success: true,
      data: {
        ...setResult.rows[0],
        items: publicItems,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/public-by-pin/:pin', async (req, res, next) => {
  try {
    const pin = String(req.params.pin || '').trim();
    if (!/^\d{5}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PIN',
        message: '5 xonali PIN kiriting',
      });
    }

    const setResult = await query(
      `
        SELECT id, title, template_type, clue_mode, pin, created_at
        FROM wordwall_sets
        WHERE pin = $1
        LIMIT 1
      `,
      [pin]
    );

    if (setResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Bunday PIN bilan Wordwall topilmadi',
      });
    }

    const setId = setResult.rows[0].id;
    const itemsResult = await query(
      `
        SELECT id, prompt, answer
        FROM wordwall_items
        WHERE set_id = $1
        ORDER BY created_at ASC
      `,
      [setId]
    );

    const publicItems = itemsResult.rows.map((item) => {
      const mcq = parseMcqPayload(item.answer);
      if (!mcq) {
        const anagramMeta = buildPublicAnagramMeta(item.answer);
        return {
          id: item.id,
          prompt: item.prompt,
          options: null,
          anagram_seed: anagramMeta.anagram_seed,
          word_lengths: anagramMeta.word_lengths,
          expected_answer: normalizeAnagramPhrase(item.answer),
        };
      }

      return {
        id: item.id,
        prompt: item.prompt,
        options: mcq.options,
      };
    });

    return res.json({
      success: true,
      data: {
        ...setResult.rows[0],
        items: publicItems,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/attempt/:setId', async (req, res, next) => {
  try {
    const { setId } = req.params;
    const { playerName, responses = [] } = req.body || {};

    if (!playerName || !Array.isArray(responses)) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'playerName and responses[] are required',
      });
    }

    const itemsResult = await query(
      `
        SELECT id, answer
        FROM wordwall_items
        WHERE set_id = $1
      `,
      [setId]
    );

    if (itemsResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Wordwall set has no items',
      });
    }

    const itemMap = new Map(itemsResult.rows.map((item) => [item.id, item]));

    let correct = 0;
    for (const response of responses) {
      const item = itemMap.get(response.itemId);
      if (!item) {
        continue;
      }

      const mcq = parseMcqPayload(item.answer);
      if (mcq) {
        const expected = mcq.correctOption;
        const actual = String(response.answer || '').trim().toUpperCase();
        if (expected === actual) {
          correct += 1;
        }
        continue;
      }

      const expected = normalizeAnagramComparable(item.answer);
      const actual = normalizeAnagramComparable(response.answer);
      if (expected && expected === actual) {
        correct += 1;
      }
    }

    const score = Math.round((correct / itemsResult.rowCount) * 100);

    const attemptResult = await query(
      `
        INSERT INTO wordwall_attempts (set_id, player_name, score)
        VALUES ($1, $2, $3)
        RETURNING id, set_id, player_name, score, created_at
      `,
      [setId, playerName, score]
    );

    return res.json({
      success: true,
      data: {
        ...attemptResult.rows[0],
        totalItems: itemsResult.rowCount,
        correct,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/live/:code/participants', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!LIVE_CODE_REGEX.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CODE',
        message: '5 xonali kod kiriting',
      });
    }

    let session = await getSessionByCode(code);
    if (!session) {
      const setByPin = await getSetByPin(code);
      if (!setByPin) {
        return res.json({
          success: true,
          data: {
            code,
            status: 'waiting',
            participants: [],
            participantsCount: 0,
          },
        });
      }

      await getOrCreateLiveSessionForSet(setByPin.id, setByPin.pin);
      session = await getSessionByCode(code);
    }

    const participants = await query(
      `
        SELECT player_name, joined_at
        FROM wordwall_live_participants
        WHERE session_id = $1
        ORDER BY joined_at ASC
      `,
      [session.id]
    );

    return res.json({
      success: true,
      data: {
        sessionId: session.id,
        setId: session.set_id,
        setTitle: session.set_title,
        setPin: session.set_pin,
        code: session.room_code,
        status: session.status,
        participants: participants.rows,
        participantsCount: participants.rowCount,
      },
    });
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
    if (!LIVE_CODE_REGEX.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CODE',
        message: '5 xonali kod kiriting',
      });
    }

    const session = await getSessionByCode(code);
    let resolvedSession = session;
    if (!resolvedSession) {
      const wordwallSet = await getSetByPin(code);
      if (!wordwallSet) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Bunday Wordwall live sessiyasi topilmadi',
        });
      }

      resolvedSession = await getOrCreateLiveSessionForSet(wordwallSet.id, wordwallSet.pin);
    }

    if (resolvedSession.status === 'finished') {
      return res.status(400).json({
        success: false,
        error: 'SESSION_FINISHED',
        message: 'Bu sessiya yakunlangan',
      });
    }

    const rawPlayerName = String(req.body?.playerName || '').trim().replace(/\s+/g, ' ');
    const playerName = rawPlayerName || String(req.user?.name || req.user?.email || 'Oquvchi').trim();

    if (!playerName || playerName.length > 120) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PLAYER_NAME',
        message: 'Ism 1 dan 120 belgigacha bo\'lishi kerak',
      });
    }

    const participant = await query(
      `
        INSERT INTO wordwall_live_participants (session_id, user_id, player_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, user_id)
        DO UPDATE SET
          player_name = EXCLUDED.player_name,
          updated_at = NOW()
        RETURNING id, session_id, player_name, joined_at
      `,
      [resolvedSession.id, req.user.id, playerName]
    );

    return res.json({
      success: true,
      data: {
        sessionId: resolvedSession.id,
        code: resolvedSession.room_code,
        status: resolvedSession.status,
        setId: resolvedSession.set_id,
        setTitle: resolvedSession.set_title,
        setPin: resolvedSession.set_pin,
        participant: participant.rows[0],
      },
      message: "So'rov qabul qilindi. Admin start berishini kuting.",
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
    if (!LIVE_CODE_REGEX.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CODE',
        message: '5 xonali kod kiriting',
      });
    }

    const session = await getSessionByCode(code);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session topilmadi' });
    }

    const participantResult = await query(
      `
        SELECT id, player_name, joined_at
        FROM wordwall_live_participants
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
        message: 'Avval kod bilan sessiyaga qoshiling',
      });
    }

    const participantsCountResult = await query(
      `
        SELECT COUNT(*)::int AS count
        FROM wordwall_live_participants
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
        setId: session.set_id,
        setTitle: session.set_title,
        setPin: session.set_pin,
        templateType: session.template_type,
        participant: participantResult.rows[0],
        participantsCount: Number(participantsCountResult.rows[0]?.count || 0),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/live/sessions/:sessionId/finish', authenticateToken, requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await ensureLiveSchema();
    await client.query('BEGIN');

    const session = await client.query(
      `
        SELECT ls.id, ls.set_id, ls.room_code
        FROM wordwall_live_sessions ls
        JOIN wordwall_sets ws ON ws.id = ls.set_id
        WHERE ls.id = $1
          AND ws.teacher_id = $2
        LIMIT 1
      `,
      [req.params.sessionId, req.user.id]
    );

    if (session.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session topilmadi' });
    }

    const updated = await client.query(
      `
        UPDATE wordwall_live_sessions
        SET status = 'finished',
            finished_at = COALESCE(finished_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, set_id, room_code, status, finished_at
      `,
      [req.params.sessionId]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      data: {
        id: updated.rows[0].id,
        setId: updated.rows[0].set_id,
        code: updated.rows[0].room_code,
        status: updated.rows[0].status,
        finishedAt: updated.rows[0].finished_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.delete('/live/:code/my-attempt', authenticateToken, async (req, res, next) => {
  try {
    if (req.user?.role !== 'student') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: "Bu endpoint faqat o'quvchilar uchun",
      });
    }

    const code = String(req.params.code || '').trim();
    if (!LIVE_CODE_REGEX.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CODE',
        message: '5 xonali kod kiriting',
      });
    }

    let resolvedSetId = null;
    let participantName = '';

    const liveSession = await getSessionByCode(code);
    if (liveSession) {
      resolvedSetId = liveSession.set_id;

      const participant = await query(
        `
          SELECT player_name
          FROM wordwall_live_participants
          WHERE session_id = $1
            AND user_id = $2
          LIMIT 1
        `,
        [liveSession.id, req.user.id]
      );

      participantName = String(participant.rows[0]?.player_name || '').trim().replace(/\s+/g, ' ');
    }

    if (!resolvedSetId) {
      const setByPin = await getSetByPin(code);
      if (!setByPin) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Wordwall set topilmadi',
        });
      }

      resolvedSetId = setByPin.id;
    }

    const requestedName = String(req.body?.playerName || '').trim().replace(/\s+/g, ' ');
    const fallbackName = String(req.user?.name || req.user?.email || '').trim().replace(/\s+/g, ' ');
    const resolvedPlayerName = participantName || requestedName || fallbackName;

    if (!resolvedPlayerName) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PLAYER_NAME',
        message: 'Player ismi topilmadi',
      });
    }

    const deletedAttempt = await query(
      `
        WITH latest AS (
          SELECT id
          FROM wordwall_attempts
          WHERE set_id = $1
            AND LOWER(TRIM(player_name)) = LOWER(TRIM($2))
          ORDER BY created_at DESC
          LIMIT 1
        )
        DELETE FROM wordwall_attempts
        WHERE id IN (SELECT id FROM latest)
        RETURNING id, set_id, player_name, score, created_at
      `,
      [resolvedSetId, resolvedPlayerName]
    );

    if (deletedAttempt.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NO_RESULT',
        message: 'O\'chirish uchun Wordwall natijasi topilmadi',
      });
    }

    const remainingResult = await query(
      `
        SELECT COUNT(*)::int AS count
        FROM wordwall_attempts
        WHERE set_id = $1
          AND LOWER(TRIM(player_name)) = LOWER(TRIM($2))
      `,
      [resolvedSetId, resolvedPlayerName]
    );

    return res.json({
      success: true,
      data: {
        deletedAttempt: deletedAttempt.rows[0],
        remainingAttempts: Number(remainingResult.rows[0]?.count || 0),
      },
      message: 'Wordwall natijasi o\'chirildi',
    });
  } catch (error) {
    return next(error);
  }
});

router.use(authenticateToken, requireAdmin);

router.get('/sets', async (req, res, next) => {
  try {
    const setsResult = await query(
      `
        SELECT id, title, template_type, clue_mode, pin, created_at
        FROM wordwall_sets
        WHERE teacher_id = $1
        ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    const sets = setsResult.rows;
    if (sets.length === 0) {
      return res.json({ success: true, data: [] });
    }

    await ensureLiveSchema();
    const setIds = sets.map((set) => set.id);
    const placeholders = setIds.map((_, index) => `$${index + 1}`).join(', ');
    const liveResult = await query(
      `
        SELECT id, set_id, room_code, status, started_at, finished_at, created_at
        FROM wordwall_live_sessions
        WHERE set_id IN (${placeholders})
        ORDER BY created_at DESC
      `,
      setIds
    );

    const latestBySetId = new Map();
    liveResult.rows.forEach((session) => {
      if (!latestBySetId.has(session.set_id)) {
        latestBySetId.set(session.set_id, session);
      }
    });

    const data = sets.map((set) => {
      const live = latestBySetId.get(set.id);
      return {
        ...set,
        live_session_id: live?.id || null,
        live_code: live?.room_code || null,
        live_status: live?.status || null,
        live_started_at: live?.started_at || null,
      };
    });

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/sets/:setId/live', async (req, res, next) => {
  try {
    await ensureLiveSchema();

    const ownership = await query(
      `
        SELECT id
        FROM wordwall_sets
        WHERE id = $1
          AND teacher_id = $2
        LIMIT 1
      `,
      [req.params.setId, req.user.id]
    );

    if (ownership.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Set topilmadi' });
    }

    const setResult = await query(
      `
        SELECT id, pin, title
        FROM wordwall_sets
        WHERE id = $1
          AND teacher_id = $2
        LIMIT 1
      `,
      [req.params.setId, req.user.id]
    );

    if (setResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Set topilmadi' });
    }

    const existing = await query(
      `
        SELECT id, room_code, status, created_at
        FROM wordwall_live_sessions
        WHERE set_id = $1
          AND status IN ('waiting', 'live')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [req.params.setId]
    );

    if (existing.rowCount > 0) {
      return res.json({
        success: true,
        data: {
          id: existing.rows[0].id,
          code: existing.rows[0].room_code,
          status: existing.rows[0].status,
          setId: req.params.setId,
        },
      });
    }

    const code = setResult.rows[0].pin;
    const created = await query(
      `
        INSERT INTO wordwall_live_sessions (set_id, room_code, status)
        VALUES ($1, $2, 'waiting')
        RETURNING id, set_id, room_code, status, created_at
      `,
      [req.params.setId, code]
    );

    return res.status(201).json({
      success: true,
      data: {
        id: created.rows[0].id,
        setId: created.rows[0].set_id,
        code: created.rows[0].room_code,
        status: created.rows[0].status,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/live/sessions/:sessionId/start', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await ensureLiveSchema();
    await client.query('BEGIN');

    const session = await client.query(
      `
        SELECT ls.id, ls.set_id, ls.room_code, ls.status
        FROM wordwall_live_sessions ls
        JOIN wordwall_sets ws ON ws.id = ls.set_id
        WHERE ls.id = $1
          AND ws.teacher_id = $2
        LIMIT 1
      `,
      [req.params.sessionId, req.user.id]
    );

    if (session.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session topilmadi' });
    }

    const updated = await client.query(
      `
        UPDATE wordwall_live_sessions
        SET status = 'live',
            started_by = $2,
            started_at = COALESCE(started_at, NOW()),
            finished_at = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, set_id, room_code, status, started_at
      `,
      [req.params.sessionId, req.user.id]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      data: {
        id: updated.rows[0].id,
        setId: updated.rows[0].set_id,
        code: updated.rows[0].room_code,
        status: updated.rows[0].status,
        startedAt: updated.rows[0].started_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/live/sessions/:sessionId/restart-code', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await ensureLiveSchema();
    await client.query('BEGIN');

    const session = await client.query(
      `
        SELECT ls.id, ls.set_id
        FROM wordwall_live_sessions ls
        JOIN wordwall_sets ws ON ws.id = ls.set_id
        WHERE ls.id = $1
          AND ws.teacher_id = $2
        LIMIT 1
      `,
      [req.params.sessionId, req.user.id]
    );

    if (session.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session topilmadi' });
    }

    const updated = await client.query(
      `
        UPDATE wordwall_live_sessions
        SET room_code = (
              SELECT pin
              FROM wordwall_sets
              WHERE id = wordwall_live_sessions.set_id
              LIMIT 1
            ),
            status = 'waiting',
            started_at = NULL,
            finished_at = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, set_id, room_code, status
      `,
      [req.params.sessionId]
    );

    await client.query(
      `
        DELETE FROM wordwall_live_participants
        WHERE session_id = $1
      `,
      [req.params.sessionId]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      data: {
        id: updated.rows[0].id,
        setId: updated.rows[0].set_id,
        code: updated.rows[0].room_code,
        status: updated.rows[0].status,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/live/sessions/:sessionId/monitor', async (req, res, next) => {
  try {
    await ensureLiveSchema();
    const session = await getSessionByIdForTeacher(req.params.sessionId, req.user.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Session topilmadi' });
    }

    const participants = await query(
      `
        SELECT player_name, joined_at
        FROM wordwall_live_participants
        WHERE session_id = $1
        ORDER BY joined_at ASC
      `,
      [session.id]
    );

    return res.json({
      success: true,
      data: {
        sessionId: session.id,
        setId: session.set_id,
        setTitle: session.set_title,
        setPin: session.set_pin,
        templateType: session.template_type,
        code: session.room_code,
        status: session.status,
        startedAt: session.started_at,
        finishedAt: session.finished_at,
        participants: participants.rows,
        participantsCount: participants.rowCount,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/sets', async (req, res, next) => {
  try {
    const { title, templateType = 'matching', clueMode = 'without' } = req.body || {};

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'title is required',
      });
    }

    const normalizedClueMode = String(clueMode || 'without').trim().toLowerCase() === 'with' ? 'with' : 'without';
    const pin = await getUniqueWordwallPin();

    const result = await query(
      `
        INSERT INTO wordwall_sets (teacher_id, title, template_type, clue_mode, pin)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, title, template_type, clue_mode, pin, created_at
      `,
      [req.user.id, title, templateType, normalizedClueMode, pin]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/sets/:setId/items', async (req, res, next) => {
  try {
    const { setId } = req.params;
    const { prompt, answer } = req.body || {};

    if (!prompt || !answer) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'prompt and answer are required',
      });
    }

    const ownership = await query(
      `
        SELECT id
        FROM wordwall_sets
        WHERE id = $1
          AND teacher_id = $2
      `,
      [setId, req.user.id]
    );

    if (ownership.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Set not found' });
    }

    const result = await query(
      `
        INSERT INTO wordwall_items (set_id, prompt, answer)
        VALUES ($1, $2, $3)
        RETURNING id, set_id, prompt, answer
      `,
      [setId, prompt, answer]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/sets/:setId', async (req, res, next) => {
  try {
    const setResult = await query(
      `
        SELECT id, title, template_type, clue_mode, pin, created_at
        FROM wordwall_sets
        WHERE id = $1
          AND teacher_id = $2
        LIMIT 1
      `,
      [req.params.setId, req.user.id]
    );

    if (setResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Set not found' });
    }

    const itemsResult = await query(
      `
        SELECT id, prompt, answer
        FROM wordwall_items
        WHERE set_id = $1
        ORDER BY created_at ASC
      `,
      [req.params.setId]
    );

    return res.json({
      success: true,
      data: {
        ...setResult.rows[0],
        items: itemsResult.rows,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/sets/:setId', async (req, res, next) => {
  try {
    const ownership = await query(
      `
        SELECT id
        FROM wordwall_sets
        WHERE id = $1
          AND teacher_id = $2
      `,
      [req.params.setId, req.user.id]
    );

    if (ownership.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Set not found' });
    }

    await query(
      `
        DELETE FROM wordwall_sets
        WHERE id = $1
          AND teacher_id = $2
      `,
      [req.params.setId, req.user.id]
    );

    return res.json({ success: true, message: 'Wordwall set ochirildi' });
  } catch (error) {
    return next(error);
  }
});

router.get('/sets/:setId/attempts', async (req, res, next) => {
  try {
    const ownership = await query(
      `
        SELECT id
        FROM wordwall_sets
        WHERE id = $1
          AND teacher_id = $2
      `,
      [req.params.setId, req.user.id]
    );

    if (ownership.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Set not found' });
    }

    const result = await query(
      `
        SELECT id, player_name, score, created_at
        FROM wordwall_attempts
        WHERE set_id = $1
        ORDER BY created_at DESC
      `,
      [req.params.setId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

export default router;
    