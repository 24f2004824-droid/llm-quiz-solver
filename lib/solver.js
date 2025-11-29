import puppeteer from 'puppeteer-core';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_BIN || null,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
  }
  return browser;
}

export async function solveChain({ email, secret, url: startUrl }) {
  let currentUrl = startUrl;
  const deadline = Date.now() + 170000;

  while (currentUrl && Date.now() < deadline) {
    const br = await getBrowser();
    const page = await br.newPage();
    await page.setDefaultTimeout(20000);

    try { await page.goto(currentUrl, { waitUntil: 'networkidle0' }); }
    catch { await page.close(); break; }

    const decoded = await page.evaluate(() => {
      const m = document.body.innerText.match(/atob\(`([^`]+)`\)/);
      return m ? atob(m[1]) : null;
    });

    const html = await page.content();
    const text = decoded || await page.evaluate(() => document.body.innerText);
    const question = text.match(/[A-Z][^?.]*\?/)?.[0] || "Solve.";
    const submitUrl = text.match(/https?:\/\/[^\s"']+\/submit[^\s"']*/)?.[0];
    if (!submitUrl) { await page.close(); break; }

    const answer = await solveWithGPT(question, html);
    const resp = await submit(submitUrl, { email, secret, url: currentUrl, answer });

    await page.close();

    if (resp?.correct && resp?.url) currentUrl = resp.url;
    else if (!resp?.correct && Date.now() < deadline - 30000) {
      const retry = await solveWithGPT(`${question}\nWrong. Fix it.`, html);
      await submit(submitUrl, { email, secret, url: currentUrl, answer: retry });
    } else break;
  }
}

async function solveWithGPT(q, h) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o', temperature: 0.1, max_tokens: 1500,
    messages: [{ role: 'user', content: `Q: ${q}\nHTML: ${h.slice(0,28000)}\nAnswer ONLY with the final answer.` }]
  });
  const t = res.choices[0].message.content.trim();
  try { return JSON.parse(t); } catch { return t; }
}

async function submit(u, p) {
  try {
    const r = await fetch(u, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(p) });
    return r.ok ? await r.json() : { correct: false };
  } catch { return { correct: false }; }
}
