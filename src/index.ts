/**
 * Cloudflare Worker to fetch user's top Github languages
 */

interface GitHubRepo {
	id: number;
	name: string;
	full_name: string;
	stargazers_count: number;
	// updated_at: string;
	language: string | null;
}

export interface Env {
	GH_KEY: string;
}

async function fetchGitHubRepos(username: string, env: Env): Promise<GitHubRepo[]> {
	const perPage = 100; // GitHub API returns up to 100 per page

	const url = `https://api.github.com/users/${username}/repos?page=1&per_page=${perPage}&sort=updated`;

	const response = await fetch(
		url,
		{
			headers: {
				'User-Agent': 'gh-lang-stats-ts',
				'Accept': 'application/vnd.github.v3+json',
				'Authorization': `Bearer ${env.GH_KEY}`,
			},
		}
	);

	if (!response.ok) {
		throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
	}

	const repos: GitHubRepo[] = await response.json();
	return repos;
}

async function generateSvg(percMap: Map<string, string>, count: number) {
	const topLangs = [...percMap.entries()]
		.sort(([, a], [, b]) => parseFloat(b) - parseFloat(a))
		.slice(0, count);

	const listHeight = topLangs.length * 40;
	// headerHeight + listHeight + padding
	const height = 55 + listHeight + 30;

	const langItems = (await Promise.all(topLangs.map(async ([lang, perc], index) => {
		const color = await stringToHexColor(lang);
		return `
      <g transform="translate(0, ${index * 40})">
        <g>
          <text data-testid="lang-name" x="2" y="15" class="lang-name">${lang}</text>
          <text x="215" y="34" class="lang-name">${perc}%</text>
          <svg width="205" x="0" y="25">
            <rect rx="5" ry="5" x="0" y="0" width="205" height="8" fill="#ddd"></rect>
            <svg width="${perc}%">
              <rect
                  height="8"
                  fill="${color}"
                  rx="5" ry="5" x="0" y="0"
                  width="100%"
                  class="lang-progress"
              />
            </svg>
          </svg>
        </g>
      </g>
    `;
	}))).join('');

	return `
<svg
  width="300"
  height="${height}"
  viewBox="0 0 300 ${height}"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  aria-labelledby="descId"
>
  <title id="titleId">Top Languages</title>
  <desc id="descId">Top languages by main repo language</desc>
  <style>
    .header {
      font: 600 20px Verdana, Sans-Serif;
      fill:rgb(3, 38, 83);
    }
    @supports(-moz-appearance: auto) {
      /* Selector detects Firefox */
      .header { font-size: 15.5px; }
    }
    .stat {
      font: 600 14px Verdana, Sans-Serif; fill: #434d58;
    }
    @supports(-moz-appearance: auto) {
      /* Selector detects Firefox */
      .stat { font-size:12px; }
    }
    .bold { font-weight: 700 }
    .lang-name {
      font: 400 11px Verdana, Sans-Serif;
      fill: #434d58;
    }
  </style>

  <rect
    data-testid="card-bg"
    x="0.5"
    y="0.5"
    rx="4.5"
    height="99%"
    stroke="#e4e2e2"
    width="299"
    fill="#fffefe"
    stroke-opacity="1"
  />

  <g data-testid="card-title" transform="translate(25, 35)">
    <g transform="translate(0, 0)">
      <text x="0" y="0" class="header" data-testid="header">Top Languages</text>
    </g>
  </g>

  <g data-testid="main-card-body" transform="translate(0, 55)">
    <svg data-testid="lang-items" x="25">
      ${langItems}
    </svg>
  </g>
</svg>
    `;
}

async function sha1Hash(msg: string) {
	// Encode as UTF-8
	const encoder = new TextEncoder();
	const data = encoder.encode(msg);
  
	// Hash it
	const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  
	// Convert buffer to byte array, then to hex string
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray
	  .map(b => b.toString(16).padStart(2, '0'))
	  .join('');
  
	return hashHex;
}

async function stringToHexColor(str: string) {
	const fullHash = await sha1Hash(str);
	return `#${fullHash.slice(0, 6)}`;
  }

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		if (request.method !== 'GET') {
			return new Response('Method not allowed', {
				status: 405,
				headers: corsHeaders
			});
		}

		try {
			// Extract username from path
			const pathParts = url.pathname.split('/').filter(p => p);
			const username = pathParts[0];

			let repos = (await fetchGitHubRepos(username, env)).filter(r => r.language !== null);

			const langs = repos.reduce((acc, r) => {
				acc.set(r.language ?? "", (acc.get(r.language ?? "") ?? 0) + 1);
				return acc;
			}, new Map<string, number>());

			const total = [...langs.values()].reduce((acc, count) => acc += count, 0);
			const percMap = new Map<string, string>();
			langs.forEach((val, key) => {
				const perc = ((val / total) * 100).toFixed(2);
				percMap.set(key, perc);
			});

			const top = url.searchParams.get("top");
			const count = (top && parseInt(top, 10) > 0) ? parseInt(top, 10) : 5;

			const svg = await generateSvg(percMap, count);

			return new Response(svg, {
				headers: {
					'Content-Type': 'image/svg+xml',
					...corsHeaders,
				},
			});

		} catch (error) {

			return new Response(
				JSON.stringify({
					error: 'Failed to fetch repository data',
					message: error instanceof Error ? error.message : 'Unknown error',
				}),
				{
					status: 500,
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders,
					},
				}
			);
		}
	},
} satisfies ExportedHandler<Env>;
