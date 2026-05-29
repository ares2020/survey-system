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
  // 生产环境 HSTS（Render 自动 HTTPS）
  // CSP disabled for file download compatibility
  // res.setHeader('Content-Security-Policy', ...);
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',  // 生产环境可配置
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api', routes);

// WAF/验证错误统一返回JSON
app.use((err, req, res, next) => {
  if (err.status === 403 || err.name === 'ForbiddenError') {
    return res.status(403).json({ success: false, message: '请求被拦截，请检查输入内容' });
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

// 404
app.use((req, res) => { res.status(404).json({ success: false, message: 'Not found' }); });

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
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
