# Headless browser check + screenshots (Playwright for Python, Chrome channel).
# Usage: python3 scripts/screenshots.py [base_url]
import sys, random, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
OUT = 'screenshots/'
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    def ctx(w, h, mobile=False):
        c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
        pg = c.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        return c, pg
    c, pg = ctx(1366, 900)
    pg.goto(BASE + '/', wait_until='networkidle'); pg.wait_for_timeout(600)
    pg.screenshot(path=OUT + '01-home.png', full_page=True)
    pg.fill('#nick', f'AN_detective{random.randint(10,99)}'); pg.click('text=Start investigating')
    pg.wait_for_selector('text=Begin assessment'); pg.screenshot(path=OUT + '02-pre-quiz-intro.png')
    pg.click('text=Begin assessment')
    pg.wait_for_selector('.quiz-msg'); pg.screenshot(path=OUT + '03-pre-quiz-item.png')
    for i in range(10):
        pg.click('button:has-text("Phishing")' if i % 3 else 'button:has-text("Legit")'); pg.wait_for_timeout(120)
    pg.wait_for_selector('.big-score'); pg.click('text=Go to case board')
    pg.wait_for_selector('.levels'); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '04-case-board.png', full_page=True)
    pg.click('text=Start Level 1'); pg.wait_for_selector('.msg')
    shot_round = shot_fb = False
    for i in range(8):
        if i: pg.click('.feedback .btn-gold'); pg.wait_for_selector('.choice-row.sticky'); pg.wait_for_timeout(300)
        is_candidate = pg.locator('.msg .msg-link').count() > 0 and not shot_fb
        if is_candidate:
            pg.locator('.msg [data-part="sender"]').click()
            pg.locator('.msg .msg-link').first.click()
            pg.locator('.msg .msg-link').first.hover(); pg.wait_for_timeout(1200)
            if not shot_round:
                pg.screenshot(path=OUT + '05-game-round.png', full_page=True); shot_round = True
        pg.click('button:has-text("Phishing")' if (is_candidate or i % 2 == 0) else 'button:has-text("Legit")')
        pg.wait_for_selector('.feedback'); pg.wait_for_timeout(300)
        if is_candidate and pg.locator('.flag-list').count():
            pg.mouse.move(5, 5); pg.screenshot(path=OUT + '06-feedback.png', full_page=True); shot_fb = True
    if not shot_fb: pg.screenshot(path=OUT + '06-feedback.png', full_page=True)
    pg.click('.feedback .btn-gold'); pg.wait_for_selector('.summary'); pg.wait_for_timeout(400)
    pg.screenshot(path=OUT + '07-round-summary.png', full_page=True)
    # admin
    pg.goto(BASE + '/admin'); pg.fill('#un', os.environ.get('ADMIN_USER', 'superadmin')); pg.fill('#pw', open(os.environ['ADMIN_PASS_FILE']).read().strip()); pg.click('button:has-text("Sign in")')
    pg.wait_for_selector('.kpis'); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '08-admin-dashboard.png', full_page=True)
    pg.click('text=Miss rates'); pg.wait_for_timeout(300); pg.screenshot(path=OUT + '09-admin-miss-rates.png')
    pg.click('text=Scenario bank'); pg.wait_for_timeout(300); pg.locator('button:has-text("Edit")').first.click(); pg.wait_for_timeout(400)
    pg.screenshot(path=OUT + '10-admin-scenario-editor.png', full_page=True)
    c.close()
    # mobile
    c, pg = ctx(390, 844, True)
    pg.goto(BASE + '/', wait_until='networkidle'); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '11-mobile-home.png')
    pg.fill('#nick', f'mobile_tester{random.randint(10,99)}'); pg.click('text=Start investigating')
    pg.click('text=Begin assessment')
    for i in range(10):
        pg.click('button:has-text("Phishing")'); pg.wait_for_timeout(80)
    pg.click('text=Go to case board'); pg.click('text=Start Level 1'); pg.wait_for_selector('.msg'); pg.wait_for_timeout(800)
    pg.screenshot(path=OUT + '12-mobile-game.png')
    print('mobile overflow:', pg.evaluate('document.documentElement.scrollWidth'), 'vs 390')
    c.close(); b.close()
print('errors:', errs or 'none')
