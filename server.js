import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));

if (!process.env.VERCEL) {
	app.use(express.static(path.join(__dirname, 'public')));
}

function getSql() {
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
	return neon(process.env.DATABASE_URL);
}

function getJwtSecret() {
	if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
		throw new Error('JWT_SECRET 환경변수를 32자 이상의 임의 문자열로 설정해 주세요.');
	}
	return process.env.JWT_SECRET;
}

function requirePlayer(req, res, next) {
	try {
		const authHeader = req.get('authorization') || '';
		const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
		if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
		const claims = jwt.verify(token, getJwtSecret(), { issuer: 'job-fighter' });
		if (typeof claims.sub !== 'string') return res.status(401).json({ error: '인증 정보가 올바르지 않습니다.' });
		req.playerId = claims.sub;
		next();
	} catch (err) {
		return res.status(401).json({ error: '인증이 만료되었거나 올바르지 않습니다. 페이지를 새로고침해 주세요.' });
	}
}

function cleanRoomCode(value) {
	return String(value || '').trim().toUpperCase();
}

async function assertRoomMember(sql, code, playerId) {
	const rows = await sql`
    SELECT code, host_id, guest_id, status, expires_at
    FROM game_rooms
    WHERE code = ${code} AND (host_id = ${playerId} OR guest_id = ${playerId})
    LIMIT 1
  `;
	return rows[0] || null;
}

app.get('/api/health', async (_req, res) => {
	try {
		const sql = getSql();
		const rows = await sql`SELECT NOW() AS server_time`;
		res.json({ ok: true, database: 'connected', serverTime: rows[0].server_time });
	} catch (err) {
		console.error('Health check failed:', err);
		res.status(503).json({ ok: false, error: '데이터베이스 연결에 실패했습니다. 환경변수와 테이블을 확인해 주세요.' });
	}
});

app.post('/api/auth/guest', async (req, res) => {
	try {
		const secret = getJwtSecret();
		const sql = getSql();
		const id = randomUUID();
		const rawNickname = String(req.body?.nickname || '').trim();
		const nickname = (rawNickname || `전사${randomInt(1000, 10000)}`).replace(/[<>\u0000-\u001f]/g, '').slice(0, 16);
		await sql`
      INSERT INTO players (id, nickname)
      VALUES (${id}::uuid, ${nickname})
    `;
		const token = jwt.sign({ sub: id }, secret, { expiresIn: '30d', issuer: 'job-fighter' });
		res.status(201).json({ token, player: { id, nickname } });
	} catch (err) {
		console.error('Guest registration failed:', err);
		res.status(500).json({ error: '게스트 계정을 만들지 못했습니다. Neon 연결과 스키마를 확인해 주세요.' });
	}
});

app.get('/api/stats', requirePlayer, async (req, res) => {
	try {
		const sql = getSql();
		const rows = await sql`
      SELECT nickname, wins, losses
      FROM players WHERE id = ${req.playerId}::uuid LIMIT 1
    `;
		if (!rows[0]) return res.status(404).json({ error: '플레이어를 찾을 수 없습니다.' });
		res.json({ nickname: rows[0].nickname, wins: rows[0].wins, losses: rows[0].losses });
	} catch (err) {
		console.error('Stats read failed:', err);
		res.status(500).json({ error: '전적을 불러오지 못했습니다.' });
	}
});

app.post('/api/stats/result', requirePlayer, async (req, res) => {
	const result = req.body?.result;
	if (!['win', 'loss'].includes(result)) return res.status(400).json({ error: 'result는 win 또는 loss여야 합니다.' });
	try {
		const sql = getSql();
		const rows = await sql`
      UPDATE players
      SET wins = wins + ${result === 'win' ? 1 : 0},
          losses = losses + ${result === 'loss' ? 1 : 0}
      WHERE id = ${req.playerId}::uuid
      RETURNING wins, losses
    `;
		if (!rows[0]) return res.status(404).json({ error: '플레이어를 찾을 수 없습니다.' });
		res.json({ ok: true, wins: rows[0].wins, losses: rows[0].losses });
	} catch (err) {
		console.error('Stats update failed:', err);
		res.status(500).json({ error: '전적을 저장하지 못했습니다.' });
	}
});

app.post('/api/rooms', requirePlayer, async (req, res) => {
	try {
		const sql = getSql();
		for (let attempt = 0; attempt < 10; attempt++) {
			const code = String(randomInt(100000, 1000000));
			const rows = await sql`
        INSERT INTO game_rooms (code, host_id, status, expires_at)
        VALUES (${code}, ${req.playerId}::uuid, 'waiting', NOW() + INTERVAL '30 minutes')
        ON CONFLICT (code) DO NOTHING
        RETURNING code
      `;
			if (rows[0]) return res.status(201).json({ code: rows[0].code, role: 'host' });
		}
		res.status(503).json({ error: '대전방 코드를 만들지 못했습니다. 다시 시도해 주세요.' });
	} catch (err) {
		console.error('Room create failed:', err);
		res.status(500).json({ error: '대전방 생성에 실패했습니다. Neon 스키마를 확인해 주세요.' });
	}
});

app.post('/api/rooms/:code/join', requirePlayer, async (req, res) => {
	const code = cleanRoomCode(req.params.code);
	if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '6자리 방 번호를 입력해 주세요.' });
	try {
		const sql = getSql();
		const rows = await sql`
      UPDATE game_rooms
      SET guest_id = ${req.playerId}::uuid, status = 'connecting'
      WHERE code = ${code}
        AND host_id <> ${req.playerId}::uuid
        AND guest_id IS NULL
        AND status = 'waiting'
        AND expires_at > NOW()
      RETURNING code
    `;
		if (!rows[0]) return res.status(409).json({ error: '방이 없거나 이미 다른 참가자가 입장했거나 만료되었습니다.' });
		res.json({ ok: true, code: rows[0].code, role: 'guest' });
	} catch (err) {
		console.error('Room join failed:', err);
		res.status(500).json({ error: '대전방 참가에 실패했습니다.' });
	}
});

app.post('/api/rooms/:code/signals', requirePlayer, async (req, res) => {
	const code = cleanRoomCode(req.params.code);
	const { type, payload } = req.body || {};
	if (!['offer', 'answer', 'candidate'].includes(type) || !payload || typeof payload !== 'object') {
		return res.status(400).json({ error: '시그널 형식이 올바르지 않습니다.' });
	}
	try {
		const sql = getSql();
		const room = await assertRoomMember(sql, code, req.playerId);
		if (!room || room.status === 'closed' || new Date(room.expires_at) < new Date()) {
			return res.status(404).json({ error: '대전방을 찾을 수 없거나 만료되었습니다.' });
		}
		if (type === 'offer' && room.host_id !== req.playerId) return res.status(403).json({ error: '방장만 offer를 보낼 수 있습니다.' });
		if (type === 'answer' && room.guest_id !== req.playerId) return res.status(403).json({ error: '참가자만 answer를 보낼 수 있습니다.' });
		await sql`
      INSERT INTO room_signals (room_code, sender_id, signal_type, payload)
      VALUES (${code}, ${req.playerId}::uuid, ${type}, ${JSON.stringify(payload)}::jsonb)
    `;
		res.status(201).json({ ok: true });
	} catch (err) {
		console.error('Signal write failed:', err);
		res.status(500).json({ error: '연결 정보를 저장하지 못했습니다.' });
	}
});

app.get('/api/rooms/:code/signals', requirePlayer, async (req, res) => {
	const code = cleanRoomCode(req.params.code);
	const afterRaw = String(req.query.after || '0');
	if (!/^\d+$/.test(afterRaw)) return res.status(400).json({ error: 'after 값이 올바르지 않습니다.' });
	try {
		const sql = getSql();
		const room = await assertRoomMember(sql, code, req.playerId);
		if (!room || room.status === 'closed' || new Date(room.expires_at) < new Date()) {
			return res.status(404).json({ error: '대전방을 찾을 수 없거나 만료되었습니다.' });
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
		res.json({ signals: rows.map(row => ({ id: String(row.id), type: row.type, payload: row.payload })) });
	} catch (err) {
		console.error('Signal read failed:', err);
		res.status(500).json({ error: '상대방의 연결 정보를 읽지 못했습니다.' });
	}
});

app.post('/api/rooms/:code/leave', requirePlayer, async (req, res) => {
	const code = cleanRoomCode(req.params.code);
	try {
		const sql = getSql();
		await sql`
      UPDATE game_rooms SET status = 'closed'
      WHERE code = ${code} AND (host_id = ${req.playerId}::uuid OR guest_id = ${req.playerId}::uuid)
    `;
		res.json({ ok: true });
	} catch (err) {
		console.warn('Room leave update failed:', err);
		res.json({ ok: true });
	}
});

// Express 앱은 Vercel에서 Function으로 실행되고, 로컬에서는 포트 3000으로 실행됩니다.
if (!process.env.VERCEL) {
	const port = Number(process.env.PORT || 3000);
	app.listen(port, () => console.log(`Job Fighter server: http://localhost:${port}`));
}

export default app;