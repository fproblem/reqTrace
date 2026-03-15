import { useState, useEffect } from "react";

const USER = {
  id: "EMP003",
  name: "Дмитрий Козлов",
  dept: "Backend",
  position: "Senior Developer",
  email: "d.kozlov@surf.dev",
  phone: "+7 (999) 123-45-67",
  avatar: "ДК",
  startDate: "15 марта 2022",
  jiraUsername: "d.kozlov",
};

const HISTORY = (() => {
  const days = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const inH = 8 + Math.floor(Math.random() * 2);
    const inM = Math.floor(Math.random() * 55);
    const outH = inH + 8 + Math.floor(Math.random() * 2);
    const outM = Math.floor(Math.random() * 55);
    const checkIn = new Date(d); checkIn.setHours(inH, inM, 0);
    const checkOut = i === 0 && Math.random() > 0.4 ? null : (() => { const o = new Date(d); o.setHours(outH, outM, 0); return o; })();
    const totalMin = checkOut ? Math.round((checkOut - checkIn) / 60000) : null;
    days.push({ date: new Date(d), checkIn, checkOut, totalMin, isToday: i === 0 });
  }
  return days;
})();

const fmt = (d) => d ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDay = (d) => d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
const fmtH = (min) => min ? `${Math.floor(min / 60)}ч ${min % 60}м` : "—";

// surf.ru palette: soft pink-lilac bg, vivid green, yellow accent, black text
const C = {
  pink: "#E8C8F0",       // soft lilac-pink blob
  green: "#7AE05A",      // vivid surf green
  greenDark: "#4DB830",
  yellow: "#D4F060",     // surf yellow-green accent
  black: "#1A1A1A",
  text: "#1A1A1A",
  textSub: "#6B7280",
  textMuted: "#9CA3AF",
  bg: "#FFFFFF",
  card: "rgba(255,255,255,0.75)",
  border: "rgba(0,0,0,0.07)",
};

// Blobs matching surf.ru: pink-lilac top-left, vivid green bottom-right, yellow accent
const Blobs = () => (
  <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
    <div style={{ position: "absolute", top: "-15%", left: "-10%", width: "65vw", height: "65vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(232,180,240,0.45) 0%, rgba(220,160,230,0.2) 40%, transparent 70%)", filter: "blur(70px)" }} />
    <div style={{ position: "absolute", top: "5%", left: "20%", width: "30vw", height: "30vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(240,200,255,0.2) 0%, transparent 70%)", filter: "blur(40px)" }} />
    <div style={{ position: "absolute", bottom: "-10%", right: "-10%", width: "60vw", height: "60vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(100,220,60,0.4) 0%, rgba(140,240,80,0.15) 40%, transparent 70%)", filter: "blur(60px)" }} />
    <div style={{ position: "absolute", bottom: "20%", right: "5%", width: "25vw", height: "25vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(210,240,80,0.25) 0%, transparent 70%)", filter: "blur(40px)" }} />
  </div>
);

const QR_SIZE = 200;
const QRCode = ({ value, size }) => {
  const modules = 25, cellSize = size / modules, cells = [];
  let seed = 0;
  for (let i = 0; i < value.length; i++) seed = ((seed << 5) - seed + value.charCodeAt(i)) | 0;
  const rng = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed & 1) === 0; };
  const drawFinder = (ox, oy) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      if ((y === 0 || y === 6 || x === 0 || x === 6) || (y >= 2 && y <= 4 && x >= 2 && x <= 4))
        cells.push({ x: ox + x, y: oy + y });
    }
  };
  drawFinder(0, 0); drawFinder(modules - 7, 0); drawFinder(0, modules - 7);
  for (let y = 0; y < modules; y++) for (let x = 0; x < modules; x++) {
    const inF = (x < 8 && y < 8) || (x >= modules - 8 && y < 8) || (x < 8 && y >= modules - 8);
    if (!inF && rng()) cells.push({ x, y });
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} fill="white" rx="16" />
      {cells.map((c, i) => <rect key={i} x={c.x * cellSize + 1} y={c.y * cellSize + 1} width={cellSize - 0.5} height={cellSize - 0.5} rx={1.2} fill="#1A1A1A" />)}
    </svg>
  );
};

const SurfWordmark = ({ color = "#1A1A1A" }) => (
  <svg width="56" height="16" viewBox="0 0 91 26" fill="none">
    <path d="M15.0951 25C13.339 25 11.6965 24.6269 10.1676 23.8808C8.65942 23.114 7.43012 22.0363 6.47974 20.6477C5.55002 19.2383 5.0645 17.6321 5.02318 15.829H11.0974C11.18 16.5751 11.4176 17.2383 11.8101 17.8187C12.2233 18.3782 12.7502 18.8238 13.3907 19.1554C14.0311 19.4663 14.7439 19.6218 15.529 19.6218C16.0042 19.6218 16.4484 19.5389 16.8616 19.3731C17.2955 19.2073 17.6467 18.9793 17.9153 18.6891C18.1839 18.399 18.3182 18.0777 18.3182 17.7254C18.3182 17.1658 18.1322 16.7306 17.7603 16.4197C17.3885 16.0881 16.9133 15.8497 16.3348 15.7047C15.7563 15.5596 14.9505 15.4041 13.9175 15.2383C12.244 14.9689 10.8701 14.6477 9.79574 14.2746C8.74206 13.9016 7.82267 13.228 7.03757 12.2539C6.27314 11.2798 5.89092 9.88083 5.89092 8.05699C5.89092 6.70984 6.28347 5.49741 7.06856 4.41969C7.85366 3.34197 8.93833 2.50259 10.3226 1.90156C11.7275 1.30052 13.2977 1 15.0332 1C16.748 1 18.3182 1.36269 19.7437 2.08808C21.1693 2.79275 22.3263 3.75648 23.2147 4.97927C24.1238 6.18135 24.6506 7.50777 24.7952 8.95855H18.5041C18.4008 8.44041 18.1632 7.97409 17.7913 7.55959C17.4401 7.14508 16.9649 6.81347 16.3658 6.56477C15.7873 6.31606 15.1365 6.19171 14.4134 6.19171C13.6696 6.19171 13.0601 6.33679 12.5849 6.62694C12.1304 6.89637 11.9031 7.25907 11.9031 7.71503C11.9031 8.12953 12.0684 8.46114 12.399 8.70985C12.7295 8.95855 13.1531 9.14508 13.6696 9.26943C14.1861 9.39378 14.8989 9.51814 15.8079 9.64249C17.5227 9.91192 18.9483 10.2435 20.0846 10.6373C21.221 11.0104 22.2127 11.7254 23.0597 12.7824C23.9068 13.8187 24.3304 15.3212 24.3304 17.2902C24.3304 18.8031 23.9378 20.1503 23.1527 21.3316C22.3883 22.4922 21.3036 23.3938 19.8987 24.0363C18.5145 24.6788 16.9133 25 15.0951 25Z" fill={color}/>
    <path d="M34.3358 24.6269C32.7242 24.6269 31.2987 24.2642 30.059 23.5389C28.8401 22.7927 27.8897 21.7565 27.2079 20.4301C26.5261 19.1036 26.1852 17.5803 26.1852 15.8601V1.37306H32.0734V15.8601C32.0734 16.5648 32.2181 17.1865 32.5073 17.7254C32.8172 18.2642 33.2408 18.6788 33.7779 18.9689C34.3151 19.2591 34.9142 19.4041 35.5754 19.4041H36.0712C37.1043 19.4041 37.9513 19.0829 38.6125 18.4404C39.2736 17.7979 39.6042 16.9378 39.6042 15.8601V1.37306H45.4924V15.8601C45.4924 17.5803 45.1515 19.1036 44.4697 20.4301C43.7879 21.7565 42.8272 22.7927 41.5876 23.5389C40.3479 24.2642 38.9224 24.6269 37.3109 24.6269H34.3358Z" fill={color}/>
    <path d="M62.8285 12.8135C63.593 13.1658 64.2438 13.601 64.7809 14.1192C65.3181 14.6373 65.7313 15.2176 66.0206 15.8601C66.3098 16.4819 66.4544 17.1554 66.4544 17.8808V24.6269H60.5662V19.4041C60.5662 18.513 60.2976 17.7668 59.7605 17.1658C59.2233 16.544 58.5312 16.2332 57.6841 16.2332H54.0272V24.6269H48.139V1.37306H57.5601C59.3782 1.37306 60.9484 1.67358 62.2707 2.27461C63.6136 2.87565 64.6467 3.73575 65.3698 4.85492C66.0929 5.97409 66.4544 7.29016 66.4544 8.80311C66.4544 9.6943 66.3201 10.5233 66.0516 11.2902C65.783 12.057 65.4008 12.7409 64.9049 13.342C64.4091 13.943 63.8099 14.4508 63.1074 14.8653L62.8285 12.8135ZM57.3742 11.0104C58.0146 11.0104 58.5621 10.9275 59.0167 10.7617C59.4712 10.5959 59.8121 10.3472 60.0394 10.0155C60.2873 9.68394 60.4113 9.27979 60.4113 8.80311C60.4113 8.09845 60.1427 7.55959 59.6055 7.18653C59.089 6.79275 58.3452 6.59585 57.3742 6.59585H54.0272V11.0104H57.3742Z" fill={color}/>
    <path d="M85.0232 6.59585H74.8272V10.2021H84.4034V15.4249H74.8272V24.6269H68.939V1.37306H85.0232V6.59585Z" fill={color}/>
  </svg>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [loginState, setLoginState] = useState("idle");
  const [tab, setTab] = useState("qr");
  const [clock, setClock] = useState(new Date());
  const [checkedIn, setCheckedIn] = useState(HISTORY[0]?.checkIn ? true : false);
  const [checkInTime, setCheckInTime] = useState(HISTORY[0]?.checkIn || null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [statsRange, setStatsRange] = useState("week");

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleLogin = () => {
    setLoginState("loading");
    setTimeout(() => { setLoginState("idle"); setAuthed(true); }, 2000);
  };

  const handleToggle = () => {
    if (!checkedIn) { setCheckedIn(true); setCheckInTime(new Date()); }
    else setCheckedIn(false);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2500);
  };

  const elapsed = checkedIn && checkInTime ? Math.round((clock - checkInTime) / 60000) : 0;

  // ─── LOGIN ───
  if (!authed) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#fff", padding: "40px 24px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", position: "relative", overflow: "hidden" }}>
      <Blobs />
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ marginBottom: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <SurfWordmark color="#1A1A1A" />
          <div style={{ width: 28, height: 2.5, background: C.green, borderRadius: 100 }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: 0.3 }}>Surf Пропуск</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Пропускная система офиса</div>
        </div>

        <div style={{ width: "100%", background: "rgba(255,255,255,0.8)", borderRadius: 24, padding: "28px 24px", border: "1px solid rgba(0,0,0,0.07)", backdropFilter: "blur(20px)", boxShadow: "0 4px 40px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4, textAlign: "center" }}>Вход в систему</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 24, textAlign: "center" }}>Используйте рабочий аккаунт Jira</div>

          <button onClick={handleLogin} disabled={loginState === "loading"} style={{ width: "100%", padding: "13px 20px", borderRadius: 14, border: "1px solid #DADCE0", background: "white", color: "#3C4043", fontSize: 15, fontWeight: 500, cursor: loginState === "loading" ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "all 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", opacity: loginState === "loading" ? 0.7 : 1 }}>
            {loginState === "loading" ? (
              <>
                <div style={{ width: 18, height: 18, border: "2px solid #DADCE0", borderTopColor: "#4285F4", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                Подключение...
              </>
            ) : (<><GoogleIcon /> Войти через Google</>)}
          </button>

          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: "rgba(122,224,90,0.1)", border: "1px solid rgba(122,224,90,0.25)" }}>
            <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.6 }}>
              Вы будете перенаправлены в <span style={{ color: C.greenDark, fontWeight: 600 }}>Google</span> для авторизации аккаунтом <span style={{ color: C.greenDark, fontWeight: 600 }}>@surf.dev</span>.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 28, fontSize: 11, color: C.textMuted, textAlign: "center", lineHeight: 1.8 }}>
          Surf · Пропускная система v1.0<br />
          <span style={{ color: "#CBD5E1" }}>Проблемы? Обратитесь в IT-поддержку</span>
        </div>
      </div>
    </div>
  );

  // ─── TAB BAR ───
  const tabs = [
    { key: "qr", label: "QR-код", icon: (a) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? C.black : C.textMuted} strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3" rx="0.5" fill={a ? C.black : C.textMuted} stroke="none"/><rect x="19" y="14" width="2" height="2" rx="0.5" fill={a ? C.black : C.textMuted} stroke="none"/><rect x="14" y="19" width="2" height="2" rx="0.5" fill={a ? C.black : C.textMuted} stroke="none"/></svg> },
    { key: "history", label: "История", icon: (a) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? C.black : C.textMuted} strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg> },

    { key: "profile", label: "Профиль", icon: (a) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? C.black : C.textMuted} strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> },
  ];

  const TabBar = () => (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(255,255,255,0.88)", borderTop: "1px solid rgba(0,0,0,0.07)", display: "flex", justifyContent: "space-around", padding: "8px 0 14px", zIndex: 50, backdropFilter: "blur(20px)" }}>
      {tabs.map(t => {
        const a = tab === t.key;
        return (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer", padding: "4px 18px" }}>
            {t.icon(a)}
            <span style={{ fontSize: 10, fontWeight: a ? 700 : 400, color: a ? C.black : C.textMuted, letterSpacing: 0.1 }}>{t.label}</span>
            {a && <div style={{ width: 18, height: 2.5, borderRadius: 100, background: C.green, marginTop: 1 }} />}
          </button>
        );
      })}
    </div>
  );

  // ─── QR TAB ───
  const QRTab = () => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 20px 100px" }}>
      <div style={{ width: "100%", padding: "14px 18px", borderRadius: 18, marginBottom: 20, background: checkedIn ? "rgba(122,224,90,0.12)" : "rgba(0,0,0,0.04)", border: checkedIn ? "1px solid rgba(78,184,48,0.3)" : "1px solid rgba(0,0,0,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, color: checkedIn ? C.greenDark : C.textSub, fontWeight: 600 }}>{checkedIn ? "Вы в офисе" : "Вы не в офисе"}</div>
          {checkedIn && checkInTime && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>С {fmt(checkInTime)} · {fmtH(elapsed)}</div>}
        </div>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: checkedIn ? C.green : "#D1D5DB", boxShadow: checkedIn ? `0 0 10px ${C.green}` : "none" }} />
      </div>

      <div style={{ background: "white", borderRadius: 28, padding: 28, boxShadow: "0 4px 40px rgba(0,0,0,0.08)", border: "1px solid rgba(0,0,0,0.06)", position: "relative", marginBottom: 14 }}>
        {showSuccess && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 28, background: checkedIn ? "rgba(78,184,48,0.95)" : "rgba(26,26,26,0.93)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
            <div style={{ fontSize: 52, marginBottom: 8 }}>{checkedIn ? "✓" : "←"}</div>
            <div style={{ color: "white", fontSize: 20, fontWeight: 700 }}>{checkedIn ? "Вход записан" : "Выход записан"}</div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, marginTop: 4 }}>{fmt(clock)}</div>
          </div>
        )}
        <QRCode value={`SURF:${USER.id}:${Date.now()}`} size={QR_SIZE} />
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <div style={{ fontSize: 13, color: C.textMuted }}>Покажите на терминале</div>
          <div style={{ fontSize: 11, color: C.greenDark, fontFamily: "monospace", marginTop: 4, fontWeight: 700 }}>{USER.id}</div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 24, display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
        QR-код обновляется каждые 30 секунд
      </div>

      <button onClick={handleToggle} style={{ width: "100%", maxWidth: 320, padding: "16px", borderRadius: 18, border: "none", background: checkedIn ? C.black : C.green, color: checkedIn ? "white" : C.black, fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: checkedIn ? "0 4px 20px rgba(0,0,0,0.2)" : `0 4px 20px rgba(122,224,90,0.4)`, transition: "all 0.2s" }}>
        {checkedIn ? "Отметить выход" : "Отметить вход"}
      </button>
      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>Или отсканируйте QR на терминале</div>
    </div>
  );

  // ─── HISTORY TAB ───
  const HistoryTab = () => (
    <div style={{ padding: "20px 20px 100px" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 16 }}>История посещений</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {HISTORY.map((day, i) => (
          <div key={i} style={{ padding: "14px 16px", background: "rgba(255,255,255,0.8)", borderRadius: 16, border: day.isToday ? `1.5px solid ${C.green}` : "1px solid rgba(0,0,0,0.07)", backdropFilter: "blur(10px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{day.isToday ? "Сегодня" : fmtDay(day.date)}</div>
              {day.totalMin && (
                <div style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 100, background: day.totalMin >= 480 ? "rgba(122,224,90,0.2)" : "rgba(0,0,0,0.06)", color: day.totalMin >= 480 ? C.greenDark : C.textSub }}>
                  {fmtH(day.totalMin)}
                </div>
              )}
              {!day.totalMin && day.isToday && checkedIn && (
                <div style={{ fontSize: 12, padding: "3px 10px", borderRadius: 100, background: "rgba(122,224,90,0.15)", color: C.greenDark, fontWeight: 600 }}>{fmtH(elapsed)}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
                <span style={{ fontSize: 13, color: C.textSub }}>Вход: <strong style={{ color: C.text }}>{fmt(day.checkIn)}</strong></span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: day.checkOut ? C.black : "#E5E7EB" }} />
                <span style={{ fontSize: 13, color: C.textSub }}>Выход: <strong style={{ color: C.text }}>{day.checkOut ? fmt(day.checkOut) : "—"}</strong></span>
              </div>
            </div>
            <div style={{ marginTop: 10, height: 4, background: "rgba(0,0,0,0.06)", borderRadius: 100, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 100, width: `${Math.min(((day.totalMin || elapsed) / 600) * 100, 100)}%`, background: (day.totalMin || elapsed) >= 480 ? `linear-gradient(90deg, ${C.greenDark}, ${C.green})` : `linear-gradient(90deg, #555, #888)` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ─── STATS TAB ───
  const StatsTab = () => {
    const range = statsRange === "week" ? HISTORY.slice(0, 5) : HISTORY;
    const totalDays = range.filter(d => d.totalMin).length;
    const totalHours = range.filter(d => d.totalMin).reduce((s, d) => s + d.totalMin, 0);
    const avg = totalDays ? Math.round(totalHours / totalDays) : 0;
    const maxH = Math.max(...range.filter(d => d.totalMin).map(d => d.totalMin), 600);
    const statCards = [
      { label: "Среднее / день", value: fmtH(avg), color: C.black, bg: "rgba(0,0,0,0.04)", icon: "◷" },
      { label: "Всего часов", value: fmtH(totalHours), color: C.black, bg: "rgba(122,224,90,0.12)", icon: "∑" },
      { label: "Дней в офисе", value: totalDays, color: C.black, bg: "rgba(212,240,96,0.2)", icon: "▦" },
      { label: "Средний приход", value: "09:15", color: C.greenDark, bg: "rgba(122,224,90,0.12)", icon: "→" },
    ];
    return (
      <div style={{ padding: "20px 20px 100px" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 16 }}>Статистика</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {[{ k: "week", l: "Неделя" }, { k: "all", l: "2 недели" }].map(r => (
            <button key={r.k} onClick={() => setStatsRange(r.k)} style={{ padding: "7px 18px", borderRadius: 100, border: "none", fontSize: 13, cursor: "pointer", background: statsRange === r.k ? C.black : "rgba(0,0,0,0.06)", color: statsRange === r.k ? "white" : C.textSub, fontWeight: statsRange === r.k ? 600 : 400 }}>{r.l}</button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          {statCards.map((s, i) => (
            <div key={i} style={{ padding: 16, borderRadius: 18, background: s.bg, border: "1px solid rgba(0,0,0,0.05)" }}>
              <div style={{ fontSize: 18, marginBottom: 6 }}>{s.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ background: "rgba(255,255,255,0.8)", borderRadius: 20, padding: 18, border: "1px solid rgba(0,0,0,0.07)", backdropFilter: "blur(10px)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 14 }}>Часы по дням</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
            {[...range].reverse().map((day, i) => {
              const h = day.totalMin ? (day.totalMin / maxH) * 100 : 5;
              const full = day.totalMin && day.totalMin >= 480;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ fontSize: 9, color: C.textMuted }}>{day.totalMin ? fmtH(day.totalMin) : ""}</div>
                  <div style={{ width: "100%", height: `${h}%`, minHeight: 4, borderRadius: 6, background: full ? `linear-gradient(to top, ${C.greenDark}, ${C.green})` : day.totalMin ? `linear-gradient(to top, #999, #CCC)` : "rgba(0,0,0,0.06)" }} />
                  <div style={{ fontSize: 9, color: C.textMuted }}>{day.date.toLocaleDateString("ru-RU", { weekday: "short" })}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 12, justifyContent: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.textSub }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: C.green }} /> ≥ 8ч
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.textSub }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: "#AAA" }} /> &lt; 8ч
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─── PROFILE TAB ───
  const ProfileTab = () => (
    <div style={{ padding: "20px 20px 100px" }}>
      {/* Hero — black card with green accent */}
      <div style={{ textAlign: "center", padding: "32px 20px", borderRadius: 24, background: C.black, marginBottom: 16, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -30, right: -20, width: 100, height: 100, borderRadius: "50%", background: `radial-gradient(circle, rgba(122,224,90,0.25) 0%, transparent 70%)` }} />
        <div style={{ position: "absolute", bottom: -20, left: -10, width: 80, height: 80, borderRadius: "50%", background: `radial-gradient(circle, rgba(212,240,96,0.15) 0%, transparent 70%)` }} />
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "white", margin: "0 auto 12px", border: "2px solid rgba(122,224,90,0.4)" }}>{USER.avatar}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "white" }}>{USER.name}</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{USER.position}</div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 10 }}>
          <span style={{ padding: "4px 14px", borderRadius: 100, background: C.green, color: C.black, fontSize: 13, fontWeight: 600 }}>{USER.dept}</span>
          <span style={{ padding: "4px 12px", borderRadius: 100, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}><JiraIcon /> Jira</span>
        </div>
      </div>

      {/* Info */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, background: "rgba(255,255,255,0.8)", borderRadius: 18, border: "1px solid rgba(0,0,0,0.07)", overflow: "hidden", marginBottom: 12, backdropFilter: "blur(10px)" }}>
        {[
          { icon: "✉", label: "Email", value: USER.email, synced: true },
          { icon: "☎", label: "Телефон", value: USER.phone, synced: false },
          { icon: "🏢", label: "Отдел", value: USER.dept, synced: true },
          { icon: "💼", label: "Должность", value: USER.position, synced: true },
          { icon: "📅", label: "В компании с", value: USER.startDate, synced: false },
          { icon: "#", label: "ID сотрудника", value: USER.id, synced: false },
          { icon: "⚙", label: "Jira username", value: USER.jiraUsername, synced: true },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: i < 6 ? "1px solid rgba(0,0,0,0.05)" : "none" }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(0,0,0,0.04)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{item.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: C.textMuted }}>{item.label}</div>
              <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>{item.value}</div>
            </div>
            {item.synced && <div style={{ fontSize: 10, color: C.greenDark, background: "rgba(122,224,90,0.15)", padding: "3px 8px", borderRadius: 100, flexShrink: 0, fontWeight: 600 }}>🔗 Jira</div>}
          </div>
        ))}
      </div>

      {/* QR */}
      <div style={{ background: "rgba(255,255,255,0.8)", borderRadius: 18, padding: 20, border: "1px solid rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 12, backdropFilter: "blur(10px)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>Мой QR-код</div>
        <QRCode value={`SURF:${USER.id}:STATIC`} size={140} />
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>Для идентификации</div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, background: "rgba(255,255,255,0.8)", borderRadius: 18, border: "1px solid rgba(0,0,0,0.07)", overflow: "hidden", marginBottom: 12, backdropFilter: "blur(10px)" }}>
        {[
          { icon: "⚙", label: "Настройки", desc: "Уведомления, тема" },
          { icon: "🔔", label: "Напоминания", desc: "Не забыть отметиться" },
          { icon: "❓", label: "Поддержка", desc: "Написать в IT" },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: i < 2 ? "1px solid rgba(0,0,0,0.05)" : "none", cursor: "pointer" }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(0,0,0,0.04)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{item.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{item.label}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{item.desc}</div>
            </div>
            <div style={{ color: C.textMuted, fontSize: 18 }}>›</div>
          </div>
        ))}
      </div>

      <button onClick={() => setAuthed(false)} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)", color: "#EF4444", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        Выйти из аккаунта
      </button>
    </div>
  );

  return (
    <div style={{ maxWidth: 430, margin: "0 auto", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", position: "relative", background: C.bg }}>
      <Blobs />
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", background: "rgba(255,255,255,0.85)", borderBottom: "1px solid rgba(0,0,0,0.07)", position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(20px)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SurfWordmark color="#1A1A1A" />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontVariantNumeric: "tabular-nums" }}>{clock.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</div>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.green, color: C.black, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{USER.avatar}</div>
        </div>
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
        {tab === "qr" && <QRTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "profile" && <ProfileTab />}
      </div>
      <TabBar />
    </div>
  );
}
