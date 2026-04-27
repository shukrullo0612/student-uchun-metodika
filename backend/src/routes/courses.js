import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `
        SELECT id, title, description, status, created_at
        FROM courses
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
    const { title, description = '', status = 'Faol' } = req.body || {};

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'title is required',
      });
    }

    const result = await query(
      `
        INSERT INTO courses (teacher_id, title, description, status)
        VALUES ($1, $2, $3, $4)
        RETURNING id, title, description, status, created_at
      `,
      [req.user.id, title, description, status]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, status } = req.body || {};

    const result = await query(
      `
        UPDATE courses
        SET title = COALESCE($1, title),
            description = COALESCE($2, description),
            status = COALESCE($3, status)
        WHERE id = $4
          AND teacher_id = $5
        RETURNING id, title, description, status, created_at
      `,
      [title, description, status, id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Course not found',
      });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
        DELETE FROM courses
        WHERE id = $1
          AND teacher_id = $2
      `,
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Course not found',
      });
    }

    return res.json({ success: true, message: 'Course deleted' });
  } catch (error) {
    return next(error);
  }
});

export default router;
