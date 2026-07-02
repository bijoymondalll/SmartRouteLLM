# SmartRouteLLM - Serverless Intelligent AI Gateway

![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)
![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)
![Node Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green?style=for-the-badge&logo=node.js)
![Database](https://img.shields.io/badge/Database-Turso%20%28libSQL%29-00e6c3?style=for-the-badge)

SmartRouteLLM is a high-performance, serverless AI routing gateway built for production-grade reliability and cost optimization. Designed to sit between client applications and LLM providers, it acts as a smart proxy that orchestrates requests, provides automatic failover capabilities, and tracks system-wide analytics with zero latency impact.

---

## 🚀 Overview

SmartRouteLLM addresses LLM provider instability and rate limits through a resilient, **zero-latency fallback router concept**:

*   **Primary Provider:** **Cerebras Inference (Llama 3)** — Chosen for industry-leading, ultra-fast token generation speeds to serve primary requests instantly.
*   **Fallback Provider:** **Google Gemini Flash** — Triggered immediately if the primary provider encounters timeouts, rate limits (HTTP 429), or service outages.

This architecture ensures your application maintains high availability and consistent responses under all load conditions.

---

## 📐 Architecture

The gateway is built on a serverless and edge-ready execution model:

1.  **Vercel Serverless / Edge Gateway:** The entry point handles incoming LLM client requests, running stateless routing logic with minimal cold-start times.
2.  **Turso Database (libSQL):** Serves as our persistent telemetry and logging store. To ensure the user never waits on database operations, telemetry events, latency tracking, and token usage statistics are logged asynchronously without blocking the client response path.

```
                      +-------------------+
                      |   Client Request  |
                      +---------+---------+
                                |
                                v
                   +----------------------------+
                   |  Vercel Serverless Router  |
                   +------------+---------------+
                                |
             +------------------+------------------+
             | (Try Primary)                       | (On Failure)
             v                                     v
   +-------------------+                 +-------------------+
   |  Cerebras Llama 3 |                 |   Google Gemini   |
   |                   |                 |      (Flash)      |
   +---------+---------+                 +---------+---------+
             |                                     |
             +------------------+------------------+
                                |
                                v
            +-------------------+-------------------+
            |           Return Response             |
            +-------------------+-------------------+
                                |
                                v (Asynchronous)
                     +---------------------+
                     |  Turso DB Telemetry |
                     +---------------------+
```

---

## ✨ Key Features

*   **Zero-Cost Cloud Infrastructure:** Designed to run fully within free tiers (Vercel Serverless and Turso Starter) while scaling elastically as traffic increases.
*   **Circuit Breaker Fallback:** Sophisticated error handling that seamlessly shifts workloads to Google Gemini Flash upon Cerebras rate limits or downtime.
*   **Token & Latency Analytics Dashboard:** A beautiful, responsive real-time analytics panel displaying total requests, token throughput, average latency, and provider distribution.

---

## 🛠️ Tech Stack

*   **Runtime & Framework:** Node.js (ES Modules style), Vercel Serverless Functions
*   **AI SDKs:** Cerebras Inference API (OpenAI SDK), Google Gemini API (`@google/generative-ai`)
*   **Database:** Turso DB (`@libsql/client`)
*   **Frontend UI:** Tailwind CSS (Responsive Dashboard Interface)

---

## ⚙️ How it Works

The routing flow operates in three sequential phases:

1.  **Request Ingestion & Primary Dispatch:** The gateway intercepts incoming client requests, packaging the payload and dispatching it directly to the ultra-low-latency Cerebras Llama 3 engine.
2.  **Circuit Breaker & Fallback Execution:** If the primary connection times out or fails (e.g., due to API key exhaustions or rate constraints), the router instantly catches the exception and routes the query to Google Gemini Flash as the failover engine.
3.  **Asynchronous Telemetry Logging:** Upon returning the completed response back to the client, the gateway fires an asynchronous query to write metadata (selected provider, response time in ms, prompt/completion tokens, and timestamp) directly into the Turso database, leaving the core client request pathway completely unblocked.

---

## 🛠️ Getting Started & Local Setup

Follow these steps to run the serverless AI routing gateway locally:

### 1. Prerequisites
Ensure you have the following installed:
*   **Node.js** (v18.0.0 or higher)
*   **Vercel CLI** (for local serverless simulation)
*   **Turso CLI** (optional, for managing the database)

### 2. Clone the Repository
```bash
git clone https://github.com/bijoymondalll/SmartRouteLLM.git
cd SmartRouteLLM
```

### 3. Install Dependencies
Install all required packages:
```bash
npm install
```

### 4. Environment Variables Setup
Create a `.env` file in the root of your project and populate it with your API keys and database credentials:
```env
# Database Credentials
TURSO_DATABASE_URL=your_turso_db_url
TURSO_AUTH_TOKEN=your_turso_auth_token

# AI Provider API Keys
CEREBRAS_API_KEY=your_cerebras_api_key
GEMINI_API_KEY=your_gemini_api_key
```

### 5. Running Locally
Run the Vercel development server to simulate the serverless edge environment:
```bash
npx vercel dev
```
Open [http://localhost:3000](http://localhost:3000) to view the telemetry dashboard in your browser.
