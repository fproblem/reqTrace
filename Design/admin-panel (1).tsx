import { useState, useEffect, useMemo } from "react";

const DEPTS = ["iOS", "Android", "Backend", "Design", "QA", "PM"];
const deptColors = {
  iOS:     { bg: "rgba(122,224,90,0.12)",  text: "#3A9E20", border: "rgba(122,224,90,0.3)" },
  Android: { bg: "rgba(212,240,96,0.18)",  text: "#6B8A00", border: "rgba(212,240,96,0.4)" },
  Backend: { bg: "rgba(0,0,0,0.06)",       text: "#444",    border: "rgba(0,0,0,0.1)" },
  Design:  { bg: "rgba(232,180,240,0.25)", text: "#8B3FAB", border: "rgba(232,180,240,0.5)" },
  QA:      { bg: "rgba(240,180,255,0.2)",  text: "#7A35A0", border: "rgba(240,180,255,0.4)" },
  PM:      { bg: "rgba(122,224,90,0.08)",  text: "#2E7D32", border: "rgba(122,224,90,0.2)" },
};

const C = {
  green: "#7AE05A", greenDark: "#4DB830",
  yellow: "#D4F060",
  black: "#1A1A1A",
  text: "#1A1A1A", textSub: "#6B7280", textMuted: "#9CA3AF",
  bg: "#FFFFFF", card: "rgba(255,255,255,0.8)", border: "rgba(0,0,0,0.07)",
};

const ADMIN_USER = { name: "Ольга Соколова", role: "hr", avatar: "ОС", email: "o.sokolova@surf.dev" };

const EMPLOYEES = [
  { id: "EMP001", name: "Алексей Иванов",    dept: "iOS",     position: "Team Lead",          avatar: "АИ" },
  { id: "EMP002", name: "Мария Петрова",     dept: "Android", position: "Senior Developer",    avatar: "МП" },
  { id: "EMP003", name: "Дмитрий Козлов",    dept: "Backend", position: "Senior Developer",    avatar: "ДК" },
  { id: "EMP004", name: "Елена Смирнова",    dept: "Design",  position: "Lead Designer",       avatar: "ЕС" },
  { id: "EMP005", name: "Сергей Волков",     dept: "iOS",     position: "Middle Developer",    avatar: "СВ" },
  { id: "EMP006", name: "Анна Новикова",     dept: "QA",      position: "QA Engineer",         avatar: "АН" },
  { id: "EMP007", name: "Павел Морозов",     dept: "Android", position: "Junior Developer",    avatar: "ПМ" },
  { id: "EMP008", name: "Ольга Соколова",    dept: "PM",      position: "Project Manager",     avatar: "ОС" },
  { id: "EMP009", name: "Игорь Лебедев",     dept: "Backend", position: "DevOps Engineer",     avatar: "ИЛ" },
  { id: "EMP010", name: "Наталья Федорова",  dept: "Design",  position: "UI Designer",         avatar: "НФ" },
  { id: "EMP011", name: "Артём Кузнецов",    dept: "iOS",     position: "Junior Developer",    avatar: "АК" },
  { id: "EMP012", name: "Виктория Попова",   dept: "QA",      position: "Senior QA",           avatar: "ВП" },
  { id: "EMP013", name: "Максим Соловьёв",   dept: "Backend", position: "Middle Developer",    avatar: "МС" },
  { id: "EMP014", name: "Дарья Васильева",   dept: "PM",      position: "Scrum Master",        avatar: "ДВ" },
  { id: "EMP015", name: "Роман Николаев",    dept: "Android", position: "Middle Developer",    avatar: "РН" },
];

const generateRecords = () => {
  const recs = []; const now = new Date();
  for (let dayOff = 0; dayOff < 14; dayOff++) {
    const d = new Date(now); d.setDate(d.getDate() - dayOff);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    EMPLOYEES.forEach(emp => {
      if (Math.random() < 0.12 && dayOff > 0) return;
      const inH = 8 + Math.floor(Math.random() * 2), inM = Math.floor(Math.random() * 55);
      const ci = new Date(d); ci.setHours(inH, inM, 0, 0);
      recs.push({ empId: emp.id, type: "in", time: new Date(ci) });
      if (dayOff > 0 || Math.random() > 0.4) {
        const outH = inH + 7 + Math.floor(Math.random() * 3), outM = Math.floor(Math.random() * 55);
        const co = new Date(d); co.setHours(outH, outM, 0, 0);
        if (co < now) recs.push({ empId: emp.id, type: "out", time: new Date(co) });
      }
    });
  }
  return recs;
};

const fmt = d => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const fmtDate = d => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const fmtShort = d => d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const fmtH = min => min ? `${Math.floor(min / 60)}ч ${min % 60}м` : "—";
const isToday = d => { const t = new Date(); return d.getDate() === t.getDate() && d.getMonth() === t.getMonth(); };

const SurfWordmark = ({ color = "#1A1A1A" }) => (
  <svg width="52" height="15" viewBox="0 0 91 26" fill="none">
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

// Blobs — same as employee app
const Blobs = () => (
  <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
    <div style={{ position: "absolute", top: "-15%", left: "-10%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(232,180,240,0.4) 0%, rgba(220,160,230,0.15) 40%, transparent 70%)", filter: "blur(80px)" }} />
    <div style={{ position: "absolute", bottom: "-10%", right: "-10%", width: "55vw", height: "55vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(100,220,60,0.35) 0%, rgba(140,240,80,0.12) 40%, transparent 70%)", filter: "blur(80px)" }} />
    <div style={{ position: "absolute", bottom: "30%", right: "10%", width: "20vw", height: "20vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(212,240,96,0.2) 0%, transparent 70%)", filter: "blur(40px)" }} />
  </div>
);

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [loginState, setLoginState] = useState("idle");
  const [records] = useState(generateRecords);
  const [clock, setClock] = useState(new Date());
  const [page, setPage] = useState("dashboard");
  const [filterDept, setFilterDept] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  const handleLogin = () => { setLoginState("loading"); setTimeout(() => { setLoginState("idle"); setAuthed(true); }, 2000); };

  const getStatus = (empId) => {
    const r = records.filter(r => r.empId === empId && isToday(r.time)).sort((a, b) => b.time - a.time);
    if (!r.length) return { status: "absent" };
    return { status: r[0].type === "in" ? "present" : "left" };
  };
  const getTodayIn = (empId) => records.filter(r => r.empId === empId && isToday(r.time) && r.type === "in").sort((a, b) => a.time - b.time)[0]?.time || null;
  const getTodayOut = (empId) => records.filter(r => r.empId === empId && isToday(r.time) && r.type === "out").sort((a, b) => b.time - a.time)[0]?.time || null;

  const presentList = EMPLOYEES.filter(e => getStatus(e.id).status === "present");
  const leftList = EMPLOYEES.filter(e => getStatus(e.id).status === "left");
  const absentList = EMPLOYEES.filter(e => getStatus(e.id).status === "absent");
  const todayLog = records.filter(r => isToday(r.time)).sort((a, b) => b.time - a.time);

  const filtered = useMemo(() => {
    let list = EMPLOYEES;
    if (filterDept !== "all") list = list.filter(e => e.dept === filterDept);
    if (search) list = list.filter(e => e.name.toLowerCase().includes(search.toLowerCase()) || e.id.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [filterDept, search]);

  // ─── LOGIN ───
  if (!authed) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", position: "relative", overflow: "hidden" }}>
      <Blobs />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ marginBottom: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <SurfWordmark color="#1A1A1A" />
          <div style={{ width: 28, height: 2.5, background: C.green, borderRadius: 100 }} />
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Surf Пропуск</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Панель управления</div>
        </div>

        <div style={{ width: 400, background: "rgba(255,255,255,0.82)", borderRadius: 24, padding: "32px 28px", border: "1px solid rgba(0,0,0,0.07)", backdropFilter: "blur(20px)", boxShadow: "0 4px 40px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4, textAlign: "center" }}>Вход в панель управления</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 24, textAlign: "center" }}>Авторизация через Google</div>

          <button onClick={handleLogin} disabled={loginState === "loading"} style={{ width: "100%", padding: "13px 20px", borderRadius: 14, border: "1px solid #DADCE0", background: "white", color: "#3C4043", fontSize: 15, fontWeight: 500, cursor: loginState === "loading" ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", opacity: loginState === "loading" ? 0.7 : 1, transition: "all 0.2s" }}>
            {loginState === "loading" ? (
              <><div style={{ width: 18, height: 18, border: "2px solid #DADCE0", borderTopColor: "#4285F4", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>Подключение...</>
            ) : (<><GoogleIcon /> Войти через Google</>)}
          </button>

          <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 12, background: "rgba(122,224,90,0.1)", border: "1px solid rgba(122,224,90,0.25)" }}>
            <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.6 }}>
              Вы будете перенаправлены в <span style={{ color: C.greenDark, fontWeight: 600 }}>Google</span> для авторизации аккаунтом <span style={{ color: C.greenDark, fontWeight: 600 }}>@surf.dev</span>. Роль назначается HR-специалистом.
            </div>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center" }}>
            {[{ r: "HR", color: C.greenDark }, { r: "Руководитель", color: C.textSub }].map((x, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textMuted }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: x.color }} /> {x.r}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 28, textAlign: "center", fontSize: 11, color: C.textMuted, lineHeight: 1.8 }}>
          Surf · Пропускная система v1.0<br />
          <span style={{ color: "#CBD5E1" }}>Доступ только для руководителей и HR</span>
        </div>
      </div>
    </div>
  );

  // ─── SIDEBAR ───
  const navItems = [
    { key: "dashboard", label: "Обзор", icon: (a) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? C.black : C.textMuted} strokeWidth="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg> },
    { key: "employees", label: "Сотрудники", icon: (a) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? C.black : C.textMuted} strokeWidth="1.8"><circle cx="9" cy="7" r="4"/><path d="M2 21c0-4 3.1-7 7-7s7 3 7 7"/><circle cx="19" cy="9" r="3"/><path d="M22 21c0-3-1.8-5-3-5"/></svg> },
    { key: "log", label: "Журнал", icon: (a) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? C.black : C.textMuted} strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg> },
    { key: "reports", label: "Отчёты", icon: (a) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? C.black : C.textMuted} strokeWidth="1.8"><rect x="4" y="14" width="4" height="7" rx="1"/><rect x="10" y="9" width="4" height="12" rx="1"/><rect x="16" y="4" width="4" height="17" rx="1"/></svg> },
  ];

  const Sidebar = () => (
    <div style={{ width: sidebarOpen ? 210 : 56, background: "rgba(255,255,255,0.88)", borderRight: "1px solid rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", transition: "width 0.2s", overflow: "hidden", flexShrink: 0, backdropFilter: "blur(20px)", position: "relative", zIndex: 10 }}>
      <div style={{ padding: sidebarOpen ? "18px 16px" : "18px 0", display: "flex", alignItems: "center", justifyContent: sidebarOpen ? "flex-start" : "center", gap: 10, borderBottom: "1px solid rgba(0,0,0,0.07)", height: 60 }}>
        {sidebarOpen ? <SurfWordmark color={C.black} /> : <div style={{ width: 28, height: 8, background: C.green, borderRadius: 4 }} />}
      </div>
      <div style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {navItems.map(n => {
          const a = page === n.key;
          return (
            <button key={n.key} onClick={() => { setPage(n.key); setSelectedEmp(null); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: sidebarOpen ? "10px 12px" : "10px 0", justifyContent: sidebarOpen ? "flex-start" : "center", borderRadius: 10, border: "none", cursor: "pointer", width: "100%", background: a ? "rgba(0,0,0,0.06)" : "transparent", color: a ? C.black : C.textSub, fontSize: 14, fontWeight: a ? 700 : 400, transition: "all 0.15s", position: "relative" }}>
              {n.icon(a)}
              {sidebarOpen && <span style={{ whiteSpace: "nowrap" }}>{n.label}</span>}
              {a && sidebarOpen && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 18, borderRadius: 100, background: C.green }} />}
            </button>
          );
        })}
      </div>
      <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ padding: 16, border: "none", background: "transparent", color: C.textMuted, cursor: "pointer", fontSize: 14, borderTop: "1px solid rgba(0,0,0,0.07)", display: "flex", justifyContent: "center" }}>
        {sidebarOpen ? "◂" : "▸"}
      </button>
    </div>
  );

  // ─── STAT CARD ───
  const StatCard = ({ label, value, sub, accent, bg }) => (
    <div style={{ padding: 18, borderRadius: 16, background: bg || "rgba(255,255,255,0.8)", border: "1px solid rgba(0,0,0,0.07)", flex: 1, minWidth: 130, backdropFilter: "blur(10px)" }}>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: accent || C.black }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{sub}</div>}
    </div>
  );

  // ─── EMP ROW ───
  const EmpRow = ({ emp, onClick }) => {
    const st = getStatus(emp.id); const inT = getTodayIn(emp.id); const outT = getTodayOut(emp.id);
    const dc = deptColors[emp.dept];
    const statusBg = st.status === "present" ? "rgba(122,224,90,0.15)" : "rgba(0,0,0,0.05)";
    const statusColor = st.status === "present" ? C.greenDark : C.textMuted;
    const statusLabel = st.status === "present" ? "В офисе" : st.status === "left" ? "Ушёл" : "Не был";
    return (
      <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(255,255,255,0.8)", borderRadius: 14, border: "1px solid rgba(0,0,0,0.07)", cursor: "pointer", backdropFilter: "blur(10px)", transition: "box-shadow 0.15s" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: st.status === "present" ? C.green : st.status === "left" ? "#E5E7EB" : "#F3F4F6", color: st.status === "present" ? C.black : C.textSub }}>{emp.avatar}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{emp.name}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
            <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 100, background: dc.bg, color: dc.text, border: `1px solid ${dc.border}` }}>{emp.dept}</span>
            <span style={{ fontSize: 12, color: C.textMuted }}>{emp.position}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: C.textSub, marginBottom: 4 }}>{inT ? fmt(inT) : "—"} → {outT ? fmt(outT) : "—"}</div>
          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 100, background: statusBg, color: statusColor }}>{statusLabel}</span>
        </div>
      </div>
    );
  };

  // ─── EMP DETAIL ───
  const EmpDetail = ({ emp }) => {
    const empRecs = records.filter(r => r.empId === emp.id).sort((a, b) => b.time - a.time);
    const days = {};
    empRecs.forEach(r => { const k = r.time.toDateString(); if (!days[k]) days[k] = { date: new Date(r.time), ins: [], outs: [] }; r.type === "in" ? days[k].ins.push(r.time) : days[k].outs.push(r.time); });
    const dayList = Object.values(days).sort((a, b) => b.date - a.date).slice(0, 10);
    const dc = deptColors[emp.dept];
    return (
      <div>
        <button onClick={() => setSelectedEmp(null)} style={{ background: "none", border: "none", color: C.greenDark, fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 16, fontWeight: 600 }}>← Назад</button>
        <div style={{ padding: 24, borderRadius: 20, background: C.black, color: "white", marginBottom: 20, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -30, right: -20, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(122,224,90,0.2) 0%, transparent 70%)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: C.black }}>{emp.avatar}</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{emp.name}</div>
              <div style={{ fontSize: 14, opacity: 0.6 }}>{emp.position}</div>
              <div style={{ marginTop: 6 }}><span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 100, background: C.green, color: C.black, fontWeight: 600 }}>{emp.dept}</span></div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 12 }}>История посещений</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {dayList.map((day, i) => {
            const firstIn = day.ins.sort((a, b) => a - b)[0];
            const lastOut = day.outs.sort((a, b) => b - a)[0];
            const total = firstIn && lastOut ? Math.round((lastOut - firstIn) / 60000) : null;
            return (
              <div key={i} style={{ padding: "12px 16px", background: "rgba(255,255,255,0.8)", borderRadius: 14, border: isToday(day.date) ? `1.5px solid ${C.green}` : "1px solid rgba(0,0,0,0.07)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{isToday(day.date) ? "Сегодня" : fmtShort(day.date)}</div>
                  {total && <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 100, background: total >= 480 ? "rgba(122,224,90,0.2)" : "rgba(0,0,0,0.06)", color: total >= 480 ? C.greenDark : C.textSub }}>{fmtH(total)}</span>}
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 13, color: C.textSub }}>
                  <span>Вход: <strong style={{ color: C.text }}>{firstIn ? fmt(firstIn) : "—"}</strong></span>
                  <span>Выход: <strong style={{ color: C.text }}>{lastOut ? fmt(lastOut) : "—"}</strong></span>
                </div>
                <div style={{ marginTop: 8, height: 4, background: "rgba(0,0,0,0.06)", borderRadius: 100, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 100, width: `${Math.min(((total || 0) / 600) * 100, 100)}%`, background: (total || 0) >= 480 ? `linear-gradient(90deg, ${C.greenDark}, ${C.green})` : "linear-gradient(90deg, #888, #AAA)" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ─── DASHBOARD ───
  const Dashboard = () => (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <StatCard label="В офисе сейчас" value={presentList.length} sub={`из ${EMPLOYEES.length}`} accent={C.black} bg="rgba(255,255,255,0.8)" />
        <StatCard label="Ушли" value={leftList.length} accent={C.black} bg="rgba(255,255,255,0.8)" />
        <StatCard label="Не были сегодня" value={absentList.length} accent={C.black} bg="rgba(255,255,255,0.8)" />
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, boxShadow: `0 0 8px ${C.green}` }} /> Сейчас в офисе
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {presentList.map(emp => (
            <div key={emp.id} onClick={() => { setSelectedEmp(emp); setPage("employees"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", background: "rgba(255,255,255,0.8)", borderRadius: 100, border: "1px solid rgba(0,0,0,0.07)", cursor: "pointer", backdropFilter: "blur(10px)" }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.green, color: C.black, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>{emp.avatar}</div>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{emp.name.split(" ")[0]}</span>
              <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 100, background: deptColors[emp.dept].bg, color: deptColors[emp.dept].text }}>{emp.dept}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 }}>По отделам</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {DEPTS.map(dept => {
            const total = EMPLOYEES.filter(e => e.dept === dept).length;
            const present = EMPLOYEES.filter(e => e.dept === dept && getStatus(e.id).status === "present").length;
            const dc = deptColors[dept];
            return (
              <div key={dept} style={{ padding: 14, borderRadius: 14, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(0,0,0,0.07)", backdropFilter: "blur(10px)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: dc.text }}>{dept}</span>
                  <span style={{ fontSize: 12, color: C.textMuted }}>{present}/{total}</span>
                </div>
                <div style={{ height: 5, background: "rgba(0,0,0,0.06)", borderRadius: 100, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 100, background: C.green, width: `${(present / total) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 }}>Последние события</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {todayLog.slice(0, 8).map((rec, i) => {
            const emp = EMPLOYEES.find(e => e.id === rec.empId); if (!emp) return null;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(255,255,255,0.8)", borderRadius: 10, border: "1px solid rgba(0,0,0,0.05)" }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, background: rec.type === "in" ? "rgba(122,224,90,0.2)" : "rgba(0,0,0,0.06)", color: rec.type === "in" ? C.greenDark : C.textSub }}>{rec.type === "in" ? "→" : "←"}</div>
                <span style={{ fontSize: 13, fontWeight: 500, color: C.text, flex: 1 }}>{emp.name}</span>
                <span style={{ fontSize: 12, color: C.textMuted }}>{emp.dept}</span>
                <span style={{ fontSize: 12, color: C.textSub, fontVariantNumeric: "tabular-nums" }}>{fmt(rec.time)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ─── EMPLOYEES ───
  const EmployeesPage = () => (
    <div>
      {selectedEmp ? <EmpDetail emp={selectedEmp} /> : (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени или ID..." style={{ flex: 1, minWidth: 200, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.1)", fontSize: 14, outline: "none", background: "rgba(255,255,255,0.8)", backdropFilter: "blur(10px)" }} />
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button onClick={() => setFilterDept("all")} style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, cursor: "pointer", background: filterDept === "all" ? C.black : "rgba(255,255,255,0.8)", color: filterDept === "all" ? "white" : C.textSub, border: "1px solid rgba(0,0,0,0.1)" }}>Все</button>
              {DEPTS.map(d => <button key={d} onClick={() => setFilterDept(d)} style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, cursor: "pointer", background: filterDept === d ? deptColors[d].bg : "rgba(255,255,255,0.8)", color: filterDept === d ? deptColors[d].text : C.textSub, border: filterDept === d ? `1px solid ${deptColors[d].border}` : "1px solid rgba(0,0,0,0.1)" }}>{d}</button>)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>Найдено: {filtered.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(emp => <EmpRow key={emp.id} emp={emp} onClick={() => setSelectedEmp(emp)} />)}
          </div>
        </>
      )}
    </div>
  );

  // ─── LOG ───
  const LogPage = () => {
    const logFiltered = filterDept === "all" ? todayLog : todayLog.filter(r => EMPLOYEES.find(e => e.id === r.empId)?.dept === filterDept);
    return (
      <div>
        <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
          <button onClick={() => setFilterDept("all")} style={{ padding: "6px 14px", borderRadius: 100, border: "1px solid rgba(0,0,0,0.1)", fontSize: 12, cursor: "pointer", background: filterDept === "all" ? C.black : "rgba(255,255,255,0.8)", color: filterDept === "all" ? "white" : C.textSub }}>Все</button>
          {DEPTS.map(d => <button key={d} onClick={() => setFilterDept(d)} style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, cursor: "pointer", background: filterDept === d ? deptColors[d].bg : "rgba(255,255,255,0.8)", color: filterDept === d ? deptColors[d].text : C.textSub, border: filterDept === d ? `1px solid ${deptColors[d].border}` : "1px solid rgba(0,0,0,0.1)" }}>{d}</button>)}
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>Записей сегодня: {logFiltered.length}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {logFiltered.map((rec, i) => {
            const emp = EMPLOYEES.find(e => e.id === rec.empId); if (!emp) return null;
            const dc = deptColors[emp.dept];
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(255,255,255,0.8)", borderRadius: 10, border: "1px solid rgba(0,0,0,0.05)" }}>
                <span style={{ fontSize: 12, color: C.textMuted, fontVariantNumeric: "tabular-nums", width: 48, flexShrink: 0 }}>{fmt(rec.time)}</span>
                <div style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, background: rec.type === "in" ? "rgba(122,224,90,0.2)" : "rgba(0,0,0,0.06)", color: rec.type === "in" ? C.greenDark : C.textSub }}>{rec.type === "in" ? "→" : "←"}</div>
                <span style={{ fontSize: 13, fontWeight: 500, color: C.text, flex: 1 }}>{emp.name}</span>
                <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 100, background: dc.bg, color: dc.text, border: `1px solid ${dc.border}` }}>{emp.dept}</span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 100, background: rec.type === "in" ? "rgba(122,224,90,0.15)" : "rgba(0,0,0,0.06)", color: rec.type === "in" ? C.greenDark : C.textSub, fontWeight: 500 }}>{rec.type === "in" ? "Вход" : "Выход"}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ─── REPORTS ───
  const ReportsPage = () => {
    const weekData = [];
    const now = new Date();
    for (let i = 4; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const uniq = [...new Set(records.filter(r => r.time.toDateString() === d.toDateString()).map(r => r.empId))];
      weekData.push({ date: d, present: uniq.length });
    }
    const maxP = Math.max(...weekData.map(d => d.present), 1);
    return (
      <div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <StatCard label="Ср. посещаемость / день" value={Math.round(weekData.reduce((s, d) => s + d.present, 0) / (weekData.length || 1))} sub="за неделю" accent={C.greenDark} bg="rgba(122,224,90,0.12)" />
          <StatCard label="Всего сотрудников" value={EMPLOYEES.length} sub="в системе" accent={C.black} bg="rgba(0,0,0,0.04)" />
        </div>
        <div style={{ background: "rgba(255,255,255,0.8)", borderRadius: 18, padding: 20, border: "1px solid rgba(0,0,0,0.07)", marginBottom: 20, backdropFilter: "blur(10px)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16 }}>Посещаемость за неделю</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 140 }}>
            {weekData.map((day, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{day.present}</div>
                <div style={{ width: "100%", height: `${(day.present / maxP) * 110}px`, borderRadius: 8, background: `linear-gradient(to top, ${C.greenDark}, ${C.green})` }} />
                <div style={{ fontSize: 11, color: C.textMuted }}>{day.date.toLocaleDateString("ru-RU", { weekday: "short" })}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.8)", borderRadius: 18, padding: 20, border: "1px solid rgba(0,0,0,0.07)", backdropFilter: "blur(10px)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16 }}>Посещаемость по отделам</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {DEPTS.map(dept => {
              const total = EMPLOYEES.filter(e => e.dept === dept).length;
              const present = EMPLOYEES.filter(e => e.dept === dept && getStatus(e.id).status === "present").length;
              const pct = Math.round((present / total) * 100);
              const dc = deptColors[dept];
              return (
                <div key={dept}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: dc.text }}>{dept}</span>
                    <span style={{ fontSize: 12, color: C.textMuted }}>{present}/{total} ({pct}%)</span>
                  </div>
                  <div style={{ height: 6, background: "rgba(0,0,0,0.06)", borderRadius: 100, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 100, background: C.green, width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const titles = { dashboard: "Обзор", employees: "Сотрудники", log: "Журнал событий", reports: "Отчёты" };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: C.bg, position: "relative" }}>
      <Blobs />
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", zIndex: 1 }}>
        {/* Header */}
        <div style={{ padding: "14px 28px", background: "rgba(255,255,255,0.85)", borderBottom: "1px solid rgba(0,0,0,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, backdropFilter: "blur(20px)" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{titles[page]}</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{fmtDate(clock)} · {fmt(clock)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
              <span style={{ fontSize: 12, color: C.textSub }}>Система активна</span>
            </div>
            <div style={{ width: 1, height: 20, background: "rgba(0,0,0,0.1)" }} />
            <div style={{ position: "relative" }}>
              <div onClick={() => setProfileOpen(!profileOpen)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "6px 10px", borderRadius: 12, background: profileOpen ? "rgba(0,0,0,0.04)" : "transparent" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: C.green, color: C.black, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{ADMIN_USER.avatar}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{ADMIN_USER.name.split(" ")[0]}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>HR</div>
                </div>
                <span style={{ fontSize: 11, color: C.textMuted }}>▾</span>
              </div>
              {profileOpen && (
                <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, width: 240, background: "rgba(255,255,255,0.95)", borderRadius: 16, border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.1)", zIndex: 100, overflow: "hidden", backdropFilter: "blur(20px)" }}>
                  <div style={{ padding: 16, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{ADMIN_USER.name}</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{ADMIN_USER.email}</div>
                    <span style={{ display: "inline-block", marginTop: 8, fontSize: 11, padding: "2px 10px", borderRadius: 100, background: "rgba(122,224,90,0.2)", color: C.greenDark, fontWeight: 600 }}>HR</span>
                  </div>
                  <button onClick={() => { setAuthed(false); setProfileOpen(false); }} style={{ width: "100%", padding: "12px 16px", border: "none", background: "transparent", color: "#EF4444", fontSize: 13, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>
                    ↩ Выйти из аккаунта
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 24 }} onClick={() => profileOpen && setProfileOpen(false)}>
          {page === "dashboard" && <Dashboard />}
          {page === "employees" && <EmployeesPage />}
          {page === "log" && <LogPage />}
          {page === "reports" && <ReportsPage />}
        </div>
      </div>
    </div>
  );
}
