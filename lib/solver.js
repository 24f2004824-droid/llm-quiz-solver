// lib/solver.js
import puppeteer from 'puppeteer';
import chromium from '@sparticuz/chromium';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
  }
  return browser;
}

export async function solveChain({ email, secret, url: startUrl }) {
  let currentUrl = startUrl.trim();
  const deadline = Date.now() + 170000; // 2m50s max
  console.log(`Starting TDS Project 2 chain for ${email}`);

  // AUTO KICKOFF: Handle the initial project2 page (requires dummy answer)
  if (currentUrl === 'https://tds-llm-analysis.s-anand.net/project2') {
    console.log('Detected start page → sending kickoff...');
    const kickoffPayloads = ['start', 'begin', 'go', 'hello', email, ''];
    
    for (const ans of kickoffPayloads) {
      if (Date.now() > deadline) break;
      const resp = await submit('https://tds-llm-analysis.s-anand.net/submit', {
        email,
        secret,
        url: currentUrl,
        answer: ans
      });
      if (resp?.correct && resp?.url) {
        currentUrl = resp.url;
        console.log(`Kickoff succeeded with answer "${ans}" → ${currentUrl}`);
        break;
      }
      console.log(`Kickoff failed with "${ans}"`);
    }
    if (!currentUrl.includes('/step/')) {
      console.log('All kickoff attempts failed. Check email/secret.');
      return;
    }
  }

  // Main solving loop
  while (currentUrl && Date.now() < deadline) {
    let page = null;
    try {
      const br = await getBrowser();
      page = await br.newPage();
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');

      console.log(`\nVisiting: ${currentUrl}`);
      await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 30000 });

      // Decode atob if present
      const decoded = await page.evaluate(() => {
        const match = document.body.innerText.match(/atob\(`([^`]+)`\)/);
        return match ? atob(match[1]) : null;
      });

      const html = await page.content();
      const bodyText = decoded || await page.evaluate(() => document.body.innerText);

      // Extract question
      const questionMatch = bodyText.match(/[A-Z][^?.]{15,400}?\?/);
      const question = questionMatch ? questionMatch[0] : 'What is the answer to this puzzle?';

      // Extract submit URL
      const submitUrl = bodyText.match(/(https?:\/\/[^\s"']+\/submit[^\s"']*)/)?.[0]
                         || 'https://tds-llm-analysis.s-anand.net/submit';

      console.log(`Question: ${question.substring(0, 120)}...`);
      console.log(`Submit URL: ${submitUrl}`);

      // Solve with GPT-4o
      let answer = await solveWithGPT(question, html, bodyText);

      // Submit
      let response = await submit(submitUrl, { email, secret, url: currentUrl, answer });

      if (response?.correct && response?.url) {
        currentUrl = response.url;
        console.log(`CORRECT! → Next: ${currentUrl}`);
        continue;
      }

      // Retry once if wrong
      if (!response?.correct && Date.now() < deadline - 30000) {
        console.log(`Wrong answer: "${answer}" → retrying...`);
        answer = await solveWithGPT(
          `${question}\nPrevious answer "${answer}" was wrong. Think carefully again.`,
          html,
          bodyText
        );
        response = await submit(submitUrl, { email, secret, url: currentUrl, answer });
        if (response?.correct && response?.url) {
          currentUrl = response.url;
          console.log(`Retry succeeded! → ${currentUrl}`);
          continue;
        }
      }

      console.log('Failed after retry. Stopping.');
      break;

    } catch (err) {
      console.error('Error:', err.message);
      break;
    } finally {
      if (page) await page.close();
    }
  }

  console.log('\nChain finished or timed out.');
}

// Enhanced GPT prompt
async function solveWithGPT(question, html, fullText) {
  const prompt = `
You are solving a step in https://tds-llm-analysis.s-anand.net/project2

Question: ${question}

Full page text (may contain hidden clues):
${fullText.slice(0, 20000)}

HTML snippet:
${html.slice(0, 12000)}

INSTRUCTIONS:
- Look for hidden text, comments, atob(), data attributes, or instructions.
- Some steps are personalized to the email.
- Answer format is always specified on the page (e.g., "Answer as a number", "JSON array", etc.).
- Output ONLY the raw final answer. No quotes, no explanation, no "Answer:" prefix.
- If it asks for a hash, number, or code → give exactly that.

Examples of correct output:
42
["apple", "banana"]
3f1a2c9d
true
`.trim();

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.3,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  let answer = res.choices[0].message.content.trim();
  answer = answer.split('\n')[0].trim();
  answer = answer.replace(/^["'`]|["'`]$/g, ''); // strip quotes
  answer = answer.replace(/^(Answer|The answer is|Final answer):?\s*/gi, '');

  console.log(`GPT → ${answer}`);
  return answer;
}

// Submit helper
async function submit(url, payload) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { correct: false };
    const json = await r.json();
    return json;
  } catch (e) {
    console.error('Submit error:', e.message);
    return { correct: false };
  }
}
