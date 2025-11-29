// lib/solver.js — FINAL WORKING VERSION (Vercel 2025)
import { launch } from 'chrome-launcher';
import { createCursor } from 'ghost-cursor';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function solveChain({ email, secret, url: startUrl }) {
  let currentUrl = startUrl;
  const deadline = Date.now() + 170000;

  while (currentUrl && Date.now() < deadline) {
    // Use chrome-launcher — it auto-finds Chrome on Vercel
    const chrome = await launch({
      chromeFlags: ['--no-sandbox', '--disable-setuid-sandbox', '--headless=new']
    });

    const cursor = createCursor(chrome.port);

    try {
      const page = await cursor.page;
      await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 20000 });

      const html = await page.content();
      const text = await page.evaluate(() => document.body.innerText);

      const question = text.match(/[A-Z][^?.]*\?/)?.[0] || "Solve this.";
      const submitUrl = text.match(/https?:\/\/[^\s"']+\/submit[^\s"']*/)?.[0];
      if (!submitUrl) break;

      const answer = await solveWithGPT(question, html);
      const resp = await submit(submitUrl, { email, secret, url: currentUrl, answer });

      if (resp?.correct && resp?.url) currentUrl = resp.url;
      else if (!resp?.correct) {
        const retry = await solveWithGPT(`${question}\nWrong. Fix it.`, html);
        await submit(submitUrl, { email, secret, url: currentUrl, answer: retry });
      } else break;
    } finally {
      await chrome.kill();
    }
  }
}

async function solveWithGPT(q, h) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    messages: [{ role: 'user', content: `Q: ${q}\nHTML: ${h.slice(0,25000)}\nAnswer ONLY the final answer.` }]
  });
  const txt = res.choices[0].message.content.trim();
  try { return JSON.parse(txt); } catch { return txt; }
}

async function submit(u, p) {
  try {
    const r = await fetch(u, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(p) });
    return r.ok ? await r.json() : { correct: false };
  } catch { return { correct: false }; }
}
