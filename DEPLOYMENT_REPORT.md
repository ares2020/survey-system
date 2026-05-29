# 共青团就业服务周报系统 V19 — 部署维护报告

**部署时间**: 2026-05-29  
**部署路径**: `/root/survey-system/`  
**运行端口**: 3001  
**数据库模式**: JSON 文件（`DATA_DIR=/root/survey-system/data`）  

---

## 1. 部署状态

| 组件 | 状态 | 说明 |
|------|------|------|
| 后端服务 (Express) | ✅ 运行中 | PID 动态分配，端口 3001 |
| 前端页面 | ✅ 正常 | survey.html / admin.html / index.html |
| JSON 数据库 | ✅ 正常 | `/root/survey-system/data/data.json` |
| 默认管理员 | ✅ 可用 | `admin` / `admin123` |
| JWT 认证 | ✅ 正常 | Bearer Token，24h 过期 |
| 登录限流 | ✅ 正常 | 5 次/15 分钟 |

---

## 2. 发现并修复的 Bug

### Bug #1: 回收站路由被动态路由截获（Express 路由顺序问题）

**问题**: `GET /api/admin/submissions/deleted` 被 `GET /api/admin/submissions/:id` 匹配，导致访问回收站时返回 "记录不存在"。

**根因**: Express 路由匹配顺序，`/:id` 在 `/deleted` 之前定义，"deleted" 被解析为 `id` 参数。

**修复**: 在 `server/routes.js` 中将 `/admin/submissions/deleted` 路由定义移动到 `/admin/submissions/:id` 之前。

**验证**: 
- 删除记录后 `/api/admin/submissions/deleted` 正确返回已删除列表
- 恢复后列表为空
- 统计计数正确排除已删除记录

---

## 3. 功能测试清单

| 功能 | 状态 | 备注 |
|------|------|------|
| 问卷提交 | ✅ | 自动保存、提交成功 |
| 管理端登录 | ✅ | JWT Token 正常发放 |
| 统计概览 | ✅ | 70 所高校、覆盖率计算正确 |
| 提交列表 | ✅ | 分页、排序正常 |
| 单条详情 | ✅ | XSS 转义生效 |
| 软删除 | ✅ | deleted/deleted_at 标记 |
| 回收站列表 | ✅ | 修复后正常 |
| 恢复记录 | ✅ | 从回收站还原 |
| 永久删除 | ✅ | 从回收站彻底删除 |
| 密码修改 | ✅ | bcrypt 哈希验证 |
| Excel 汇总导出 | ✅ | Sheet1 数据统计 + Sheet2 活动情况 |
| 原始数据导出 | ✅ | 完整字段 CSV/XLSX |
| 未提交高校导出 | ✅ | 基于本周周期过滤 |
| 学校列表 API | ✅ | 70 所上海高校 |
| 健康检查 | ✅ | `/health` 返回 ok |

---

## 4. 已知限制（非代码问题）

| 限制 | 优先级 | 说明 |
|------|--------|------|
| JSON 模式无审计日志 | 低 | 审计日志仅支持 MongoDB 模式 |
| 批量导入需 SheetJS CDN | 低 | 前端依赖外部 CDN |
| 单管理员账户 | 低 | 设计如此 |
| 无邮件通知 | 低 | 未集成邮件服务 |
| 无自动备份 | 中 | 建议配置定时备份 data.json |
| Render 免费版休眠 | 中 | 15 分钟无访问休眠，冷启动 30-60s |

---

## 5. 关键配置

```bash
# 环境变量
DATA_DIR=/root/survey-system/data    # 数据文件目录
NODE_ENV=production                    # 生产模式
PORT=3001                            # 服务端口

# 如需 MongoDB，设置
MONGODB_URI=mongodb+srv://...

# 如需固定 JWT Secret（避免重启后 token 失效）
JWT_SECRET=your-fixed-secret-here
```

---

## 6. 文件结构

```
/root/survey-system/
├── index.js                 # 入口文件
├── render.yaml              # Render 部署配置
├── server/
│   ├── index.js             # Express 应用
│   ├── db.js                # 数据库抽象层
│   ├── models.js            # 数据模型
│   ├── routes.js            # API 路由（已修复路由顺序）
│   ├── auth.js              # JWT 认证
│   ├── export.js            # Excel 导出
│   ├── constants.js         # 70 所高校列表
│   └── package.json         # 依赖
├── public/
│   ├── index.html           # 入口页
│   ├── survey.html          # 填报端
│   └── admin.html           # 管理后台
├── data/
│   └── data.json            # 数据库文件
├── start.sh                 # 启动脚本
└── 交接文档.md              # 原始交接文档
```

---

## 7. 启动命令

```bash
cd /root/survey-system
export DATA_DIR=/root/survey-system/data
node index.js &
```

或执行脚本：
```bash
bash /root/survey-system/start.sh
```

---

**维护人**: KimiClaw  
**系统版本**: V19 (2026-05-29)
