import puppeteer from 'puppeteer-core';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || null,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
});

export async function solveChain({ email, secret, url: startUrl }) {
  let currentUrl = startUrl;
  const deadline = Date.now() + 170000; // 2 min 50 sec buffer

  while (currentUrl && Date.now() < deadline) {
    const page = await browser.newPage();
    await page.setDefaultTimeout(20000);

    try {
      await page.goto(currentUrl, { waitUntil: 'networkidle0' });
    } catch (e) {
      console.error('Page load failed:', e.message);
      await page.close();
      break;
    }

    // Decode hidden atob() instructions
    const decoded = await page.evaluate(() => {
      const script = document.body.innerText.match(/atob\(`([^`]+)`\)/);
      return script ? atob(script[1]) : null;
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
    const response = await submitAnswer(submitUrl, { email, secret, url: currentUrl, answer });

    await page.close();

    if (response?.correct && response?.url) {
      currentUrl = response.url;
    } else if (!response?.correct && Date.now() < deadline - 30000) {
      // One retry with feedback
      const retryAnswer = await solveWithGPT(
        `${question}\nPrevious answer "${JSON.stringify(answer)}" was wrong. Reason: ${response?.reason || 'unknown'}. Correct it.`,
        html
      );
      await submitAnswer(submitUrl, { email, secret, url: currentUrl, answer: retryAnswer });
    } else {
      break;
    }
  }
  console.log('Quiz chain finished.');
}

async function solveWithGPT(question, html) {
  const prompt = `QUESTION: ${question}\n\nHTML CONTEXT (first 28k chars):\n${html.slice(0, 28000)}\n\n` +
    `INSTRUCTIONS: Solve exactly. Download files, read PDFs, analyze data, make charts if needed.\n` +
    `Return ONLY the final answer as valid JSON, number, string, or data:image/png;base64,...\n` +
    `NO explanations, NO extra text.`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.1,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = res.choices[0].message.content.trim();
  try { return JSON.parse(text); } catch { return text; }
}

async function submitAnswer(url, payload) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) return { correct: false, reason: 'HTTP ' + r.status };
    return await r.json();
  } catch (e) {
    return { correct: false, reason: 'Network error' };
  }
}
