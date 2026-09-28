import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';
import { getSetting } from './db';

/**
 * GigaChat от Сбера. Его серверы подписаны корневым сертификатом Минцифры,
 * которого нет в стандартном наборе Node, — добавляем его только для этих запросов.
 * Ключ авторизации (base64 от client_id:secret) вводится в админке.
 */

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_URL = 'https://api.giga.chat/v1/chat/completions';
const SCOPE = 'GIGACHAT_API_PERS';
export const GIGACHAT_MODEL = 'GigaChat-3-Ultra';
export const GIGACHAT_KEY_SETTING = 'gigachat_key';

const russianRootCa = fs.readFileSync(new URL('./certs/russian_trusted_root_ca.pem', import.meta.url), 'utf8');
const agent = new https.Agent({ ca: [...tls.rootCertificates, russianRootCa], keepAlive: true });

export class GigaChatError extends Error {}

export function gigachatKey(): string | undefined {
  return getSetting(GIGACHAT_KEY_SETTING) ?? process.env.GIGACHAT_AUTH_KEY?.trim() ?? undefined;
}

function post(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'POST', agent, headers, timeout: timeoutMs }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          // Не JSON — отдадим статус, текст в ошибку не тащим.
        }
        resolve({ status: response.statusCode ?? 0, json });
      });
    });
    request.on('timeout', () => request.destroy(new GigaChatError('GigaChat не ответил вовремя')));
    request.on('error', reject);
    request.end(body);
  });
}

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

/** Токен доступа живёт 30 минут — берём новый заранее, за минуту до конца. */
async function accessToken(key: string): Promise<string> {
  if (cachedToken?.key === key && cachedToken.expiresAt - Date.now() > 60_000) return cachedToken.token;

  const { status, json } = await post(
    OAUTH_URL,
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: `Basic ${key}`,
    },
    new URLSearchParams({ scope: SCOPE }).toString(),
    15_000,
  );
  if (status !== 200 || !json?.access_token) {
    throw new GigaChatError(`GigaChat не выдал токен (${status}${json?.message ? `: ${json.message}` : ''})`);
  }
  cachedToken = { key, token: json.access_token, expiresAt: Number(json.expires_at) || Date.now() + 25 * 60_000 };
  return cachedToken.token;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function gigachatComplete(messages: ChatMessage[], options: { key?: string } = {}): Promise<string> {
  const key = options.key ?? gigachatKey();
  if (!key) throw new GigaChatError('Ключ GigaChat не задан');

  const token = await accessToken(key);
  const { status, json } = await post(
    API_URL,
    { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    JSON.stringify({ model: GIGACHAT_MODEL, messages, temperature: 0.9, max_tokens: 300 }),
    60_000,
  );
  if (status === 401) cachedToken = null;
  const text = json?.choices?.[0]?.message?.content;
  if (status !== 200 || typeof text !== 'string') {
    throw new GigaChatError(`GigaChat ответил ${status}${json?.message ? `: ${json.message}` : ''}`);
  }
  return text.trim();
}
