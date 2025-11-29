import puppeteer from 'puppeteer-core';
import OpenAI from 'openai';
import chromium from '@sparticuz/chromium-min';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let browser = null;

async function getBrowser() {
  if (browser) return browser;

  console.log("BROWSER: Launching Chromium..."); // ADD THIS

  const tarUrl = 'https://github.com/Sparticuz/chromium-min/releases/download/v130.0.0/chromium-130.0.0.tar.bz2';

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: await chromium.executablePath(tarUrl),
      args: [
        ...chromium.args,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
      ignoreDefaultArgs: ['--disable-extensions']
    });
    console.log("BROWSER: Launched successfully"); // ADD THIS
  } catch (e) {
    console.error("BROWSER CRASH:", e.message); // ADD THIS
    throw e;
  }

  return browser;
}

export async function solveChain({ email, secret, url: startUrl }) {
  console.log("SOLVER START: Chain for", startUrl); // ADD THIS

  let currentUrl = startUrl;
  const deadline = Date.now() + 170000;

  while (currentUrl && Date.now() < deadline) {
    console.log("SOLVER STEP: Loading page", currentUrl); // ADD THIS

    const br = await getBrowser();
    const page = await br.newPage();
    await page.setDefaultTimeout(20000);

    try {
      await page.goto(currentUrl, { waitUntil: 'networkidle0' });
      console.log("SOLVER: Page loaded"); // ADD THIS
    } catch (e) {
      console.error("SOLVER: Page load failed", e.message); // ADD THIS
      await page.close();
      break;
    }

    const decoded = await page.evaluate(() => {
      const match = document.body.innerText.match(/atob\(`([^`]+)`\)/);
      return match ? atob(match[1]) : null;
    });

    const html = await page.content();
    const text = decoded || await page.evaluate(() => document.body.innerText);

    const question = text.match(/[A-Z][^?.]*\?/)?.[0] || "Solve this task.";
    const submitUrl = text.match(/https?:\/\/[^\s"']+\/submit[^\s"']*/)?.[0];

    console.log("SOLVER: Question:", question.substring(0, 100) + "..."); // ADD THIS
    console.log("SOLVER: Submit URL:", submitUrl); // ADD THIS

    if (!submitUrl) {
      console.error("SOLVER: No submit URL found"); // ADD THIS
      await page.close();
      break;
    }

    console.log("SOLVER: Calling GPT-4o..."); // ADD THIS
    const answer = await solveWithGPT(question, html);
    console.log("SOLVER: GPT answer:", answer); // ADD THIS

    const resp = await submitAnswer(submitUrl, { email, secret, url: currentUrl, answer });
    console.log("SOLVER: Submit response:", resp); // ADD THIS

    await page.close();

    if (resp?.correct && resp?.url) {
      currentUrl = resp.url;
    } else if (!resp?.correct && Date.now() < deadline - 30000) {
      console.log("SOLVER: Retrying..."); // ADD THIS
      const retry = await solveWithGPT(`${question}\nPrevious answer "${JSON.stringify(answer)}" was wrong. Reason: ${resp?.reason || 'unknown'}. Fix it.`, html);
      await submitAnswer(submitUrl, { email, secret, url: currentUrl, answer: retry });
    } else {
      break;
    }
  }
  console.log("SOLVER END: Chain finished"); // ADD THIS
}

async function solveWithGPT(question, html) {
  const prompt = `QUESTION: ${question}\n\nHTML CONTEXT (first 28k chars):\n${html.slice(0, 28000)}\n\nINSTRUCTIONS:\n- Solve the data task exactly (scrape, PDF, API, analysis, chart).\n- Return ONLY the final answer as number, string, JSON, or base64 image.\n- No explanations.`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });
    const txt = res.choices[0].message.content.trim();
    console.log("GPT: Response received:", txt.substring(0, 100) + "..."); // ADD THIS
    try { return JSON.parse(txt); } catch { return txt; }
  } catch (e) {
    console.error("GPT ERROR:", e.message); // ADD THIS
    return "error";
  }
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
    console.error("SUBMIT ERROR:", e.message); // ADD THIS
    return { correct: false, reason: 'Network error' };
  }
}
