import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';

const app = express();
const CURRENT_FILE = fileURLToPath(import.meta.url);
const __dirname = path.dirname(CURRENT_FILE);
const IS_DIRECT_EXECUTION = Boolean(process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILE);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const JWT_ISSUER = 'job-fighter';
const JWT_ALGORITHM = 'HS256';
const TOKEN_LIFETIME = '30d';
const ROOM_LIFETIME_MINUTES = 30;
const REQUIRED_TABLES = ['players', 'game_rooms', 'room_signals'];
const IS_VERCEL = process.env.VERCEL === '1' && !IS_DIRECT_EXECUTION;

app.disable('x-powered-by');
app.use(express.json({ limit: '128kb', strict: true }));
app.use('/api', (_req, res, next) => {
	res.set('Cache-Control', 'no-store');
	res.set('X-Content-Type-Options', 'nosniff');
	next();
});

if (!IS_VERCEL) {
	app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));
}

let cachedSql = null;
let cachedDatabaseUrl = null;

function getSql() {
	const databaseUrl = process.env.DATABASE_URL?.trim();
	if (!databaseUrl) {
		const error = new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
		error.code = 'DATABASE_URL_MISSING';
		throw error;
	}
	if (!cachedSql || cachedDatabaseUrl !== databaseUrl) {
		cachedSql = neon(databaseUrl);
		cachedDatabaseUrl = databaseUrl;
	}
	return cachedSql;
}

function getJwtSecret() {
	const secret = process.env.JWT_SECRET?.trim();
	if (!secret || secret.length < 32) {
		const error = new Error('JWT_SECRET은 32자 이상의 임의 문자열이어야 합니다.');
		error.code = 'JWT_SECRET_INVALID';
		throw error;
	}
	return secret;
}

function getRealtimeTokenSecret() {
	const secret = process.env.REALTIME_TOKEN_SECRET?.trim();
	if (!secret || secret.length < 32) {
		const error = new Error('REALTIME_TOKEN_SECRET은 32자 이상의 임의 문자열이어야 합니다.');
		error.code = 'REALTIME_SECRET_INVALID';
		throw error;
	}
	return secret;
}

function logError(context, error) {
	console.error(`[${context}]`, {
		name: error?.name || 'Error',
		code: error?.code || 'UNKNOWN',
		message: error?.message || String(error),
	});
}

function sendServerError(res, error, publicMessage) {
	logError('API error', error);
	const code = typeof error?.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code)
		? error.code
		: 'SERVER_ERROR';
	return res.status(500).json({ error: publicMessage, code });
}

function cleanNickname(value) {
	const raw = typeof value === 'string' ? value : '';
	const cleaned = raw
		.normalize('NFC')
		.trim()
		.replace(/[<>\u0000-\u001f\u007f]/g, '');
	const chars = Array.from(cleaned).slice(0, 16).join('');
	return chars || `전사${randomInt(1000, 10000)}`;
}

function cleanRoomCode(value) {
	return String(value ?? '').trim();
}

function isValidRoomCode(value) {
	return /^\d{6}$/.test(value);
}

function requirePlayer(req, res, next) {
	const authHeader = req.get('authorization') || '';
	const match = /^Bearer\s+(.+)$/i.exec(authHeader);
	if (!match) {
		return res.status(401).json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' });
	}

	let secret;
	try {
		secret = getJwtSecret();
	} catch (error) {
		logError('JWT configuration', error);
		return res.status(500).json({ error: '서버 인증 설정을 확인해 주세요.', code: error.code });
	}

	try {
		const claims = jwt.verify(match[1], secret, {
			algorithms: [JWT_ALGORITHM],
			issuer: JWT_ISSUER,
		});

		if (typeof claims.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.sub)) {
			return res.status(401).json({ error: '인증 정보가 올바르지 않습니다.', code: 'AUTH_INVALID' });
		}

		req.playerId = claims.sub;
		return next();
	} catch {
		return res.status(401).json({
			error: '인증이 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.',
			code: 'AUTH_EXPIRED_OR_INVALID',
		});
	}
}

async function getRoomForMember(sql, code, playerId) {
	const rows = await sql`
    SELECT code, host_id, guest_id, status, expires_at
    FROM game_rooms
    WHERE code = ${code}
      AND (host_id = ${playerId}::uuid OR guest_id = ${playerId}::uuid)
    LIMIT 1
  `;
	return rows[0] || null;
}

function isRoomUnavailable(room) {
	return !room || room.status === 'closed' || new Date(room.expires_at).getTime() <= Date.now();
}

app.get('/api', (_req, res) => {
	res.json({ name: 'job-fighter-api', ok: true });
});

app.get('/api/health', async (_req, res) => {
	try {
		const sql = getSql();
		const [dbInfo] = await sql`
      SELECT NOW() AS server_time, current_database() AS database_name
    `;

		const [tableInfo] = await sql`
      SELECT
        to_regclass('public.players') IS NOT NULL AS players,
        to_regclass('public.game_rooms') IS NOT NULL AS game_rooms,
        to_regclass('public.room_signals') IS NOT NULL AS room_signals
    `;

		const missingTables = REQUIRED_TABLES.filter((table) => tableInfo[table] !== true);
		const schemaReady = missingTables.length === 0;

		return res.status(schemaReady ? 200 : 503).json({
			ok: schemaReady,
			service: 'job-fighter-api',
			database: 'connected',
			schema: schemaReady ? 'ready' : 'incomplete',
			realtime: process.env.REALTIME_TOKEN_SECRET?.trim() && process.env.REALTIME_WS_URL?.trim()
				? 'configured'
				: 'not_configured',
			missingTables,
			databaseName: dbInfo.database_name,
			serverTime: dbInfo.server_time,
		});
	} catch (error) {
		logError('Health check failed', error);
		const code = typeof error?.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code)
			? error.code
			: 'DATABASE_CONNECTION_FAILED';
		return res.status(503).json({
			ok: false,
			service: 'job-fighter-api',
			database: 'disconnected',
			error: '데이터베이스 연결을 확인할 수 없습니다. Vercel 환경변수 DATABASE_URL과 Neon 상태를 확인해 주세요.',
			code,
		});
	}
});

app.get('/api/realtime-ticket', requirePlayer, async (req, res) => {
	const code = cleanRoomCode(req.query.room);
	if (!isValidRoomCode(code)) {
		return res.status(400).json({ error: '6자리 대전방 코드가 필요합니다.', code: 'INVALID_ROOM_CODE' });
	}

	let secret;
	let websocketBase;
	try {
		secret = getRealtimeTokenSecret();
		websocketBase = process.env.REALTIME_WS_URL?.trim();
		if (!websocketBase) {
			const error = new Error('REALTIME_WS_URL 환경변수가 설정되지 않았습니다.');
			error.code = 'REALTIME_URL_MISSING';
			throw error;
		}
	} catch (error) {
		logError('Realtime configuration', error);
		return res.status(503).json({
			error: '실시간 서버 설정이 아직 완료되지 않았습니다. Vercel의 REALTIME_TOKEN_SECRET과 REALTIME_WS_URL을 확인해 주세요.',
			code: error.code || 'REALTIME_CONFIGURATION_INVALID',
		});
	}

	try {
		const base = new URL(websocketBase);
		if (base.protocol !== 'wss:' || base.username || base.password) {
			return res.status(503).json({
				error: 'REALTIME_WS_URL은 wss://로 시작하는 Cloudflare Worker 주소여야 합니다.',
				code: 'REALTIME_URL_INVALID',
			});
		}
		base.pathname = `/ws/${code}`;
		base.search = '';
		base.hash = '';

		const sql = getSql();
		const room = await getRoomForMember(sql, code, req.playerId);
		if (isRoomUnavailable(room)) {
			return res.status(404).json({ error: '대전방을 찾을 수 없거나 만료되었습니다.', code: 'ROOM_NOT_FOUND' });
		}

		const role = room.host_id === req.playerId ? 'host'
			: room.guest_id === req.playerId ? 'guest' : null;
		if (!role) {
			return res.status(403).json({ error: '이 대전방에 참가할 권한이 없습니다.', code: 'ROOM_MEMBER_MISMATCH' });
		}

		const token = jwt.sign(
			{ room: code, role },
			secret,
			{
				algorithm: JWT_ALGORITHM,
				issuer: 'job-fighter-realtime',
				audience: 'job-fighter-worker',
				subject: req.playerId,
				expiresIn: '5m',
			},
		);

		return res.set('Cache-Control', 'no-store').json({
			ok: true,
			role,
			token,
			websocketUrl: base.toString(),
			expiresInSeconds: 300,
		});
	} catch (error) {
		return sendServerError(res, error, '실시간 대전 접속 정보를 발급하지 못했습니다.');
	}
});

app.post('/api/auth/guest', async (req, res) => {
	try {
		const secret = getJwtSecret();
		const sql = getSql();
		const playerId = randomUUID();
		const nickname = cleanNickname(req.body?.nickname);

		await sql`
      INSERT INTO players (id, nickname)
      VALUES (${playerId}::uuid, ${nickname})
    `;

		const token = jwt.sign(
			{ sub: playerId },
			secret,
			{ algorithm: JWT_ALGORITHM, expiresIn: TOKEN_LIFETIME, issuer: JWT_ISSUER }
		);

		return res.status(201).json({
			ok: true,
			token,
			player: { id: playerId, nickname },
		});
	} catch (error) {
		return sendServerError(res, error, '게스트 계정을 만들지 못했습니다. DB 연결과 players 테이블을 확인해 주세요.');
	}
});

app.get('/api/stats', requirePlayer, async (req, res) => {
	try {
		const sql = getSql();
		const rows = await sql`
      SELECT nickname, wins, losses
      FROM players
      WHERE id = ${req.playerId}::uuid
      LIMIT 1
    `;

		if (!rows[0]) {
			return res.status(404).json({ error: '플레이어를 찾을 수 없습니다.', code: 'PLAYER_NOT_FOUND' });
		}

		return res.json({
			nickname: rows[0].nickname,
			wins: Number(rows[0].wins),
			losses: Number(rows[0].losses),
		});
	} catch (error) {
		return sendServerError(res, error, '전적을 불러오지 못했습니다.');
	}
});

app.post('/api/stats/result', requirePlayer, async (req, res) => {
	const result = req.body?.result;
	if (result !== 'win' && result !== 'loss') {
		return res.status(400).json({ error: 'result는 win 또는 loss여야 합니다.', code: 'INVALID_RESULT' });
	}

	try {
		const sql = getSql();
		const rows = await sql`
      UPDATE players
      SET wins = wins + ${result === 'win' ? 1 : 0},
          losses = losses + ${result === 'loss' ? 1 : 0}
      WHERE id = ${req.playerId}::uuid
      RETURNING wins, losses
    `;

		if (!rows[0]) {
			return res.status(404).json({ error: '플레이어를 찾을 수 없습니다.', code: 'PLAYER_NOT_FOUND' });
		}

		return res.json({
			ok: true,
			wins: Number(rows[0].wins),
			losses: Number(rows[0].losses),
		});
	} catch (error) {
		return sendServerError(res, error, '전적을 저장하지 못했습니다.');
	}
});

app.post('/api/rooms', requirePlayer, async (req, res) => {
	try {
		const sql = getSql();

		for (let attempt = 0; attempt < 10; attempt += 1) {
			const code = String(randomInt(100000, 1000000));
			const rows = await sql`
        INSERT INTO game_rooms (code, host_id, status, expires_at)
        VALUES (
          ${code},
          ${req.playerId}::uuid,
          'waiting',
          NOW() + (${ROOM_LIFETIME_MINUTES} * INTERVAL '1 minute')
        )
        ON CONFLICT (code) DO NOTHING
        RETURNING code, expires_at
      `;

			if (rows[0]) {
				return res.status(201).json({
					ok: true,
					code: rows[0].code,
					role: 'host',
					expiresAt: rows[0].expires_at,
				});
			}
		}

		return res.status(503).json({ error: '대전방 코드를 만들지 못했습니다. 다시 시도해 주세요.', code: 'ROOM_CODE_UNAVAILABLE' });
	} catch (error) {
		return sendServerError(res, error, '대전방 생성에 실패했습니다. game_rooms 테이블을 확인해 주세요.');
	}
});

app.post('/api/rooms/:code/join', requirePlayer, async (req, res) => {
	const code = cleanRoomCode(req.params.code);
	if (!isValidRoomCode(code)) {
		return res.status(400).json({ error: '6자리 방 번호를 입력해 주세요.', code: 'INVALID_ROOM_CODE' });
	}

	try {
		const sql = getSql();
		const rows = await sql`
      UPDATE game_rooms
      SET guest_id = ${req.playerId}::uuid,
          status = 'connecting'
      WHERE code = ${code}
        AND host_id <> ${req.playerId}::uuid
        AND guest_id IS NULL
        AND status = 'waiting'
        AND expires_at > NOW()
      RETURNING code, expires_at
    `;

		if (!rows[0]) {
			return res.status(409).json({
				error: '방이 없거나 이미 다른 참가자가 입장했거나 만료되었습니다.',
				code: 'ROOM_NOT_JOINABLE',
			});
		}

		return res.json({ ok: true, code: rows[0].code, role: 'guest', expiresAt: rows[0].expires_at });
	} catch (error) {
		return sendServerError(res, error, '대전방 참가에 실패했습니다.');
	}
});

app.post('/api/rooms/:code/signals', requirePlayer, async (req, res) => {
	const code = cleanRoomCode(req.params.code);
	const { type, payload } = req.body || {};

	if (!isValidRoomCode(code)) {
		return res.status(400).json({ error: '6자리 방 번호가 올바르지 않습니다.', code: 'INVALID_ROOM_CODE' });
	}

	if (!['offer', 'answer', 'candidate'].includes(type) ||
		payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
		return res.status(400).json({ error: 'WebRTC 시그널 형식이 올바르지 않습니다.', code: 'INVALID_SIGNAL' });
	}

	let serializedPayload;
	try {
		serializedPayload = JSON.stringify(payload);
	} catch {
		return res.status(400).json({ error: '시그널 데이터를 JSON으로 변환할 수 없습니다.', code: 'INVALID_SIGNAL_JSON' });
	}

	if (Buffer.byteLength(serializedPayload, 'utf8') > 48 * 1024) {
		return res.status(413).json({ error: '시그널 데이터가 너무 큽니다.', code: 'SIGNAL_TOO_LARGE' });
	}

	try {
		const sql = getSql();
		const room = await getRoomForMember(sql, code, req.playerId);

		if (isRoomUnavailable(room)) {
			return res.status(404).json({ error: '대전방을 찾을 수 없거나 만료되었습니다.', code: 'ROOM_NOT_FOUND' });
		}

		if (type === 'offer' && room.host_id !== req.playerId) {
			return res.status(403).json({ error: '방장만 offer를 보낼 수 있습니다.', code: 'HOST_ONLY' });
		}
		if (type === 'answer' && room.guest_id !== req.playerId) {
			return res.status(403).json({ error: '참가자만 answer를 보낼 수 있습니다.', code: 'GUEST_ONLY' });
		}

		await sql`
      INSERT INTO room_signals (room_code, sender_id, signal_type, payload)
      VALUES (${code}, ${req.playerId}::uuid, ${type}, ${serializedPayload}::jsonb)
    `;

		return res.status(201).json({ ok: true });
	} catch (error) {
		return sendServerError(res, error, 'WebRTC 연결 정보를 저장하지 못했습니다.');
	}
});

app.get('/api/rooms/:code/signals', requirePlayer, async (req, res) => {
	const code = cleanRoomCode(req.params.code);
	const afterRaw = String(req.query.after ?? '0');

	if (!isValidRoomCode(code)) {
		return res.status(400).json({ error: '6자리 방 번호가 올바르지 않습니다.', code: 'INVALID_ROOM_CODE' });
	}
	if (!/^\d{1,18}$/.test(afterRaw)) {
		return res.status(400).json({ error: 'after 값이 올바르지 않습니다.', code: 'INVALID_SIGNAL_CURSOR' });
	}

	try {
		const sql = getSql();
		const room = await getRoomForMember(sql, code, req.playerId);

		if (isRoomUnavailable(room)) {
			return res.status(404).json({ error: '대전방을 찾을 수 없거나 만료되었습니다.', code: 'ROOM_NOT_FOUND' });
		}

		const rows = await sql`
      SELECT id, signal_type AS type, payload
      FROM room_signals
      WHERE room_code = ${code}
        AND sender_id <> ${req.playerId}::uuid
        AND id > ${afterRaw}::bigint
      ORDER BY id ASC
      LIMIT 100
    `;

		return res.json({
			signals: rows.map((row) => ({
				id: String(row.id),
				type: row.type,
				payload: row.payload,
			})),
		});
	} catch (error) {
		return sendServerError(res, error, '상대방의 WebRTC 연결 정보를 읽지 못했습니다.');
	}
});

app.post('/api/rooms/:code/leave', requirePlayer, async (req, res) => {
	const code = cleanRoomCode(req.params.code);
	if (!isValidRoomCode(code)) {
		return res.status(400).json({ error: '6자리 방 번호가 올바르지 않습니다.', code: 'INVALID_ROOM_CODE' });
	}

	try {
		const sql = getSql();
		await sql`
      UPDATE game_rooms
      SET status = 'closed'
      WHERE code = ${code}
        AND (host_id = ${req.playerId}::uuid OR guest_id = ${req.playerId}::uuid)
    `;
		return res.json({ ok: true });
	} catch (error) {
		return sendServerError(res, error, '대전방을 종료하지 못했습니다.');
	}
});

app.get(['/', '/index.html'], (_req, res, next) => {
	res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (error) => {
		if (error) next(error);
	});
});

app.use('/api', (_req, res) => {
	res.status(404).json({ error: '존재하지 않는 API 경로입니다.', code: 'API_ROUTE_NOT_FOUND' });
});

app.use((req, res) => {
	res.status(404).type('text').send('요청한 페이지를 찾을 수 없습니다.');
});

app.use((error, _req, res, _next) => {
	if (error?.type === 'entity.parse.failed') {
		return res.status(400).json({ error: 'JSON 요청 본문 형식이 올바르지 않습니다.', code: 'INVALID_JSON' });
	}
	logError('Unhandled Express error', error);
	return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.', code: 'INTERNAL_SERVER_ERROR' });
});

if (IS_DIRECT_EXECUTION) {
	const server = app.listen(PORT, '0.0.0.0', () => {
		console.log(`Job Fighter server listening at http://127.0.0.1:${PORT}`);
	});

	server.on('error', (error) => {
		logError('Local server startup failed', error);
		if (error?.code === 'EADDRINUSE') {
			console.error(`포트 ${PORT}가 이미 사용 중입니다. 기존 서버를 종료하거나 PORT를 변경하세요.`);
		}
		process.exitCode = 1;
	});
}

export default app;