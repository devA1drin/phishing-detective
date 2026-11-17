#!/usr/bin/env bash
# End-to-end API smoke test with curl + jq-free parsing (needs node).
# Usage: bash scripts/api-smoke.sh [base_url] [admin_password]
set -euo pipefail
BASE=${1:-http://localhost:3000}
PW=${2:-detective2026}
js() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(eval(process.argv[1]))})" "$1"; }
NICK="curl_$RANDOM"

echo "== health";            curl -sf $BASE/api/health; echo
echo "== random scenarios";  curl -sf "$BASE/api/scenarios/random?level=2&count=3" | js "j.map(s=>s.id+' ['+s.channel+', d'+s.difficulty+', '+s.segments.length+' segments]').join('\n')"
echo "== register $NICK";    PID=$(curl -sf -X POST $BASE/api/players -H 'Content-Type: application/json' -d "{\"nickname\":\"$NICK\"}" | js "j.id"); echo "playerId=$PID"
echo "== pre-quiz";          ITEMS=$(curl -sf $BASE/api/quiz/pre | js "JSON.stringify(j.items.map((x,i)=>({itemId:x.id,choice:i%3?'phishing':'legit'})))")
curl -sf -X POST $BASE/api/quiz/pre/submit -H 'Content-Type: application/json' -d "{\"playerId\":$PID,\"answers\":$ITEMS}"; echo
echo "== start level 1";     SESSION=$(curl -sf -X POST $BASE/api/sessions -H 'Content-Type: application/json' -d "{\"playerId\":$PID,\"level\":1}")
SID=$(echo "$SESSION" | js "j.sessionId"); echo "sessionId=$SID"
for SCID in $(echo "$SESSION" | js "j.scenarios.map(s=>s.id).join(' ')"); do
  curl -sf -X POST $BASE/api/sessions/$SID/answers -H 'Content-Type: application/json' \
    -d "{\"scenarioId\":\"$SCID\",\"choice\":\"phishing\",\"timeMs\":8000,\"clickedParts\":[\"sender\",\"link:0\"]}" \
    | js "'  $SCID -> '+(j.isCorrect?'correct':'wrong')+' +'+j.points+' pts, flags '+j.flagsFound+'/'+j.totalFlags+', streak '+j.streak"
done
echo "== finish";            curl -sf -X POST $BASE/api/sessions/$SID/finish | js "'score '+j.score+', accuracy '+j.accuracy+'%, unlocked level '+j.unlockedLevel"
echo "== post-quiz";         ITEMS=$(curl -sf $BASE/api/quiz/post | js "JSON.stringify(j.items.map(x=>({itemId:x.id,choice:'phishing'})))")
curl -sf -X POST $BASE/api/quiz/post/submit -H 'Content-Type: application/json' -d "{\"playerId\":$PID,\"answers\":$ITEMS}" | js "'post '+j.percent+'% (pre '+j.prePercent+'%), change '+j.improvementPoints+' pts'"
echo "== progress";          curl -sf $BASE/api/players/$PID/progress | js "JSON.stringify({rank:j.rank,totalScore:j.totalScore,unlockedLevel:j.unlockedLevel,pre:j.preQuiz,post:j.postQuiz})"
echo "== leaderboard";       curl -sf $BASE/api/leaderboard | js "j.slice(0,3).map(r=>r.nickname+' '+r.total_score).join(', ')"
echo "== admin login";       TOKEN=$(curl -sf -X POST $BASE/api/admin/login -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" | js "j.token")
echo "== admin stats";       curl -sf $BASE/api/admin/stats -H "Authorization: Bearer $TOKEN" | js "JSON.stringify({players:j.players,sessions:j.sessions,accuracy:j.accuracy,quiz:j.quiz})"
echo "== top missed";        curl -sf $BASE/api/admin/scenario-stats -H "Authorization: Bearer $TOKEN" | js "j.slice(0,3).map(r=>r.id+' '+r.miss_rate+'%').join(', ')"
echo "== CSV export (players, first 3 lines)"; curl -sf "$BASE/api/admin/export/players.csv" -H "Authorization: Bearer $TOKEN" | head -3
echo "== unauthorized check"; curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/admin/stats
echo "ALL OK"
