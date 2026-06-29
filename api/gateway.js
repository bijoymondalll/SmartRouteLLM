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

async function callGemini(prompt) {
  const start = Date.now();
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  const latency = Date.now() - start;

  const usage = response.usageMetadata;

  return {
    success: true,
    provider: "gemini",
    model: "gemini-2.0-flash",
    response: response.text() || "",
    latency_ms: latency,
    input_tokens: usage?.promptTokenCount || 0,
    output_tokens: usage?.candidatesTokenCount || 0,
  };
}

export default async function handler(req, res) {
  try {
    // CORS Headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt' in request body." });
    }

    let result;
    try {
      result = await callCerebras(prompt);
    } catch (cerebrasError) {
      console.error("Cerebras execution failed, falling back to Gemini:", cerebrasError);
      try {
        result = await callGemini(prompt);
      } catch (geminiError) {
        console.error("Gemini fallback also failed:", geminiError);
        return res.status(500).json({
          success: false,
          error: "All providers failed",
          cerebras_error: cerebrasError ? cerebrasError.message : "No error captured",
          gemini_error: geminiError ? geminiError.message : "No error captured",
        });
      }
    }

    // Keep the Turso DB logging wrapped in its own independent try/catch so a database glitch never breaks the LLM response emission
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
  } catch (error) {
    return res.status(500).json({
      success: false,
      error_type: "GATEWAY_CRASH",
      details: error.message,
      stack: error.stack,
    });
  }
}
