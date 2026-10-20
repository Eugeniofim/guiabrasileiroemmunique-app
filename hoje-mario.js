/* =====================================================
   HOJE DO MARIO — o painel de entrada no padrão da Freddy (14/10/2026)

   Pedido do Eugênio: "deixa o hoje igual ao freddy", só com o básico —
   sem atendimento, marketing, agência nem e-mails. Ficou:
   - Boas-vindas (uma vez por aparelho): os três primeiros toques;
   - 💷 Quem pagou: reservas com pagamento dos últimos 7 dias;
   - 🔔 Amanhã — lembretes de véspera, com a mensagem pronta no WhatsApp;
   - Próximos tours (14 dias), cada um com o lembrete de 1 toque.
   Carregado depois do app.js: embrulha o admToday, não reescreve.
   ===================================================== */
'use strict';

const HJ_BV_CHAVE = String(typeof DB_KEY !== 'undefined' ? DB_KEY : 'mario_db_v1').replace(/_db_v\d+$/, '') + '_boasvindas';
const hjDt = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const hjNome1 = (n) => String(n || '').trim().split(' ')[0];
const hjTour = (b) => Tours.get(b.tourId) || { name: { pt: '' }, meeting: '' };
const hjTl = (o) => (o && (o[LANG] || o.pt)) || '';

function hjMsgLembrete(b) {
  const x = hjTour(b);
  const falta = Bookings.due(b);
  return `Olá, ${hjNome1(b.name)}! Aqui é o ${guiaNome()}, seu guia em Munique 😊\n\n`
    + `Amanhã é o nosso passeio: ${hjTl(x.name)}!\n🕘 ${b.time}\n📍 ${noIdioma(x.meeting)}\n`
    + (falta > 0 ? `💶 Restante a pagar no dia: ${eur(falta)}\n` : '')
    + `\nQualquer coisa, é só me chamar aqui. Até amanhã!`;
}
function hjWa(b) { return waLink(hjMsgLembrete(b), String(b.whats || '').replace(/\D/g, '')); }

const _admTodayMario = admToday;
admToday = function () {
  _admTodayMario();
  const stage = document.getElementById('stage'); if (!stage) return;
  const hoje = isoToday(), amanha = addDays(hoje, 1), semana = addDays(hoje, -7);
  const conf = DB.bookings.filter(b => b.status === 'confirmed');
  const pagos = conf.filter(b => Bookings.paid(b) > 0 && String(b.createdAt || '').slice(0, 10) >= semana);
  const lembretes = conf.filter(b => b.date === amanha);
  const proximas = conf.filter(b => b.date > amanha && b.date <= addDays(hoje, 14)).sort((a, b) => a.date.localeCompare(b.date));
  const item = (ic, tit, sub, acao) => `<div class="hjItem"><span class="hjIc">${ic}</span><div><b>${tit}</b>${sub ? `<small>${sub}</small>` : ''}</div>${acao || ''}</div>`;
  const blocos = [];
  if (pagos.length) blocos.push(`<section class="card hj"><h3>💷 Quem pagou <span class="pill warn">${pagos.length}</span></h3>
    ${pagos.slice(0, 6).map(b => item('🗓', esc(b.name), `${esc(hjTl(hjTour(b).name))} · ${hjDt(b.date)} · ${b.pax} ${t('people')} · ${eur(Bookings.paid(b))}`,
      `<button class="mini" data-ir="/adm/bookings">Ver</button>`)).join('')}</section>`);
  blocos.push(`<section class="card hj"><h3>🔔 Amanhã — lembretes de véspera</h3>
    ${lembretes.length ? '' : '<p class="empty">Nenhum tour amanhã.</p>'}
    ${lembretes.map(b => item('🗓', esc(b.name) + ' · ' + esc(hjTl(hjTour(b).name)), esc(b.time) + ' · ' + b.pax + ' ' + t('people'),
      `<a class="mini" target="_blank" rel="noopener" href="${esc(hjWa(b))}">Mandar lembrete</a>`)).join('')}
    ${proximas.length ? `<p class="rotMini">Próximos tours</p>${proximas.slice(0, 4).map(b => item('📅', hjDt(b.date) + ' · ' + esc(hjNome1(b.name)),
      esc(hjTl(hjTour(b).name)) + ' · ' + esc(b.time),
      `<a class="mini" target="_blank" rel="noopener" href="${esc(hjWa(b))}">Lembrete</a>`)).join('')}` : ''}
    <p class="why">A mensagem já vem pronta, com horário, ponto de encontro e o que falta pagar. Um toque abre o WhatsApp com ela escrita.</p></section>`);
  const h1 = stage.querySelector('.pageh');
  const html = `<div class="hjGrade">${blocos.join('')}</div>`;
  if (h1) h1.insertAdjacentHTML('afterend', html); else stage.insertAdjacentHTML('afterbegin', html);
  stage.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => go(b.dataset.ir));
  hjBoasVindas(stage);
};

function hjBoasVindas(stage) {
  try { if (localStorage.getItem(HJ_BV_CHAVE) === '1') return; } catch (e) { return; }
  if (stage.querySelector('#bvCard')) return;
  const nome = hjNome1(guiaNome());
  const html = `<section class="card bvCard" id="bvCard">
    <button class="bvX" id="bvX" aria-label="Fechar">×</button>
    <h2 class="bvTit">Bem-vindo ao seu app, ${esc(nome)}!</h2>
    <p class="bvSub">Aqui é o seu lado — o painel onde você comanda tudo. É só seu: os seus clientes, as suas reservas e os seus passeios moram aqui. Dê uma volta à vontade; nada quebra.</p>
    <div class="bvPassos">
      <a class="bvP" href="#/adm/tours"><span class="bvN">1</span><span><b>Veja os seus passeios</b><small>Os seus 3 passeios já estão aqui. Toque para ajustar fotos, textos e horários.</small></span></a>
      <a class="bvP" href="#/adm/bookings"><span class="bvN">2</span><span><b>Lance uma reserva</b><small>Fechou pelo WhatsApp? Lance aqui e ela entra na agenda e no extrato.</small></span></a>
      <a class="bvP" href="#/" target="_blank" rel="noopener"><span class="bvN">3</span><span><b>Veja o que o cliente vê</b><small>Abre a primeira tela do app, do jeito que o seu cliente abre.</small></span></a>
    </div>
    <button class="cta bvOk" id="bvOk">Vamos começar ✨</button>
  </section>`;
  const h1 = stage.querySelector('.pageh');
  if (h1) h1.insertAdjacentHTML('beforebegin', html); else stage.insertAdjacentHTML('afterbegin', html);
  const fechar = () => { try { localStorage.setItem(HJ_BV_CHAVE, '1'); } catch (e) {} const c = document.getElementById('bvCard'); if (c) c.remove(); };
  document.getElementById('bvOk').onclick = fechar;
  document.getElementById('bvX').onclick = fechar;
}

/* o visual do Hoje da Freddy (carol.css), com as cores do Mario */
(function hjEstilo() {
  if (document.getElementById('hjCss')) return;
  const s = document.createElement('style');
  s.id = 'hjCss';
  s.textContent = `
.rotMini{margin:12px 0 6px;font:600 var(--fs-1)/1 var(--f-ui);letter-spacing:var(--track-label);text-transform:uppercase;color:var(--ink-3)}
.hjGrade{display:grid;gap:12px;margin:10px 0 16px}
@media (min-width:980px){.hjGrade{grid-template-columns:1fr 1fr}}
.card.hj h3{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.hjItem{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.hjItem:first-of-type{border-top:0}
.hjItem > div{flex:1;min-width:0}
.hjItem b{display:block;font-size:var(--fs-3);line-height:1.3}
.hjItem small{display:block;font-size:var(--fs-2);color:var(--ink-3);line-height:1.35;margin-top:2px}
.hjItem .mini{flex:none;text-decoration:none}
.hjIc{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--surface-2);font-size:15px}
.bvCard{position:relative;text-align:center;border:1px solid var(--highlight);border-top:4px solid var(--accent);background:linear-gradient(180deg,var(--highlight-wash),var(--surface));padding:22px 20px 20px;margin-bottom:14px}
.bvX{position:absolute;top:8px;right:10px;width:36px;height:36px;border:0;background:none;font-size:24px;line-height:1;color:var(--ink-3);cursor:pointer;border-radius:10px}
.bvX:hover{background:var(--surface-2);color:var(--ink)}
.bvTit{font-family:var(--f-display);font-weight:800;font-size:1.6rem;color:var(--accent);margin:0 0 6px}
.bvSub{max-width:560px;margin:0 auto 18px;color:var(--ink-2);line-height:1.5}
.bvPassos{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:left;margin-bottom:18px}
.bvP{display:flex;gap:10px;align-items:flex-start;padding:13px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:inherit;text-decoration:none;text-align:left;font:inherit;cursor:pointer;transition:border-color .15s,transform .15s}
.bvP:hover{border-color:var(--accent);transform:translateY(-1px)}
.bvP .bvN{flex:none;width:26px;height:26px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font:600 13px/1 var(--f-ui)}
.bvP b{display:block;font-size:14px;margin-bottom:2px}
.bvP small{color:var(--ink-3);font-size:12px;line-height:1.4}
.bvOk{display:inline-flex;margin:0 auto}
@media(max-width:700px){.bvPassos{grid-template-columns:1fr}}`;
  document.head.appendChild(s);
})();

/* o app.js já desenhou a primeira tela antes deste arquivo chegar: se ela
   era o Hoje, desenha de novo (route() refaz a checagem do login) */
if (/^#\/adm(\/today)?\/?$/.test(location.hash)) route();
