// lib/solver.js — FINAL WORKING NO-BROWSER VERSION (Vercel 2025)

import OpenAI from "openai";
import { JSDOM } from "jsdom";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function solveChain({ email, secret, url: startUrl }) {
  let currentUrl = startUrl;
  const deadline = Date.now() + 170000;

  while (currentUrl && Date.now() < deadline) {
    console.log("FETCHING PAGE:", currentUrl);

    const html = await fetchPageHtml(currentUrl);
    if (!html) {
      console.log("FAILED TO FETCH PAGE.");
      break;
    }

    const { text, question, submitUrl } = parsePage(html);
    if (!submitUrl) {
      console.log("NO SUBMIT URL FOUND.");
      break;
    }

    console.log("QUESTION:", question);
    console.log("SUBMIT:", submitUrl);

    const answer = await solveWithGPT(question, html);

    const resp = await submit(submitUrl, {
      email,
      secret,
      url: currentUrl,
      answer
    });

    console.log("SUBMISSION RESPONSE:", resp);

    if (resp?.correct && resp?.url) {
      currentUrl = resp.url;
      continue;
    }

    if (!resp?.correct) {
      console.log("RETRYING WITH GPT…");
      const retry = await solveWithGPT(question + "\nThe previous answer was wrong. Fix it.", html);
      const resp2 = await submit(submitUrl, {
        email,
        secret,
        url: currentUrl,
        answer: retry
      });
      if (resp2?.correct && resp2?.url) {
        currentUrl = resp2.url;
        continue;
      }
    }

    break;
  }
}

async function fetchPageHtml(url) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
      }
    });
    return await r.text();
  } catch (err) {
    console.log("FETCH ERROR:", err);
    return null;
  }
}

function parsePage(html) {
  const dom = new JSDOM(html);
  const text = dom.window.document.body.textContent || "";

  const question =
    text.match(/[A-Z][^?]*\?/)?.[0] ||
    "Solve this question from the HTML.";

  const submitUrl =
    html.match(/https?:\/\/[^"' ]+\/submit[^"' ]*/)?.[0] || null;

  return { text, question, submitUrl };
}

async function solveWithGPT(question, html) {
  const prompt = `You are solving an LLM-Analysis quiz step. 
HTML (trimmed): ${html.slice(
