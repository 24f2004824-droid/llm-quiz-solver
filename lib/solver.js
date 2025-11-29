import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function solveChain({ email, secret, url: startUrl }) {
  console.log("NO-BROWSER SOLVER START:", startUrl);

  let currentUrl = startUrl;
  const deadline = Date.now() + 170000;

  while (currentUrl && Date.now() < deadline) {
    console.log("Fetching page:", currentUrl);
    const html = await fetch(currentUrl).then(r => r.text());

    // Decode atob() exactly like real pages do
    const decoded = html.match(/atob\(`([^`]+)`\)/);
    const pageText = decoded ? atob(decoded[1]) : html.replace(/<[^>]*>/g, ' ');

    const question = pageText.match(/[A-Z][^?.]*\?/)?.[0] || "Solve this.";
    const submitUrl = pageText.match(/https?:\/\/[^\s"']+\/submit[^\s"']*/)?.[0];

    if (!submitUrl) {
      console.log("No submit URL found — ending chain");
      break;
    }

    console.log("Question:", question);
    console.log("Submit URL:", submitUrl);

    const answer = await callGpt(question, html + "\n\nDECODED TEXT:\n" + pageText);
    console.log("GPT answer:", answer);

    const resp = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, secret, url: currentUrl, answer })
    }).then(r => r.json().catch(() => ({})));

    console.log("Submit response:", resp);

    if (resp.correct && resp.url) {
      currentUrl = resp.url;
    } else {
      break;
    }
  }
  console.log("SOLVER FINISHED — NO BROWSER NEEDED");
}

async function callGpt(q, context) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    messages: [{ role: 'user', content: `Question: ${q}\n\nFull page (including decoded atob): ${context.slice(0, 50000)}\n\nGive ONLY the final answer (number, string, JSON, etc.). No explanation.` }]
  });
  return res.choices[0].message.content.trim();
}
