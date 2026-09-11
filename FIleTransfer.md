<!DOCTYPE html>
<html>
<head>
  <style>
    body { width: 340px; font-family: system-ui, sans-serif; padding: 10px; }
    textarea { width: 100%; box-sizing: border-box; }
    button { margin-top: 6px; padding: 6px 12px; }
    #out { white-space: pre-wrap; margin-top: 10px; font-size: 13px; }
  </style>
</head>
<body>
  <textarea id="instruction" rows="3">Summarise this page in 5 bullet points.</textarea>
  <button id="go">Ask AI</button>
  <div id="out"></div>
  <script src="popup.js"></script>
</body>
</html>



const API_KEY = "PASTE_YOUR_GEMINI_KEY_HERE";
const MODEL = "gemini-flash-latest";

document.getElementById("go").addEventListener("click", async () => {
  const out = document.getElementById("out");
  const instruction = document.getElementById("instruction").value;
  out.textContent = "Reading page...";

  // 1. Which tab am I looking at?
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 2. Run a tiny function inside that page to grab its visible text
  const [{ result: pageText }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.body.innerText.slice(0, 20000)
  });

  out.textContent = "Thinking...";

  // 3. Send the instruction + page text to the model
  const prompt = `${instruction}

--- PAGE TITLE ---
${tab.title}
--- PAGE CONTENT ---
${pageText}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    const data = await res.json();
    out.textContent =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "No answer. Raw response: " + JSON.stringify(data).slice(0, 400);
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }
});