// lib/solver.js
import puppeteer from 'puppeteer';
import chromium from '@sparticuz/chromium';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let browser = null;

async function getBrowser() {
  if (!browser) {
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
  const deadline = Date.now() + 170000; // ~3 minutes max

  console.log(`Starting chain for ${email} at ${currentUrl}`);

  while (currentUrl && Date.now() < deadline) {
    let page = null;
    try {
      const br = await getBrowser();
      page = await br.newPage();

      // Optional: set user agent to avoid detection
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');

      console.log(`Visiting: ${currentUrl}`);
      await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 30000 });

      // Try to decode atob if present (common in these puzzles)
      const decoded = await page.evaluate(() => {
        const match = document.body.innerText.match(/atob\(`([^`]+)`\)/);
        return match ? atob(match[1]) : null;
      });

      const html = await page.content();
      const bodyText = decoded || await page.evaluate(() => document.body.innerText);

      // Extract question (first sentence ending with ?)
      const questionMatch = bodyText.match(/[A-Z][^?.]{10,300}?\?/);
      const question = questionMatch ? questionMatch[0] : 'What is the answer to this puzzle?';

      // Extract submit URL
      const submitUrlMatch = bodyText.match(/(https?:\/\/[^\s"']+\/submit[^\s"']*)/);
      if (!submitUrlMatch) {
        console.log('No submit URL found. Stopping.');
        break;
      }
      const submitUrl = submitUrlMatch[0];

      console.log(`Question: ${question.substring(0, 100)}...`);
      console.log(`Submit URL: ${submitUrl}`);

      // Solve with GPT-4o
      const answer = await solveWithGPT(question, html);

      // Submit answer
      const response = await submit(submitUrl, { email, secret, url: currentUrl, answer });

      if (response?.correct && response?.url) {
        currentUrl = response.url;
        console.log(`Correct! Next URL: ${currentUrl}`);
      } else if (!response?.correct) {
        console.log(`Wrong answer: ${answer}`);

        // One retry if time allows
        if (Date.now() < deadline - 40000) {
          console.log('Retrying once...');
          const retryAnswer = await solveWithGPT(`${question}\nPrevious answer was wrong. Think step-by-step and fix it.`, html);
          const retryResp = await submit(submitUrl, { email, secret, url: currentUrl, answer: retryAnswer });
          if (retryResp?.correct && retryResp?.url) {
            currentUrl = retryResp.url;
            console.log(`Retry succeeded! → ${currentUrl}`);
          } else {
            console.log('Retry failed. Stopping.');
            break;
          }
        } else {
          break;
        }
      } else {
        console.log('No valid response from server. Stopping.');
        break;
      }
    } catch (err) {
      console.error('Error during solveChain:', err.message);
      break;
    } finally {
      if (page) await page.close();
    }
  }

  console.log('Chain finished or timed out.');
}

// Solve using GPT-4o with strong prompting
async function solveWithGPT(question, html) {
  const prompt = `
You are solving a puzzle from https://tds-llm-analysis.s-anand.net/project2
Read the HTML and answer the question **exactly** as required.

Question: ${question}

HTML (truncated):
${html.slice(0, 28000)}

INSTRUCTIONS:
- Think step-by-step.
- Look for hidden text, atob, comments, or instructions in the page.
- The answer is often a number, word, JSON, or short phrase.
- Answer ONLY with the final answer, nothing else.
- If it says "answer format: X", follow it exactly.
- Do not say "the answer is", just output the raw answer.
`.trim();

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  let answer = res.choices[0].message.content.trim();

  // Clean up common GPT mistakes
  answer = answer.replace(/^["`']|["`']$/g, '');
  answer = answer.replace(/^Answer:? /gi, '');
  answer = answer.split('\n')[0].trim(); // first line only

  console.log(`GPT Answer: ${answer}`);
  return answer;
}

// Submit answer via fetch
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
    console.error('Submit failed:', e.message);
    return { correct: false };
  }
}
