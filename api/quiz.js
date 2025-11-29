import { solveChain } from '../lib/solver.js';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  console.log("API ENTRY: Request received", req.method, req.body); // ADD THIS

  if (req.method !== 'POST') {
    console.log("API ERROR: Wrong method", req.method); // ADD THIS
    return res.status(405).json({ error: 'POST only' });
  }

  let body;
  try { 
    body = req.body; 
  } catch { 
    console.log("API ERROR: Invalid JSON"); // ADD THIS
    return res.status(400).json({ error: 'Invalid JSON' }); 
  }

  const { email, secret, url } = body || {};
  if (!email || !secret || !url) {
    console.log("API ERROR: Missing fields", body); // ADD THIS
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (secret !== process.env.SECRET) {
    console.log("API ERROR: Bad secret", secret); // ADD THIS
    return res.status(403).json({ error: 'Forbidden' });
  }

  console.log("API SUCCESS: Starting solver for", url); // ADD THIS
  res.status(200).json({ status: 'accepted' });
  solveChain({ email, secret, url }).catch(err => console.error('SOLVER CRASH:', err)); // ADD LOG TO CATCH
}
