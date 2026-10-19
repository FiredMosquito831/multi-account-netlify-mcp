export interface NetlifyUser {
  id: string;
  email: string;
}

const NETLIFY_API = 'https://api.netlify.com';

// Confirms a token works and tells us which Netlify user it belongs to.
export const fetchNetlifyUser = async (token: string, fetchImpl: typeof fetch = fetch): Promise<NetlifyUser> => {
  const response = await fetchImpl(`${NETLIFY_API}/api/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, 'user-agent': 'multi-account-netlify-mcp' },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Netlify rejected this token (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(`Netlify API returned HTTP ${response.status} while checking the token.`);
  }
  const body = (await response.json()) as { id?: unknown; email?: unknown };
  if (typeof body.id !== 'string' || typeof body.email !== 'string') {
    throw new Error('Unexpected response from Netlify /api/v1/user.');
  }
  return { id: body.id, email: body.email };
};
