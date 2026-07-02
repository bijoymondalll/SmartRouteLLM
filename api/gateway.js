import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { createClient } from "@libsql/client";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const cerebras = new OpenAI({
  apiKey: process.env.CEREBRAS_API_KEY,
  baseURL: "https://api.cerebras.ai/v1",
});

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// =========================================================================
// 🗄️ TURSO TELEMETRY — fully isolated, never touches the response path
// =========================================================================
async function logRequestToTurso({ provider, model, input_tokens, output_tokens, latency_ms }) {
  try {
    await db.execute({
      sql: "INSERT INTO requests_log (provider, model, input_tokens, output_tokens, latency_ms) VALUES (?, ?, ?, ?, ?)",
      args: [provider, model, input_tokens, output_tokens, latency_ms],
    });
  } catch (error) {
    console.error("Turso Logging Failed:", error);
  }
}

// =========================================================================
// 🚀 PRIMARY: Cerebras via OpenAI SDK (llama-3.3-70b)
// =========================================================================
async function callCerebras(prompt) {
  const start = Date.now();
  const response = await cerebras.chat.completions.create({
    model: "llama-3.3-70b",
    messages: [{ role: "user", content: prompt }],
  });
  const latency = Date.now() - start;

  return {
    success: true,
    provider: "cerebras",
    model: "llama-3.3-70b",
    response: response.choices[0]?.message?.content || "",
    latency_ms: latency,
    input_tokens: response.usage?.prompt_tokens || 0,
    output_tokens: response.usage?.completion_tokens || 0,
  };
}

// =========================================================================
// 🛡️ FALLBACK: Gemini via SDK (gemini-2.5-flash)
// CRITICAL: system role → systemInstruction field on getGenerativeModel()
// =========================================================================
async function callGemini(prompt, messages) {
  const start = Date.now();

  // Extract system instruction from messages array if present
  let systemText = null;
  if (Array.isArray(messages)) {
    const systemMsg = messages.find(m => m.role === "system");
    if (systemMsg) systemText = systemMsg.content;
  }

  // Build model config — systemInstruction goes HERE, not in the content payload
  const modelConfig = { model: "gemini-2.5-flash" };
  if (systemText) {
    modelConfig.systemInstruction = systemText;
  }

  const model = genAI.getGenerativeModel(modelConfig);

  // For multi-turn messages, use startChat; for single prompt, use generateContent
  let result;
  if (Array.isArray(messages) && messages.filter(m => m.role !== "system").length > 1) {
    // Multi-turn: build history from all non-system messages except the last user message
    const nonSystemMsgs = messages.filter(m => m.role !== "system");
    const history = nonSystemMsgs.slice(0, -1).map(m => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));
    const lastMsg = nonSystemMsgs[nonSystemMsgs.length - 1];

    const chat = model.startChat({ history });
    result = await chat.sendMessage(lastMsg.content);
  } else {
    // Single prompt: direct generateContent call
    result = await model.generateContent(prompt);
  }

  const response = await result.response;
  const latency = Date.now() - start;
  const usage = response.usageMetadata;

  return {
    success: true,
    provider: "gemini",
    model: "gemini-2.5-flash",
    response: response.text() || "",
    latency_ms: latency,
    input_tokens: usage?.promptTokenCount || 0,
    output_tokens: usage?.candidatesTokenCount || 0,
  };
}

// =========================================================================
// 🔥 VERCEL SERVERLESS HANDLER
// =========================================================================
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const { prompt, messages } = req.body || {};
  if (!prompt && (!messages || messages.length === 0)) {
    return res.status(400).json({ error: "Missing 'prompt' or 'messages' in request body." });
  }

  // Resolve the actual prompt text to send to providers
  const resolvedPrompt = prompt || messages.filter(m => m.role !== "system").pop()?.content || "";

  let result;
  let cerebrasError = null;
  let geminiError = null;

  // 🚀 LAYER 1: Cerebras (llama-3.3-70b)
  try {
    result = await callCerebras(resolvedPrompt);
  } catch (err1) {
    cerebrasError = err1;
    console.error("Cerebras failed:", err1.message);

    // 🛡️ LAYER 2: Gemini (gemini-2.5-flash) with systemInstruction fix
    try {
      result = await callGemini(resolvedPrompt, messages);
    } catch (err2) {
      geminiError = err2;
      console.error("Gemini fallback failed:", err2.message);

      // 💥 BOTH DEAD — 200 so frontend fetch never throws
      return res.status(200).json({
        success: false,
        error: "All API layers failed",
        cerebras_log: cerebrasError.message || "Unknown Cerebras error",
        gemini_log: geminiError.message || "Unknown Gemini error",
      });
    }
  }

  // 🗄️ Turso Telemetry — isolated, never blocks response
  try {
    await logRequestToTurso({
      provider: result.provider,
      model: result.model,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      latency_ms: result.latency_ms,
    });
  } catch (dbError) {
    console.error("Database telemetry logging failed:", dbError);
  }

  return res.status(200).json(result);
}
