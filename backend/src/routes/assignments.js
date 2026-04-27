import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `
        SELECT a.id,
               a.title,
               a.total_tasks,
               a.completed_tasks,
               a.due_date,
               a.created_at,
               c.title AS course_title,
               c.id AS course_id
        FROM assignments a
        LEFT JOIN courses c ON c.id = a.course_id
        WHERE a.teacher_id = $1
        ORDER BY a.created_at DESC
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
    const { title, courseId = null, totalTasks = 0, completedTasks = 0, dueDate = null } = req.body || {};

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELD',
        message: 'title is required',
      });
    }

    const result = await query(
      `
        INSERT INTO assignments (teacher_id, course_id, title, total_tasks, completed_tasks, due_date)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, title, total_tasks, completed_tasks, due_date, created_at, course_id
      `,
      [req.user.id, courseId, title, totalTasks, completedTasks, dueDate]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, courseId, totalTasks, completedTasks, dueDate } = req.body || {};

    const result = await query(
      `
        UPDATE assignments
        SET title = COALESCE($1, title),
            course_id = COALESCE($2, course_id),
            total_tasks = COALESCE($3, total_tasks),
            completed_tasks = COALESCE($4, completed_tasks),
            due_date = COALESCE($5, due_date)
        WHERE id = $6
          AND teacher_id = $7
        RETURNING id, title, total_tasks, completed_tasks, due_date, created_at, course_id
      `,
      [title, courseId, totalTasks, completedTasks, dueDate, id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Assignment not found',
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
        DELETE FROM assignments
        WHERE id = $1
          AND teacher_id = $2
      `,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: 'Assignment not found',
      });
    }

    return res.json({ success: true, message: 'Assignment deleted' });
  } catch (error) {
    return next(error);
  }
});

export default router;
