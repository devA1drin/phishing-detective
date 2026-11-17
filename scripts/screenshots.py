# Headless browser check + screenshots (Playwright for Python, Chrome channel).
# Usage: ADMIN_PASS_FILE=… EDU_USER=… EDU_PASS_FILE=… SECTION_CODE=… python3 scripts/screenshots.py [base_url]
# Uses the real API to prepare players (register, pre-quiz, rounds) and the UI for every screenshot.
import sys, os, json, random, string, subprocess, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
OUT = 'screenshots/'
os.makedirs(OUT, exist_ok=True)
SU_PASS = open(os.environ['ADMIN_PASS_FILE']).read().strip()
EDU_USER = os.environ.get('EDU_USER')
EDU_PASS = open(os.environ['EDU_PASS_FILE']).read().strip() if os.environ.get('EDU_PASS_FILE') else None
CODE = os.environ.get('SECTION_CODE')
sys.path.insert(0, 'scripts')
errs = []

def call(method, path, body=None, tok=None, raw=False):
    req = urllib.request.Request(BASE + '/api' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    try:
        r = urllib.request.urlopen(req).read()
        return r if raw else json.loads(r or b'null')
    except urllib.error.HTTPError as e:
        return {'_status': e.code, **json.loads(e.read() or b'{}')}

TRUTH = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', """
const { scenarios } = await import('./server/src/data/scenarios.js');
const { quizPools } = await import('./server/src/data/quiz.js');
console.log(JSON.stringify({ s: Object.fromEntries(scenarios.map((x) => [x.id, x.isPhishing])), q: Object.fromEntries(Object.values(quizPools).flat().map((x) => [x.id, x.isPhishing])) }));
"""]))
su = call('POST', '/admin/login', {'username': os.environ.get('ADMIN_USER', 'superadmin'), 'password': SU_PASS})['token']

def player(prefix, pre=True, rounds=0, accuracy=0.7):
    nick = prefix + ''.join(random.choices(string.digits, k=2))
    reg = call('POST', '/players/register', {'nickname': nick, 'pin': '2468', 'consent': True})
    tok = reg['token']
    call('PUT', f"/admin/players/{reg['player']['id']}/group", {'group': 'experimental'}, su)
    if CODE: call('POST', '/players/me/section', {'code': CODE}, tok)
    if pre:
        items = call('GET', '/quiz/pre')['items']
        call('POST', '/quiz/pre/submit', {'answers': [{'itemId': i['id'], 'choice': 'phishing' if (TRUTH['q'][i['id']] == (n < 6)) else 'legit', 'confidence': 3} for n, i in enumerate(items)]}, tok)
    for _ in range(rounds):
        s = call('POST', '/sessions', {'level': 1}, tok)
        for sc in s['scenarios']:
            right = random.random() < accuracy
            isp = TRUTH['s'].get(sc['id'], True)
            call('POST', f"/sessions/{s['sessionId']}/answers", {'scenarioId': sc['id'], 'choice': 'phishing' if isp == right else 'legit', 'timeMs': 6000}, tok)
        call('POST', f"/sessions/{s['sessionId']}/finish", None, tok)
    return {**reg['player'], 'token': tok}

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    def ctx(w, h, mobile=False):
        c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
        pg = c.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errs.append(m.text))
        return c, pg
    def as_player(pg, pl):
        pg.goto(BASE + '/'); pg.evaluate("v => localStorage.setItem('pd.player', v)", json.dumps(pl))

    c, pg = ctx(1366, 900)
    # 1. home (consent + PIN registration)
    pg.goto(BASE + '/', wait_until='networkidle'); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '01-home.png', full_page=True)
    # 2. pre-quiz with confidence rating
    fresh = player('AN_rookie', pre=False)
    as_player(pg, fresh); pg.goto(BASE + '/quiz/pre'); pg.click('text=Begin assessment')
    pg.wait_for_selector('.quiz-msg'); pg.click('button:has-text("Phishing")'); pg.wait_for_selector('.confidence'); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '02-pre-quiz-confidence.png')
    # 3. case board with daily challenge, badges, class board, weak spots
    me = player('AN_detective', rounds=2, accuracy=0.6)
    as_player(pg, me); pg.goto(BASE + '/hub'); pg.wait_for_selector('.levels'); pg.wait_for_timeout(1200)
    pg.screenshot(path=OUT + '03-case-board.png', full_page=True)
    # 4-7. classic round: clue + link hover, link trap, feedback with coach, summary
    pg.goto(BASE + '/play/1'); pg.wait_for_selector('.msg')
    shot_round = shot_trap = shot_fb = False
    for i in range(8):
        if i:
            pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
        pg.wait_for_selector('.choice-row'); pg.wait_for_timeout(300)
        has_link = pg.locator('.msg .msg-link').count() > 0
        if has_link and not shot_round:
            pg.locator('.msg [data-part="sender"]').click()
            pg.locator('.msg .msg-link').first.hover(); pg.wait_for_timeout(900)
            pg.screenshot(path=OUT + '04-game-round.png', full_page=True); shot_round = True
            pg.mouse.move(5, 5)
        elif has_link and shot_round and not shot_trap:
            pg.locator('.msg .msg-link').first.click(); pg.wait_for_timeout(300)
            if pg.locator('text=Open link').count() or pg.locator('text=Open scanned link').count():
                pg.locator('button:has-text("Open")').first.click(); pg.wait_for_timeout(700)
                pg.screenshot(path=OUT + '05-link-trap.png'); shot_trap = True
                close = pg.locator('.trap button').first
                if close.count(): close.click(); pg.wait_for_timeout(300)
        if pg.locator('.feedback').count() == 0:
            pg.click('button.btn-red.big'); pg.wait_for_selector('.feedback')
        if not shot_fb and pg.locator('.flag-list').count():
            pg.wait_for_selector('.coach p:not(.muted)', timeout=8000); pg.wait_for_timeout(300)
            pg.screenshot(path=OUT + '06-feedback-coach.png', full_page=True); shot_fb = True
    pg.keyboard.press('Enter'); pg.wait_for_selector('.summary'); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '07-round-summary-badges.png', full_page=True)
    # 8. inbox mode
    pg.goto(BASE + '/inbox/1'); pg.wait_for_selector('.inbox-list'); pg.wait_for_timeout(800)
    pg.screenshot(path=OUT + '08-inbox-mode.png')
    # 9. daily challenge summary
    pg.goto(BASE + '/daily'); pg.wait_for_selector('.msg')
    for i in range(5):
        pg.click('button.btn-red.big'); pg.wait_for_selector('.feedback'); pg.wait_for_timeout(300); pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
    pg.wait_for_selector('.summary'); pg.wait_for_timeout(400)
    pg.screenshot(path=OUT + '09-daily-challenge.png', full_page=True)
    # 10-11. certificate + verify page + PDF render
    items = call('GET', '/quiz/post', tok=me['token'])['items']
    call('POST', '/quiz/post/submit', {'answers': [{'itemId': i['id'], 'choice': 'phishing' if (TRUTH['q'][i['id']] == (n < 8)) else 'legit', 'confidence': 4} for n, i in enumerate(items)]}, me['token'])
    cert = call('POST', '/certificates/me', None, me['token'])['certificate']
    pg.goto(BASE + '/verify/' + cert['code']); pg.wait_for_selector('.verify-ok'); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '10-certificate-verify.png')
    open('/tmp/pd-cert.pdf', 'wb').write(call('GET', f"/certificates/{cert['code']}/pdf", raw=True))
    subprocess.run(['pdftoppm', '-png', '-r', '110', '-singlefile', '/tmp/pd-cert.pdf', OUT + '11-certificate-pdf'], check=True)
    c.close()

    # 12-16. educator dashboard (scoped to their sections)
    c, pg = ctx(1366, 900)
    pg.goto(BASE + '/admin'); pg.fill('#un', EDU_USER or 'superadmin'); pg.fill('#pw', EDU_PASS or SU_PASS); pg.click('button:has-text("Sign in")')
    pg.wait_for_selector('.kpis'); pg.wait_for_timeout(700)
    pg.screenshot(path=OUT + '12-admin-overview.png', full_page=True)
    pg.get_by_role('tab', name='🏫 Classes').click(); pg.wait_for_timeout(500)
    pg.get_by_role('button', name='Report').first.click(); pg.wait_for_selector('text=Class weak spots'); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '13-admin-class-report.png', full_page=True)
    pg.locator('.report-grid button:has-text("Report")').first.click(); pg.wait_for_selector('.modal .stat-row'); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '14-admin-student-report.png')
    pg.get_by_role('button', name='✕ Close').first.click()
    with pg.expect_download() as d:
        pg.get_by_role('button', name='📄 Chapter 4 PDF', exact=True).click()
    d.value.save_as('/tmp/pd-chapter4.pdf')
    subprocess.run(['pdftoppm', '-png', '-r', '80', '-f', '1', '-l', '2', '/tmp/pd-chapter4.pdf', OUT + '15-chapter4-pdf'], check=True)
    pg.get_by_role('tab', name='🎯 Miss rates').click(); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '16-admin-miss-rates.png')
    c.close()
    # 17-18. superadmin: AI drafts review and the vishing call editor preview
    c, pg = ctx(1366, 900)
    pg.goto(BASE + '/admin'); pg.fill('#un', 'superadmin'); pg.fill('#pw', SU_PASS); pg.click('button:has-text("Sign in")')
    pg.wait_for_selector('.kpis'); pg.wait_for_timeout(500)
    pg.locator('[role=tab]:has-text("AI drafts")').click(); pg.wait_for_timeout(1200)
    pg.screenshot(path=OUT + '17-admin-ai-drafts.png', full_page=True)
    pg.get_by_role('tab', name='🗂 Scenario bank').click(); pg.wait_for_timeout(300)
    pg.fill('input[placeholder="Search…"]', 'call'); pg.wait_for_timeout(300)
    pg.locator('button:has-text("Edit")').first.click(); pg.wait_for_timeout(600)
    pg.screenshot(path=OUT + '18-admin-call-editor.png', full_page=True)
    c.close()
    # 19-20. mobile
    c, pg = ctx(390, 844, True)
    pg.goto(BASE + '/', wait_until='networkidle'); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '19-mobile-home.png')
    mob = player('mobile_tester')
    as_player(pg, mob); pg.goto(BASE + '/play/1'); pg.wait_for_selector('.msg'); pg.wait_for_timeout(800)
    pg.screenshot(path=OUT + '20-mobile-game.png')
    print('mobile overflow:', pg.evaluate('document.documentElement.scrollWidth'), 'vs 390')
    c.close(); b.close()
print('errors:', errs or 'none')
