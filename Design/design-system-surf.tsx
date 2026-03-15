import { useState } from "react";

const sections = [
  "Обзор",
  "Цвета",
  "Типографика",
  "Отступы и скругления",
  "Фоны и эффекты",
  "Компоненты",
  "Иконография",
  "Паттерны",
];

// ─── COLOR TOKENS ───
const colors = {
  brand: [
    { name: "Green", token: "green", value: "#7AE05A", desc: "Основной акцент, CTA, статус «активен»" },
    { name: "Green Dark", token: "greenDark", value: "#4DB830", desc: "Текст на зелёном фоне, hover-состояния" },
    { name: "Yellow-Green", token: "yellow", value: "#D4F060", desc: "Вторичный акцент, бейджи, декор" },
    { name: "Lilac-Pink", token: "pink", value: "#E8C8F0", desc: "Декоративные блобы, фоновые градиенты" },
  ],
  neutrals: [
    { name: "Black", token: "black", value: "#1A1A1A", desc: "Заголовки, основной текст, тёмные карточки" },
    { name: "Text Primary", token: "text", value: "#1A1A1A", desc: "Основной текст" },
    { name: "Text Secondary", token: "textSub", value: "#6B7280", desc: "Подписи, вторичный текст" },
    { name: "Text Muted", token: "textMuted", value: "#9CA3AF", desc: "Плейсхолдеры, метаинформация" },
    { name: "Background", token: "bg", value: "#FFFFFF", desc: "Фон страницы" },
    { name: "Border", token: "border", value: "rgba(0,0,0,0.07)", desc: "Границы карточек и разделители" },
  ],
  semantic: [
    { name: "Present / Success", token: "—", value: "rgba(122,224,90,0.15)", desc: "Фон для статуса «в офисе / успех»" },
    { name: "Error", token: "—", value: "#EF4444", desc: "Ошибки, кнопка выхода" },
    { name: "Error bg", token: "—", value: "rgba(239,68,68,0.06)", desc: "Фон для деструктивных действий" },
  ],
  departments: [
    { name: "iOS", bg: "rgba(122,224,90,0.12)", text: "#3A9E20" },
    { name: "Android", bg: "rgba(212,240,96,0.18)", text: "#6B8A00" },
    { name: "Backend", bg: "rgba(0,0,0,0.06)", text: "#444" },
    { name: "Design", bg: "rgba(232,180,240,0.25)", text: "#8B3FAB" },
    { name: "QA", bg: "rgba(240,180,255,0.2)", text: "#7A35A0" },
    { name: "PM", bg: "rgba(122,224,90,0.08)", text: "#2E7D32" },
  ],
};

const typo = [
  { name: "Display", size: "64px", weight: 700, lh: "1", ls: "-2px", use: "Часы на терминале" },
  { name: "H1", size: "30px", weight: 700, lh: "1.2", ls: "0", use: "Крупные числа в stat-картах" },
  { name: "H2", size: "22px", weight: 700, lh: "1.3", ls: "0", use: "Имя в профиле, заголовки секций" },
  { name: "H3", size: "20px", weight: 700, lh: "1.4", ls: "0.3px", use: "Заголовки страниц, брендинг" },
  { name: "H4", size: "17px", weight: 700, lh: "1.4", ls: "0", use: "Заголовки карточек" },
  { name: "Body", size: "14-16px", weight: "400-600", lh: "1.5", ls: "0", use: "Основной текст, кнопки" },
  { name: "Caption", size: "12-13px", weight: 400, lh: "1.5", ls: "0", use: "Подписи, метки, бейджи" },
  { name: "Micro", size: "10-11px", weight: "400-700", lh: "1.4", ls: "0.1px", use: "Tab bar, мелкие метки, версия" },
];

const radii = [
  { token: "pill", value: "100px", use: "Бейджи, пилюли, переключатели" },
  { token: "card-lg", value: "24-28px", use: "Модальные карточки, QR-контейнер" },
  { token: "card", value: "16-20px", use: "Карточки контента, stat-карты" },
  { token: "input", value: "12-14px", use: "Инпуты, кнопки, алерты" },
  { token: "avatar", value: "50%", use: "Аватары, индикаторы" },
  { token: "bar", value: "100px", use: "Прогресс-бары" },
];

const SurfWordmark = ({ color = "#1A1A1A", w = 56 }) => (
  <svg width={w} height={w * 0.286} viewBox="0 0 91 26" fill="none">
    <path d="M15.0951 25C13.339 25 11.6965 24.6269 10.1676 23.8808C8.65942 23.114 7.43012 22.0363 6.47974 20.6477C5.55002 19.2383 5.0645 17.6321 5.02318 15.829H11.0974C11.18 16.5751 11.4176 17.2383 11.8101 17.8187C12.2233 18.3782 12.7502 18.8238 13.3907 19.1554C14.0311 19.4663 14.7439 19.6218 15.529 19.6218C16.0042 19.6218 16.4484 19.5389 16.8616 19.3731C17.2955 19.2073 17.6467 18.9793 17.9153 18.6891C18.1839 18.399 18.3182 18.0777 18.3182 17.7254C18.3182 17.1658 18.1322 16.7306 17.7603 16.4197C17.3885 16.0881 16.9133 15.8497 16.3348 15.7047C15.7563 15.5596 14.9505 15.4041 13.9175 15.2383C12.244 14.9689 10.8701 14.6477 9.79574 14.2746C8.74206 13.9016 7.82267 13.228 7.03757 12.2539C6.27314 11.2798 5.89092 9.88083 5.89092 8.05699C5.89092 6.70984 6.28347 5.49741 7.06856 4.41969C7.85366 3.34197 8.93833 2.50259 10.3226 1.90156C11.7275 1.30052 13.2977 1 15.0332 1C16.748 1 18.3182 1.36269 19.7437 2.08808C21.1693 2.79275 22.3263 3.75648 23.2147 4.97927C24.1238 6.18135 24.6506 7.50777 24.7952 8.95855H18.5041C18.4008 8.44041 18.1632 7.97409 17.7913 7.55959C17.4401 7.14508 16.9649 6.81347 16.3658 6.56477C15.7873 6.31606 15.1365 6.19171 14.4134 6.19171C13.6696 6.19171 13.0601 6.33679 12.5849 6.62694C12.1304 6.89637 11.9031 7.25907 11.9031 7.71503C11.9031 8.12953 12.0684 8.46114 12.399 8.70985C12.7295 8.95855 13.1531 9.14508 13.6696 9.26943C14.1861 9.39378 14.8989 9.51814 15.8079 9.64249C17.5227 9.91192 18.9483 10.2435 20.0846 10.6373C21.221 11.0104 22.2127 11.7254 23.0597 12.7824C23.9068 13.8187 24.3304 15.3212 24.3304 17.2902C24.3304 18.8031 23.9378 20.1503 23.1527 21.3316C22.3883 22.4922 21.3036 23.3938 19.8987 24.0363C18.5145 24.6788 16.9133 25 15.0951 25Z" fill={color}/>
    <path d="M34.3358 24.6269C32.7242 24.6269 31.2987 24.2642 30.059 23.5389C28.8401 22.7927 27.8897 21.7565 27.2079 20.4301C26.5261 19.1036 26.1852 17.5803 26.1852 15.8601V1.37306H32.0734V15.8601C32.0734 16.5648 32.2181 17.1865 32.5073 17.7254C32.8172 18.2642 33.2408 18.6788 33.7779 18.9689C34.3151 19.2591 34.9142 19.4041 35.5754 19.4041H36.0712C37.1043 19.4041 37.9513 19.0829 38.6125 18.4404C39.2736 17.7979 39.6042 16.9378 39.6042 15.8601V1.37306H45.4924V15.8601C45.4924 17.5803 45.1515 19.1036 44.4697 20.4301C43.7879 21.7565 42.8272 22.7927 41.5876 23.5389C40.3479 24.2642 38.9224 24.6269 37.3109 24.6269H34.3358Z" fill={color}/>
    <path d="M62.8285 12.8135C63.593 13.1658 64.2438 13.601 64.7809 14.1192C65.3181 14.6373 65.7313 15.2176 66.0206 15.8601C66.3098 16.4819 66.4544 17.1554 66.4544 17.8808V24.6269H60.5662V19.4041C60.5662 18.513 60.2976 17.7668 59.7605 17.1658C59.2233 16.544 58.5312 16.2332 57.6841 16.2332H54.0272V24.6269H48.139V1.37306H57.5601C59.3782 1.37306 60.9484 1.67358 62.2707 2.27461C63.6136 2.87565 64.6467 3.73575 65.3698 4.85492C66.0929 5.97409 66.4544 7.29016 66.4544 8.80311C66.4544 9.6943 66.3201 10.5233 66.0516 11.2902C65.783 12.057 65.4008 12.7409 64.9049 13.342C64.4091 13.943 63.8099 14.4508 63.1074 14.8653L62.8285 12.8135ZM57.3742 11.0104C58.0146 11.0104 58.5621 10.9275 59.0167 10.7617C59.4712 10.5959 59.8121 10.3472 60.0394 10.0155C60.2873 9.68394 60.4113 9.27979 60.4113 8.80311C60.4113 8.09845 60.1427 7.55959 59.6055 7.18653C59.089 6.79275 58.3452 6.59585 57.3742 6.59585H54.0272V11.0104H57.3742Z" fill={color}/>
    <path d="M85.0232 6.59585H74.8272V10.2021H84.4034V15.4249H74.8272V24.6269H68.939V1.37306H85.0232V6.59585Z" fill={color}/>
  </svg>
);

// ─── SWATCH ───
const Swatch = ({ value, name, desc, token, dark }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
    <div style={{ width: 44, height: 44, borderRadius: 10, background: value, border: "1px solid rgba(0,0,0,0.08)", flexShrink: 0 }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>{name}</span>
        {token && <code style={{ fontSize: 11, color: "#7A35A0", background: "rgba(240,180,255,0.15)", padding: "1px 6px", borderRadius: 4 }}>{token}</code>}
      </div>
      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{desc}</div>
    </div>
    <code style={{ fontSize: 12, color: "#9CA3AF", flexShrink: 0, fontFamily: "monospace" }}>{value}</code>
  </div>
);

export default function DesignSystem() {
  const [active, setActive] = useState(0);
  const sec = sections[active];

  const nav = (
    <div style={{ width: 200, borderRight: "1px solid rgba(0,0,0,0.07)", padding: "20px 0", flexShrink: 0, background: "rgba(255,255,255,0.9)", backdropFilter: "blur(20px)" }}>
      <div style={{ padding: "0 16px 16px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(0,0,0,0.07)", marginBottom: 8, paddingBottom: 16 }}>
        <SurfWordmark color="#1A1A1A" w={48} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1A1A" }}>Design System</div>
          <div style={{ fontSize: 10, color: "#9CA3AF" }}>v1.0</div>
        </div>
      </div>
      {sections.map((s, i) => (
        <button key={s} onClick={() => setActive(i)} style={{
          display: "block", width: "100%", textAlign: "left", padding: "9px 16px", border: "none",
          background: i === active ? "rgba(122,224,90,0.12)" : "transparent",
          color: i === active ? "#1A1A1A" : "#6B7280",
          fontWeight: i === active ? 600 : 400, fontSize: 13, cursor: "pointer",
          borderLeft: i === active ? "3px solid #7AE05A" : "3px solid transparent",
          transition: "all 0.15s",
        }}>{s}</button>
      ))}
    </div>
  );

  const renderContent = () => {
    if (sec === "Обзор") return (
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", marginBottom: 8 }}>Surf Design System</h2>
        <p style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.7, marginBottom: 24 }}>
          Единая дизайн-система Surf для веб- и мобильных приложений. Основана на визуальном языке <strong>surf.ru</strong> — органические градиенты, живой зелёный акцент, glassmorphism и чистая типографика.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
          {[
            { title: "Светлая основа", desc: "Белый фон (#FFFFFF) с полупрозрачными карточками и glassmorphism" },
            { title: "Органические блобы", desc: "Lilac-pink и green градиентные сферы с blur(60-80px) на фоне" },
            { title: "Живой зелёный", desc: "#7AE05A как основной акцент — CTA, статусы, навигация" },
            { title: "Минимальный контраст", desc: "Чёрный текст (#1A1A1A) на белом, тонкие rgba-границы" },
          ].map((c, i) => (
            <div key={i} style={{ padding: 16, borderRadius: 16, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A", marginBottom: 4 }}>{c.title}</div>
              <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.6 }}>{c.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: 16, borderRadius: 16, background: "#1A1A1A", color: "white" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Шрифтовой стек</div>
          <code style={{ fontSize: 13, color: "#7AE05A" }}>-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif</code>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 8 }}>Используется системный шрифт на всех платформах. Для чисел — fontVariantNumeric: "tabular-nums".</div>
        </div>
      </div>
    );

    if (sec === "Цвета") return (
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", marginBottom: 20 }}>Цветовые токены</h2>

        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A", marginBottom: 8, marginTop: 0 }}>Бренд</h3>
        {colors.brand.map(c => <Swatch key={c.token} {...c} />)}

        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A", marginBottom: 8, marginTop: 20 }}>Нейтральные</h3>
        {colors.neutrals.map(c => <Swatch key={c.token} {...c} />)}

        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A", marginBottom: 8, marginTop: 20 }}>Семантические</h3>
        {colors.semantic.map((c, i) => <Swatch key={i} name={c.name} value={c.value} desc={c.desc} />)}

        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A", marginBottom: 12, marginTop: 20 }}>Палитра отделов</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {colors.departments.map(d => (
            <span key={d.name} style={{ padding: "5px 14px", borderRadius: 100, background: d.bg, color: d.text, fontSize: 13, fontWeight: 600 }}>{d.name}</span>
          ))}
        </div>
      </div>
    );

    if (sec === "Типографика") return (
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", marginBottom: 20 }}>Типографика</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {typo.map(t => (
            <div key={t.name} style={{ display: "flex", alignItems: "baseline", gap: 16, padding: "14px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
              <div style={{ width: 80, flexShrink: 0 }}>
                <code style={{ fontSize: 11, color: "#7A35A0", background: "rgba(240,180,255,0.15)", padding: "2px 6px", borderRadius: 4 }}>{t.name}</code>
              </div>
              <div style={{ fontSize: t.name === "Display" ? 32 : t.name === "H1" ? 24 : t.name === "H2" ? 20 : t.name === "H3" ? 18 : t.name === "H4" ? 16 : t.name === "Body" ? 14 : t.name === "Caption" ? 12 : 11, fontWeight: typeof t.weight === "string" ? 600 : t.weight, color: "#1A1A1A", flex: 1 }}>
                Пример текста
              </div>
              <div style={{ flexShrink: 0, textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "#6B7280" }}>{t.size} / {String(t.weight)}</div>
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>{t.use}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    if (sec === "Отступы и скругления") return (
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", marginBottom: 20 }}>Отступы и скругления</h2>

        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A", marginBottom: 12 }}>Border Radius</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {radii.map(r => (
            <div key={r.token} style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
              <div style={{ width: 44, height: 44, borderRadius: r.token === "pill" ? 100 : r.token === "avatar" ? "50%" : parseInt(r.value), background: "rgba(122,224,90,0.2)", border: "2px solid #7AE05A", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <code style={{ fontSize: 12, color: "#7A35A0", fontWeight: 600 }}>{r.token}</code>
                <span style={{ fontSize: 12, color: "#9CA3AF", marginLeft: 8 }}>{r.value}</span>
              </div>
              <div style={{ fontSize: 12, color: "#6B7280" }}>{r.use}</div>
            </div>
          ))}
        </div>

        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A", marginBottom: 12, marginTop: 24 }}>Отступы (Spacing)</h3>
        <div style={{ padding: 16, borderRadius: 16, background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.07)" }}>
          {[
            { token: "xs", val: "4-6px", use: "Между мелкими элементами (gap в dots, бейджах)" },
            { token: "sm", val: "8-10px", use: "Gap между карточками, внутренние отступы элементов" },
            { token: "md", val: "12-16px", use: "Padding карточек, секционные отступы" },
            { token: "lg", val: "20-24px", use: "Padding страниц, основные отступы контента" },
            { token: "xl", val: "28-36px", use: "Отступы между крупными секциями" },
            { token: "2xl", val: "40-60px", use: "Вертикальные отступы на splash/login" },
          ].map(s => (
            <div key={s.token} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
              <code style={{ fontSize: 12, color: "#7A35A0", width: 40, flexShrink: 0 }}>{s.token}</code>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A", width: 70, flexShrink: 0 }}>{s.val}</span>
              <span style={{ fontSize: 12, color: "#6B7280" }}>{s.use}</span>
            </div>
          ))}
        </div>
      </div>
    );

    if (sec === "Фоны и эффекты") return (
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", marginBottom: 20 }}>Фоны и эффекты</h2>

        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Gradient Blobs</h3>
        <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.7, marginBottom: 16, marginTop: 0 }}>
          Фоновые декоративные элементы — крупные полупрозрачные сферы с radial-gradient и blur. Зафиксированы через position: fixed, pointerEvents: none. Три базовых цвета блобов:
        </p>
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Lilac-Pink", grad: "radial-gradient(circle, rgba(232,180,240,0.45) 0%, transparent 70%)", pos: "top-left" },
            { label: "Green", grad: "radial-gradient(circle, rgba(100,220,60,0.4) 0%, transparent 70%)", pos: "bottom-right" },
            { label: "Yellow", grad: "radial-gradient(circle, rgba(212,240,96,0.25) 0%, transparent 70%)", pos: "accent" },
          ].map(b => (
            <div key={b.label} style={{ flex: 1, aspectRatio: "1", borderRadius: 20, background: b.grad, display: "flex", alignItems: "flex-end", padding: 12, border: "1px solid rgba(0,0,0,0.05)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A" }}>{b.label}</div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>{b.pos}</div>
              </div>
            </div>
          ))}
        </div>

        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Glassmorphism</h3>
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1, padding: 20, borderRadius: 20, background: "rgba(255,255,255,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 4px 40px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A", marginBottom: 4 }}>Card</div>
            <code style={{ fontSize: 11, color: "#6B7280", display: "block", lineHeight: 1.8 }}>
              background: rgba(255,255,255,0.8)<br/>
              backdropFilter: blur(20px)<br/>
              border: 1px solid rgba(0,0,0,0.07)<br/>
              boxShadow: 0 4px 40px rgba(0,0,0,0.06)
            </code>
          </div>
          <div style={{ flex: 1, padding: 20, borderRadius: 20, background: "rgba(255,255,255,0.88)", backdropFilter: "blur(20px)", border: "1px solid rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A", marginBottom: 4 }}>Header / Nav</div>
            <code style={{ fontSize: 11, color: "#6B7280", display: "block", lineHeight: 1.8 }}>
              background: rgba(255,255,255,0.85-0.88)<br/>
              backdropFilter: blur(20px)<br/>
              border-bottom: 1px solid rgba(0,0,0,0.07)<br/>
              position: sticky
            </code>
          </div>
        </div>

        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Анимации</h3>
        <div style={{ padding: 16, borderRadius: 16, background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.07)" }}>
          {[
            { name: "fade-in + slide-up", val: "opacity 0→1, translateY(10-20px→0)", timing: "0.6-0.8s cubic-bezier(0.16, 1, 0.3, 1)" },
            { name: "pulse (dots)", val: "opacity 0.2↔1, scale 0.8↔1.2", timing: "1.2s ease-in-out infinite, delay: i*0.2s" },
            { name: "spin (loader)", val: "rotate(0→360deg)", timing: "0.8s linear infinite" },
            { name: "scan-line", val: "top: 0 → 100% → 0", timing: "1.2s ease-in-out infinite" },
            { name: "divider expand", val: "width: 0 → 40px", timing: "0.6s cubic-bezier(0.16, 1, 0.3, 1)" },
          ].map(a => (
            <div key={a.name} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
              <code style={{ fontSize: 12, color: "#7A35A0", width: 130, flexShrink: 0, fontWeight: 600 }}>{a.name}</code>
              <span style={{ fontSize: 12, color: "#1A1A1A", flex: 1 }}>{a.val}</span>
              <span style={{ fontSize: 11, color: "#9CA3AF", flexShrink: 0 }}>{a.timing}</span>
            </div>
          ))}
        </div>
      </div>
    );

    if (sec === "Компоненты") return (
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", marginBottom: 20 }}>Компоненты</h2>

        {/* Button Primary */}
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Кнопки</h3>
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <button style={{ padding: "14px 28px", borderRadius: 18, border: "none", background: "#7AE05A", color: "#1A1A1A", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 20px rgba(122,224,90,0.4)" }}>Primary (Green)</button>
          <button style={{ padding: "14px 28px", borderRadius: 18, border: "none", background: "#1A1A1A", color: "white", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>Primary (Dark)</button>
          <button style={{ padding: "13px 20px", borderRadius: 14, border: "1px solid #DADCE0", background: "white", color: "#3C4043", fontSize: 15, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Google Login
          </button>
          <button style={{ padding: "14px 28px", borderRadius: 14, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)", color: "#EF4444", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Destructive</button>
        </div>

        {/* Chips */}
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Chips / Переключатели</h3>
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          <button style={{ padding: "7px 18px", borderRadius: 100, border: "none", fontSize: 13, background: "#1A1A1A", color: "white", fontWeight: 600 }}>Активный</button>
          <button style={{ padding: "7px 18px", borderRadius: 100, border: "1px solid rgba(0,0,0,0.1)", fontSize: 13, background: "rgba(255,255,255,0.8)", color: "#6B7280", fontWeight: 400 }}>Неактивный</button>
          <span style={{ padding: "5px 14px", borderRadius: 100, background: "rgba(122,224,90,0.12)", color: "#3A9E20", fontSize: 13, fontWeight: 600 }}>iOS</span>
          <span style={{ padding: "5px 14px", borderRadius: 100, background: "rgba(232,180,240,0.25)", color: "#8B3FAB", fontSize: 13, fontWeight: 600 }}>Design</span>
        </div>

        {/* Status card */}
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Status Banner</h3>
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, padding: "14px 18px", borderRadius: 18, background: "rgba(122,224,90,0.12)", border: "1px solid rgba(78,184,48,0.3)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, color: "#4DB830", fontWeight: 600 }}>Вы в офисе</div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>С 09:15 · 3ч 42м</div>
            </div>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#7AE05A", boxShadow: "0 0 10px #7AE05A" }} />
          </div>
          <div style={{ flex: 1, padding: "14px 18px", borderRadius: 18, background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 14, color: "#6B7280", fontWeight: 600 }}>Вы не в офисе</div>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#D1D5DB" }} />
          </div>
        </div>

        {/* Stat Card */}
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Stat Card</h3>
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          {[
            { icon: "◷", value: "8ч 15м", label: "Среднее / день", bg: "rgba(0,0,0,0.04)" },
            { icon: "∑", value: "41ч", label: "Всего часов", bg: "rgba(122,224,90,0.12)" },
          ].map((s, i) => (
            <div key={i} style={{ padding: 16, borderRadius: 18, background: s.bg, border: "1px solid rgba(0,0,0,0.05)", flex: 1 }}>
              <div style={{ fontSize: 18, marginBottom: 6 }}>{s.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#1A1A1A" }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Avatar */}
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Аватары</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
          {[
            { size: 72, fs: 26, bg: "rgba(255,255,255,0.1)", border: "2px solid rgba(122,224,90,0.4)", color: "white", outer: "#1A1A1A" },
            { size: 40, fs: 13, bg: "#7AE05A", color: "#1A1A1A" },
            { size: 34, fs: 12, bg: "#7AE05A", color: "#1A1A1A" },
            { size: 26, fs: 10, bg: "#7AE05A", color: "#1A1A1A" },
          ].map((a, i) => (
            <div key={i} style={{ width: a.size, height: a.size, borderRadius: "50%", background: a.outer || a.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: a.outer ? a.size - 8 : a.size, height: a.outer ? a.size - 8 : a.size, borderRadius: "50%", background: a.outer ? a.bg : a.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: a.fs, fontWeight: 700, color: a.color, border: a.border || "none" }}>ДК</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Progress Bar</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {[85, 55, 20].map(p => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, height: 5, background: "rgba(0,0,0,0.06)", borderRadius: 100, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 100, width: `${p}%`, background: p >= 80 ? "linear-gradient(90deg, #4DB830, #7AE05A)" : "linear-gradient(90deg, #888, #AAA)" }} />
              </div>
              <span style={{ fontSize: 12, color: "#6B7280", width: 32 }}>{p}%</span>
            </div>
          ))}
        </div>

        {/* Dark Hero Card */}
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Dark Hero Card</h3>
        <div style={{ padding: 24, borderRadius: 24, background: "#1A1A1A", color: "white", position: "relative", overflow: "hidden", marginBottom: 20 }}>
          <div style={{ position: "absolute", top: -30, right: -20, width: 100, height: 100, borderRadius: "50%", background: "radial-gradient(circle, rgba(122,224,90,0.25) 0%, transparent 70%)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#7AE05A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "#1A1A1A" }}>ДК</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>Дмитрий Козлов</div>
              <div style={{ fontSize: 14, opacity: 0.5 }}>Senior Developer</div>
              <span style={{ display: "inline-block", marginTop: 6, fontSize: 12, padding: "3px 10px", borderRadius: 100, background: "#7AE05A", color: "#1A1A1A", fontWeight: 600 }}>Backend</span>
            </div>
          </div>
        </div>
      </div>
    );

    if (sec === "Иконография") return (
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", marginBottom: 8 }}>Иконография</h2>
        <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.7, marginBottom: 20, marginTop: 0 }}>
          Иконки — inline SVG, stroke-based, strokeWidth 1.8. Размер 18-22px. Цвет переключается между #1A1A1A (активная) и #9CA3AF (неактивная). Для эмодзи-иконок используются Unicode-символы в квадратных плашках 32×32 с borderRadius: 10.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { label: "QR-код", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg> },
            { label: "История", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg> },
            { label: "Профиль", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> },
            { label: "Обзор", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg> },
            { label: "Группа", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="1.8"><circle cx="9" cy="7" r="4"/><path d="M2 21c0-4 3.1-7 7-7s7 3 7 7"/><circle cx="19" cy="9" r="3"/></svg> },
            { label: "Журнал", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/></svg> },
            { label: "Отчёты", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="1.8"><rect x="4" y="14" width="4" height="7" rx="1"/><rect x="10" y="9" width="4" height="12" rx="1"/><rect x="16" y="4" width="4" height="17" rx="1"/></svg> },
            { label: "Сканер", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="1.2"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg> },
          ].map(ic => (
            <div key={ic.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 14, borderRadius: 14, background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.05)" }}>
              {ic.icon}
              <span style={{ fontSize: 11, color: "#6B7280" }}>{ic.label}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "rgba(122,224,90,0.08)", border: "1px solid rgba(122,224,90,0.2)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4DB830", marginBottom: 4 }}>Emoji-иконки</div>
          <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.6 }}>
            Для информационных полей профиля используются Unicode emoji (✉ ☎ 🏢 💼 📅 ⚙ ❓ 🔔) внутри контейнера 32×32, border-radius: 10, background: rgba(0,0,0,0.04).
          </div>
        </div>
      </div>
    );

    if (sec === "Паттерны") return (
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", marginBottom: 20 }}>Паттерны использования</h2>

        {[
          {
            title: "Layout: Mobile App",
            code: `• Фон: #FFFFFF + Blobs (position: fixed)
• Header: sticky, rgba(255,255,255,0.85), backdropFilter: blur(20px)
• Content: padding 20px, z-index: 1
• Tab Bar: fixed bottom, rgba(255,255,255,0.88), blur(20px)
• Max-width: 430px, margin: 0 auto`
          },
          {
            title: "Layout: Desktop Admin",
            code: `• Sidebar: 210px (collapsed: 56px), sticky
• Header: flex, space-between, sticky top
• Content: flex: 1, overflow: auto, padding: 24px
• Blobs: position: fixed, z-index: 0
• Content: position: relative, z-index: 1`
          },
          {
            title: "Layout: Terminal / Kiosk",
            code: `• Centered single-column, max-width: 480px
• Крупные часы (64px) как фокусная точка
• Scanner zone: aspect-ratio 1, borderRadius: 32
• Минимум элементов, максимум whitespace`
          },
          {
            title: "Login Screen",
            code: `• Центрирование: flex column, align + justify center
• Wordmark → Divider (green, 28px) → Title → Subtitle
• Карточка: max-width 360-400px, borderRadius: 24
• Google OAuth кнопка: border #DADCE0, Google icon
• Info-блок: background rgba(122,224,90,0.1), border rgba(122,224,90,0.25)
• Footer: version + support link, fontSize: 11, #9CA3AF`
          },
          {
            title: "Splash → Content Transition",
            code: `• Phase 0: Logo fade-in (scale 0.9→1, translateY 20→0)
• Phase 1 (+800ms): Divider expand (width 0→40), label fade-in
• Phase 2 (+2400ms): Entire screen opacity → 0
• Easing: cubic-bezier(0.16, 1, 0.3, 1)`
          },
          {
            title: "Бренд-блок (Header)",
            code: `<SurfWordmark />           // SVG логотип
<div width=28 bg=green />  // Зелёный divider
<span>Surf Пропуск</span>  // 20px, weight: 700
<span>Подзаголовок</span>  // 13px, color: textMuted`
          },
        ].map((p, i) => (
          <div key={i} style={{ marginBottom: 16, padding: 16, borderRadius: 16, background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1A1A", marginBottom: 8 }}>{p.title}</div>
            <pre style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{p.code}</pre>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#FAFAFA", overflow: "hidden" }}>
      {nav}
      <div style={{ flex: 1, overflow: "auto", padding: 32 }}>
        <div style={{ maxWidth: 720 }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
