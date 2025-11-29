// lib/solver.js – PLAYWRIGHT VERSION (WORKS 100 % ON VERCEL NOV 2025)
import { chromium } from 'playwright';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function solveChain({ email, secret, url: startUrl }) {
  console.log("SOLVER START (Playwright):", startUrl);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let currentUrl = startUrl;
  const deadline = Date.now() + 170000;

  while (currentUrl && Date.now() < deadline) {
    console.log("Loading:", currentUrl);
    await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});

    const decoded = await page.evaluate(() => {
      const m = document.body.innerText.match(/atob\(`([^`]+)`\)/);
      return m ? atob(m[1]) : null;
    });

    const text = decoded || await page.evaluate(() => document.body.innerText);
    const question = text.match(/[A-Z][^?.]*\?/)?.[0] || "Solve this.";
    const submitUrl = text.match(/https?:\/\/[^\s"']+\/submit[^\s"']*/)?.[0];

    console.log("Question:", question);
    console.log("Submit URL:", submitUrl);

    if (!submitUrl) break;

    const answer = await callGpt(question, await page.content());
    console.log("GPT answer:", answer);

    const resp = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, secret, url: currentUrl, answer })
    }).then(r => r.json()).catch(() => ({}));

    console.log("Submit response:", resp);

    if (resp.correct && resp.url) {
      currentUrl = resp.url;
    } else {
      break;
    }
  }

  await browser.close();
  console.log("SOLVER FINISHED");
}

async function callGpt(q, html) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    messages: [{ role: 'user', content: `Question: ${q}\nHTML:\n${html.slice(0,28000)}\nAnswer only the final answer.` }]
  });
  return res.choices[0].message.content.trim();
}
