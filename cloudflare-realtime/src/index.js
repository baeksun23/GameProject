import { DurableObject } from 'cloudflare:workers';

const MAX_GAME_MESSAGE_BYTES = 8 * 1024;
const MAX_MESSAGES_PER_SECOND = 120;
const TOKEN_ISSUER = 'job-fighter-realtime';
const TOKEN_AUDIENCE = 'job-fighter-worker';
const encoder = new TextEncoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function verifyRealtimeToken(token, secret, expectedRoom) {
  if (typeof token !== 'string' || token.length > 4096 || !secret || secret.length < 32) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = decodeJsonPart(parts[0]);
    const claims = decodeJsonPart(parts[1]);
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null;

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const verified = await crypto.subtle.verify(
      'HMAC',
      key,
      decodeBase64Url(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!verified) return null;

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== TOKEN_ISSUER || claims.aud !== TOKEN_AUDIENCE) return null;
    if (!Number.isInteger(claims.exp) || claims.exp <= now) return null;
    if (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now)) return null;
    if (claims.room !== expectedRoom || !['host', 'guest'].includes(claims.role)) return null;
    if (typeof claims.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.sub)) return null;

    return claims;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({
        ok: true,
        service: 'job-fighter-realtime',
        durableObjects: 'ready',
        tokenSecret: env.REALTIME_TOKEN_SECRET && env.REALTIME_TOKEN_SECRET.length >= 32 ? 'configured' : 'missing',
      }, env.REALTIME_TOKEN_SECRET && env.REALTIME_TOKEN_SECRET.length >= 32 ? 200 : 503);
    }

    const match = /^\/ws\/(\d{6})$/.exec(url.pathname);
    if (!match) return json({ error: '지원하지 않는 경로입니다.', code: 'NOT_FOUND' }, 404);
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket Upgrade가 필요합니다.', { status: 426 });
    }
    if (!env.REALTIME_TOKEN_SECRET || env.REALTIME_TOKEN_SECRET.length < 32) {
      return json({ error: '실시간 인증 비밀키가 설정되지 않았습니다.', code: 'REALTIME_SECRET_MISSING' }, 503);
    }

    const roomCode = match[1];
    const id = env.GAME_ROOMS.idFromName(roomCode);
    const stub = env.GAME_ROOMS.get(id);
    return stub.fetch(request);
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.authTimers = new Map();
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong'),
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    const match = /^\/ws\/(\d{6})$/.exec(url.pathname);
    if (!match) return new Response('잘못된 대전방 코드입니다.', { status: 400 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket Upgrade가 필요합니다.', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      roomCode: match[1],
      authenticated: false,
      playerId: null,
      role: null,
      messageWindowStartedAt: Date.now(),
      messageCount: 0,
    });

    // 인증 첫 메시지를 보내지 않는 연결은 짧은 시간 뒤 종료합니다.
    const authTimer = setTimeout(() => {
      this.authTimers.delete(server);
      try {
        const attachment = server.deserializeAttachment();
        if (!attachment?.authenticated && server.readyState === WebSocket.OPEN) {
          server.close(1008, 'Authentication timeout');
        }
      } catch {
        // 이미 연결이 닫힌 경우 무시합니다.
      }
    }, 10000);
    this.authTimers.set(server, authTimer);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let packet;
    try {
      if (typeof message !== 'string' || encoder.encode(message).byteLength > MAX_GAME_MESSAGE_BYTES) {
        ws.close(1009, 'Message too large');
        return;
      }
      packet = JSON.parse(message);
    } catch {
      ws.close(1007, 'Invalid JSON');
      return;
    }

    const attachment = ws.deserializeAttachment() || {};
    if (!attachment.authenticated) {
      if (packet?.type !== 'auth') {
        ws.close(1008, 'Authentication required');
        return;
      }

      const claims = await verifyRealtimeToken(
        packet.token,
        this.env.REALTIME_TOKEN_SECRET,
        attachment.roomCode,
      );
      if (!claims) {
        ws.send(JSON.stringify({ type: 'error', code: 'AUTH_INVALID', message: '실시간 인증 정보가 유효하지 않습니다.' }));
        ws.close(1008, 'Invalid token');
        return;
      }

      const authTimer = this.authTimers.get(ws);
      if (authTimer) clearTimeout(authTimer);
      this.authTimers.delete(ws);

      const sockets = this.ctx.getWebSockets();
      for (const other of sockets) {
        if (other === ws) continue;
        const otherInfo = other.deserializeAttachment() || {};
        if (!otherInfo.authenticated || otherInfo.role !== claims.role) continue;

        // 같은 플레이어의 재접속은 이전 연결을 조용히 교체합니다.
        if (otherInfo.playerId === claims.sub) {
          otherInfo.silentClose = true;
          other.serializeAttachment(otherInfo);
          try { other.close(4001, 'Replaced by a newer connection'); } catch { /* ignored */ }
        } else {
          ws.send(JSON.stringify({ type: 'error', code: 'ROOM_ROLE_TAKEN', message: '해당 플레이어 자리는 이미 사용 중입니다.' }));
          ws.close(1008, 'Room role already connected');
          return;
        }
      }

      ws.serializeAttachment({
        ...attachment,
        authenticated: true,
        playerId: claims.sub,
        role: claims.role,
        tokenExpiresAt: claims.exp,
        messageWindowStartedAt: Date.now(),
        messageCount: 0,
      });

      ws.send(JSON.stringify({ type: 'authenticated', role: claims.role }));
      this.notifyRoomReady(attachment.roomCode);
      return;
    }

    if (packet?.type !== 'game' || !packet.data || typeof packet.data !== 'object' || Array.isArray(packet.data)) {
      ws.close(1008, 'Invalid game packet');
      return;
    }

    const now = Date.now();
    const windowStart = Number(attachment.messageWindowStartedAt) || now;
    if (now - windowStart >= 1000) {
      attachment.messageWindowStartedAt = now;
      attachment.messageCount = 0;
    }
    attachment.messageCount = (Number(attachment.messageCount) || 0) + 1;
    if (attachment.messageCount > MAX_MESSAGES_PER_SECOND) {
      ws.serializeAttachment(attachment);
      ws.close(1008, 'Message rate limit exceeded');
      return;
    }
    ws.serializeAttachment(attachment);

    const data = packet.data;
    if (!['sel', 'in', 'sync'].includes(data.t)) {
      ws.close(1008, 'Unsupported game message');
      return;
    }
    if (data.t === 'sel' && (typeof data.job !== 'string' || data.job.length > 32)) {
      ws.close(1008, 'Invalid character selection');
      return;
    }
    if (data.t === 'in' && (!data.k || typeof data.k !== 'object' || Array.isArray(data.k))) {
      ws.close(1008, 'Invalid input state');
      return;
    }
    if (data.t === 'sync' && ((!data.p0 || typeof data.p0 !== 'object') || (!data.p1 || typeof data.p1 !== 'object'))) {
      ws.close(1008, 'Invalid game state');
      return;
    }

    const outgoing = JSON.stringify({ type: 'game', data });
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws || peer.readyState !== WebSocket.OPEN) continue;
      const peerInfo = peer.deserializeAttachment() || {};
      if (peerInfo.authenticated && peerInfo.roomCode === attachment.roomCode) {
        try { peer.send(outgoing); } catch { /* closed peer */ }
      }
    }
  }

  notifyRoomReady(roomCode) {
    const sockets = this.ctx.getWebSockets();
    const active = sockets.filter((socket) => {
      const info = socket.deserializeAttachment() || {};
      return info.authenticated && info.roomCode === roomCode && socket.readyState === WebSocket.OPEN;
    });
    const roles = new Set(active.map((socket) => (socket.deserializeAttachment() || {}).role));

    if (roles.has('host') && roles.has('guest')) {
      const message = JSON.stringify({ type: 'peer-ready' });
      for (const socket of active) {
        try { socket.send(message); } catch { /* closed peer */ }
      }
      return;
    }

    const message = JSON.stringify({ type: 'waiting' });
    for (const socket of active) {
      try { socket.send(message); } catch { /* closed peer */ }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const info = ws.deserializeAttachment() || {};
    if (!info.authenticated || info.silentClose) return;

    const message = JSON.stringify({
      type: 'peer-left',
      role: info.role,
      reason: typeof reason === 'string' ? reason.slice(0, 120) : '',
    });
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws || peer.readyState !== WebSocket.OPEN) continue;
      const peerInfo = peer.deserializeAttachment() || {};
      if (peerInfo.authenticated && peerInfo.roomCode === info.roomCode) {
        try { peer.send(message); } catch { /* closed peer */ }
      }
    }
  }

  async webSocketError(ws, error) {
    const info = ws.deserializeAttachment() || {};
    console.warn('GameRoom WebSocket error', {
      roomCode: info.roomCode,
      role: info.role,
      message: error?.message || 'unknown',
    });
  }
}
