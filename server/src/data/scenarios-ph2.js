// Phase 2 scenario pack: Filipino/Taglish smishing, vishing (call transcripts) and QR phishing.
// Call transcripts: one line per speaker, prefixed "Caller:" or "You:". The renderer shows them as a call log.
// QR links: { qr: true } renders a QR image that encodes href; players "scan" (inspect) to see the decoded URL.
// All phishing numbers and domains are fictional.
export const phase2Scenarios = [
  // ───────────── vishing (voice phishing) ─────────────
  {
    id: 'vish-bdo-otp', channel: 'call', difficulty: 2, isPhishing: true, language: 'taglish',
    senderName: 'BDO Fraud Dept.', senderAddress: '+63 2 8631 8000 (spoofed)',
    body: 'Caller: Good morning po, this is Mark from BDO Fraud Department. May na-detect po kaming transaction na P24,500 sa card ninyo sa Lazada.\nYou: Ha? Hindi po ako bumili.\nCaller: Kaya nga po, ma\'am/sir, para ma-cancel natin, may ise-send po kaming 6-digit code. Paki-basa lang po sa akin ang OTP.\nCaller: Kailangan po within 5 minutes, otherwise ma-po-post na po ang charge at hindi na ma-reverse.\nYou: Sige po, wait lang.',
    redFlags: [
      { target: 'sender', label: 'Spoofed caller ID', detail: 'Caller ID can be faked. A number that looks like the bank hotline proves nothing.' },
      { target: 'body', match: 'Paki-basa lang po sa akin ang OTP.', label: 'Asks for your OTP', detail: 'An OTP is the final key to your account. Banks never ask you to read it to them, not even "to cancel" a charge.' },
      { target: 'body', match: 'within 5 minutes, otherwise ma-po-post na po ang charge', label: 'Time pressure', detail: 'Rushing you stops you from hanging up and calling the bank yourself.' },
    ],
    explanation: 'Classic bank vishing. Hang up, then call the number on the back of your card. Never read an OTP to anyone.',
  },
  {
    id: 'vish-lbc-customs', channel: 'call', difficulty: 1, isPhishing: true, language: 'tl',
    senderName: 'Unknown', senderAddress: '+63 951 774 0326',
    body: 'Caller: Magandang hapon po, taga-LBC Customs Clearance po ito. May package po kayo galing abroad na naka-hold sa Bureau of Customs.\nCaller: Para mai-release po, kailangan ninyong magbayad ng P3,850 na customs tax ngayong araw sa GCash number na ibibigay ko.\nYou: Wala naman po akong inorder.\nCaller: Baka po regalo ng kamag-anak. Kapag hindi nabayaran ngayon, ibabalik po namin at mamumulta pa kayo.',
    redFlags: [
      { target: 'sender', label: 'Random mobile number', detail: 'Couriers and the Bureau of Customs do not call from personal mobile numbers to collect fees.' },
      { target: 'body', match: 'magbayad ng P3,850 na customs tax ngayong araw sa GCash number', label: 'Pay to a personal GCash', detail: 'Real duties are paid through official BOC/LBC channels with an official receipt, never to a personal e-wallet.' },
      { target: 'body', match: 'ibabalik po namin at mamumulta pa kayo', label: 'Threat of penalty', detail: 'Threats are used to make you pay before you think.' },
    ],
    explanation: 'Fake customs/parcel scam. If you did not order anything, there is nothing to pay. Check with LBC through its official app or hotline.',
  },
  {
    id: 'vish-scholarship-legit', channel: 'call', difficulty: 2, isPhishing: false, language: 'taglish',
    senderName: 'URS Scholarship Office', senderAddress: 'Landline (02) 8xxx-xxxx',
    body: 'Caller: Good morning, this is Ms. Santos from the URS Scholarship and Financial Assistance Office. Tumatawag lang po ako para paalalahanan kayo na kulang pa ang Certificate of Registration ninyo sa scholarship file.\nYou: Ah, ano po ang kailangan kong gawin?\nCaller: Paki-dala lang po ang printed COR sa office namin sa campus bago mag-Friday, office hours. Wala po kayong babayaran.\nCaller: Kung gusto ninyong i-verify, puwede kayong tumawag sa trunkline na nasa urs.edu.ph o pumunta mismo sa office.',
    redFlags: [],
    safeSigns: ['Asks you to bring a document in person, not to send money or codes', 'Says clearly that there is nothing to pay', 'Invites you to verify through the official website or by visiting the office', 'No pressure beyond a normal deadline'],
    explanation: 'Legitimate reminder: no OTP, no payment, no personal-wallet transfer, and it encourages independent verification.',
  },
  {
    id: 'vish-gcash-remote-app', channel: 'call', difficulty: 3, isPhishing: true, language: 'taglish',
    senderName: 'GCash Help Center', senderAddress: '2882 (spoofed)',
    body: 'Caller: Hello po, GCash Help Center ito. Nakita po namin na may nag-attempt mag-login sa account ninyo sa ibang device.\nCaller: Para ma-secure po, i-download ninyo ang "QuickSupport" app sa Play Store para ma-check namin ang phone ninyo remotely.\nYou: Okay po, na-install ko na. May lumabas na 9-digit ID.\nCaller: Sige po, basahin ninyo sa akin ang ID, tapos buksan ninyo ang GCash app habang naka-connect tayo.',
    redFlags: [
      { target: 'sender', label: 'Spoofed hotline', detail: 'The caller ID shows the real hotline number, but spoofing makes that meaningless. GCash does not make unsolicited support calls like this.' },
      { target: 'body', match: 'i-download ninyo ang "QuickSupport" app', label: 'Remote-access app', detail: 'Remote-control apps let the scammer see and control your phone, including your e-wallet and OTPs.' },
      { target: 'body', match: 'buksan ninyo ang GCash app habang naka-connect tayo', label: 'Open your wallet while they watch', detail: 'Once connected, they can transfer your balance while you watch.' },
    ],
    explanation: 'Remote-access vishing. Never install an app because a caller told you to. Hang up and contact GCash only through the Help Center inside the app.',
  },

  // ───────────── QR phishing (quishing) ─────────────
  {
    id: 'qr-meralco-overdue', channel: 'email', difficulty: 2, isPhishing: true, language: 'taglish',
    senderName: 'Meralco Billing', senderAddress: 'billing@meralco-payonline.net',
    subject: 'Disconnection Notice: Overdue bill, i-settle bago mag-6PM',
    body: 'Mahal naming customer,\n\nAng inyong account ay may overdue balance na P2,436.18. Ang serbisyo ng kuryente ay puputulin ngayong 6:00 PM kung hindi mababayaran.\n\nPara mabilis, i-scan lang ang QR code gamit ang inyong e-wallet app:\n\n{{link:0}}\n\nSalamat,\nMeralco Billing Team',
    links: [{ text: 'Scan to pay (GCash / Maya / Bank)', href: 'https://meralco-payonline.net/qr/settle?acct=8812', qr: true }],
    redFlags: [
      { target: 'sender', label: 'Look-alike domain', detail: 'Meralco uses meralco.com.ph. "meralco-payonline.net" is not Meralco.' },
      { target: 'body', match: 'puputulin ngayong 6:00 PM', label: 'Same-day disconnection threat', detail: 'Real disconnection follows written notices and grace periods, not a same-day email deadline.' },
      { target: 'link', index: 0, label: 'QR leads to a fake site', detail: 'Scanning (inspecting) the QR reveals a non-Meralco URL. QR codes hide the destination until you check it.' },
    ],
    explanation: 'Quishing: the QR code hides a fake payment page. Pay bills only in the official Meralco app or website, typed in yourself.',
  },
  {
    id: 'qr-library-legit', channel: 'email', difficulty: 2, isPhishing: false, language: 'en',
    senderName: 'URS University Library', senderAddress: 'library@urs.edu.ph',
    subject: 'New e-journal databases available this semester',
    body: 'Hello URSians,\n\nThe University Library now offers remote access to two new e-journal databases for your research and thesis work. Scan the QR code below or open the library website, then sign in with your university account.\n\n{{link:0}}\n\nNeed help? Visit the Reference Section or reply to this email.\n\nUniversity Library',
    links: [{ text: 'Scan for e-resources', href: 'https://library.urs.edu.ph/e-resources', qr: true }],
    redFlags: [],
    safeSigns: ['Sent from the official urs.edu.ph domain', 'Decoded QR URL is on library.urs.edu.ph', 'Offers a non-QR alternative (open the library website yourself)', 'No urgency, money or password request in the email'],
    explanation: 'Legitimate: the QR code decodes to the university\'s own domain and the email gives a safe alternative.',
  },
  {
    id: 'qr-marketplace-receive', channel: 'social', platform: 'Messenger', difficulty: 3, isPhishing: true, language: 'taglish',
    senderName: 'Buyer: Jericho Dela Peña', senderAddress: 'Marketplace buyer',
    body: 'Hi! Kukunin ko na yung laptop mo, P18,000 as listed. Na-send ko na yung payment via GCash pero kailangan mo munang i-scan itong QR para ma-"receive" mo yung pera, security feature daw ng GCash for sellers.\n\n{{link:0}}\n\nPa-scan na lang tapos i-enter mo MPIN mo para ma-confirm, para ma-pick up ko na mamaya. Thanks!',
    links: [{ text: 'GCash "Receive Payment" QR', href: 'https://gcash-seller-receive.top/claim?amt=18000', qr: true }],
    redFlags: [
      { target: 'body', match: 'kailangan mo munang i-scan itong QR para ma-"receive" mo yung pera', label: 'You never scan to RECEIVE money', detail: 'Received money simply arrives in your wallet. Scanning is only for paying.' },
      { target: 'body', match: 'i-enter mo MPIN mo', label: 'Asks for your MPIN', detail: 'Your MPIN is never needed to receive money. Entering it on a scam page gives away your wallet.' },
      { target: 'link', index: 0, label: 'QR goes to a fake GCash page', detail: 'The decoded URL is gcash-seller-receive.top, not GCash.' },
    ],
    explanation: '"Scan to receive" is always a scam. Check your GCash transaction history yourself before handing over an item.',
  },

  // ───────────── smishing (Filipino / Taglish) ─────────────
  {
    id: 'sms-maya-unclaimed', channel: 'sms', difficulty: 1, isPhishing: true, language: 'taglish',
    senderName: '+63 908 552 1173', senderAddress: '+639085521173',
    body: 'Maya: May P8,000 cash reward ka na hindi pa na-claim! Mag-e-expire na ito mamayang 11:59PM. I-claim dito: {{link:0}}',
    links: [{ text: 'maya-rewards-ph.click', href: 'http://maya-rewards-ph.click/claim' }],
    redFlags: [
      { target: 'sender', label: 'Personal mobile number', detail: 'Maya texts use its registered sender ID, not a +63 personal number.' },
      { target: 'body', match: 'May P8,000 cash reward ka na hindi pa na-claim!', label: 'Unexpected reward', detail: 'A surprise reward is bait to get you to click.' },
      { target: 'link', index: 0, label: 'Fake domain', detail: 'maya-rewards-ph.click is not maya.ph.' },
    ],
    explanation: 'Reward smishing. Maya, like other e-wallets, does not send claim links by SMS. Check promos inside the official app.',
  },
  {
    id: 'sms-sss-calamity-loan', channel: 'sms', difficulty: 2, isPhishing: true, language: 'taglish',
    senderName: 'SSS-PH', senderAddress: 'SSS-PH',
    body: 'SSS: Approved na ang Calamity Loan application mo na P20,000. Para ma-release sa account mo, i-update ang bank details at mag-login gamit ang My.SSS password mo dito: {{link:0}} Valid lang hanggang bukas.',
    links: [{ text: 'sss-gov-ph.online/release', href: 'https://sss-gov-ph.online/release' }],
    redFlags: [
      { target: 'body', match: 'Approved na ang Calamity Loan application mo', label: 'Loan you did not apply for', detail: 'If you never applied, an "approval" is a hook.' },
      { target: 'body', match: 'mag-login gamit ang My.SSS password mo dito', label: 'Asks for your password via link', detail: 'Government agencies do not ask you to log in through SMS links.' },
      { target: 'link', index: 0, label: 'Fake government domain', detail: 'Philippine government sites end in .gov.ph. "sss-gov-ph.online" is not sss.gov.ph.' },
    ],
    explanation: 'Government-impersonation smishing. Even a sender ID like "SSS-PH" can be spoofed. Go to sss.gov.ph yourself.',
  },
  {
    id: 'sms-globe-load-legit', channel: 'sms', difficulty: 1, isPhishing: false, language: 'taglish',
    senderName: 'Globe', senderAddress: 'Globe',
    body: 'Globe: Salamat sa pag-load! Na-register ka na sa GoSURF50 with 3GB data, valid hanggang Nov 20, 11:59PM. I-check ang balance sa GlobeOne app. Hindi kami hihingi ng PIN o OTP sa text.',
    redFlags: [],
    safeSigns: ['Confirms something you just did (you loaded)', 'No link to click and nothing to pay', 'Points you to the official app', 'Reminds you they never ask for a PIN or OTP'],
    explanation: 'Legitimate confirmation of a load you bought: no link, no request, and it matches your own action.',
  },
  {
    id: 'sms-bpi-otp-legit', channel: 'sms', difficulty: 1, isPhishing: false, language: 'taglish',
    senderName: 'BPI', senderAddress: 'BPI',
    body: 'BPI: 482913 ang iyong One-Time PIN para sa pag-login sa BPI app. Valid ito sa loob ng 5 minuto. HUWAG itong ibigay kahit kanino, kahit sa BPI staff.',
    redFlags: [],
    safeSigns: ['You receive it right after you try to log in yourself', 'No link and no request to reply', 'Explicitly warns you not to share the OTP'],
    explanation: 'A real OTP message only delivers a code and warns you to keep it secret. It becomes dangerous only if someone asks you for it.',
  },
  {
    id: 'sms-pagibig-mp2', channel: 'sms', difficulty: 2, isPhishing: true, language: 'tl',
    senderName: '+63 927 610 0458', senderAddress: '+639276100458',
    body: 'PAG-IBIG FUND: Handa na ang inyong MP2 dividend na P6,742. Para makuha, magbayad muna ng P250 na processing fee at ipadala ang litrato ng inyong valid ID sa {{link:0}}',
    links: [{ text: 'pagibig-dividend.com', href: 'https://pagibig-dividend.com/claim' }],
    redFlags: [
      { target: 'sender', label: 'Personal mobile number', detail: 'Pag-IBIG does not text from personal numbers.' },
      { target: 'body', match: 'magbayad muna ng P250 na processing fee', label: 'Fee to release your own money', detail: 'You never pay a fee to receive dividends.' },
      { target: 'body', match: 'ipadala ang litrato ng inyong valid ID', label: 'Asks for your ID photo', detail: 'ID photos are used for identity theft and fake loans.' },
      { target: 'link', index: 0, label: 'Non-government domain', detail: 'The real site is pagibigfund.gov.ph.' },
    ],
    explanation: 'Advance-fee and identity-theft scam using Pag-IBIG\'s name. Check dividends in Virtual Pag-IBIG on pagibigfund.gov.ph.',
  },
  {
    id: 'sms-ndrrmc-alert-legit', channel: 'sms', difficulty: 2, isPhishing: false, language: 'tl',
    senderName: 'NDRRMC', senderAddress: 'NDRRMC',
    body: 'BABALA: Itinaas ang Signal No. 2 sa Rizal. Asahan ang malakas na hangin at ulan. Maghanda ng emergency kit, makinig sa abiso ng inyong LGU, at lumikas kung kinakailangan. -NDRRMC',
    redFlags: [],
    safeSigns: ['Official emergency-alert sender', 'Gives safety advice only: no link, no payment, no personal data request', 'Refers you to your LGU for instructions'],
    explanation: 'Legitimate public emergency alert. It asks you to prepare, not to click, pay, or share information.',
  },

  // ───────────── social / email (Filipino / Taglish) ─────────────
  {
    id: 'social-hacked-friend-padala', channel: 'social', platform: 'Messenger', difficulty: 2, isPhishing: true, language: 'taglish',
    senderName: 'Kim Reyes', senderAddress: 'Friend (Messenger)',
    body: 'Uy bes! Pasuyo naman, pa-send muna ng P2,000 sa GCash na ito: 0966 318 4402 (Ma. Lourdes T.). Hindi ko kasi ma-open GCash ko ngayon, babayaran kita mamaya promise! Huwag mo na lang akong tawagan, nasa klase ako. 🙏',
    redFlags: [
      { target: 'body', match: 'pa-send muna ng P2,000 sa GCash na ito', label: 'Urgent money request in chat', detail: 'Hacked accounts message friends asking for quick transfers.' },
      { target: 'body', match: '(Ma. Lourdes T.)', label: 'Different account name', detail: 'The money goes to someone else\'s wallet, not your friend\'s.' },
      { target: 'body', match: 'Huwag mo na lang akong tawagan', label: 'Discourages verification', detail: 'Scammers avoid calls because your friend\'s voice would expose them.' },
    ],
    explanation: 'Hacked-account scam. Call your friend on a number you already have before sending anything.',
  },
  {
    id: 'email-ched-grant-phish', channel: 'email', difficulty: 2, isPhishing: true, language: 'taglish',
    senderName: 'CHED Tulong Dunong', senderAddress: 'grants@ched-tdp-ph.online',
    subject: 'Congratulations! Qualified ka sa Tulong Dunong Program grant',
    body: 'Magandang araw, Iskolar!\n\nIkaw ay napili bilang benepisyaryo ng Tulong Dunong Program (TDP) na nagkakahalaga ng P15,000. Para ma-release ang grant, kumpletuhin ang form at ilagay ang inyong ATM card number at PIN.\n\n{{link:0}}\n\nMay P350 na processing fee na ibabawas sa grant o babayaran sa GCash. Deadline: bukas ng 5PM.\n\nCHED Scholarship Unit',
    links: [{ text: 'TDP Grant Release Form', href: 'https://ched-tdp-ph.online/release-form' }],
    redFlags: [
      { target: 'sender', label: 'Non-government domain', detail: 'CHED uses ched.gov.ph. ".online" domains are not government sites.' },
      { target: 'body', match: 'ilagay ang inyong ATM card number at PIN', label: 'Asks for card number and PIN', detail: 'No scholarship ever needs your ATM PIN.' },
      { target: 'body', match: 'May P350 na processing fee', label: 'Processing fee', detail: 'Government grants do not charge release fees.' },
      { target: 'link', index: 0, label: 'Link to a fake form', detail: 'The form is hosted on the fake domain.' },
    ],
    explanation: 'Scholarship scam targeting students. Confirm grants with your school\'s scholarship office or ched.gov.ph.',
  },
  {
    id: 'email-urs-buwan-ng-wika-legit', channel: 'email', difficulty: 1, isPhishing: false, language: 'tl',
    senderName: 'URS Office of Student Affairs', senderAddress: 'osa@urs.edu.ph',
    subject: 'Paanyaya: Pagdiriwang ng Buwan ng Wikang Pambansa 2026',
    body: 'Magandang araw, mga URSian!\n\nInaanyayahan ang lahat sa pagdiriwang ng Buwan ng Wikang Pambansa sa Agosto 28, 8:00 n.u., sa University Gymnasium. Magkakaroon ng sabayang pagbigkas, balagtasan at patimpalak sa pagsulat ng tula.\n\nPara sa mekaniks ng mga patimpalak, bisitahin ang {{link:0}}.\n\nWalang bayad ang paglahok.\n\nTanggapan ng mga Gawaing Pang-mag-aaral',
    links: [{ text: 'urs.edu.ph/buwan-ng-wika', href: 'https://urs.edu.ph/buwan-ng-wika' }],
    redFlags: [],
    safeSigns: ['Official urs.edu.ph sender', 'Link text matches the real university URL', 'No request for passwords, money or personal data', 'Explicitly free to join'],
    explanation: 'Legitimate school announcement in Filipino: official domain, matching link, and nothing asked of you.',
  },
  {
    id: 'email-shopee-shipped-legit', channel: 'email', difficulty: 2, isPhishing: false, language: 'taglish',
    senderName: 'Shopee', senderAddress: 'info@mail.shopee.ph',
    subject: 'Na-ship na ang order mo #2611SHP0457',
    body: 'Hi Detective!\n\nNa-ship na ang order mo (1x USB-C hub). Inaasahang darating ito sa loob ng 2-4 araw.\n\nI-track ang order sa Shopee app o sa {{link:0}}.\n\nPaalala: Hindi kailanman hihingi ang Shopee ng OTP o bayad sa labas ng app.\n\nShopee Philippines',
    links: [{ text: 'shopee.ph/user/purchase', href: 'https://shopee.ph/user/purchase' }],
    redFlags: [],
    safeSigns: ['Sent from a shopee.ph subdomain', 'Matches an order you actually placed', 'Link goes to shopee.ph', 'Warns against sharing OTPs or paying outside the app'],
    explanation: 'Legitimate shipping notice: real domain and a link to your purchases page, with no request for codes or money.',
  },
  {
    id: 'email-netflix-hold-tl', channel: 'email', difficulty: 3, isPhishing: true, language: 'taglish',
    senderName: 'Netflix', senderAddress: 'info@netf1ix-billing.com',
    subject: 'Na-hold ang membership mo: i-update ang payment',
    body: 'Hi,\n\nHindi namin na-process ang huling bayad para sa iyong Netflix Premium plan. Naka-hold muna ang iyong membership.\n\nPara maituloy ang panonood, i-update ang iyong card details sa loob ng 48 oras:\n\n{{link:0}}\n\nKung hindi, permanenteng isasara ang account at mabubura ang iyong viewing history.\n\nAng Netflix Team',
    links: [{ text: 'I-update ang Payment', href: 'https://netf1ix-billing.com/ph/update-card' }],
    redFlags: [
      { target: 'sender', label: 'Homograph domain', detail: '"netf1ix" uses the number 1 instead of the letter l.' },
      { target: 'body', match: 'i-update ang iyong card details sa loob ng 48 oras', label: 'Deadline for card details', detail: 'Pressure plus a request for card details is a classic billing scam.' },
      { target: 'body', match: 'permanenteng isasara ang account', label: 'Threat of loss', detail: 'Threatening to delete your account pushes you to act fast.' },
      { target: 'link', index: 0, label: 'Fake billing link', detail: 'The real URL is on netf1ix-billing.com, not netflix.com.' },
    ],
    explanation: 'Billing phishing with a homograph domain. Open the Netflix app or type netflix.com yourself to check your account.',
  },
];
