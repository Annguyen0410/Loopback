// Self-contained mobile control page (dark, installable). Served by remote-control.ts.
import type { AppLanguage } from '@shared/types'

interface PhoneLabels {
  connecting: string
  noData: string
  today: string
  streak: string
  runCheckIns: string
  undo: string
  markDone: string
  /** Titles for the built-in routine steps (custom steps send their own). */
  steps: Record<string, string>
  clickerTitle: string
  clickerIdle: string
  clickerPicking: string
  clickerRunning: string
  clicks: string
  mouseFree: string
  start: string
  cancel: string
  stop: string
  tasks: string
  noTasks: string
  run: string
  actions: string
  leetcode: string
  check: string
  testAlert: string
  send: string
  msgPlaceholder: string
  notifyPc: string
  recent: string
  noNotifications: string
  errKey: string
  errReach: string
  errHints: string
  noKey: string
  doneAlert: string
  sentToPc: string
  started: string
}

const LABELS: Record<AppLanguage, PhoneLabels> = {
  en: {
    connecting: 'Connecting…',
    noData: 'No data',
    today: 'Today',
    streak: 'day streak',
    runCheckIns: 'Run all check-ins',
    undo: 'Mark as not done',
    markDone: 'Mark as done',
    steps: {
      leetcode: 'LeetCode daily challenge',
      draft: 'Write the solution draft',
      images: 'Add screenshots / images',
      medium: 'Publish on Medium',
      linkedin: 'Post on LinkedIn',
      linkedinGroup: 'Share to LinkedIn groups',
      browserCheckIn: 'Daily claim'
    },
    clickerTitle: 'Auto Clicker',
    clickerIdle: 'Idle',
    clickerPicking: 'Waiting for you to pick a point…',
    clickerRunning: 'Running',
    clicks: 'clicks',
    mouseFree: 'mouse free',
    start: '▶ Start (last settings)',
    cancel: '■ Cancel',
    stop: '■ Stop',
    tasks: 'Tasks',
    noTasks: 'No scheduled tasks',
    run: 'Run',
    actions: 'Actions',
    leetcode: 'LeetCode daily',
    check: 'Check',
    testAlert: 'Test phone alert',
    send: 'Send',
    msgPlaceholder: 'Send a message to the PC…',
    notifyPc: 'Notify PC',
    recent: 'Recent notifications',
    noNotifications: 'No notifications',
    errKey: 'Wrong key — reopen the QR link',
    errReach: 'Cannot reach TaskOrbit',
    errHints: 'Same Wi-Fi as the PC? PC awake? Key in link correct?',
    noKey: 'No access key — open the link from the QR code',
    doneAlert: 'Done — check Discord/Telegram',
    sentToPc: 'Sent to PC',
    started: 'Started'
  },
  vi: {
    connecting: 'Đang kết nối…',
    noData: 'Không có dữ liệu',
    today: 'Hôm nay',
    streak: 'ngày liên tiếp',
    runCheckIns: 'Chạy tất cả điểm danh',
    undo: 'Bỏ đánh dấu',
    markDone: 'Đánh dấu đã xong',
    steps: {
      leetcode: 'Giải bài LeetCode hằng ngày',
      draft: 'Viết bản nháp bài giải',
      images: 'Thêm ảnh chụp màn hình',
      medium: 'Đăng lên Medium',
      linkedin: 'Đăng lên LinkedIn',
      linkedinGroup: 'Chia sẻ vào nhóm LinkedIn',
      browserCheckIn: 'Nhận thưởng hằng ngày'
    },
    clickerTitle: 'Tự động click',
    clickerIdle: 'Đang rảnh',
    clickerPicking: 'Đang chờ bạn chọn một điểm…',
    clickerRunning: 'Đang chạy',
    clicks: 'click',
    mouseFree: 'chuột vẫn rảnh',
    start: '▶ Bắt đầu (theo cài đặt gần nhất)',
    cancel: '■ Huỷ',
    stop: '■ Dừng',
    tasks: 'Tác vụ',
    noTasks: 'Không có tác vụ định kỳ',
    run: 'Chạy',
    actions: 'Thao tác',
    leetcode: 'LeetCode hằng ngày',
    check: 'Kiểm tra',
    testAlert: 'Thử cảnh báo điện thoại',
    send: 'Gửi',
    msgPlaceholder: 'Gửi tin nhắn tới máy tính…',
    notifyPc: 'Báo cho PC',
    recent: 'Thông báo gần đây',
    noNotifications: 'Không có thông báo',
    errKey: 'Sai khoá — hãy mở lại liên kết QR',
    errReach: 'Không kết nối được TaskOrbit',
    errHints: 'Điện thoại có cùng Wi-Fi với máy tính? Máy tính còn thức? Khoá trong liên kết đúng chưa?',
    noKey: 'Thiếu khoá truy cập — hãy mở liên kết từ mã QR',
    doneAlert: 'Xong — kiểm tra Discord/Telegram',
    sentToPc: 'Đã gửi tới máy tính',
    started: 'Đã bắt đầu'
  }
}

export function appHtml(language: AppLanguage = 'en'): string {
  const L = LABELS[language] ?? LABELS.en
  return `<!doctype html><html lang="${language === 'vi' ? 'vi' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f1117">
<link rel="manifest" href="/manifest.webmanifest">
<title>TaskOrbit Control</title>
<style>
:root{--bg:#0f1117;--card:#161a23;--line:#262c3a;--txt:#e2e6ee;--mut:#8b93a7;--acc:#5b8cff;--ok:#46c78c;--warn:#e5a13d;--dng:#e5484d}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--txt);padding:16px 16px 40px;-webkit-tap-highlight-color:transparent}
h1{font-size:18px;margin:4px 0 16px;display:flex;align-items:center;gap:8px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--dng);box-shadow:0 0 8px currentColor}
.dot.on{background:var(--ok)}.dot.off{background:var(--dng)}.dot.ping{background:var(--acc)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:14px}
.row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(38,44,58,.5)}
.row:last-child{border-bottom:none}
.label{flex:1;min-width:0;font-size:14px}
.sub{font-size:12px;color:var(--mut);font-weight:400;display:block;margin-top:2px}
button{font-family:inherit;font-size:14px;font-weight:600;color:#fff;background:var(--acc);border:none;border-radius:10px;padding:11px 16px;cursor:pointer}
button.ghost{background:#1d2230;color:var(--txt);border:1px solid var(--line)}
button.stop{background:var(--dng)}
button:active{transform:scale(.97)}
button:disabled{opacity:.5}
.big{width:100%;padding:16px;font-size:16px;margin-top:4px}
.badge{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:20px;background:#1d2230;color:var(--mut)}
.badge.ok{color:var(--ok)}.badge.warn{color:var(--warn)}
.nlist{max-height:220px;overflow:auto}
.bar{height:6px;border-radius:3px;background:#2a3140;overflow:hidden;margin-top:8px}
.bar i{display:block;height:100%;background:var(--ok);border-radius:3px;transition:width .3s linear}
.n{padding:9px 0;border-bottom:1px solid rgba(38,44,58,.5);font-size:13px}
.n b{display:block;font-size:13.5px}.n span{color:var(--mut);font-size:11.5px}
input{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;color:var(--txt);padding:11px 12px;font-size:14px;font-family:inherit}
.toggle{width:44px;height:26px;border-radius:13px;background:#2a3140;position:relative;flex:0 0 auto;cursor:pointer;transition:background .15s}
.toggle.on{background:var(--acc)}
.toggle::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}
.toggle.on::after{left:21px}
.muted{color:var(--mut);font-size:12px}
#msg{min-height:16px;font-size:12px;color:var(--mut)}
</style></head><body>
<h1><span class="dot off" id="conn"></span> TaskOrbit Control</h1>
<div id="app"><div class="muted">${L.connecting}</div></div>
<div id="msg"></div>
<script>
const L=${JSON.stringify(L)};
const T=decodeURIComponent((location.hash||'').replace(/^#?/,''));
const $=(s)=>document.querySelector(s);
let ST=null;
async function api(path,body){
  const opt=body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}:{method:'GET'};
  const r=await fetch(path+(path.includes('?')?'&':'?')+'t='+encodeURIComponent(T),opt);
  if(r.status===401)throw new Error(L.errKey);
  return r.json();
}
function setMsg(m){$('#msg').textContent=m||'';if(m)setTimeout(()=>{if($('#msg').textContent===m)$('#msg').textContent=''},2500)}
function render(){
  if(!ST){$('#app').innerHTML='<div class="muted">'+esc(L.noData)+'</div>';return}
  const c=ST.clicker;const run=c.phase==='running';const pick=c.phase==='picking';
  const tasks=(ST.tasks||[]).map(t=>
    '<div class="row"><div class="label"><b>'+esc(t.name)+'</b><span class="sub">'+esc(t.cron)+(t.lastStatus?(' · '+t.lastStatus):'')+'</span></div>'+
    '<div class="toggle '+(t.enabled?'on':'')+'" onclick="togTask(\\''+t.id+'\\','+(!t.enabled)+')"></div>'+
    '<button class="ghost" onclick="runTask(\\''+t.id+'\\')">'+esc(L.run)+'</button></div>'
  ).join('');
  const notes=(ST.notifications||[]).slice(0,8).map(n=>'<div class="n"><b>'+esc(n.title)+'</b><span>'+esc(n.body)+' · '+new Date(n.createdAt).toLocaleTimeString()+'</span></div>').join('')||'<div class="muted">'+esc(L.noNotifications)+'</div>';
  const routine=ST.routine;
  let routineCard='';
  if(routine){
    const rows=(routine.steps||[]).map(s=>{
      const label=s.kind==='custom'?s.title:(L.steps[s.kind]||s.title);
      return '<div class="row"><div class="label"'+(s.done?' style="opacity:.5;text-decoration:line-through"':'')+'>'+esc(label)+'</div>'+
        '<button class="ghost" title="'+(s.done?esc(L.undo):esc(L.markDone))+'" onclick="tick(\\''+s.id+'\\','+(s.done?'false':'true')+')">'+(s.done?'↺':'✓')+'</button></div>';
    }).join('');
    const pct=routine.total?Math.round(routine.done/routine.total*100):0;
    routineCard='<div class="card"><b>'+esc(L.today)+' · '+routine.done+'/'+routine.total+(routine.streak?' · 🔥 '+routine.streak+' '+esc(L.streak):'')+'</b>'+
      '<div class="bar"><i style="width:'+pct+'%"></i></div>'+
      '<div style="margin-top:6px">'+rows+'</div>'+
      (routine.checkInCount>0?'<button class="big" onclick="runCheckIns()">⚡ '+esc(L.runCheckIns)+'</button>':'')+'</div>';
  }
  const clickerState=run
    ? esc(L.clickerRunning)+' · '+c.clicks+' '+esc(L.clicks)+(c.config&&c.config.method==='virtual'?(' · '+esc(L.mouseFree)):'')
    : pick ? esc(L.clickerPicking) : esc(L.clickerIdle);
  $('#app').innerHTML=routineCard+
    '<div class="card"><div class="row"><div class="label"><b>'+esc(L.clickerTitle)+'</b><span class="sub">'+clickerState+'</span></div><span class="badge '+(run?'ok':'warn')+'">'+c.phase+'</span></div>'+
    (run?'<button class="big stop" onclick="clk(\\'stop\\')">'+esc(L.stop)+'</button>':'<button class="big" onclick="clk(\\''+(pick?'stop':'start')+'\\')">'+(pick?esc(L.cancel):esc(L.start))+'</button>')+'</div>'+
    '<div class="card"><b>'+esc(L.tasks)+'</b><div style="margin-top:6px">'+(tasks||'<div class="muted">'+esc(L.noTasks)+'</div>')+'</div></div>'+
    '<div class="card"><b>'+esc(L.actions)+'</b><div class="row"><div class="label">'+esc(L.leetcode)+'</div><button class="ghost" onclick="act(\\'leetcode\\')">'+esc(L.check)+'</button></div>'+
    '<div class="row"><div class="label">'+esc(L.testAlert)+'</div><button class="ghost" onclick="act(\\'alert\\')">'+esc(L.send)+'</button></div>'+
    '<div class="row" style="flex-direction:column;align-items:stretch;gap:8px"><input id="ntxt" placeholder="'+esc(L.msgPlaceholder)+'"><button onclick="notify()">'+esc(L.notifyPc)+'</button></div></div>'+
    '<div class="card"><b>'+esc(L.recent)+'</b><div class="nlist" style="margin-top:6px">'+notes+'</div></div>';
}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
async function refresh(){try{const s=await api('/api/state');ST=s;$('#conn').className='dot on';render()}catch(e){$('#conn').className='dot off';$('#app').innerHTML='<div class="card"><b>'+esc(L.errReach)+'</b><div class="muted">'+esc(e.message)+'</div><div class="muted">'+esc(L.errHints)+'</div></div>'}}
window.clk=async(m)=>{try{await api('/api/clicker/'+m);setMsg('clicker '+m);await refresh()}catch(e){setMsg(e.message)}}
window.runTask=async(id)=>{try{const r=await api('/api/task/run',{id});setMsg(r.ok?L.started+' '+id:r.error);await refresh()}catch(e){setMsg(e.message)}}
window.togTask=async(id,en)=>{try{await api('/api/task/toggle',{id,enabled:en});await refresh()}catch(e){setMsg(e.message)}}
window.act=async(a)=>{try{if(a==='leetcode')await api('/api/leetcode');else await api('/api/alert');setMsg(L.doneAlert)}catch(e){setMsg(e.message)}}
window.notify=async()=>{const v=$('#ntxt').value.trim();if(!v)return;try{await api('/api/notify',{title:'Phone',body:v});$('#ntxt').value='';setMsg(L.sentToPc)}catch(e){setMsg(e.message)}}
window.tick=async(id,done)=>{try{await api('/api/routine/step',{stepId:id,done});await refresh()}catch(e){setMsg(e.message)}}
window.runCheckIns=async()=>{try{const r=await api('/api/routine/checkins');setMsg(r.ok?'Started — watch the notifications':r.error);await refresh()}catch(e){setMsg(e.message)}}
if(!T)setMsg(L.noKey);
refresh();setInterval(refresh,4000);
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
</script></body></html>`
}

export function manifest(): string {
  return JSON.stringify({
    name: 'TaskOrbit Control',
    short_name: 'TaskOrbit',
    start_url: '.',
    display: 'standalone',
    background_color: '#0f1117',
    theme_color: '#0f1117',
    icons: [
      { src: '/icon.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
      { src: '/icon.png', sizes: '192x192', type: 'image/png' }
    ]
  })
}

/** Minimal SW so Chrome offers "Add to Home Screen". */
export function serviceWorker(): string {
  return `self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>self.clients.claim());
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>r).catch(()=>caches.match('/')))})`
}
