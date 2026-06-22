require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const logger = require('./utils/logger');
const { handleError, NotFoundError } = require('./utils/errors');
const { testConnection } = require('./db/pool');
const collabWs = require('./wsServer');

const authRoutes = require('./routes/authRoutes');
const engineRoutes = require('./routes/engineRoutes');
const caseRoutes = require('./routes/caseRoutes');
const imageRoutes = require('./routes/imageRoutes');
const annotationRoutes = require('./routes/annotationRoutes');

const app = express();
const server = http.createServer(app);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: config.server.corsOrigin.split(','),
  credentials: true,
  exposedHeaders: ['X-Total-Count', 'Content-Disposition']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: { code: 'RATE_LIMIT', message: '登录尝试次数过多，请稍后再试' } },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  message: { success: false, error: { code: 'RATE_LIMIT', message: '请求频率过高' } }
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      wsConnections: collabWs.getUserCount(),
      wsRooms: collabWs.getRoomCount()
    }
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/engines', engineRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/cases/:caseId/images', imageRoutes);
app.use('/api/cases/:caseId/annotations', annotationRoutes);

app.use('/uploads', express.static(config.storage.uploadDir, {
  maxAge: '1y',
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));
app.use('/tiles', express.static(config.storage.tileDir, {
  maxAge: '1y',
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));

if (config.server.env === 'production') {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api|uploads|tiles|ws).*/, (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
}

app.use('*', (req, res, next) => {
  next(new NotFoundError(`API 路由不存在: ${req.method} ${req.originalUrl}`));
});

app.use(handleError);

async function start() {
  logger.info('========================================');
  logger.info('航空发动机孔探缺陷工单流转系统 - 服务端');
  logger.info('========================================');

  await testConnection();

  collabWs.start(server);

  server.listen(config.server.port, () => {
    logger.info(`HTTP API Server  listening on :${config.server.port}`);
    logger.info(`WebSocket Server   listening on :${config.server.port}/ws`);
    logger.info(`Environment: ${config.server.env}`);
    logger.info(`CORS Origin: ${config.server.corsOrigin}`);
    logger.info(`Upload Dir: ${config.storage.uploadDir}`);
    logger.info(`Tile Dir:   ${config.storage.tileDir}`);
  });

  server.on('error', (err) => {
    logger.error('Server error:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection:', reason);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => process.exit(0));
  });
}

start();

module.exports = app;
