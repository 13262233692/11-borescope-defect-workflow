export class CollabConnection {
  constructor(caseId, token, handlers = {}) {
    this.caseId = caseId;
    this.token = token;
    this.handlers = handlers;
    this.ws = null;
    this.wsId = null;
    this.peers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.isManuallyClosed = false;
  }

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?token=${encodeURIComponent(this.token)}`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[Collab] WebSocket connected');
      this.reconnectAttempts = 0;
      this.send({ type: 'JOIN_CASE', payload: { caseId: this.caseId } });
      this.handlers.onConnected?.();
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[Collab] WebSocket error:', err);
      this.handlers.onError?.(err);
    };

    this.ws.onclose = (e) => {
      console.log(`[Collab] WebSocket closed (code=${e.code})`);
      this.handlers.onDisconnected?.();
      if (!this.isManuallyClosed) {
        this.scheduleReconnect();
      }
    };
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Collab] Max reconnect attempts reached');
      return;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[Collab] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  handleMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'JOIN_ACK':
        this.wsId = payload.yourId;
        payload.peers.forEach(p => this.peers.set(p.id, p));
        this.handlers.onJoinAck?.(payload);
        this.handlers.onPeersChanged?.(Array.from(this.peers.values()));
        break;

      case 'PEER_JOINED':
        this.peers.set(payload.peer.id, payload.peer);
        this.handlers.onPeerJoined?.(payload.peer);
        this.handlers.onPeersChanged?.(Array.from(this.peers.values()));
        break;

      case 'PEER_LEFT':
        this.peers.delete(payload.peerId);
        this.handlers.onPeerLeft?.(payload.peerId);
        this.handlers.onPeersChanged?.(Array.from(this.peers.values()));
        break;

      case 'ANNOTATION_CREATED':
        this.handlers.onAnnotationCreated?.(payload);
        break;

      case 'ANNOTATION_UPDATED':
        this.handlers.onAnnotationUpdated?.(payload);
        break;

      case 'ANNOTATION_DELETED':
        this.handlers.onAnnotationDeleted?.(payload);
        break;

      case 'CURSOR_UPDATE':
        this.handlers.onCursorUpdate?.(payload);
        break;

      case 'CASE_STATUS_CHANGED':
        this.handlers.onCaseStatusChanged?.(payload);
        break;

      case 'NEW_COMMENT':
        this.handlers.onNewComment?.(payload);
        break;

      case 'ANNOTATION_SYNC_COMPLETE':
        this.handlers.onAnnotationSyncComplete?.(payload);
        break;

      case 'ERROR':
        console.error('[Collab] Server error:', msg.error);
        this.handlers.onError?.(msg.error);
        break;

      case 'PONG':
        break;

      default:
        console.debug('[Collab] Unhandled message type:', type);
    }
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendCursor(imageId, x, y, zoom) {
    this.send({
      type: 'CURSOR_POSITION',
      payload: { caseId: this.caseId, imageId, x, y, zoom }
    });
  }

  broadcastAnnotationCreate(annotation) {
    this.send({
      type: 'ANNOTATION_CREATE',
      payload: { caseId: this.caseId, annotation }
    });
  }

  broadcastAnnotationUpdate(annotation) {
    this.send({
      type: 'ANNOTATION_UPDATE',
      payload: { caseId: this.caseId, annotation }
    });
  }

  broadcastAnnotationDelete(annotationId) {
    this.send({
      type: 'ANNOTATION_DELETE',
      payload: { caseId: this.caseId, annotationId }
    });
  }

  disconnect() {
    this.isManuallyClosed = true;
    if (this.ws) {
      this.send({ type: 'LEAVE_CASE', payload: { caseId: this.caseId } });
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.peers.clear();
  }
}
