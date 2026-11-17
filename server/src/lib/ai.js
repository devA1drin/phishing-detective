// AI features through the Vercel AI Gateway + AI SDK, all optional:
//  - scenario generator for educators (drafts go to "pending review", never straight to players)
//  - per-answer coach tailored to the player's weak categories
// Credentials: AI_GATEWAY_API_KEY, or Vercel OIDC (VERCEL_OIDC_TOKEN, injected automatically on
// Vercel when the project has AI Gateway access). Without them every feature degrades to a
// static fallback and the admin panel explains what is missing. AI_ENABLED=false turns AI off.
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { CATEGORIES, categorizeFlag } from './categories.js';

export const AI_MODEL = process.env.AI_GATEWAY_MODEL || 'openai/gpt-5.4-mini';
const TIMEOUT_GENERATE_MS = Number(process.env.AI_GENERATE_TIMEOUT_MS) || 40_000;
const TIMEOUT_COACH_MS = Number(process.env.AI_COACH_TIMEOUT_MS) || 7_000;
// Deterministic offline stand-in for tests and local demos only (never on Vercel).
const FAKE = process.env.AI_FAKE === '1' && !process.env.VERCEL;

let coachPausedUntil = 0; // after a gateway failure the coach serves static tips for a while (no added latency)
const COACH_COOLDOWN_MS = 5 * 60 * 1000;
let lastError = null; // last gateway failure (shown to admins, no secrets)

export function aiStatus(env = process.env, fake = FAKE) {
  if (env.AI_ENABLED === 'false') return { enabled: false, reason: 'AI is turned off (AI_ENABLED=false).' };
  if (fake) return { enabled: true, model: 'fake (offline test mode)', auth: 'none' };
  const auth = env.AI_GATEWAY_API_KEY ? 'api-key' : env.VERCEL_OIDC_TOKEN || env.VERCEL ? 'vercel-oidc' : null;
  if (!auth) return { enabled: false, reason: 'No AI credentials. Set AI_GATEWAY_API_KEY (Vercel dashboard → AI Gateway → API keys) or deploy on Vercel with AI Gateway enabled (OIDC).' };
  return { enabled: true, model: AI_MODEL, auth, lastError };
}

const remember = (e) => {
  const msg = String(e?.message || e).replace(/(key|token)[^\s]*/gi, '$1…').slice(0, 300);
  lastError = { message: msg, at: new Date().toISOString() };
  coachPausedUntil = Date.now() + COACH_COOLDOWN_MS;
  return msg;
};

// ── scenario generator ──
const flagSchema = z.object({
  target: z.enum(['sender', 'subject', 'body', 'link', 'attachment']),
  match: z.string().optional().describe('For body flags: an EXACT, verbatim substring of the body'),
  index: z.number().int().optional().describe('For link/attachment flags: index into links/attachments'),
  label: z.string().describe('2-5 word name of the red flag'),
  detail: z.string().describe('One sentence explaining why it is suspicious'),
});
export const scenarioSchema = z.object({
  senderName: z.string(),
  senderAddress: z.string().describe('Email address, SMS sender ID/number, social handle, or caller number'),
  subject: z.string().optional().describe('Email only'),
  platform: z.string().optional().describe('Social only: Messenger, Instagram, Telegram, Facebook, Viber'),
  body: z.string().describe('Message text. Put {{link:0}} where links[0] appears. Calls: lines starting "Caller:" or "You:"'),
  links: z.array(z.object({ text: z.string(), href: z.string(), qr: z.boolean().optional() })).default([]),
  attachments: z.array(z.object({ name: z.string(), size: z.string() })).default([]),
  redFlags: z.array(flagSchema).default([]),
  safeSigns: z.array(z.string()).default([]),
  explanation: z.string(),
});

const LANG = { en: 'English', tl: 'Filipino (Tagalog)', taglish: 'Taglish (natural mix of Tagalog and English, as Filipino students text)' };

export function generatorPrompt({ channel, difficulty, isPhishing, language, topic }) {
  return [
    'You write training scenarios for "Phishing Detective", a cybersecurity awareness game for Filipino university students.',
    `Write ONE ${isPhishing ? 'PHISHING' : 'LEGITIMATE'} ${{ email: 'email', sms: 'SMS text message', social: 'social-media direct message', call: 'phone call transcript (vishing)' }[channel]}.`,
    `Language: ${LANG[language] || LANG.en}. Difficulty ${difficulty}/3 (1 = obvious, 3 = subtle, look-alike domains and believable context).`,
    topic ? `Topic / organization: ${topic}.` : 'Use a realistic Philippine context (GCash, Maya, BDO, BPI, Shopee, Lazada, LBC, SSS, Pag-IBIG, CHED, PhilHealth, the university portal, job offers).',
    'Rules:',
    '- Use ONLY fictional domains/numbers for scam infrastructure (e.g. *.online, *.top, look-alikes). Never real personal data. Legit messages use the organization\'s real public domain.',
    '- Never include working instructions for crime; this is defensive education.',
    isPhishing
      ? '- Include 2-5 redFlags. Body flags must use "match" with an EXACT verbatim substring of the body. Link flags use "index". Include a sender flag when the sender is fake.'
      : '- redFlags must be empty. Give 2-4 safeSigns explaining why it can be trusted.',
    channel === 'call' ? '- Body: 3-6 lines, each starting with "Caller:" or "You:". No links.' : '- If there is a link, write {{link:0}} in the body and describe it in links[0] (text = what the reader sees, href = the real URL).',
    channel === 'email' ? '- Include a subject.' : '- No subject.',
    '- explanation: 1-2 sentences with the key lesson.',
  ].join('\n');
}

/** Fill in fields the model may omit and tidy flags so they validate. */
export function normaliseGenerated(obj, opts) {
  const s = { ...obj, channel: opts.channel, difficulty: Number(opts.difficulty), isPhishing: !!opts.isPhishing, language: opts.language || 'en' };
  if (s.channel !== 'email') delete s.subject;
  if (s.channel !== 'social') delete s.platform;
  if (s.channel === 'call') s.links = [];
  if (!s.isPhishing) s.redFlags = [];
  s.redFlags = (s.redFlags || []).filter((f) => f.target !== 'body' || (f.match && s.body.includes(f.match)));
  return s;
}

function fakeScenario(opts) {
  const ph = !!opts.isPhishing;
  const base = { senderName: ph ? 'GCash Rewards' : 'URS Registrar', senderAddress: ph ? 'promo@gcash-rewards.online' : 'registrar@urs.edu.ph',
    body: ph ? 'Congrats! You won P5,000. Claim within 1 hour at {{link:0}} and enter your MPIN.' : 'Enrollment opens on Monday. Log in to the portal yourself at {{link:0}}.',
    links: [{ text: ph ? 'gcash-rewards.online' : 'portal.urs.edu.ph', href: ph ? 'https://gcash-rewards.online/claim' : 'https://portal.urs.edu.ph' }],
    redFlags: ph ? [{ target: 'body', match: 'enter your MPIN', label: 'Asks for MPIN', detail: 'GCash never asks for your MPIN.' }, { target: 'link', index: 0, label: 'Fake domain', detail: 'Not gcash.com.' }] : [],
    safeSigns: ph ? [] : ['Official domain', 'No request for credentials'], explanation: ph ? 'Prize + MPIN request = phishing.' : 'Official sender and matching link.' };
  if (opts.channel === 'call') { base.body = ph ? 'Caller: This is GCash, read me your OTP.\nYou: Why?' : 'Caller: This is the Registrar, please visit our office.\nYou: Okay.'; base.links = []; base.redFlags = ph ? [{ target: 'body', match: 'read me your OTP', label: 'Asks for OTP', detail: 'Never share an OTP.' }] : []; }
  if (opts.channel === 'email') base.subject = ph ? 'You won!' : 'Enrollment schedule';
  return base;
}

/** Generate one draft scenario. Throws with a readable message when AI is unavailable. */
export async function generateScenario(opts) {
  const st = aiStatus();
  if (!st.enabled) throw Object.assign(new Error(st.reason), { status: 503 });
  if (FAKE) return { scenario: normaliseGenerated(fakeScenario(opts), opts), model: 'fake' };
  try {
    const { output } = await generateText({
      model: AI_MODEL,
      output: Output.object({ schema: scenarioSchema }),
      prompt: generatorPrompt(opts),
      abortSignal: AbortSignal.timeout(TIMEOUT_GENERATE_MS),
    });
    lastError = null;
    return { scenario: normaliseGenerated(output, opts), model: AI_MODEL };
  } catch (e) {
    throw Object.assign(new Error(`AI Gateway error: ${remember(e)}`), { status: 502 });
  }
}

// ── coach ──
const categorizeFlagSafe = (f) => (f ? categorizeFlag(f) : null);
export function staticCoach({ scenario, result, weak }) {
  const focus = weak[0]?.category || (scenario.isPhishing ? (categorizeFlagSafe(result.redFlags.find((f) => !f.found)) || 'link') : 'legit');
  const c = CATEGORIES[focus] || CATEGORIES.link;
  const fil = scenario.language && scenario.language !== 'en';
  const opener = result.isCorrect ? 'Nice call.' : result.phished ? 'That link was the trap.' : 'Tricky one.';
  return `${opener} Coach tip on ${c.label.toLowerCase()}: ${fil ? c.tipTl : c.tip}`;
}

export async function coachText({ scenario, result, weak }) {
  const fallback = { source: 'static', text: staticCoach({ scenario, result, weak }) };
  const st = aiStatus();
  if (!st.enabled) return fallback;
  if (FAKE) return { source: 'ai', text: `AI coach (test): focus on ${weak.map((w) => w.label).join(', ') || 'the red flags'}.` };
  const missed = result.redFlags.filter((f) => !f.found).map((f) => `${f.label}: ${f.detail}`);
  const prompt = [
    'You are a friendly cybersecurity coach for Filipino university students playing a phishing-detection game.',
    `Write 2-3 short sentences (max 70 words) of personalised feedback. ${scenario.language && scenario.language !== 'en' ? 'Reply in natural Taglish.' : 'Reply in simple English.'}`,
    'Be encouraging, concrete, and refer to THIS message. Do not repeat the whole explanation. No markdown.',
    `Message (${scenario.channel}, from "${scenario.senderName}" <${scenario.senderAddress}>): ${scenario.body.slice(0, 900)}`,
    `Truth: ${scenario.isPhishing ? 'PHISHING' : 'LEGIT'}. Player answered: ${result.phished ? 'opened the link' : result.timedOut ? 'ran out of time' : result.isCorrect ? 'correctly' : 'incorrectly'}.`,
    missed.length ? `Red flags the player missed: ${missed.join(' | ')}` : 'The player found every red flag (or it was legit).',
    weak.length ? `The player's weakest areas overall: ${weak.map((w) => `${w.label} (misses ${Math.round(w.weakness * 100)}%)`).join(', ')}. Connect the tip to these if relevant.` : '',
  ].join('\n');
  if (Date.now() < coachPausedUntil) return fallback;
  try {
    const { text } = await generateText({ model: AI_MODEL, prompt, abortSignal: AbortSignal.timeout(TIMEOUT_COACH_MS) });
    lastError = null;
    const clean = text.trim().slice(0, 600);
    return clean ? { source: 'ai', text: clean } : fallback;
  } catch (e) {
    remember(e);
    return fallback;
  }
}
