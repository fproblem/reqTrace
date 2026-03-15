import { useState, useEffect } from "react";

export default function SplashScreen() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 800);
    const t2 = setTimeout(() => setPhase(2), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div style={{
      width: "100%", height: "100vh",
      background: "#FFFFFF",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      position: "relative", overflow: "hidden",
      opacity: phase === 2 ? 0 : 1,
      transition: "opacity 0.6s ease",
    }}>
      {/* Gradient blobs — like surf.ru */}
      <div style={{
        position: "absolute", top: "-10%", right: "-10%", width: "60vw", height: "60vw",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(200,170,255,0.35) 0%, rgba(230,200,255,0.15) 40%, transparent 70%)",
        filter: "blur(60px)",
      }} />
      <div style={{
        position: "absolute", top: "10%", right: "5%", width: "30vw", height: "30vw",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(240,180,255,0.2) 0%, transparent 70%)",
        filter: "blur(40px)",
      }} />
      <div style={{
        position: "absolute", bottom: "-5%", right: "-5%", width: "45vw", height: "45vw",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(140,230,120,0.3) 0%, rgba(180,255,150,0.1) 40%, transparent 70%)",
        filter: "blur(60px)",
      }} />
      <div style={{
        position: "absolute", bottom: "15%", left: "5%", width: "25vw", height: "25vw",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(200,170,255,0.12) 0%, transparent 70%)",
        filter: "blur(40px)",
      }} />

      {/* SURF Logo */}
      <div style={{
        opacity: phase >= 0 ? 1 : 0,
        transform: phase >= 0 ? "translateY(0) scale(1)" : "translateY(20px) scale(0.9)",
        transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
        marginBottom: 24,
      }}>
        <svg width="182" height="52" viewBox="0 0 91 26" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15.0951 25C13.339 25 11.6965 24.6269 10.1676 23.8808C8.65942 23.114 7.43012 22.0363 6.47974 20.6477C5.55002 19.2383 5.0645 17.6321 5.02318 15.829H11.0974C11.18 16.5751 11.4176 17.2383 11.8101 17.8187C12.2233 18.3782 12.7502 18.8238 13.3907 19.1554C14.0311 19.4663 14.7439 19.6218 15.529 19.6218C16.0042 19.6218 16.4484 19.5389 16.8616 19.3731C17.2955 19.2073 17.6467 18.9793 17.9153 18.6891C18.1839 18.399 18.3182 18.0777 18.3182 17.7254C18.3182 17.1658 18.1322 16.7306 17.7603 16.4197C17.3885 16.0881 16.9133 15.8497 16.3348 15.7047C15.7563 15.5596 14.9505 15.4041 13.9175 15.2383C12.244 14.9689 10.8701 14.6477 9.79574 14.2746C8.74206 13.9016 7.82267 13.228 7.03757 12.2539C6.27314 11.2798 5.89092 9.88083 5.89092 8.05699C5.89092 6.70984 6.28347 5.49741 7.06856 4.41969C7.85366 3.34197 8.93833 2.50259 10.3226 1.90156C11.7275 1.30052 13.2977 1 15.0332 1C16.748 1 18.3182 1.36269 19.7437 2.08808C21.1693 2.79275 22.3263 3.75648 23.2147 4.97927C24.1238 6.18135 24.6506 7.50777 24.7952 8.95855H18.5041C18.4008 8.44041 18.1632 7.97409 17.7913 7.55959C17.4401 7.14508 16.9649 6.81347 16.3658 6.56477C15.7873 6.31606 15.1365 6.19171 14.4134 6.19171C13.6696 6.19171 13.0601 6.33679 12.5849 6.62694C12.1304 6.89637 11.9031 7.25907 11.9031 7.71503C11.9031 8.12953 12.0684 8.46114 12.399 8.70985C12.7295 8.95855 13.1531 9.14508 13.6696 9.26943C14.1861 9.39378 14.8989 9.51814 15.8079 9.64249C17.5227 9.91192 18.9483 10.2435 20.0846 10.6373C21.221 11.0104 22.2127 11.7254 23.0597 12.7824C23.9068 13.8187 24.3304 15.3212 24.3304 17.2902C24.3304 18.8031 23.9378 20.1503 23.1527 21.3316C22.3883 22.4922 21.3036 23.3938 19.8987 24.0363C18.5145 24.6788 16.9133 25 15.0951 25Z" fill="#1A1A1A"/>
          <path d="M34.3358 24.6269C32.7242 24.6269 31.2987 24.2642 30.059 23.5389C28.8401 22.7927 27.8897 21.7565 27.2079 20.4301C26.5261 19.1036 26.1852 17.5803 26.1852 15.8601V1.37306H32.0734V15.8601C32.0734 16.5648 32.2181 17.1865 32.5073 17.7254C32.8172 18.2642 33.2408 18.6788 33.7779 18.9689C34.3151 19.2591 34.9142 19.4041 35.5754 19.4041H36.0712C37.1043 19.4041 37.9513 19.0829 38.6125 18.4404C39.2736 17.7979 39.6042 16.9378 39.6042 15.8601V1.37306H45.4924V15.8601C45.4924 17.5803 45.1515 19.1036 44.4697 20.4301C43.7879 21.7565 42.8272 22.7927 41.5876 23.5389C40.3479 24.2642 38.9224 24.6269 37.3109 24.6269H34.3358Z" fill="#1A1A1A"/>
          <path d="M62.8285 12.8135C63.593 13.1658 64.2438 13.601 64.7809 14.1192C65.3181 14.6373 65.7313 15.2176 66.0206 15.8601C66.3098 16.4819 66.4544 17.1554 66.4544 17.8808V24.6269H60.5662V19.4041C60.5662 18.513 60.2976 17.7668 59.7605 17.1658C59.2233 16.544 58.5312 16.2332 57.6841 16.2332H54.0272V24.6269H48.139V1.37306H57.5601C59.3782 1.37306 60.9484 1.67358 62.2707 2.27461C63.6136 2.87565 64.6467 3.73575 65.3698 4.85492C66.0929 5.97409 66.4544 7.29016 66.4544 8.80311C66.4544 9.6943 66.3201 10.5233 66.0516 11.2902C65.783 12.057 65.4008 12.7409 64.9049 13.342C64.4091 13.943 63.8099 14.4508 63.1074 14.8653L62.8285 12.8135ZM57.3742 11.0104C58.0146 11.0104 58.5621 10.9275 59.0167 10.7617C59.4712 10.5959 59.8121 10.3472 60.0394 10.0155C60.2873 9.68394 60.4113 9.27979 60.4113 8.80311C60.4113 8.09845 60.1427 7.55959 59.6055 7.18653C59.089 6.79275 58.3452 6.59585 57.3742 6.59585H54.0272V11.0104H57.3742Z" fill="#1A1A1A"/>
          <path d="M85.0232 6.59585H74.8272V10.2021H84.4034V15.4249H74.8272V24.6269H68.939V1.37306H85.0232V6.59585Z" fill="#1A1A1A"/>
        </svg>
      </div>

      {/* Divider */}
      <div style={{
        width: phase >= 1 ? 40 : 0, height: 2,
        background: "linear-gradient(90deg, #A78BFA, #6366F1)", borderRadius: 100, marginBottom: 16,
        transition: "width 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
      }} />

      {/* Label */}
      <div style={{
        opacity: phase >= 1 ? 1 : 0,
        transform: phase >= 1 ? "translateY(0)" : "translateY(10px)",
        transition: "all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1A1A1A", letterSpacing: 1.5 }}>
          Surf Пропуск
        </div>
        <div style={{ fontSize: 12, color: "#9CA3AF", letterSpacing: 0.5 }}>
          Пропускная система офиса
        </div>
      </div>

      {/* Loading dots */}
      <div style={{
        position: "absolute", bottom: 60, display: "flex", gap: 6,
        opacity: phase >= 1 ? 1 : 0,
        transition: "opacity 0.4s ease 0.3s",
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: "50%", background: "#A78BFA",
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.2; transform: scale(0.8); }
            50% { opacity: 1; transform: scale(1.2); }
          }
        `}</style>
      </div>

      <div style={{
        position: "absolute", bottom: 28,
        opacity: phase >= 1 ? 0.4 : 0,
        transition: "opacity 0.4s ease 0.5s",
        fontSize: 11, color: "#9CA3AF",
      }}>
        by Surf
      </div>
    </div>
  );
}
