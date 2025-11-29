// lib/solver.js — FINAL VERSION (passes the exact sample + real quiz)
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process', '--no-zygote'],
  executablePath: process.env.PUPPETEER_EXEC_PATH || await import('puppeteer').then(m => m.executablePath())
});

export async function solveChain({ email, secret, url: startUrl }) {
  let currentUrl = startUrl;
  const deadline = Date.now() + 170000;

  while (currentUrl && Date.now() < deadline) {
    const page = await browser.newPage();
    await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 25000 });

    // Decode atob(...) if present
    const decoded = await page.evaluate(() => {
      const match = document.body.innerText.match(/atob\(`([^`]+)`\)/);
      return match ? atob(match[1]) : null;
    });

    const text = decoded || await page.evaluate(() => document.body.innerText);
    const html = await page.content();

    const question = text.match(/[A-Z][^?.]*\?/)?.[0] || "Solve this task.";
    const submitUrl = text.match(/https?:\/\/[^\s"']+\/submit[^\s"']*/)?.[0];
    if (!submitUrl) { await page.close(); break; }

    const answer = await askGPT(question + "\n\nPage HTML (first 30k):\n" + html.slice(0,30000));
    const result = await submit(submitUrl, { email, secret, url: currentUrl, answer });

    await page.close();

    if (result?.correct && result?.url) {
      currentUrl = result.url;
    } else if (!result?.correct && Date.now() < deadline - 30000) {
      const retry = await askGPT(`${question}\nWrong answer. Reason: ${result?.reason || 'unknown'}. Fix it.\nHTML: ${html.slice(0,30000)}`);
      await submit(submitUrl, { email, secret, url: currentUrl, answer: retry });
    } else break;
  }
}

async function askGPT(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt + "\n\nReturn ONLY the final answer (number/JSON/string/base64). No explanation." }]
    })
  });
  const data = await res.json();
  const txt = data.choices?.[0]?.message?.content?.trim() || "";
  try { return JSON.parse(txt); } catch { return txt; }
}

async function submit(url, payload) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch { return { correct: false }; }
}
