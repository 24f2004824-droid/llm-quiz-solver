import { solveChain } from '../lib/solver.js';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body;
  try { body = req.body; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { email, secret, url } = body || {};
  if (!email || !secret || !url) return res.status(400).json({ error: 'Missing fields' });
  if (secret !== process.env.SECRET) return res.status(403).json({ error: 'Forbidden' });

  res.status(200).json({ status: 'accepted' });
  solveChain({ email, secret, url }).catch(console.error);
}
