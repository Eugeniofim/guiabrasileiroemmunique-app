/* =====================================================
   PRIMEIRA TELA NO ESTILO "LINK NA BIO" (08/10/2026)
   O Mario mostrou uma página de link-na-bio de outra guia e pediu "assim":
   foto grande no topo, nome e bio curta, botão verde de WhatsApp, os
   passeios em cartões que deslizam para o lado, cada um com "Saiba mais".

   Liga com APP_CONFIG.guia.homeEstilo = 'bio'. Sem isso, o app usa a
   primeira tela de sempre (viewHub em app.js) — é só apagar a linha do
   config.js para voltar. Os ids #goTours e #admEntry continuam aqui
   porque o tutorial aponta para eles.
   ===================================================== */
'use strict';

const BIO_TXT = {
  fale:     { pt: 'Fale comigo no WhatsApp', en: 'Chat with me on WhatsApp' },
  passeios: { pt: 'Meus passeios', en: 'My tours' },
  saiba:    { pt: 'Saiba mais', en: 'Learn more' },
  todos:    { pt: 'Ver datas e reservar', en: 'See dates and book' },
  todosSub: { pt: 'Escolha o dia e peça pelo WhatsApp', en: 'Pick a day and ask on WhatsApp' },
  sobre:    { pt: 'Quem sou eu', en: 'Get to know me' },
  sobreSub: { pt: 'Guia oficial de Munique desde 1995', en: 'Official Munich guide since 1995' },
  video:    { pt: 'Conheça o Mario em 30 segundos', en: 'Meet Mario in 30 seconds' },
};
/* o vídeo de apresentação dele (08/10). Só baixa quando a pessoa toca no play. */
const BIO_VIDEO = { src: 'arte/mario-apresentacao.mp4', capa: 'arte/mario-apresentacao.jpg' };
/* o fundo do topo: vista da Marienplatz e da Frauenkirche (Ilia Bronskiy / Unsplash). O vídeo fica só em "Quem sou eu" (08/10). */
const BIO_FUNDO = 'arte/fundo-munique.jpg';
/* a prévia (ou o config) está ligada? O vídeo de "Quem sou eu" segue a mesma chave. */
function bioAtiva() {
  return /[?&]estilo=bio\b/.test(location.search)
    || !!(typeof APP_CONFIG !== 'undefined' && APP_CONFIG.guia && APP_CONFIG.guia.homeEstilo === 'bio');
}
/* as fotos que o Mario mandou (12/10), em "Quem sou eu" */
const BIO_GALERIA = [
  { src: 'arte/galeria-marienplatz.jpg',    pt: 'Marienplatz, Munique',          en: 'Marienplatz, Munich' },
  { src: 'arte/galeria-neuschwanstein.jpg', pt: 'Castelo de Neuschwanstein',     en: 'Neuschwanstein Castle' },
  { src: 'arte/galeria-alpsee.jpg',         pt: 'Lago Alpsee',                   en: 'Lake Alpsee' },
  { src: 'arte/galeria-palacio.jpg',        pt: 'Jardins de um palácio bávaro',  en: 'Gardens of a Bavarian palace' },
];
function bioGaleriaHtml() {
  if (!BIO_GALERIA.length || !bioAtiva()) return '';
  const tit = LANG === 'en' ? 'Moments across Bavaria' : 'Momentos pela Baviera';
  return `<div class="ab-galeria" style="margin:26px 0 8px">
    <h3 style="text-align:center;margin:0 0 12px">${tit}</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${BIO_GALERIA.map(f => `
      <figure style="margin:0;border-radius:16px;overflow:hidden;background:#0002">
        <img src="${f.src}" alt="${esc(LANG === 'en' ? f.en : f.pt)}" loading="lazy" style="display:block;width:100%;aspect-ratio:3/4;object-fit:cover">
        <figcaption style="font-size:.8rem;padding:6px 8px;opacity:.8">${esc(LANG === 'en' ? f.en : f.pt)}</figcaption>
      </figure>`).join('')}</div></div>`;
}
/* o vídeo dentro de "Quem sou eu" (pedido do Eugênio, 08/10) */
function bioVideoHtml() {
  if (!BIO_VIDEO.src || !bioAtiva()) return '';
  return `<div class="ab-video" style="margin:22px auto;max-width:380px;text-align:center">
    <p style="font-weight:600;margin:0 0 10px">▶ ${bioT('video')}</p>
    <video src="${BIO_VIDEO.src}" poster="${BIO_VIDEO.capa}" controls playsinline preload="none"
      style="width:100%;aspect-ratio:9/16;border-radius:18px;background:#000;object-fit:cover;display:block"></video></div>`;
}
const bioT = (k) => (BIO_TXT[k] && (BIO_TXT[k][LANG] || BIO_TXT[k].pt)) || k;

function bioEstilo() {
  if (document.getElementById('bioCss')) return;
  const s = document.createElement('style');
  s.id = 'bioCss';
  s.textContent = `
.bio{min-height:100vh;background:#101216;color:#fff;padding-bottom:40px}
.bio-hero{position:relative;height:56vh;min-height:360px;max-height:560px;background-size:cover;background-position:center 58%}
.bio-hvid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 62%}
.bio-hero::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(16,18,22,.05) 0%,rgba(16,18,22,.25) 45%,#101216 100%)}
.bio-top{position:absolute;top:12px;right:12px;z-index:2}
.bio-hero::after{z-index:1}
.bio-head{position:relative;z-index:2;margin-top:-150px;text-align:center;padding:0 22px}
.bio-face{width:92px;height:92px;border-radius:50%;object-fit:cover;object-position:center 20%;border:3px solid #fff;box-shadow:0 6px 22px rgba(0,0,0,.45)}
.bio-head h1{font-size:1.55rem;line-height:1.2;margin:12px 0 4px;color:#fff}
.bio-head .bio-neg{font-size:.92rem;opacity:.8;margin:0 0 10px}
.bio-head .bio-txt{font-size:.98rem;line-height:1.5;opacity:.92;margin:0 auto;max-width:440px}
.bio-redes{display:flex;justify-content:center;gap:10px;margin:14px 0 4px}
.bio-redes a{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.1);color:#fff}
.bio-redes a svg{width:20px;height:20px}
.bio-btns{padding:18px 16px 0;display:grid;gap:12px;max-width:520px;margin:0 auto}
.bio-wa{display:flex;align-items:center;justify-content:center;gap:10px;background:#25d366;color:#0b2b16;font-weight:700;font-size:1.05rem;border-radius:999px;padding:16px 18px;text-decoration:none;box-shadow:0 6px 18px rgba(37,211,102,.25)}
.bio-wa svg{width:24px;height:24px}
.bio-pill{display:flex;align-items:center;gap:12px;background:#1d2027;color:#fff;border-radius:999px;padding:10px 18px 10px 10px;border:1px solid rgba(255,255,255,.08);text-align:left;width:100%;font:inherit;cursor:pointer}
.bio-pill img,.bio-pill .bio-ic{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none;display:grid;place-items:center;background:rgba(255,255,255,.08);font-size:20px}
.bio-pill b{display:block;font-size:1rem}
.bio-pill small{display:block;opacity:.7;font-size:.82rem}
.bio-pill .bio-go{margin-left:auto;opacity:.6}
.bio-sec{display:flex;align-items:center;justify-content:center;gap:6px;margin:28px 0 12px;font-weight:600;font-size:1.02rem;opacity:.95}
.bio-cards{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding:0 16px 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.bio-cards::-webkit-scrollbar{display:none}
.bio-card{flex:0 0 78%;max-width:320px;scroll-snap-align:center;background:#1d2027;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column}
.bio-card .bio-foto{aspect-ratio:4/3;background-size:cover;background-position:center}
.bio-card .bio-cin{padding:12px 14px 14px;display:flex;flex-direction:column;gap:6px;flex:1}
.bio-card b{font-size:1rem;line-height:1.3}
.bio-card small{opacity:.72;font-size:.84rem;line-height:1.35}
.bio-saiba{margin-top:auto;background:#fff;color:#111;border:0;border-radius:999px;padding:10px 14px;font-weight:700;font:inherit;font-weight:700;cursor:pointer}
.bio .adm-entry{display:block;margin:30px auto 0}
.bio-video{background:#1d2027;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,.06)}
.bio-video p{margin:0;padding:10px 14px;font-weight:600;font-size:.95rem}
.bio-video video{display:block;width:100%;max-height:70vh;background:#000;aspect-ratio:9/16;object-fit:cover}
@media (min-width:760px){.bio-card{flex-basis:300px}.bio-cards{justify-content:center}}
`;
  document.head.appendChild(s);
}

function viewHubBio() {
  bioEstilo();
  const st = DB.settings;
  const txt = (o) => (o && (o[LANG] || o.pt)) || '';
  const redes = [
    st.insta    ? { u: 'https://instagram.com/' + st.insta.replace(/^@/, ''), ic: ICONE_IG, n: 'Instagram' } : null,
    linkExterno(st.youtube)  ? { u: st.youtube,  ic: ICONE_YT,   n: 'YouTube' } : null,
    linkExterno(st.site)     ? { u: st.site,     ic: ICONE_SITE, n: 'Site' } : null,
    linkExterno(st.blog)     ? { u: st.blog,     ic: ICONE_BLOG, n: 'Blog' } : null,
    linkExterno(st.facebook) ? { u: st.facebook, ic: ICONE_FB,   n: 'Facebook' } : null,
  ].filter(Boolean);
  const tours = Tours.live();
  const nomeCompleto = (APP_CONFIG.guia && APP_CONFIG.guia.nomeCompleto) || guiaNome();

  app.innerHTML = `
  <div class="bio">
    <div class="bio-hero" style="background-image:url(${esc(BIO_FUNDO || st.homePhoto || 'home.jpg')})">
      <div class="bio-top">${langBar('right')}</div>
    </div>
    <div class="bio-head">
      <img class="bio-face" id="hubFace" src="${esc(st.photo || 'guia.jpg')}" alt="">
      <h1>${esc(nomeCompleto)}</h1>
      <p class="bio-neg">${esc(st.negocio || '')}</p>
      <p class="bio-txt">${esc(noIdioma(st.homeText) || t('tagline'))}</p>
      ${redes.length ? `<div class="bio-redes">${redes.map(r =>
        `<a href="${esc(r.u)}" target="_blank" rel="noopener" aria-label="${r.n}" title="${r.n}">${r.ic}</a>`).join('')}</div>` : ''}
    </div>
    <div class="bio-btns">
      <a class="bio-wa" href="${waLink(t('waHello'))}" target="_blank" rel="noopener">${ICONE_WA}<span>${bioT('fale')}</span></a>
      <button class="bio-pill" id="goAbout"><img src="${esc(st.photo || 'guia.jpg')}" alt=""><span><b>${bioT('sobre')}</b><small>${bioT('sobreSub')}</small></span><span class="bio-go" aria-hidden="true">→</span></button>
    </div>
    ${tours.length ? `<p class="bio-sec">${bioT('passeios')}</p>
    <div class="bio-cards">${tours.map(x => `
      <div class="bio-card">
        <div class="bio-foto" style="background-image:url(${esc(x.photo || '')})"></div>
        <div class="bio-cin">
          <b>${esc(txt(x.name))}</b>
          ${txt(x.tagline) ? `<small>${esc(txt(x.tagline))}</small>` : ''}
          <button class="bio-saiba" data-tour="${esc(x.id)}">${bioT('saiba')}</button>
        </div>
      </div>`).join('')}
    </div>` : ''}
    <div class="bio-btns">
      <button class="bio-pill" id="goTours"><span class="bio-ic">📅</span><span><b>${bioT('todos')}</b><small>${bioT('todosSub')}</small></span><span class="bio-go" aria-hidden="true">→</span></button>
    </div>
    <button class="adm-entry" id="admEntry">🔒 ${t('admEntry')}</button>
  </div>`;
  bindLang(app);
  app.querySelectorAll('.bio-saiba').forEach(b => { b.onclick = () => go('/tour/' + b.dataset.tour); });
  $('#goTours').onclick = () => { viewShowcase._f = 'all'; go('/tours'); };
  $('#goAbout').onclick = () => go('/about');
  $('#admEntry').onclick = () => go('/adm/today');
  if ($('#hubFace')) fallbackPhoto($('#hubFace'), '☺');
  Coach.start([
    { sel: '.bio-cards, #goTours', txt: { pt: 'Seu cliente começa aqui: os passeios, cada um com datas reais.', en: 'Your guest starts here: your tours, each with live dates.' } },
    { sel: '#admEntry', txt: { pt: 'E esta é a SUA porta, ' + guiaNome() + ' — o painel onde você controla tudo.', en: 'And this is YOUR door, ' + guiaNome() + ' — the panel where you control everything.' } },
  ], 'tutorialClient');
}
