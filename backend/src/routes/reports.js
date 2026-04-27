import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get('/summary', async (req, res, next) => {
  try {
    const teacherId = req.user.id;

    const [students, courses, assignments, quizStats] = await Promise.all([
      query('SELECT COUNT(*)::int AS count FROM students WHERE teacher_id = $1', [teacherId]),
      query('SELECT COUNT(*)::int AS count FROM courses WHERE teacher_id = $1', [teacherId]),
      query(
        'SELECT COALESCE(SUM(completed_tasks), 0)::int AS completed FROM assignments WHERE teacher_id = $1',
        [teacherId]
      ),
      query(
        `
          SELECT COALESCE(AVG(score), 0)::numeric(10,2) AS avg_score
          FROM quiz_attempts
          WHERE teacher_id = $1
        `,
        [teacherId]
      ),
    ]);

    return res.json({
      success: true,
      data: {
        students: students.rows[0].count,
        courses: courses.rows[0].count,
        completedAssignments: assignments.rows[0].completed,
        averageScore: Number(quizStats.rows[0].avg_score),
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
