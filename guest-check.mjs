const API_URL = 'http://127.0.0.1:3000/api/auth/guest';

const nickname = '테스트전사';

console.log('==============================');
console.log(' JOB FIGHTER GUEST CHECK');
console.log('==============================');

try {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({ nickname })
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('서버 응답이 JSON 형식이 아닙니다: ' + text);
    }

    console.log('HTTP 상태:', response.status);

    if (!response.ok) {
        console.error('계정 생성 실패:', data.error || text);
        process.exitCode = 1;
    } else {
        console.log('계정 생성 성공!');
        console.log('플레이어 ID:', data.player?.id);
        console.log('닉네임:', data.player?.nickname);
        console.log('JWT 발급 여부:', Boolean(data.token));
    }

} catch (error) {
    console.error('테스트 실패:', error.message);
    process.exitCode = 1;
}

console.log('==============================');
