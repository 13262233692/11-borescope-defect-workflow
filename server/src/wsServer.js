const WebSocket = require('ws');
const url = require('url');
const config = require('./config');
const { authenticateWS } = require('./middleware/auth');
const { query } = require('./db/pool');
const logger = require('./utils/logger');

class CollabWebSocketServer {
  constructor() {
    this.wss = null;
    this.rooms = new Map();
    this.userConnections = new Map();
  }

  start(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', async (ws, req) => {
      const queryParams = url.parse(req.url, true).query;
      const token = queryParams.token;

      let user;
      try {
        user = await authenticateWS(token);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'ERROR', error: err.message }));
        ws.close(4001, 'Authentication failed');
        return;
      }

      ws.user = user;
      ws.id = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ws.joinedRooms = new Set();

      logger.debug(`WS connected: ${user.username} (${ws.id})`);

      this.userConnections.set(user.id, ws);

      ws.on('message', (data) => {
        this.handleMessage(ws, data).catch(err => {
          logger.error('WS message handler error:', err);
          this.sendError(ws, err.message);
        });
      });

      ws.on('close', () => {
        logger.debug(`WS disconnected: ${user.username} (${ws.id})`);
        this.handleDisconnect(ws);
      });

      ws.on('error', (err) => {
        logger.error('WS socket error:', err);
      });
    });

    logger.info(`WebSocket server listening on /ws`);
    return this.wss;
  }

  async handleMessage(ws, data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      return this.sendError(ws, '无效的 JSON 消息');
    }

    const { type, payload } = message;

    switch (type) {
      case 'JOIN_CASE':
        await this.handleJoinCase(ws, payload);
        break;
      case 'LEAVE_CASE':
        this.handleLeaveCase(ws, payload);
        break;
      case 'ANNOTATION_CREATE':
        await this.handleAnnotationCreate(ws, payload);
        break;
      case 'ANNOTATION_UPDATE':
        await this.handleAnnotationUpdate(ws, payload);
        break;
      case 'ANNOTATION_DELETE':
        await this.handleAnnotationDelete(ws, payload);
        break;
      case 'CURSOR_POSITION':
        this.handleCursorPosition(ws, payload);
        break;
      case 'CASE_STATUS_CHANGE':
        this.handleCaseStatusChange(ws, payload);
        break;
      case 'PING':
        this.sendTo(ws, { type: 'PONG', timestamp: Date.now() });
        break;
      default:
        this.sendError(ws, `未知的消息类型: ${type}`);
    }
  }

  async handleJoinCase(ws, payload) {
    const { caseId } = payload;
    if (!caseId) return this.sendError(ws, '缺少 caseId');

    const { rows: [caseRow] } = await query(
      'SELECT id, status FROM inspection_case WHERE id = $1',
      [caseId]
    );
    if (!caseRow) return this.sendError(ws, '工单不存在');

    if (!this.rooms.has(caseId)) {
      this.rooms.set(caseId, new Set());
    }

    this.rooms.get(caseId).add(ws);
    ws.joinedRooms.add(caseId);

    const peers = this.getRoomPeers(caseId, ws.id);

    this.sendTo(ws, {
      type: 'JOIN_ACK',
      payload: {
        caseId,
        yourId: ws.id,
        peers: peers.map(p => ({ id: p.id, username: p.user.username, role: p.user.role, displayName: p.user.displayName }))
      }
    });

    this.broadcastToRoom(caseId, {
      type: 'PEER_JOINED',
      payload: {
        peer: { id: ws.id, username: ws.user.username, role: ws.user.role, displayName: ws.user.displayName }
      }
    }, ws.id);

    logger.debug(`WS join case: ${ws.user.username} -> ${caseId} (peers: ${peers.length})`);
  }

  handleLeaveCase(ws, payload) {
    const { caseId } = payload;
    if (!caseId || !this.rooms.has(caseId)) return;

    this.rooms.get(caseId).delete(ws);
    ws.joinedRooms.delete(caseId);

    this.broadcastToRoom(caseId, {
      type: 'PEER_LEFT',
      payload: { peerId: ws.id }
    });

    if (this.rooms.get(caseId).size === 0) {
      this.rooms.delete(caseId);
    }
  }

  async handleAnnotationCreate(ws, payload) {
    const { caseId, annotation } = payload;
    if (!caseId || !annotation) return this.sendError(ws, '缺少 caseId 或 annotation');

    this.broadcastToRoom(caseId, {
      type: 'ANNOTATION_CREATED',
      payload: {
        annotation,
        by: { id: ws.id, username: ws.user.username, displayName: ws.user.displayName },
        serverTimestamp: Date.now()
      }
    }, ws.id);

    logger.debug(`WS annotation create broadcast in ${caseId}: ${annotation?.id}`);
  }

  async handleAnnotationUpdate(ws, payload) {
    const { caseId, annotation } = payload;
    if (!caseId || !annotation) return this.sendError(ws, '缺少 caseId 或 annotation');

    this.broadcastToRoom(caseId, {
      type: 'ANNOTATION_UPDATED',
      payload: {
        annotation,
        by: { id: ws.id, username: ws.user.username, displayName: ws.user.displayName },
        serverTimestamp: Date.now()
      }
    }, ws.id);
  }

  async handleAnnotationDelete(ws, payload) {
    const { caseId, annotationId } = payload;
    if (!caseId || !annotationId) return this.sendError(ws, '缺少 caseId 或 annotationId');

    this.broadcastToRoom(caseId, {
      type: 'ANNOTATION_DELETED',
      payload: {
        annotationId,
        by: { id: ws.id, username: ws.user.username, displayName: ws.user.displayName },
        serverTimestamp: Date.now()
      }
    }, ws.id);
  }

  handleCursorPosition(ws, payload) {
    const { caseId, imageId, x, y, zoom } = payload;
    if (!caseId) return;

    this.broadcastToRoom(caseId, {
      type: 'CURSOR_UPDATE',
      payload: {
        peerId: ws.id,
        username: ws.user.username,
        displayName: ws.user.displayName,
        imageId,
        x, y, zoom
      }
    }, ws.id);
  }

  handleCaseStatusChange(ws, payload) {
    const { caseId, fromStatus, toStatus } = payload;
    if (!caseId) return;

    this.broadcastToRoom(caseId, {
      type: 'CASE_STATUS_CHANGED',
      payload: {
        caseId,
        fromStatus,
        toStatus,
        by: { id: ws.id, username: ws.user.username, displayName: ws.user.displayName },
        serverTimestamp: Date.now()
      }
    });
  }

  handleDisconnect(ws) {
    if (this.userConnections.get(ws.user?.id) === ws) {
      this.userConnections.delete(ws.user?.id);
    }

    ws.joinedRooms?.forEach(caseId => {
      this.rooms.get(caseId)?.delete(ws);
      this.broadcastToRoom(caseId, {
        type: 'PEER_LEFT',
        payload: { peerId: ws.id }
      });
      if (this.rooms.get(caseId)?.size === 0) {
        this.rooms.delete(caseId);
      }
    });
  }

  broadcastToRoom(caseId, message, excludeWsId = null) {
    const room = this.rooms.get(caseId);
    if (!room) return;

    const data = JSON.stringify(message);
    for (const client of room) {
      if (excludeWsId && client.id === excludeWsId) continue;
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  getRoomPeers(caseId, excludeWsId = null) {
    const room = this.rooms.get(caseId);
    if (!room) return [];
    return Array.from(room).filter(c => c.id !== excludeWsId);
  }

  sendTo(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  sendError(ws, errorMessage) {
    this.sendTo(ws, { type: 'ERROR', error: errorMessage, timestamp: Date.now() });
  }

  getRoomCount() {
    return this.rooms.size;
  }

  getUserCount() {
    return this.userConnections.size;
  }
}

module.exports = new CollabWebSocketServer();
