const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const nickname = '테스트전사';

try {
	const response = await fetch(`${baseUrl}/api/auth/guest`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify({ nickname }),
	});
	const data = await response.json();
	console.log('HTTP:', response.status);

	if (!response.ok) {
		console.error('GUEST CHECK FAILED:', data.error || data);
		process.exitCode = 1;
	} else {
		console.log('GUEST CHECK OK');
		console.log('Player ID:', data.player?.id);
		console.log('Nickname:', data.player?.nickname);
		console.log('JWT issued:', Boolean(data.token));
		if (data.player?.nickname !== nickname) {
			console.error('닉네임이 요청값과 다릅니다.');
			process.exitCode = 1;
		}
	}
} catch (error) {
	console.error('GUEST CHECK FAILED:', error.message);
	process.exitCode = 1;
}