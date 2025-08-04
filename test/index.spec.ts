import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const mockRepos = [
	{ id: 1, name: 'repo1', full_name: 'user/repo1', stargazers_count: 1, language: 'TypeScript' },
	{ id: 2, name: 'repo2', full_name: 'user/repo2', stargazers_count: 1, language: 'TypeScript' },
	{ id: 3, name: 'repo3', full_name: 'user/repo3', stargazers_count: 1, language: 'JavaScript' },
	{ id: 4, name: 'repo4', full_name: 'user/repo4', stargazers_count: 1, language: 'Python' },
	{ id: 5, name: 'repo5', full_name: 'user/repo5', stargazers_count: 1, language: 'Python' },
	{ id: 6, name: 'repo6', full_name: 'user/repo6', stargazers_count: 1, language: 'Python' },
	{ id: 7, name: 'repo7', full_name: 'user/repo7', stargazers_count: 1, language: null },
];

describe('gh-lang-stats-ts worker', () => {
	it('should respond to OPTIONS request with CORS headers', async () => {
		const request = new IncomingRequest('http://example.com/testuser', { method: 'OPTIONS' });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
		expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
	});

	it('should return 405 for non-GET/OPTIONS requests', async () => {
		for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
			const request = new IncomingRequest('http://example.com/testuser', { method });
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(405);
			expect(await response.text()).toBe('Method not allowed');
		}
	});

	it('should return svg for a valid user', async () => {
		const fetch = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
			if (url.toString().startsWith('https://api.github.com/users/')) {
				return new Response(JSON.stringify(mockRepos), {
					headers: { 'Content-Type': 'application/json' },
				});
			}
			return new Response('Not found', { status: 404 });
		});

		const request = new IncomingRequest('http://example.com/testuser');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
		const svg = await response.text();
		expect(svg).toContain('<svg');
		expect(svg).toContain('Top Languages');
		expect(svg).toContain('Python');
		expect(svg).toContain('TypeScript');
		expect(svg).toContain('JavaScript');
		expect(svg).toContain('50.00%');
		expect(svg).toContain('33.33%');
		expect(svg).toContain('16.67%');

		fetch.mockRestore();
	});

	it('should handle github api errors gracefully', async () => {
		const fetch = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
			if (url.toString().startsWith('https://api.github.com/users/')) {
				return new Response(JSON.stringify({ message: 'API error' }), { status: 403, statusText: 'Forbidden' });
			}
			return new Response('Not found', { status: 404 });
		});

		const request = new IncomingRequest('http://example.com/testuser');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(500);
		const json = await response.json();
		expect(json.error).toBe('Failed to fetch repository data');
		expect(json.message).toContain('GitHub API error: 403 Forbidden');

		fetch.mockRestore();
	});

	it('should respect the `top` query parameter', async () => {
		const fetch = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
			if (url.toString().startsWith('https://api.github.com/users/')) {
				return new Response(JSON.stringify(mockRepos), {
					headers: { 'Content-Type': 'application/json' },
				});
			}
			return new Response('Not found', { status: 404 });
		});

		const request = new IncomingRequest('http://example.com/testuser?top=2');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const svg = await response.text();
		expect(svg).toContain('Python');
		expect(svg).toContain('TypeScript');
		expect(svg).not.toContain('JavaScript');

		fetch.mockRestore();
	});

	it('should handle missing username', async () => {
		const fetch = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
			if (url.toString().includes('undefined')) {
				return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, statusText: 'Not Found' });
			}
			return new Response(JSON.stringify(mockRepos), {
				headers: { 'Content-Type': 'application/json' },
			});
		});

		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(500);
		const json = await response.json();
		expect(json.error).toBe('Failed to fetch repository data');
		expect(json.message).toContain('GitHub API error: 404 Not Found');

		fetch.mockRestore();
	});
});
