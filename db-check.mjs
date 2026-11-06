import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

console.log('==============================');
console.log(' JOB FIGHTER DATABASE CHECK');
console.log('==============================');

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

console.log('DATABASE_URL:', Boolean(databaseUrl));
console.log('JWT_SECRET:', Boolean(jwtSecret && jwtSecret.length >= 32));

if (!databaseUrl) {
    console.error('DATABASE_URL이 설정되지 않았습니다.');
    process.exit(1);
}

if (!jwtSecret || jwtSecret.length < 32) {
    console.error('JWT_SECRET을 확인해 주세요.');
    process.exit(1);
}

try {
    const sql = neon(databaseUrl);

    // 데이터베이스 연결 확인
    const result = await sql`
        SELECT
            current_database() AS database_name,
            NOW() AS server_time
    `;

    console.log('');
    console.log('DATABASE CONNECTED!');
    console.log('DB 이름:', result[0].database_name);
    console.log('서버 시간:', result[0].server_time);

    // 게임에 필요한 테이블 확인
    const tables = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN (
            'players',
            'game_rooms',
            'room_signals'
        )
        ORDER BY table_name
    `;

    const required = [
        'players',
        'game_rooms',
        'room_signals'
    ];

    const found = tables.map(row => row.table_name);
    const missing = required.filter(name => !found.includes(name));

    console.log('');
    console.log('TABLE CHECK');

    for (const name of required) {
        console.log(
            name + ': ' + (found.includes(name) ? 'OK' : 'MISSING')
        );
    }

    if (missing.length > 0) {
        console.error('');
        console.error('누락된 테이블:', missing.join(', '));
        process.exitCode = 1;
    } else {
        console.log('');
        console.log('ALL TABLES READY!');
    }

} catch (error) {
    console.error('');
    console.error('DATABASE CONNECTION FAILED');
    console.error('오류 이름:', error.name);
    console.error('오류 코드:', error.code || '없음');
    console.error('오류 내용:', error.message);
    process.exitCode = 1;
}

console.log('==============================');
