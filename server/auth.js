import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// JWT密钥优先从环境变量读取，fallback到每次启动不同的随机值
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// JWT认证中间件
export function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: '未提供认证令牌' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: '令牌无效或已过期' });
  }
}

export { JWT_SECRET };
