export type SecurityAction = "pass" | "block" | "hint";

export function buildOpenAiSseBody(text: string, id: string): string {
  const now = Math.floor(Date.now() / 1000);
  const model = "security";
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: now,
    model,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
  const finish = {
    id,
    object: "chat.completion.chunk",
    created: now,
    model,
    choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n` +
    `data: ${JSON.stringify(finish)}\n\n` +
    "data: [DONE]\n\n";
}

export function buildOpenAiJsonBody(text: string, id: string): string {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    id,
    object: "chat.completion",
    created: now,
    model: "security",
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
  });
}

export function guessRequestWantsSse(url: string, headers: Record<string, string>, bodyText: string): boolean {
  try {
    if (bodyText) {
      const parsed = JSON.parse(bodyText) as { stream?: unknown };
      if (parsed?.stream === true) return true;
    }
  } catch { }

  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const accept = (normalizedHeaders.accept || "").toLowerCase();
  if (accept.includes("text/event-stream")) return true;

  if (url.includes("/chat/completions")) return true;
  return false;
}

export function isSseResponse(resp: Response): boolean {
  const contentType = (resp.headers.get("content-type") || "").toLowerCase();
  return contentType.includes("text/event-stream");
}

export function createBlockResponse(wantsSse: boolean, text: string): Response {
  const id = "chatcmpl-security-blocked";
  if (wantsSse) {
    return new Response(buildOpenAiSseBody(text, id), {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  return new Response(buildOpenAiJsonBody(text, id), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function createHintResponse(original: Response, originalBody: string, hintText: string, wantsSse: boolean): Response | null {
  if (originalBody.includes('"tool_calls"')) return null;

  const originalText = wantsSse ? extractTextFromSseBody(originalBody) : extractTextFromJsonBody(originalBody);
  const mergedText = `${originalText}${hintText}`;
  const body = wantsSse
    ? buildOpenAiSseBody(mergedText, "chatcmpl-security-hint")
    : buildOpenAiJsonBody(mergedText, "chatcmpl-security-hint");

  const headers = new Headers(original.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");

  return new Response(body, {
    status: original.status,
    statusText: original.statusText,
    headers,
  });
}

function extractTextFromSseBody(body: string): string {
  const lines = body.split("\n");
  const chunks: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    if (line === "data: [DONE]") continue;
    try {
      const parsed = JSON.parse(line.slice(6)) as {
        choices?: Array<{
          delta?: { content?: unknown };
          message?: { content?: unknown };
        }>;
      };
      const choice = parsed.choices?.[0];
      const deltaContent = choice?.delta?.content;
      const messageContent = choice?.message?.content;
      if (typeof deltaContent === "string" && deltaContent) chunks.push(deltaContent);
      if (typeof messageContent === "string" && messageContent) chunks.push(messageContent);
    } catch { }
  }
  return chunks.join("");
}

function extractTextFromJsonBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      choices?: Array<{
        message?: { content?: unknown };
        delta?: { content?: unknown };
      }>;
    };
    const choice = parsed.choices?.[0];
    if (typeof choice?.message?.content === "string") return choice.message.content;
    if (typeof choice?.delta?.content === "string") return choice.delta.content;
    return "";
  } catch {
    return "";
  }
}
