import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL?.trim();
console.log('DATABASE_URL:', Boolean(url));
console.log('JWT_SECRET:', Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 32));

if (!url) {
  console.error('DATABASE_URL이 없습니다. 프로젝트 최상위 .env를 확인하세요.');
  process.exit(1);
}

try {
  const sql = neon(url);
  const [db] = await sql`SELECT current_database() AS name, NOW() AS server_time`;
  const [tables] = await sql`
    SELECT
      to_regclass('public.players') IS NOT NULL AS players,
      to_regclass('public.game_rooms') IS NOT NULL AS game_rooms,
      to_regclass('public.room_signals') IS NOT NULL AS room_signals
  `;

  console.log('DATABASE CONNECTED:', db.name);
  for (const name of ['players', 'game_rooms', 'room_signals']) {
    console.log(`${name}: ${tables[name] ? 'OK' : 'MISSING'}`);
  }
  console.log('SERVER TIME:', db.server_time);
  if (!tables.players || !tables.game_rooms || !tables.room_signals) process.exitCode = 1;
} catch (error) {
  console.error('DATABASE CHECK FAILED');
  console.error('name:', error.name);
  console.error('code:', error.code || '(none)');
  console.error('message:', error.message);
  process.exitCode = 1;
}
