import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, getDb, useMongo } from './db.js';
import routes from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.resolve(process.env.DATA_DIR || __dirname, 'data.json');
const PORT = process.env.PORT || 3001;

const app = express();

// 隐藏X-Powered-By
app.disable('x-powered-by');

// 安全头中间件
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : ['http://localhost:3001', 'https://survey-system-v19.onrender.com'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
// Request logging (helps debug P0 auth routing issues)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin || 'none'} - Content-Type: ${req.headers['content-type'] || 'none'}`);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api', routes);

// WAF/验证错误统一返回JSON
app.use((err, req, res, next) => {
  if (err.status === 403 || err.name === 'ForbiddenError') {
    return res.status(403).json({ success: false, message: '请求被拦截，请检查输入内容' });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'CORS policy violation' });
  }
  next(err);
});

// Static files
const publicPath = path.resolve(__dirname, '../public');
app.use(express.static(publicPath));

// Entry page
app.get('/', (req, res) => { res.sendFile(path.join(publicPath, 'index.html')); });

// Health check + data status
app.get('/health', (req, res) => {
  const db = getDb();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dataDir: process.env.DATA_DIR || 'default',
    dataFile: DATA_FILE,
    records: db.submissions?.length || 0,
    mongo: useMongo(),
    version: 'v19-test'
  });
});

// 版本确认端点
app.get('/version', (req, res) => {
  res.json({ version: '2026-05-30-v2', build: 'P0-P3-fix' });
});

// 404 - must return JSON, never HTML
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found', path: req.path });
});

export function startServer() {
  initDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Data file: ${DATA_FILE}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  }).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
}

// 直接执行时启动服务（兼容 Render rootDir=server 配置）
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
