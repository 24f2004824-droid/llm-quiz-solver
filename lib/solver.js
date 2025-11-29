import puppeteer from 'puppeteer-core';
import OpenAI from 'openai';
import chromium from '@sparticuz/chromium';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let browser = null;

async function getBrowser() {
  if (browser) return browser;

  browser = await puppeteer.launch({
    headless: 'new',  // Use new headless mode (2025 standard)
    executablePath: await chromium.executablePath({ 
      args: chromium.args,  // Auto-adds serverless args
      fallback: false  // Fail fast if no binary
    }),
    args: [
      ...chromium.args,  // Includes --no-sandbox, --disable-setuid-sandbox, etc.
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--single-process',
      '--disable-extensions'
    ],
    ignoreDefaultArgs: ['--disable-extensions']
  });

  return browser;
}

export async function solveChain({ email, secret, url: startUrl }) {
  let currentUrl = startUrl;
  const deadline = Date.now() + 170000;  // 2:50 buffer

  while (currentUrl && Date.now() < deadline) {
    const br = await getBrowser();
    const page = await br.newPage();
    await page.setDefaultTimeout(20000);

    try {
      await page.goto(currentUrl, { waitUntil: 'networkidle0' });
    } catch (e) {
      console.error('Page load failed:', e.message);
      await page.close();
      break;
    }

    // Decode atob() hidden instructions
    const decoded = await page.evaluate(() => {
      const match = document.body.innerText.match(/atob\(`([^`]+)`\)/);
      return match ? atob(match[1]) : null;
    });

    const html = await page.content();
    const text = decoded || await page.evaluate(() => document.body.innerText);

    const question = text.match(/[A-Z][^?.]*\?/)?.[0] || "Solve this task.";
    const submitUrl = text.match(/https?:\/\/[^\s"']+\/submit[^\s"']*/)?.[0];

    if (!submitUrl) {
      console.error('No submit URL found');
      await page.close();
      break;
    }

    const answer = await solveWithGPT(question, html);
    const resp = await submitAnswer(submitUrl, { email, secret, url: currentUrl, answer });

    await page.close();

    if (resp?.correct && resp?.url) {
      currentUrl = resp.url;
    } else if (!resp?.correct && Date.now() < deadline - 30000) {
      // Retry with feedback
      const retry = await solveWithGPT(`${question}\nPrevious answer "${JSON.stringify(answer)}" was wrong. Reason: ${resp?.reason || 'unknown'}. Fix it.`, html);
      await submitAnswer(submitUrl, { email, secret, url: currentUrl, answer: retry });
    } else {
      break;
    }
  }
  console.log('Quiz chain completed.');
}

async function solveWithGPT(question, html) {
  const prompt = `QUESTION: ${question}\n\nHTML CONTEXT (first 28k chars):\n${html.slice(0, 28000)}\n\nINSTRUCTIONS:\n- Solve the data task exactly (scrape, PDF, API, analysis, chart).\n- Return ONLY the final answer as number, string, JSON, or base64 image.\n- No explanations.`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.1,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const txt = res.choices[0].message.content.trim();
  try { return JSON.parse(txt); } catch { return txt; }
}

async function submitAnswer(url, payload) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) return { correct: false, reason: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { correct: false, reason: 'Network error' };
  }
}
