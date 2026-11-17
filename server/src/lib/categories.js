// Red-flag categories: used for weakness tracking, adaptive selection and the coach.
export const CATEGORIES = {
  sender: { label: 'Fake senders', tip: 'Check the exact sender: the full email domain, the SMS sender ID or the caller. Look-alike domains (bdo-online-ph.com), personal Gmail or +63 mobile numbers posing as companies are red flags. Caller ID can be faked, so hang up and call the official number yourself.', tipTl: 'Tingnan mabuti kung sino talaga ang nagpadala: ang buong domain, sender ID o numero. Puwedeng pekeng ang caller ID, kaya ikaw mismo ang tumawag sa official hotline.' },
  link: { label: 'Fake links & QR codes', tip: 'Before you trust a link, inspect where it really goes: hover or long-press, or "scan" a QR and read the decoded URL. The real domain is the part just before the first single slash (bdo.com.ph, not bdo.com.ph-secure.help). Shortened links and QR codes hide the destination.', tipTl: 'Bago mag-click, silipin muna kung saan talaga papunta ang link o QR. Ang totoong domain ay ang bahago bago ang unang "/". Itago man ng short link o QR, i-check pa rin.' },
  urgency: { label: 'Urgency & threats', tip: 'Deadlines like "24 hours", "today 6PM" or "account will be closed" are pressure tactics. Real organizations give you time and other ways to verify. When you feel rushed, slow down.', tipTl: 'Ang "ngayon na", "24 oras" o "isasara ang account" ay paraan para magmadali ka. Huminto muna at i-verify sa official na paraan.' },
  credentials: { label: 'Requests for OTP, PIN or password', tip: 'No bank, e-wallet, school or government office will ask for your OTP, MPIN, password or card PIN by text, email, chat or call. Any request for these is phishing, even if everything else looks real.', tipTl: 'Walang bangko, e-wallet, paaralan o ahensya na hihingi ng OTP, MPIN, password o PIN. Kapag hiningi, scam iyon.' },
  money: { label: 'Fees, prizes & payments', tip: 'Prizes you never joined, "processing fees" to release your own money, guaranteed returns and paying to a personal GCash are classic scams. Legit payouts never require you to pay first.', tipTl: 'Premyong hindi mo sinalihan, "processing fee", at bayad sa personal na GCash ay mga klasikong scam. Hindi ka magbabayad para makatanggap ng pera.' },
  attachment: { label: 'Dangerous attachments', tip: 'Watch out for .html, .exe, macro-enabled Office files (.xlsm, .docm) and double extensions like "file.pdf.exe". Never enable macros on an unexpected file.', tipTl: 'Mag-ingat sa .html, .exe, .xlsm o "file.pdf.exe" na attachment. Huwag i-enable ang macros.' },
  pretext: { label: 'Too-good stories & manipulation', tip: 'Scammers use believable stories: an emergency, a secret, a job with no interview, a stranger asking you to move to Telegram, or an app they ask you to install. Verify through a channel you already trust.', tipTl: 'Gumagamit ang scammer ng kapani-paniwalang kuwento: emergency, sikreto, trabahong walang interview, o app na ipapa-install. I-verify sa paraang kilala mo na.' },
  legit: { label: 'Recognizing legit messages', tip: 'Not everything is a scam. Legit messages come from the official domain or sender ID, match something you actually did, and ask for nothing sensitive. Over-flagging real messages has a cost too.', tipTl: 'Hindi lahat ay scam. Ang totoong mensahe ay galing sa official na domain, tugma sa ginawa mo, at walang hinihinging sensitibong impormasyon.' },
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

const RULES = [
  ['credentials', /otp|mpin|\bpin\b|password|credential|log ?in|card number|cvv|sensitive data|card details/i],
  ['money', /too good|fee|prize|reward|pay|gcash|wallet|money|return|discount|gift card|loan|claim|account number|refund|reversal|bait/i],
  ['urgency', /urgen|deadline|threat|pressure|same-day|time|loss|penalty|disconnect|all-caps/i],
  ['attachment', /attachment|macro|extension|\.html/i],
  ['pretext', /emergency|secrecy|secret|interview|task|telegram|remote|verification|story|real-looking|exam|thread|reference|stranger|watch|id document|id photo/i],
];

/** Category of one red flag (target first, then keywords in its label). */
export function categorizeFlag(f) {
  if (f.target === 'sender') return 'sender';
  if (f.target === 'link') return 'link';
  if (f.target === 'attachment') return 'attachment';
  const text = `${f.label} ${f.target === 'subject' ? 'urgency' : ''}`;
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return f.target === 'subject' ? 'urgency' : 'pretext';
}

/** Distinct categories in a scenario (legit messages → ['legit']). */
export function scenarioCategories(s) {
  if (!s.isPhishing) return ['legit'];
  return [...new Set((s.redFlags || []).map(categorizeFlag))];
}

/** Bayesian-smoothed miss rate: (missed + 1) / (seen + 2). New players start at 0.5. */
export const weaknessScore = (row) => (Number(row?.missed || 0) + 1) / (Number(row?.seen || 0) + 2);

/** Per-category outcome of one answer, from the scoring result. */
export function categoryOutcomes(scenario, result) {
  if (!scenario.isPhishing) return [{ category: 'legit', missed: !result.isCorrect }];
  const byCat = new Map();
  result.redFlags.forEach((f) => {
    const c = categorizeFlag(f);
    const cur = byCat.get(c) || { found: false };
    if (f.found) cur.found = true;
    byCat.set(c, cur);
  });
  return [...byCat].map(([category, v]) => ({ category, missed: !result.isCorrect || !v.found }));
}

/** Top weak categories (needs some evidence first). */
export function weakCategories(rows, { min = 2, top = 3 } = {}) {
  return rows
    .filter((r) => Number(r.seen) >= min)
    .map((r) => ({ category: r.category, label: CATEGORIES[r.category]?.label || r.category, seen: Number(r.seen), missed: Number(r.missed), weakness: Math.round(weaknessScore(r) * 100) / 100 }))
    .sort((a, b) => b.weakness - a.weakness || b.seen - a.seen)
    .slice(0, top);
}
