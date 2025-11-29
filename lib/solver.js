// lib/solver.js  ← REPLACE THE WHOLE FILE WITH THIS
import puppeteer from 'puppeteer-core';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let browser = null;

async function getBrowser() {
  if (browser) return browser;

  // Vercel now ships Chrome automatically at this path
  const executablePath = '/tmp/chrome-linux/chrome';

  browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process'
    ]
  });

  return browser;
}

export async function solveChain({ email, secret, url: startUrl }) {
  let currentUrl = startUrl;
  const deadline = Date.now() + 170000;

  while (currentUrl && Date.now() < deadline) {
    const br = await getBrowser();
    const page = await br.newPage();

    try {
      await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 20000 });
    } catch (e) {
      console.error('Page load failed');
      await page.close();
      break;
    }

    const html = await page.content();
    const text = await page.evaluate(() => document.body.innerText);

    const question = text.match(/[A-Z][^?.]*\?/)?.[0] || "Solve this.";
    const submitUrl = text.match(/https?:\/\/[^\s"']+\/submit[^\s"']*/)?.[0];
    if (!submitUrl) { await page.close(); break; }

    const answer = await solveWithGPT(question, html);
    const resp = await submit(submitUrl, { email, secret, url: currentUrl, answer });

    await page.close();

    if (resp?.correct && resp?.url) currentUrl = resp.url;
    else if (!resp?.correct) {
      const retry = await solveWithGPT(`${question}\nWrong answer. Fix it.`, html);
      await submit(submitUrl, { email, secret, url: currentUrl, answer: retry });
    } else break;
  }
}

async function solveWithGPT(q, h) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    messages: [{ role: 'user', content: `Question: ${q}\nHTML: ${h.slice(0,25000)}\nAnswer ONLY the final answer.` }]
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
