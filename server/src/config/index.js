require('dotenv').config();
const path = require('path');

const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    wsPort: parseInt(process.env.WS_PORT || '3001', 10),
    env: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173'
  },

  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'borescope_db',
    user: process.env.DB_USER || 'borescope_admin',
    password: process.env.DB_PASSWORD || 'Borescope@2026',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h'
  },

  storage: {
    uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
    tileDir: path.resolve(process.env.TILE_DIR || './tiles'),
    tileSize: parseInt(process.env.TILE_SIZE || '256', 10),
    maxImageSize: parseInt(process.env.MAX_IMAGE_SIZE || '104857600', 10)
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },

  roles: {
    INSPECTOR: 'INSPECTOR',
    REVIEWER: 'REVIEWER',
    RELEASER: 'RELEASER',
    ADMIN: 'ADMIN'
  },

  caseStatus: {
    PENDING: 'PENDING',
    REVIEWING: 'REVIEWING',
    REPAIR: 'REPAIR',
    CLEAR: 'CLEAR',
    CLOSED: 'CLOSED'
  },

  workflowActions: {
    CREATE: 'CREATE',
    SUBMIT: 'SUBMIT',
    REVIEW_PASS: 'REVIEW_PASS',
    REVIEW_REJECT: 'REVIEW_REJECT',
    RELEASE: 'RELEASE',
    CLOSE: 'CLOSE',
    COMMENT: 'COMMENT',
    EDIT_ANNOTATION: 'EDIT_ANNOTATION'
  }
};

module.exports = config;
