import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `
        SELECT id, full_name, email, group_name, created_at
        FROM students
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

router.post('/', async (req, res, next) => {
  try {
    const { fullName, email, groupName = '9-A' } = req.body || {};

    if (!fullName || !email) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'fullName and email are required',
      });
    }

    const result = await query(
      `
        INSERT INTO students (teacher_id, full_name, email, group_name)
        VALUES ($1, $2, $3, $4)
        RETURNING id, full_name, email, group_name, created_at
      `,
      [req.user.id, fullName, email.toLowerCase(), groupName]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'ALREADY_EXISTS',
        message: 'Student email already exists',
      });
    }
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fullName, email, groupName } = req.body || {};

    const result = await query(
      `
        UPDATE students
        SET full_name = COALESCE($1, full_name),
            email = COALESCE($2, email),
            group_name = COALESCE($3, group_name)
        WHERE id = $4
          AND teacher_id = $5
        RETURNING id, full_name, email, group_name, created_at
      `,
      [fullName, email ? email.toLowerCase() : null, groupName, id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Student not found',
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
        DELETE FROM students
        WHERE id = $1
          AND teacher_id = $2
      `,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Student not found',
      });
    }

    return res.json({ success: true, message: 'Student deleted' });
  } catch (error) {
    return next(error);
  }
});

export default router;
