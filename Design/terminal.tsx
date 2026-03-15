import { useState, useEffect, useCallback } from "react";

const EMPLOYEES = [
  { id: "EMP001", name: "Алексей Иванов",   dept: "iOS",     avatar: "АИ" },
  { id: "EMP002", name: "Мария Петрова",    dept: "Android", avatar: "МП" },
  { id: "EMP003", name: "Дмитрий Козлов",   dept: "Backend", avatar: "ДК" },
  { id: "EMP004", name: "Елена Смирнова",   dept: "Design",  avatar: "ЕС" },
  { id: "EMP005", name: "Сергей Волков",    dept: "iOS",     avatar: "СВ" },
  { id: "EMP006", name: "Анна Новикова",    dept: "QA",      avatar: "АН" },
  { id: "EMP007", name: "Павел Морозов",    dept: "Android", avatar: "ПМ" },
  { id: "EMP008", name: "Ольга Соколова",   dept: "PM",      avatar: "ОС" },
  { id: "EMP009", name: "Игорь Лебедев",    dept: "Backend", avatar: "ИЛ" },
  { id: "EMP010", name: "Наталья Федорова", dept: "Design",  avatar: "НФ" },
];

const fmt = d => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const fmtSec = d => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDate = d => d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

const C = {
  green: "#7AE05A", greenDark: "#4DB830",
  black: "#1A1A1A", text: "#1A1A1A",
  textSub: "#6B7280", textMuted: "#9CA3AF",
  bg: "#FFFFFF", border: "rgba(0,0,0,0.07)",
};

const Blobs = () => (
  <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
    <div style={{ position: "absolute", top: "-15%", left: "-10%", width: "60vw", height: "60vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(232,180,240,0.4) 0%, transparent 70%)", filter: "blur(80px)" }} />
    <div style={{ position: "absolute", bottom: "-10%", right: "-10%", width: "55vw", height: "55vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(100,220,60,0.35) 0%, transparent 70%)", filter: "blur(80px)" }} />
    <div style={{ position: "absolute", top: "40%", right: "15%", width: "20vw", height: "20vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(212,240,96,0.2) 0%, transparent 70%)", filter: "blur(40px)" }} />
  </div>
);

const SurfWordmark = ({ color = "#1A1A1A" }) => (
  <svg width="52" height="15" viewBox="0 0 91 26" fill="none">
    <path d="M15.0951 25C13.339 25 11.6965 24.6269 10.1676 23.8808C8.65942 23.114 7.43012 22.0363 6.47974 20.6477C5.55002 19.2383 5.0645 17.6321 5.02318 15.829H11.0974C11.18 16.5751 11.4176 17.2383 11.8101 17.8187C12.2233 18.3782 12.7502 18.8238 13.3907 19.1554C14.0311 19.4663 14.7439 19.6218 15.529 19.6218C16.0042 19.6218 16.4484 19.5389 16.8616 19.3731C17.2955 19.2073 17.6467 18.9793 17.9153 18.6891C18.1839 18.399 18.3182 18.0777 18.3182 17.7254C18.3182 17.1658 18.1322 16.7306 17.7603 16.4197C17.3885 16.0881 16.9133 15.8497 16.3348 15.7047C15.7563 15.5596 14.9505 15.4041 13.9175 15.2383C12.244 14.9689 10.8701 14.6477 9.79574 14.2746C8.74206 13.9016 7.82267 13.228 7.03757 12.2539C6.27314 11.2798 5.89092 9.88083 5.89092 8.05699C5.89092 6.70984 6.28347 5.49741 7.06856 4.41969C7.85366 3.34197 8.93833 2.50259 10.3226 1.90156C11.7275 1.30052 13.2977 1 15.0332 1C16.748 1 18.3182 1.36269 19.7437 2.08808C21.1693 2.79275 22.3263 3.75648 23.2147 4.97927C24.1238 6.18135 24.6506 7.50777 24.7952 8.95855H18.5041C18.4008 8.44041 18.1632 7.97409 17.7913 7.55959C17.4401 7.14508 16.9649 6.81347 16.3658 6.56477C15.7873 6.31606 15.1365 6.19171 14.4134 6.19171C13.6696 6.19171 13.0601 6.33679 12.5849 6.62694C12.1304 6.89637 11.9031 7.25907 11.9031 7.71503C11.9031 8.12953 12.0684 8.46114 12.399 8.70985C12.7295 8.95855 13.1531 9.14508 13.6696 9.26943C14.1861 9.39378 14.8989 9.51814 15.8079 9.64249C17.5227 9.91192 18.9483 10.2435 20.0846 10.6373C21.221 11.0104 22.2127 11.7254 23.0597 12.7824C23.9068 13.8187 24.3304 15.3212 24.3304 17.2902C24.3304 18.8031 23.9378 20.1503 23.1527 21.3316C22.3883 22.4922 21.3036 23.3938 19.8987 24.0363C18.5145 24.6788 16.9133 25 15.0951 25Z" fill={color}/>
    <path d="M34.3358 24.6269C32.7242 24.6269 31.2987 24.2642 30.059 23.5389C28.8401 22.7927 27.8897 21.7565 27.2079 20.4301C26.5261 19.1036 26.1852 17.5803 26.1852 15.8601V1.37306H32.0734V15.8601C32.0734 16.5648 32.2181 17.1865 32.5073 17.7254C32.8172 18.2642 33.2408 18.6788 33.7779 18.9689C34.3151 19.2591 34.9142 19.4041 35.5754 19.4041H36.0712C37.1043 19.4041 37.9513 19.0829 38.6125 18.4404C39.2736 17.7979 39.6042 16.9378 39.6042 15.8601V1.37306H45.4924V15.8601C45.4924 17.5803 45.1515 19.1036 44.4697 20.4301C43.7879 21.7565 42.8272 22.7927 41.5876 23.5389C40.3479 24.2642 38.9224 24.6269 37.3109 24.6269H34.3358Z" fill={color}/>
    <path d="M62.8285 12.8135C63.593 13.1658 64.2438 13.601 64.7809 14.1192C65.3181 14.6373 65.7313 15.2176 66.0206 15.8601C66.3098 16.4819 66.4544 17.1554 66.4544 17.8808V24.6269H60.5662V19.4041C60.5662 18.513 60.2976 17.7668 59.7605 17.1658C59.2233 16.544 58.5312 16.2332 57.6841 16.2332H54.0272V24.6269H48.139V1.37306H57.5601C59.3782 1.37306 60.9484 1.67358 62.2707 2.27461C63.6136 2.87565 64.6467 3.73575 65.3698 4.85492C66.0929 5.97409 66.4544 7.29016 66.4544 8.80311C66.4544 9.6943 66.3201 10.5233 66.0516 11.2902C65.783 12.057 65.4008 12.7409 64.9049 13.342C64.4091 13.943 63.8099 14.4508 63.1074 14.8653L62.8285 12.8135ZM57.3742 11.0104C58.0146 11.0104 58.5621 10.9275 59.0167 10.7617C59.4712 10.5959 59.8121 10.3472 60.0394 10.0155C60.2873 9.68394 60.4113 9.27979 60.4113 8.80311C60.4113 8.09845 60.1427 7.55959 59.6055 7.18653C59.089 6.79275 58.3452 6.59585 57.3742 6.59585H54.0272V11.0104H57.3742Z" fill={color}/>
    <path d="M85.0232 6.59585H74.8272V10.2021H84.4034V15.4249H74.8272V24.6269H68.939V1.37306H85.0232V6.59585Z" fill={color}/>
  </svg>
);

export default function App() {
  const [records, setRecords] = useState(() => {
    const now = new Date(), pre = [];
    [0,1,2,4,5,7].forEach(i => {
      const emp = EMPLOYEES[i];
      const h = 8 + Math.floor(Math.random() * 2), m = Math.floor(Math.random() * 50);
      const ci = new Date(now); ci.setHours(h, m, 0);
      pre.push({ empId: emp.id, type: "in", time: new Date(ci) });
      if (Math.random() > 0.5) {
        const co = new Date(ci); co.setHours(h + 4 + Math.floor(Math.random() * 4), Math.floor(Math.random() * 60));
        if (co < now) pre.push({ empId: emp.id, type: "out", time: co });
      }
    });
    return pre;
  });

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [manualId, setManualId] = useState("");
  const [clock, setClock] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  const getStatus = useCallback((empId) => {
    const r = records.filter(r => r.empId === empId).sort((a, b) => b.time - a.time);
    if (!r.length) return "absent";
    return r[0].type === "in" ? "present" : "absent";
  }, [records]);

  const handleScan = (empId) => {
    const emp = EMPLOYEES.find(e => e.id === empId);
    if (!emp) { setScanResult({ success: false }); setTimeout(() => setScanResult(null), 3000); return; }
    const type = getStatus(empId) === "present" ? "out" : "in";
    const now = new Date();
    setRecords(prev => [...prev, { empId, type, time: now }]);
    setScanResult({ success: true, emp, type, time: now });
    setTimeout(() => setScanResult(null), 4000);
  };

  const simulateScan = () => {
    if (scanning || scanResult) return;
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      handleScan(EMPLOYEES[Math.floor(Math.random() * EMPLOYEES.length)].id);
    }, 900 + Math.random() * 800);
  };

  const presentCount = EMPLOYEES.filter(e => getStatus(e.id) === "present").length;
  const recentLog = [...records].sort((a, b) => b.time - a.time).slice(0, 5);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", position: "relative", overflow: "hidden" }}>
      <Blobs />
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        @keyframes scanLine { 0%,100% { top: 0 } 50% { top: calc(100% - 2px) } }
        @keyframes pulse { 0%,100% { opacity:0.4; transform:scale(0.95) } 50% { opacity:1; transform:scale(1.05) } }
      `}</style>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 480, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", alignItems: "center", minHeight: "100vh" }}>

        {/* Header */}
        <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
            <SurfWordmark color={C.black} />
            <span style={{ fontSize: 16, fontWeight: 400, color: C.black, letterSpacing: 0.2 }}>Пропуск</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, boxShadow: `0 0 6px ${C.green}`, animation: "pulse 2s ease-in-out infinite" }} />
            Система активна
          </div>
        </div>

        {/* Clock */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 64, fontWeight: 700, color: C.black, letterSpacing: -2, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {clock.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 8, textTransform: "capitalize" }}>{fmtDate(clock)}</div>
        </div>

        {/* Scanner zone */}
        <div
          onClick={simulateScan}
          style={{
            width: "100%", aspectRatio: "1", maxWidth: 300, borderRadius: 32,
            background: scanning ? "rgba(122,224,90,0.06)" : "rgba(255,255,255,0.7)",
            border: scanning ? `2px solid rgba(122,224,90,0.5)` : `2px dashed rgba(0,0,0,0.12)`,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            position: "relative", overflow: "hidden", cursor: scanning || scanResult ? "default" : "pointer",
            backdropFilter: "blur(20px)", boxShadow: "0 4px 40px rgba(0,0,0,0.06)",
            transition: "all 0.3s", marginBottom: 24,
          }}
        >
          {/* scan line */}
          {scanning && (
            <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${C.green}, transparent)`, animation: "scanLine 1.2s ease-in-out infinite" }} />
          )}

          {scanResult ? (
            <div style={{ textAlign: "center", padding: 28, animation: "fadeUp 0.3s ease" }}>
              {scanResult.success ? (
                <>
                  <div style={{ width: 72, height: 72, borderRadius: "50%", margin: "0 auto 16px", background: scanResult.type === "in" ? C.green : C.black, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, color: scanResult.type === "in" ? C.black : "white" }}>
                    {scanResult.type === "in" ? "→" : "←"}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: C.black, marginBottom: 4 }}>{scanResult.emp.name}</div>
                  <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 14 }}>{scanResult.emp.dept}</div>
                  <div style={{ display: "inline-block", padding: "8px 20px", borderRadius: 100, background: scanResult.type === "in" ? "rgba(122,224,90,0.15)" : "rgba(0,0,0,0.07)", color: scanResult.type === "in" ? C.greenDark : C.black, fontSize: 15, fontWeight: 700 }}>
                    {scanResult.type === "in" ? "Вход" : "Выход"} · {fmt(scanResult.time)}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ width: 72, height: 72, borderRadius: "50%", margin: "0 auto 16px", background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, color: "#EF4444" }}>✕</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "#EF4444" }}>Не найден</div>
                </>
              )}
            </div>
          ) : scanning ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 44, height: 44, border: `3px solid rgba(0,0,0,0.08)`, borderTopColor: C.green, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
              <div style={{ fontSize: 16, color: C.textSub, fontWeight: 500 }}>Сканирование...</div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 24 }}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.2" style={{ marginBottom: 16, display: "block", margin: "0 auto 16px" }}>
                <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/>
                <rect x="7" y="7" width="10" height="10" rx="1.5"/>
              </svg>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Поднесите QR-код</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>или нажмите для симуляции</div>
            </div>
          )}
        </div>

        {/* Manual input */}
        <div style={{ width: "100%", display: "flex", gap: 8, marginBottom: 28 }}>
          <input
            value={manualId}
            onChange={e => setManualId(e.target.value.toUpperCase())}
            placeholder="ID сотрудника (EMP001)"
            style={{ flex: 1, padding: "12px 16px", borderRadius: 14, border: "1px solid rgba(0,0,0,0.1)", background: "rgba(255,255,255,0.8)", color: C.text, fontSize: 14, outline: "none", backdropFilter: "blur(10px)" }}
            onKeyDown={e => { if (e.key === "Enter" && manualId) { handleScan(manualId); setManualId(""); } }}
          />
          <button
            onClick={() => { if (manualId) { handleScan(manualId); setManualId(""); } }}
            style={{ padding: "12px 20px", borderRadius: 14, border: "none", background: C.black, color: "white", fontSize: 16, cursor: "pointer" }}
          >→</button>
        </div>

        {/* Present count pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 100, background: "rgba(255,255,255,0.75)", border: "1px solid rgba(0,0,0,0.07)", backdropFilter: "blur(10px)", marginBottom: 28 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
          <span style={{ fontSize: 13, color: C.textSub }}>В офисе:</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.black }}>{presentCount}</span>
          <span style={{ fontSize: 13, color: C.textMuted }}>из {EMPLOYEES.length}</span>
        </div>



      </div>
    </div>
  );
}
