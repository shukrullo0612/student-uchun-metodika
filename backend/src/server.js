import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Server as SocketIOServer } from 'socket.io';
import config from './config.js';
import { testConnection } from './db.js';
import authRoutes from './routes/auth.js';
import coursesRoutes from './routes/courses.js';
import studentsRoutes from './routes/students.js';
import assignmentsRoutes from './routes/assignments.js';
import quizRoutes from './routes/quiz.js';
import kahootRoutes, { setKahootSocket } from './routes/kahoot.js';
import wordwallRoutes from './routes/wordwall.js';
import reportsRoutes from './routes/reports.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: config.allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

setKahootSocket(io);

io.on('connection', (socket) => {
  socket.on('join-kahoot', ({ pin, sessionId } = {}) => {
    if (pin) {
      socket.join(`kahoot-pin:${pin}`);
    }
    if (sessionId) {
      socket.join(`kahoot-session:${sessionId}`);
    }
  });
});

app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Origin not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

app.get('/api/health', async (req, res) => {
  return res.json({
    status: 'ok',
    service: 'eduskill-backend',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/kahoot', kahootRoutes);
app.use('/api/wordwall', wordwallRoutes);
app.use('/api/reports', reportsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

server.listen(config.port, async () => {
  let dbState = 'disconnected';
  try {
    await testConnection();
    dbState = 'connected';
  } catch (error) {
    dbState = 'error';
  }

  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(`[server] database: ${dbState}`);
});
