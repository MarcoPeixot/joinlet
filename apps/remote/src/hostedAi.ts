import Anthropic from "@anthropic-ai/sdk";
import {
  COMPATIBLE_PROVIDERS,
  isAiProvider,
  isCompatibleProvider,
  readChatModel,
} from "@strukt/core";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { createSettings } from "../../server/src/settings";
import { createOpenRouterClient } from "../../server/src/openrouter";
import {
  parseChatBody,
  replyToChat,
  streamChatEvents,
  ChatFailure,
} from "../../server/src/chat";
import {
  readChatTarget,
  replyToEditableChat,
  streamEditableChat,
} from "../../server/src/chatEdit";
import { chatEventStream } from "../../server/src/chatStream";
import { proposeOps } from "../../server/src/diagram";
import { writeDoc } from "../../server/src/doc";
import { MODELS, type AiClient } from "../../server/src/anthropic";
import type { HostedStore } from "./hostedStore";
import { HostedError } from "./hostedStore";

const PROVIDER_ORIGINS = new Set([
  "https://api.anthropic.com",
  "https://openrouter.ai",
  "https://api.openai.com",
  "https://opencode.ai",
  ...Object.values(COMPATIBLE_PROVIDERS).map((p) => new URL(p.baseUrl).origin),
]);
/** Fixed public providers only. Arbitrary compatible URLs/redirects must never become a hosted SSRF proxy. */
export function hostedProviderFetch(
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (!PROVIDER_ORIGINS.has(url.origin) || url.username || url.password)
      throw new HostedError(
        400,
        "This provider address is not supported on Joinlet Cloud. Choose a listed public provider.",
      );
    const response = await fetcher(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        init?.signal ?? new AbortController().signal,
        AbortSignal.timeout(240_000),
      ]),
    });
    if (!response.body) return response;
    const reader = response.body.getReader();
    let bytes = 0;
    return new globalThis.Response(
      new ReadableStream({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
              return;
            }
            bytes += next.value.byteLength;
            if (bytes > 8_000_000) {
              await reader.cancel();
              throw Error("Provider response limit exceeded.");
            }
            controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        cancel: (reason) => reader.cancel(reason),
      }),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  }) as typeof fetch;
}
const failure = (error: unknown) => ({
  status:
    error instanceof ChatFailure
      ? error.status
      : error instanceof HostedError
        ? error.status
        : (error as { status?: number })?.status === 429
          ? 429
          : error instanceof Error &&
              ["AbortError", "TimeoutError"].includes(error.name)
            ? 504
            : 502,
  error:
    error instanceof ChatFailure
      ? error.message
      : error instanceof HostedError
        ? error.message
        : "The AI provider could not complete this request. Check your connection, model and available credits.",
});
const localized = (client: AiClient, locale: unknown): AiClient => {
  const params = (
    p: Parameters<AiClient["beta"]["messages"]["create"]>[0],
  ) => ({
    ...p,
    system: [
      ...(typeof p.system === "string"
        ? [{ type: "text" as const, text: p.system }]
        : (p.system ?? [])),
      {
        type: "text" as const,
        text:
          locale === "pt-BR"
            ? "Responda em português do Brasil."
            : "Respond in English.",
      },
    ],
  });
  return {
    beta: {
      messages: {
        create: (p, o) => client.beta.messages.create(params(p), o),
        ...(client.beta.messages.stream
          ? {
              stream: (
                p: Parameters<AiClient["beta"]["messages"]["create"]>[0],
                o?: { signal?: AbortSignal },
              ) => client.beta.messages.stream!(params(p), o),
            }
          : {}),
      },
    },
  };
};

export function createHostedAi(store: HostedStore, fetcher?: typeof fetch) {
  const active = new Set<number>();
  const rates = new Map<number, { at: number; n: number }>();
  const safeFetch = hostedProviderFetch(fetcher);
  return async (req: Request, res: Response, user: number) => {
    for (const [id, rate] of rates)
      if (Date.now() - rate.at > 60_000) rates.delete(id);
    const rate = rates.get(user) ?? { at: Date.now(), n: 0 };
    rate.n++;
    rates.set(user, rate);
    if (rate.n > 90)
      throw new HostedError(429, "Too many requests. Try again in a minute.");
    if (active.has(user) || active.size >= 16)
      throw new HostedError(
        429,
        "An AI request is already running. Wait or stop it before trying again.",
      );
    active.add(user);
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) abort.abort();
    };
    res.on("close", onClose);
    const signal = AbortSignal.any([
      abort.signal,
      AbortSignal.timeout(240_000),
    ]);
    try {
      const requestFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
        safeFetch(input, {
          ...init,
          signal: AbortSignal.any([signal, init?.signal ?? signal]),
        })) as typeof fetch;
      const settings = createSettings({
        file: String(user),
        env: {},
        fs: {
          read: async () => store.settings(user),
          write: async (_path, text) => store.saveSettings(user, text),
        },
        fetch: requestFetch,
        anthropic: (apiKey) =>
          new Anthropic({
            apiKey,
            authToken: null,
            fetch: requestFetch,
            maxRetries: 1,
            timeout: 240_000,
          }),
        openrouter: (apiKey) =>
          createOpenRouterClient({ apiKey, fetch: requestFetch }),
      });
      await settings.load();
      const path = req.path;
      if (path === "/api/settings") {
        if (req.method === "GET") return res.json(settings.view());
        const base = req.body?.openai?.baseUrl;
        if (base) {
          let url: URL;
          try {
            url = new URL(base);
          } catch {
            throw new HostedError(400, "Invalid provider address.");
          }
          if (!PROVIDER_ORIGINS.has(url.origin) || url.username || url.password)
            throw new HostedError(
              400,
              "Choose a listed public provider for Joinlet Cloud. Local and private AI endpoints are available in the local app.",
            );
        }
        const next = await settings.update(req.body);
        if (typeof next === "string") throw new HostedError(400, next);
        return res.json(next);
      }
      if (path === "/api/settings/test") {
        if (!isAiProvider(req.body?.provider))
          throw new HostedError(400, "Invalid provider.");
        return res.json(await settings.test(req.body.provider));
      }
      if (path.startsWith("/api/settings/") && req.method === "GET") {
        if (path.endsWith("/anthropic-models"))
          return res.json({
            models: [...new Set(Object.values(MODELS))].map((id) => ({
              id,
              name: id,
              context: 0,
            })),
          });
        if (path.endsWith("/openrouter-models"))
          return res.json({ models: await settings.openRouterModels() });
        if (path.endsWith("/opencode-models"))
          return res.json({ models: await settings.openCodeModels() });
        if (path.endsWith("/opencode-go-models"))
          return res.json({ models: await settings.openCodeModels(true) });
        if (path.endsWith("/openai-models")) {
          const provider = req.query.provider ?? "openai";
          if (provider !== "openai" && !isCompatibleProvider(provider))
            throw new HostedError(400, "Invalid provider.");
          return res.json({ models: await settings.openAiModels(provider) });
        }
        throw new HostedError(404, "Unknown settings endpoint.");
      }
      let ai = settings.current();
      if (req.body?.selection !== undefined) {
        const choice = readChatModel(req.body.selection);
        if (!choice) throw new HostedError(400, "Invalid model selection.");
        const selected = settings.forChat(choice);
        if (typeof selected === "string") throw new HostedError(400, selected);
        ai = selected;
      }
      if (!ai)
        throw new HostedError(
          503,
          "Connect your own AI provider in Settings → AI and providers.",
        );
      let client =
        ai.forSession?.(
          `${user}:${
            req
              .header("x-strukt-session")
              ?.replace(/[^A-Za-z0-9_.:-]/g, "")
              .slice(0, 120) ?? "chat"
          }`,
        ) ?? ai.client;
      client = localized(client, req.body?.locale);
      if (JSON.stringify(req.body).length > 160_000)
        throw new HostedError(
          413,
          "Use a smaller selection or conversation for this request.",
        );
      if (path === "/api/ai/diagram") {
        const body = req.body;
        if (
          typeof body?.instruction !== "string" ||
          !body.instruction.trim() ||
          body.instruction.length > 4000 ||
          typeof body.json !== "string" ||
          !["edit", "generate"].includes(body.mode) ||
          (body.selection !== undefined &&
            (!Array.isArray(body.selection) ||
              body.selection.length > 500 ||
              body.selection.some((s: unknown) => typeof s !== "string")))
        )
          throw new HostedError(400, "Invalid diagram request.");
        const result = await proposeOps(
          client,
          { ...body, selection: body.selection ?? [] },
          signal,
          ai.models,
        );
        return res.status(result.ok ? 200 : result.status).json(result);
      }
      if (path === "/api/ai/doc") {
        if (typeof req.body?.json !== "string")
          throw new HostedError(400, "Invalid document request.");
        const result = await writeDoc(client, req.body.json, signal, ai.models);
        return res.status(result.ok ? 200 : result.status).json(result);
      }
      if (path !== "/api/ai/chat")
        throw new HostedError(404, "Unknown AI endpoint.");
      const body = parseChatBody(req.body);
      if (typeof body === "string") throw new HostedError(400, body);
      const target =
        req.body.target === undefined
          ? undefined
          : readChatTarget(req.body.target);
      if (target === null) throw new HostedError(400, "Invalid editable item.");
      if (req.body.stream === true) {
        const events = target
          ? streamEditableChat(client, body, target, signal, ai.models)
          : streamChatEvents(client, body, signal, ai.models);
        const first = await events.next();
        res
          .type("application/x-ndjson")
          .set("Cache-Control", "no-store")
          .set("X-Accel-Buffering", "no");
        await pipeline(
          Readable.fromWeb(
            chatEventStream(
              events,
              first,
              abort,
              failure,
            ) as unknown as import("node:stream/web").ReadableStream,
          ),
          res,
        );
        return;
      }
      const result = target
        ? await replyToEditableChat(client, body, target, signal, ai.models)
        : await replyToChat(client, body, signal, ai.models);
      return res.status(result.ok ? 200 : result.status).json(result);
    } catch (error) {
      if (!res.headersSent) {
        const problem = failure(error);
        res.status(problem.status).json({ error: problem.error });
      }
    } finally {
      abort.abort();
      res.off("close", onClose);
      active.delete(user);
    }
  };
}

/** Worker/connector analysis uses the owner's existing encrypted BYOK settings. */
export async function hostedRepositoryAnalyzer(store: HostedStore, user: number, fetcher: typeof fetch = fetch) {
  const safeFetch = hostedProviderFetch(fetcher);
  const settings = createSettings({ file: String(user), env: {}, fs: { read: async () => store.settings(user), write: async () => { throw Error('Worker settings are read-only.'); } }, fetch: safeFetch,
    anthropic: apiKey => new Anthropic({ apiKey, authToken: null, fetch: safeFetch, timeout: 240_000, maxRetries: 1 }),
    openrouter: apiKey => createOpenRouterClient({ apiKey, fetch: safeFetch }),
  });
  await settings.load(); const provider = settings.current();
  if (!provider) return undefined;
  const { repositoryAnalyzer } = await import('../../server/src/repositoryAi');
  return repositoryAnalyzer(provider.client, provider.models.edit);
}
