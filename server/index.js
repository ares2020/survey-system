import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db.js';
import routes from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

// Health check
app.get('/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

// 404 - must return JSON, never HTML
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found', path: req.path });
});

// Error handler - always JSON
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

export async function startServer() {
  try {
    // 初始化数据库（先尝试连接MongoDB，失败则使用JSON fallback）
    await initDatabase();
    app.listen(PORT, () => {
      console.log('Server running on port', PORT);
    });
  } catch (err) {
    console.error('Start failed:', err);
    process.exit(1);
  }
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
