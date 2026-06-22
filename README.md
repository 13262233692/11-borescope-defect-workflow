# 航空发动机孔探缺陷工单流转系统

## 系统概述

本系统专为航空维修基地设计，用于管理发动机孔探检测的完整工作流，包括：

- **孔探图像管理**：支持超大图片瓦片化加载（4096x4096+）
- **缺陷标注**：多用户协作标注，实时同步
- **工单流转**：待判读→待复核→需维修/可放行→已关闭
- **复核审批**：多人复核评论，支持版本对比
- **适航放行**：生成正式放行记录并归档

## 技术架构

### 前端 (Vue 3)
- Vite 构建工具
- Pinia 状态管理
- Vue Router 路由
- Canvas 图片切片渲染器
- WebSocket 实时协作

### 后端 (Node.js + Express)
- JWT 身份认证
- WebSocket (ws 库)
- PostgreSQL (pg 驱动)
- Sharp 图片处理
- 基于角色的访问控制 (RBAC)

### 数据库 (PostgreSQL)
- engine - 发动机台账
- inspection_case - 孔探批次/工单
- image_tile - 图片瓦片索引
- defect_annotation - 缺陷标注
- workflow_record - 审批/流转记录

## 权限模型

| 角色 | 权限 |
|------|------|
| 判读员 (Inspector) | 创建标注、提交判读 |
| 复核员 (Reviewer) | 复核标注、退回或通过 |
| 放行工程师 (Releaser) | 最终审批、签发放行 |
| 管理员 (Admin) | 全权限、用户管理 |

## 快速启动

### 使用 Docker Compose
```bash
docker-compose up -d
```

### 手动启动
```bash
# 1. 启动 PostgreSQL 并初始化数据库
# 2. 安装后端依赖
cd server && npm install && npm run dev

# 3. 安装前端依赖
cd client && npm install && npm run dev
```

### 测试账号
- 判读员: inspector / inspector123
- 复核员: reviewer / reviewer123
- 放行工程师: releaser / releaser123
- 管理员: admin / admin123

## 工单状态流转

```
待判读 (PENDING)
    ↓ [判读员提交判读]
待复核 (REVIEWING)
    ↓ [复核员退回] ←──┐
    ↓ [复核员通过]      │
  ┌─────────────────┐  │
  ↓                 ↓  │
需维修 (REPAIR)  可放行 (CLEAR)
  ↓                 ↓
已关闭 (CLOSED)  已关闭 (CLOSED)
```
