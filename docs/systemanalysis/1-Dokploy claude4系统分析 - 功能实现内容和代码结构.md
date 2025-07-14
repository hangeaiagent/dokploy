Dokploy 系统分析 - 功能实现内容和代码结构
项目概述
Dokploy 是一个免费的、可自托管的平台即服务（PaaS）解决方案，类似于 Vercel、Heroku 和 Netlify 的开源替代品。它简化了应用程序和数据库的部署和管理。
项目架构
1. 技术栈
前端技术栈
Next.js 15.2.4 - React 全栈框架
React 18.2.0 - 用户界面库
TypeScript 5.4.2 - 类型安全的 JavaScript
Tailwind CSS 3.4.1 - 原子化 CSS 框架
Radix UI - 无样式组件库
tRPC 10.43.6 - 类型安全的 API 层
后端技术栈
Node.js 20.16.0 - 运行时环境
Hono - 轻量级 Web 框架（API 服务）
tRPC - 类型安全的 API 层
Drizzle ORM 0.39.1 - 数据库 ORM
PostgreSQL - 主数据库
Redis - 缓存和会话存储
BullMQ - 队列系统
基础设施
Docker - 容器化
Docker Swarm - 容器编排
Traefik - 反向代理和负载均衡
SQLite - 监控数据存储（Go 服务）
集成服务
AI 服务: OpenAI, Anthropic, Cohere, Mistral, Azure AI
Git 提供商: GitHub, GitLab, Gitea, Bitbucket
认证: Better Auth
邮件: Nodemailer
监控: Go 服务 + Fiber 框架
2. 项目结构
Apply to Untitled-1
2.1 主应用 (apps/dokploy)
核心文件结构：
Apply to Untitled-1
2.2 API 服务 (apps/api)
功能：
独立的 API 服务，使用 Hono 框架
端口：4000
队列管理和处理
Redis 集成
2.3 监控服务 (apps/monitoring)
功能：
Go 语言实现的系统监控
使用 Fiber 框架提供 HTTP 服务
系统资源监控（CPU、内存、磁盘、网络）
SQLite 数据存储
2.4 调度服务 (apps/schedules)
功能：
定时任务管理
使用 Hono 框架
端口：4001
BullMQ 队列集成
2.5 服务器包 (packages/server)
核心目录：
Apply to Untitled-1
主要功能模块
1. 核心服务 (services/)
主要服务模块：
application.ts (20KB) - 应用程序管理
deployment.ts (24KB) - 部署管理
compose.ts (15KB) - Docker Compose 管理
docker.ts (11KB) - Docker 容器管理
notification.ts (13KB) - 通知系统
cdn.ts (13KB) - CDN 管理
数据库服务：
postgres.ts - PostgreSQL 管理
mysql.ts - MySQL 管理
redis.ts - Redis 管理
mongo.ts - MongoDB 管理
mariadb.ts - MariaDB 管理
Git 集成：
github.ts - GitHub 集成
gitlab.ts - GitLab 集成
gitea.ts - Gitea 集成
bitbucket.ts - Bitbucket 集成
其他服务：
ai.ts - AI 集成
backup.ts - 备份管理
certificate.ts - SSL 证书管理
domain.ts - 域名管理
security.ts - 安全管理
user.ts - 用户管理
2. 数据库模式 (db/schema/)
核心实体：
application.ts (16KB) - 应用程序数据模型
deployment.ts (5.6KB) - 部署记录
compose.ts (6.2KB) - Compose 配置
user.ts (8.7KB) - 用户模型
notification.ts (7.8KB) - 通知模型
backups.ts (5.5KB) - 备份记录
数据库实体：
postgres.ts - PostgreSQL 实例
mysql.ts - MySQL 实例
redis.ts - Redis 实例
mongo.ts - MongoDB 实例
mariadb.ts - MariaDB 实例
3. API 路由 (server/api/routers/)
完整的 tRPC 路由系统：
adminRouter - 管理员功能
applicationRouter - 应用程序管理
deploymentRouter - 部署管理
dockerRouter - Docker 管理
projectRouter - 项目管理
userRouter - 用户管理
domainRouter - 域名管理
certificateRouter - 证书管理
backupRouter - 备份管理
notificationRouter - 通知系统
aiRouter - AI 集成
[数据库路由...] - 各种数据库管理
[Git 路由...] - Git 提供商集成
4. 队列系统 (server/queues/)
队列管理：
deployments-queue.ts - 部署队列
queueSetup.ts - 队列配置
queue-types.ts - 队列类型定义
5. WebSocket 服务 (server/wss/)
实时功能：
docker-container-logs.ts - 容器日志流
docker-container-terminal.ts - 容器终端
docker-stats.ts - Docker 统计信息
[其他 WebSocket 服务...]
部署架构
1. 容器化部署
Docker Compose 服务：
Apply to Untitled-1
端口配置：
80/443 - Traefik 反向代理
3000 - 主应用端口
4000 - API 服务端口
4001 - 调度服务端口
2. Docker Swarm 集群
集群管理功能：
多节点部署
服务自动扩展
负载均衡
服务发现
3. 监控系统
监控组件：
Go 监控服务（系统资源）
容器统计信息
应用性能监控
日志聚合
主要特性
1. 应用管理
支持多种应用类型（Node.js, PHP, Python, Go, Ruby 等）
Docker 容器管理
自动构建和部署
版本控制集成
2. 数据库管理
支持主流数据库（PostgreSQL, MySQL, Redis, MongoDB, MariaDB）
自动备份
数据迁移
性能监控
3. 域名和证书
自定义域名管理
SSL 证书自动申请和续期
Traefik 集成路由
4. 模板系统
预构建应用模板
一键部署流行应用
自定义模板支持
5. 多环境支持
开发、测试、生产环境
环境变量管理
配置隔离
6. 监控和日志
实时性能监控
容器日志查看
系统资源监控
告警通知
7. 安全功能
用户认证和授权
2FA 支持
SSH 密钥管理
安全策略配置
8. 集成功能
Git 提供商集成
CI/CD 管道
Webhook 支持
第三方服务集成
技术亮点
1. 类型安全
全栈 TypeScript
tRPC 提供端到端类型安全
Drizzle ORM 类型安全的数据库操作
2. 现代化架构
微服务架构
容器化部署
队列系统
实时通信
3. 开发体验
热重载
自动化测试
代码规范检查
自动化部署
4. 可扩展性
插件系统
模板系统
API 开放
多语言支持
部署流程
1. 安装步骤
Apply to Untitled-1
Run
2. 服务启动
Docker Swarm 初始化
网络创建
服务部署
数据库迁移
用户初始化
3. 访问方式
HTTP: http://server-ip
HTTPS: https://server-ip
直接访问: http://server-ip:3000
总结
Dokploy 是一个功能完整的 PaaS 解决方案，采用现代化的技术栈和架构设计：
全栈 TypeScript 确保代码质量和开发效率
微服务架构 提供良好的可扩展性和维护性
容器化部署 简化部署和运维
丰富的集成 支持主流开发工具和服务
用户友好 提供直观的 Web 界面和完善的文档
项目代码组织良好，模块化程度高，适合团队协作和长期维护。通过清晰的分层架构和丰富的功能模块，为用户提供了一个强大且易用的应用部署平台。
分析日期：2025年7月13日
 
