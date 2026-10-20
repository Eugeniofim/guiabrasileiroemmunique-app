/* =====================================================
   APP-GUIA — camada de dados
   Persistência: localStorage. A troca para Supabase é
   trocar as funções deste arquivo — as telas não mudam.
   ===================================================== */
'use strict';

/* Chave propria, e nao a 'vi_db_v1' do molde: este app mora no mesmo
   endereco da demonstracao (guia.eugeniofim.com/ingrid/), e o navegador
   guarda os dados por endereco. Com a mesma chave, quem abrisse os dois
   veria os passeios de um dentro do outro. */
const DB_KEY = 'mario_db_v1';

/* ---------- modelo ----------
Tour       {id, type, region, name:{pt,en}, desc:{pt,en}, meeting, photo,
            price, priceMode:'pp'|'session'|'tabela', tabela:[20 valores], min, max,
            payPolicy:'full'|'split',
            status:'live'|'draft'|'seasonal', order}
Rule       {id, tourId, weekdays:[0-6], time:'16:30', capacity, from:'2026-11-20', until:'2026-12-23'}
Departure  {id, tourId, date:'2026-12-21', time, capacity}  // avulsas; recorrentes são geradas das Rules
Block      {id, from, until, reason}                        // bloqueio global (férias)
Booking    {id, code, tourId, date, time, name, email, whats, insta, pax, total,
            veiculo, malas, sinal,          // so nos transfers (da tabela dela)
            group:[{nome, nasc}],            // quem mais veio, alem de quem reservou
            coupon, discount, policy:'full'|'split'|'sinal',
            adultos, criancas,
            payments:[{amount, date, method, kind:'full'|'deposit'|'balance'}],
            status:'confirmed'|'cancelled', createdAt, origin}
Coupon     {code, pct, until, oncePerPerson, uses:[email]}
------------------------------------------------------ */

/* ---------- quem e o guia ----------
   O config.js da o valor inicial; o guia edita nos Ajustes e o que vale e
   o que esta em DB.settings. Nada disto vem gravado no codigo. */
const GUIA_CFG = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.guia) || {};
/* Sem banco no config.js o app e uma DEMONSTRACAO: tudo vive no aparelho de
   quem esta olhando e nada sai dali. Meia duzia de telas mudam por causa
   disto, entao a pergunta mora num lugar so. */
function temNuvem() { return !!(typeof APP_CONFIG !== 'undefined' && APP_CONFIG && APP_CONFIG.supabaseUrl); }
const PREFIXO = (GUIA_CFG.prefixo || 'RS').toUpperCase();
function _cfgSettings() { return (typeof DB !== 'undefined' && DB && DB.settings) || {}; }
function guiaNome() { return _cfgSettings().admName || GUIA_CFG.nome || 'Guia'; }
function guiaNegocio() { return _cfgSettings().negocio || GUIA_CFG.negocio || guiaNome(); }
function guiaBase() { return _cfgSettings().base || GUIA_CFG.cidade || ''; }
function regioes() {
  /* O que ela cadastrou no painel vem primeiro. O try e porque DB e "let"
     e pode ainda nao existir quando o arquivo carrega. */
  try {
    const d = DB && DB.settings && DB.settings.regioes;
    if (Array.isArray(d) && d.length) return d;
  } catch (e) {}
  const r = GUIA_CFG.regioes;
  return (r && r.length) ? r : [['cidade', 'Cidade', 'City'], ['arredores', 'Arredores', 'Surroundings']];
}
function regiaoLabel(code) {
  const r = regioes().find(x => x[0] === code);
  if (!r) return code || '';
  return (typeof LANG !== 'undefined' && LANG === 'en') ? r[2] : r[1];
}
function regiaoOpts(cur) {
  const en = typeof LANG !== 'undefined' && LANG === 'en';
  return regioes().map(([v, pt, e]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${en ? e : pt}</option>`).join('');
}

/* ---------- transfer: pessoas, bagagem e horario ----------

   A tabela dela de 2026 (TABELA VALORES 2026 - Transfer Roma.pdf) cobra por
   TRECHO, nunca por pessoa, e o valor depende de tres coisas:

     1. QUANTAS PESSOAS, de 1 a 20 ("1 ou 2 pessoas" e uma linha so);
     2. para cada quantidade ha DUAS opcoes de veiculo, e quem decide entre
        elas e a BAGAGEM (ex.: 3 pessoas com 2 malas cabem num carro; com 6
        malas precisam de minivan);
     3. a HORA: das 21h as 5h59 vale a coluna "Noturno".

   Cada linha tem tambem o SINAL, que e o que o cliente paga antes para
   garantir. O resto e no dia.

   transfer.linhas = [{ pax, malas, veiculo, dia, noite, sinal }]
   pax 2 = "1 ou 2 pessoas". */
const NOITE_DE = 21, NOITE_ATE = 6;   /* 21:00 as 05:59 = noturno */

function transferNoturno(hora) {
  const h = parseInt(String(hora || '').slice(0, 2), 10);
  if (isNaN(h)) return false;
  return h >= NOITE_DE || h < NOITE_ATE;
}

/* "1 ou 2 pessoas" e a mesma linha na tabela dela */
function transferPax(pax) { return Math.max(2, Math.min(20, +pax || 1)); }

/* as opcoes de veiculo para aquela quantidade, na ordem da tabela */
function transferOpcoes(x, pax) {
  const ls = (x.transfer && Array.isArray(x.transfer.linhas)) ? x.transfer.linhas : [];
  const n = transferPax(pax);
  return ls.filter(l => +l.pax === n);
}

function transferLinha(x, pax, opcao) {
  const ops = transferOpcoes(x, pax);
  return ops[Math.max(0, Math.min(ops.length - 1, +opcao || 0))] || null;
}

function transferPreco(x, pax, opcao, hora) {
  const l = transferLinha(x, pax, opcao);
  if (!l) return 0;
  return +(transferNoturno(hora) ? l.noite : l.dia) || 0;
}

/* o "a partir de": o menor valor diurno da tabela */
function transferMenor(x) {
  const ls = (x.transfer && x.transfer.linhas) || [];
  const v = ls.map(l => +l.dia || 0).filter(v => v > 0);
  return v.length ? Math.min(...v) : 0;
}

/* ate quantas pessoas a tabela responde */
function transferAte(x) {
  const ls = (x.transfer && x.transfer.linhas) || [];
  return ls.reduce((m, l) => Math.max(m, +l.pax || 0), 0);
}

/* ---------- ingressos por idade ----------

   Pedido da Ingrid (18/09/2026): "teria como ja somar o valor de ingressos
   por idade?". Os ingressos nao estao no valor do passeio, e o preco muda com
   a idade — no Vaticano, crianca ate 6 nao paga, jovem ate 18 paga €15 e
   adulto €25. Ela compra os ingressos com antecedencia, entao precisa saber
   o valor certo na hora da reserva.

   x.ingressos = [{ nome:{pt,en}, gratisAte, reduzido, reduzidoAte, inteiro,
                    guia, noDia }]
     gratisAte   = ate esta idade (inclusive) nao paga
     reduzido    = valor reduzido, ate reduzidoAte (inclusive)
     inteiro     = o resto, e todo adulto
     guia        = o ingresso da propria guia, cobrado uma vez (Sao Pedro)
     noDia       = pago no dia, fora do total (os fones do Vaticano)

   Adulto nao informa idade: paga o inteiro. */
function precoIngresso(g, idade) {
  const a = idade === null || idade === undefined ? 99 : +idade;
  const tem = (v) => v !== null && v !== undefined && v !== '';
  if (tem(g.gratisAte) && a <= +g.gratisAte) return 0;
  if (+g.reduzido > 0 && tem(g.reduzidoAte) && a <= +g.reduzidoAte) return +g.reduzido;
  return +g.inteiro || 0;
}

function ingressosDe(x, adultos, idades) {
  const ings = Array.isArray(x.ingressos) ? x.ingressos : [];
  const pessoas = Array(Math.max(0, +adultos || 0)).fill(null)
    .concat((idades || []).map(v => (v === '' || v === null || v === undefined) ? null : +v));
  const linhas = [], noDia = [];
  let total = 0, totalDia = 0;
  for (const g of ings) {
    const porValor = {};
    let soma = 0;
    for (const idade of pessoas) {
      const v = precoIngresso(g, idade);
      soma += v; porValor[v] = (porValor[v] || 0) + 1;
    }
    const guia = +g.guia || 0;
    soma += guia;
    const linha = { nome: g.nome, valor: soma, porValor, guia };
    if (g.noDia) { noDia.push(linha); totalDia += soma; } else { linhas.push(linha); total += soma; }
  }
  return { linhas, total, noDia, totalDia };
}

/* ---------- preco por numero de pessoas ----------

   A Ingrid nao cobra por pessoa nem um valor unico: ela tem uma tabela com
   o valor FECHADO do grupo para cada quantidade, de 1 ate 20. Ela montou
   essa tabela justamente para parar de fazer conta a mao no meio de um dia
   cheio — entao o app so serve para alguma coisa se souber ler a tabela.

   tabela[i] = valor total do grupo com (i+1) pessoas. 0 = "consultar":
   grupo grande, caso raro, ela responde a mao e tudo bem. */
const TABELA_MAX = 20;

function tabelaPreco(x, pax) {
  const tb = Array.isArray(x.tabela) ? x.tabela : [];
  const n = Math.max(1, Math.min(TABELA_MAX, +pax || 1));
  return +tb[n - 1] || 0;
}

/* O menor valor da tabela — e o "a partir de" do cartao da vitrine. */
function tabelaMenor(x) {
  const tb = (Array.isArray(x.tabela) ? x.tabela : []).map(v => +v || 0).filter(v => v > 0);
  return tb.length ? Math.min(...tb) : 0;
}

/* Ate quantas pessoas a tabela responde sozinha. Acima disso o app nao
   inventa preco: manda falar com ela. */
function tabelaAte(x) {
  const tb = Array.isArray(x.tabela) ? x.tabela : [];
  let n = 0;
  for (let i = 0; i < TABELA_MAX; i++) if (+tb[i] > 0) n = i + 1;
  return n;
}

function _blank() {
  return { tours: [], rules: [], departures: [], blocks: [], bookings: [], coupons: [], seatCounts: [],
           /* pedidos de roteiro personalizado (o questionario do cliente) */
           pedidos: [],
           settings: { lang: 'pt', tutorialClient: true, tutorialAdm: true,
           /* quem e o guia — nasce do config.js e o guia edita no painel */
           admName: GUIA_CFG.nome || 'Guia', negocio: GUIA_CFG.negocio || '',
           whats: GUIA_CFG.whats || '', insta: GUIA_CFG.insta || '', placeholderContact: false,
           /* o cliente ve antes de reservar */
           photo: '', badge: GUIA_CFG.badge || '',
           base: GUIA_CFG.cidade || '',
           /* como o cliente paga. Vazio ate ela preencher no ADM — e enquanto
              estiver vazio a tela diz a verdade: ela passa os dados no WhatsApp. */
           /* pixName e pixCity sao exigidos pelo padrao do BR Code:
              sem eles o banco recusa o codigo. */
           pixKey: '', pixName: '', pixCity: '', iban: '', ibanName: '', payNote: '',
           site: '', roteiro: true, cupons: true,
           /* Wise: link de pagamento (wise.com/pay/...). Dinheiro no dia: o
              transfer dela e cobrado assim. Vazio/falso = nao aparece. */
           wiseLink: '', dinheiroNoDia: false,
           /* A primeira tela e o "link na bio" dela: redes e os links de
              parceiros que ela ja divulga (hotel, chip, seguro). Ela edita
              tudo no painel, em Aparencia. */
           youtube: '', facebook: '', blog: '',
           links: [],
           /* cidades e regioes da vitrine. Vazio = as do config.js. Ela
              acrescenta uma cidade nova pelo painel, sem nos. */
           regioes: [],
           /* para onde vai o aviso de reserva nova. Vazio = ela ainda nao
              preencheu; quem manda o e-mail e o robo, fora do navegador. */
           admEmail: '',
           /* e-mail PARA O CLIENTE. Nasce desligado de proposito: e-mail
              indo para cliente de verdade so depois que ela ler os textos e
              decidir ligar. */
           avisarClientes: false,
           /* cartao pelo Stripe. Desligado ate a gente provar a cobranca
              de ponta a ponta com dinheiro de verdade. */
           stripeAtivo: false,
           /* A voz dela dentro do e-mail. Vazio = usa o texto padrao.
              Ela NAO edita o e-mail inteiro de proposito: o miolo tem os
              dados da reserva, o Pix e o aviso de que o recibo nao e
              comprovante de pagamento. Apagar esse aviso sem perceber faria
              cliente que nao pagou achar que esta tudo certo. */
           emailReciboIntro: { pt: '', en: '' },
           emailReciboPS:    { pt: '', en: '' },
           emailConfIntro:   { pt: '', en: '' },
           emailConfPS:      { pt: '', en: '' },
           /* margem sobre a cotacao do BCE: cobre o spread de conversao e a
              taxa de quem processa. Sem ela, o euro que chega e menor. */
           /* O guia pediu para tirar a cotacao da tela. A chave antiga
              (mostrarReais) ficou 'true' na nuvem; usar um nome novo desliga
              na hora para todo mundo, sem depender de ela abrir o app. */
           fxMargem: 4, exibirCotacao: false,
           /* a primeira tela: foto de fundo e a frase. Vazio = usa o padrao. */
           homePhoto: '', homeText: { pt: '', en: '' },
           bio: {
             pt: 'Aqui vai a sua apresentação: quem você é, há quanto tempo guia, o que faz o seu passeio ser diferente.\n\nO cliente lê isto antes do preço — quem confia na pessoa aceita melhor o valor.\n\nEdite este texto em Ajustes → Sobre você.',
             en: 'This is where you introduce yourself: who you are, how long you have been guiding, what makes your tour different.\n\nGuests read this before the price — people who trust the person accept the value more easily.\n\nEdit this text in Settings → About you.'
           } } };
}

function _seed() {
  const db = _blank();
  db.demo = true;
  db.seedVer = SEED_VER;

  /* A apresentacao do Mario. Tudo saiu dos sites dele
     (guiabrasileiroemmunique.com e guiamotorista.com) e do Instagram. Nada
     inventado; ele reescreve em Ajustes -> Sobre voce. */
  db.settings.homeText = {
    pt: 'Guia oficial de Munique desde 1995. Passeios privativos em português por Munique e pela Baviera.',
    en: 'Official Munich guide since 1995. Private tours in Portuguese through Munich and Bavaria.',
  };
  /* O Mario pediu para tirar o link 'Guia-motorista pela Baviera' da primeira tela (22/09). */
  db.settings.links = [];
  db.settings.youtube  = 'https://www.youtube.com/watch?v=RjdxgZKIgM0';
  db.settings.facebook = 'https://www.facebook.com/visitasguiadasemportugues';
  db.settings.blog     = 'https://www.guiabrasileiroemmunique.com/#Blog';
  db.settings.site     = 'https://www.guiabrasileiroemmunique.com/';
  /* pedidos dele: sem 'Monte seu roteiro' e sem cupons */
  db.settings.roteiro  = false;
  db.settings.cupons   = false;
  db.settings.photo    = 'arte/mario-perfil.jpg';   /* 12/10: selfie dele na Marienplatz (ele mandou) */
  db.settings.bio = {
    pt: 'Sou o Mario Dal Pra, curitibano. Muito jovem fui morar no exterior — Buenos Aires, Edimburgo, Nova York — '
      + 'e há mais de 30 anos moro em Munique, onde me formei em Turismo.\n\n'
      + 'Sou guia oficial da cidade de Munique desde 1995, credenciado na Alemanha, tour leader pela Câmara de Indústria e '
      + 'Comércio de Munique e membro da Associação Federal de Guias Turísticos (BVGD). Falo português, espanhol, inglês e alemão.\n\n'
      + 'Minha missão é aproximar você de Munique com conhecimento, hospitalidade e a alegria de viver brasileira. '
      + 'Todos os passeios são privativos e personalizados: a pé, de carro com guia-motorista, por Munique e pela Baviera.',
    en: 'I am Mario Dal Pra, from Curitiba, Brazil. I moved abroad very young — Buenos Aires, Edinburgh, New York — '
      + 'and I have lived in Munich for over 30 years, where I studied Tourism.\n\n'
      + 'I have been an official Munich city guide since 1995, accredited in Germany, a tour leader certified by the Munich '
      + 'Chamber of Commerce and a member of the German Federation of Tourist Guides (BVGD). I speak Portuguese, Spanish, English and German.\n\n'
      + 'My mission is to bring you close to Munich with knowledge, hospitality and Brazilian joie de vivre. '
      + 'Every tour is private and tailor-made: on foot, by car with a driver-guide, across Munich and Bavaria.',
  };

  db.tours = [
    { id: "centro-historico", type: "walk", region: "munique",
      name: { pt: "Visita guiada privativa pelo Centro Histórico", en: "Private guided tour of the Old Town" },
      desc: { pt: "A visita guiada caminhando começa na Marienplatz e dura aproximadamente 3 a 4 horas, dependendo do interesse e dos ingressos. Podemos começar também desde o seu hotel. Vamos conhecer a Praça Marienplatz com a coluna de Nossa Senhora, a Prefeitura Nova com o carrilhão, a Prefeitura Antiga com o Museu dos Brinquedos, o calçadão com a parte de compras, a Catedral Frauenkirche, o Teatro Municipal, a “Residenz” — o Palácio Real —, a famosa Cervejaria Hofbräuhaus e o Mercado de Vitualhas.",
              en: "The walking tour starts at Marienplatz and takes about 3 to 4 hours, depending on your interests and tickets. We can also start from your hotel. We see Marienplatz with the Column of Our Lady, the New Town Hall with its carillon, the Old Town Hall with the Toy Museum, the pedestrian shopping street, the Frauenkirche cathedral, the National Theatre, the Residenz — the Royal Palace —, the famous Hofbräuhaus and the Viktualienmarkt." },
      meeting: "Na Marienplatz ou no seu hotel",
      duration: "3h a 4h", distance: '', effort: 'easy',
      includes: { pt: ["Guia oficial de Munique, em português"], en: ["Official Munich guide, in Portuguese"] },
      notIncludes: { pt: ["Ingressos"], en: ["Tickets"] },
      stops: [
        { t: '', ph: "fotos/marienplatz.jpg", lat: 0, lng: 0,
          n: { pt: "Marienplatz e a coluna da Virgem Maria", en: "Marienplatz and the Column of the Virgin Mary" },
          d: { pt: "A Praça de Nossa Senhora, o coração de Munique, com a coluna da Virgem Maria no centro.", en: "Our Lady’s Square, the heart of Munich, with the Column of the Virgin Mary in the middle." } },
        { t: '', ph: "fotos/rathaus.jpg", lat: 0, lng: 0,
          n: { pt: "Prefeitura Nova e o carrilhão", en: "New Town Hall and the carillon" },
          d: { pt: "A fachada neogótica e o famoso carrilhão com os bonecos que dançam na torre.", en: "The neo-Gothic façade and the famous carillon whose figures dance in the tower." } },
        { t: '', ph: "fotos/altesrathaus.jpg", lat: 0, lng: 0,
          n: { pt: "Antiga Prefeitura", en: "Old Town Hall" },
          d: { pt: "A Prefeitura Antiga, que hoje abriga o Museu dos Brinquedos.", en: "The Old Town Hall, now home to the Toy Museum." } },
        { t: '', ph: "fotos/karlstor.jpg", lat: 0, lng: 0,
          n: { pt: "O calçadão e as compras", en: "The pedestrian shopping street" },
          d: { pt: "O calçadão com a parte de compras, do Karlstor até a Marienplatz.", en: "The pedestrian zone and its shops, from the Karlstor to Marienplatz." } },
        { t: '', ph: "fotos/frauenkirche.jpg", lat: 0, lng: 0,
          n: { pt: "Catedral Frauenkirche", en: "Frauenkirche cathedral" },
          d: { pt: "A Catedral de Munique, com as duas torres que são o símbolo da cidade.", en: "Munich Cathedral, whose two towers are the symbol of the city." } },
        { t: '', ph: "fotos/nationaltheater.jpg", lat: 0, lng: 0,
          n: { pt: "Teatro Municipal", en: "National Theatre" },
          d: { pt: "O grande teatro da ópera de Munique, na Max-Joseph-Platz.", en: "Munich’s great opera house, on Max-Joseph-Platz." } },
        { t: '', ph: "fotos/residenz.jpg", lat: 0, lng: 0,
          n: { pt: "“Residenz”, o Palácio Real", en: "The Residenz, the Royal Palace" },
          d: { pt: "O palácio dos reis da Baviera, bem no centro da cidade.", en: "The palace of the kings of Bavaria, right in the city centre." } },
        { t: '', ph: "fotos/odeonsplatz.jpg", lat: 0, lng: 0,
          n: { pt: "Praça Odeon", en: "Odeonsplatz" },
          d: { pt: "A Feldherrnhalle e a igreja dos Teatinos, no começo da Ludwigstrasse.", en: "The Feldherrnhalle and the Theatine Church, at the start of Ludwigstrasse." } },
        { t: '', ph: "fotos/hofbrauhaus.jpg", lat: 0, lng: 0,
          n: { pt: "Cervejaria Hofbräuhaus", en: "Hofbräuhaus" },
          d: { pt: "A cervejaria mais famosa de Munique.", en: "Munich’s most famous beer hall." }, cr: "Bayreuth2009 · CC BY 3.0 · Wikimedia Commons" },
        { t: '', ph: "fotos/viktualienmarkt.jpg", lat: 0, lng: 0,
          n: { pt: "Mercado de Vitualhas", en: "Viktualienmarkt" },
          d: { pt: "O mercado ao ar livre de Munique, com frutas, queijos, especialidades bávaras e cerveja.", en: "Munich’s open-air market, with fruit, cheese, Bavarian specialities and beer." }, cr: "Jan Czeczotka · CC BY-SA 4.0 · Wikimedia Commons" },
      ],
      photo: "fotos/mario-marienplatz.jpg",
      tagline: { pt: "Da Marienplatz à Hofbräuhaus, a pé", en: "From Marienplatz to the Hofbräuhaus, on foot" },
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: "live", order: 1,
    },
    { id: "panoramica", type: "carro", region: "munique",
      name: { pt: "Panorâmica Clássica de luxo de Munique", en: "Classic luxury panoramic tour of Munich" },
      desc: { pt: "Este passeio dura aproximadamente 3 a 4 horas. Começamos no Parque Olímpico, com vista para o imponente Estádio Olímpico e a Torre Olímpica, e seguimos para o Museu da BMW. O percurso continua até o magnífico Palácio de Nymphenburg, antes de visitar a Königsplatz, com seus edifícios neoclássicos. No Distrito dos Museus, visitamos os museus de arte mais importantes da cidade: a Antiga Pinacoteca, a Nova Pinacoteca, a Pinacoteca do Modernismo, a Galeria Municipal no Lenbachhaus e o impressionante Museu Egípcio.",
              en: "This tour takes about 3 to 4 hours. We start at the Olympic Park, overlooking the imposing Olympic Stadium and the Olympic Tower, and continue to the BMW Museum. The route goes on to the magnificent Nymphenburg Palace, before visiting Königsplatz with its neoclassical buildings. In the Museum Quarter we visit the city’s most important art museums: the Alte Pinakothek, the Neue Pinakothek, the Pinakothek der Moderne, the Lenbachhaus municipal gallery and the impressive Egyptian Museum." },
      meeting: "No seu hotel em Munique",
      duration: "3h a 4h", distance: '', effort: 'easy',
      includes: { pt: ["Guia oficial em português", "Carro confortável com guia-motorista", "Busca no hotel"], en: ["Official guide in Portuguese", "Comfortable car with driver-guide", "Hotel pick-up"] },
      notIncludes: { pt: ["Ingressos das atrações", "Refeições"], en: ["Attraction tickets", "Meals"] },
      stops: [
        { t: '', ph: "fotos/olympiapark-mario2.jpg", lat: 0, lng: 0,
          n: { pt: "Parque Olímpico", en: "Olympic Park" },
          d: { pt: "Vista para o imponente Estádio Olímpico e a Torre Olímpica.", en: "Views of the imposing Olympic Stadium and the Olympic Tower." } },
        { t: '', ph: "fotos/bmw-mario.jpg", lat: 0, lng: 0,
          n: { pt: "BMW-Welt e Museu da BMW", en: "BMW Welt and BMW Museum" },
          d: { pt: "A sede da BMW, o museu e o pavilhão futurista.", en: "BMW’s headquarters, its museum and the futuristic pavilion." } },
        { t: '', ph: "fotos/nymphenburg.jpg", lat: 0, lng: 0,
          n: { pt: "Palácio Nymphenburg", en: "Nymphenburg Palace" },
          d: { pt: "O magnífico palácio de verão dos reis da Baviera.", en: "The magnificent summer palace of the Bavarian kings." } },
        { t: '', ph: "fotos/koenigsplatz.jpg", lat: 0, lng: 0,
          n: { pt: "Praça Real (Königsplatz)", en: "Königsplatz" },
          d: { pt: "A praça com seus edifícios neoclássicos.", en: "The square with its neoclassical buildings." } },
        { t: '', ph: "fotos/pinakothek.jpg", lat: 0, lng: 0,
          n: { pt: "Distrito dos Museus", en: "Museum Quarter" },
          d: { pt: "Antiga Pinacoteca, Nova Pinacoteca, Pinacoteca de Arte Contemporânea, Galeria Estatal Lenbachhaus e Museu Egípcio.", en: "Alte Pinakothek, Neue Pinakothek, Pinakothek der Moderne, the Lenbachhaus gallery and the Egyptian Museum." }, cr: "AuHaidhausen · CC BY 4.0 · Wikimedia Commons" },
      ],
      photo: "fotos/mario-carro.jpg",
      tagline: { pt: "Parque Olímpico, BMW, Nymphenburg e os museus", en: "Olympic Park, BMW, Nymphenburg and the museums" },
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: "live", order: 2,
    },
    { id: "terceiro-reich", type: "walk", region: "munique",
      name: { pt: "Munique e o Terceiro Reich", en: "Munich and the Third Reich" },
      desc: { pt: "Munique foi um dos principais centros do movimento nacional-socialista e a cidade onde o NSDAP iniciou sua trajetória política. Neste tour, vamos percorrer lugares que ajudam a compreender a ascensão do nazismo, seus acontecimentos decisivos, a resistência e as consequências da ditadura.",
              en: "Munich was one of the main centres of the National Socialist movement and the city where the NSDAP began its political career. On this tour we walk through places that help explain the rise of Nazism, its decisive events, the resistance and the consequences of the dictatorship." },
      meeting: "Na Marienplatz",
      duration: "3h", distance: '', effort: 'easy',
      includes: { pt: ["Guia oficial de Munique, em português"], en: ["Official Munich guide, in Portuguese"] },
      notIncludes: { pt: ["Ingressos"], en: ["Tickets"] },
      stops: [
        { t: '', ph: "fotos/sterneckerbraeu.jpg", lat: 0, lng: 0,
          n: { pt: "Sterneckerbräu", en: "Sterneckerbräu" },
          d: { pt: "Local histórico ligado ao partido nazista quando ele ainda existia como DAP.", en: "A historic site tied to the Nazi party when it still existed as the DAP." }, cr: "Ute Schröder · CC BY-SA 3.0 · Wikimedia Commons" },
        { t: '', ph: "fotos/hofbrauhaus.jpg", lat: 0, lng: 0,
          n: { pt: "Hofbräuhaus", en: "Hofbräuhaus" },
          d: { pt: "Os primeiros anos do movimento nazista em Munique.", en: "The early years of the Nazi movement in Munich." }, cr: "Bayreuth2009 · CC BY 3.0 · Wikimedia Commons" },
        { t: '', ph: "fotos/feldherrnhalle.jpg", lat: 0, lng: 0,
          n: { pt: "Odeonsplatz e Feldherrnhalle", en: "Odeonsplatz and Feldherrnhalle" },
          d: { pt: "O cenário do Putsch de 1923.", en: "The scene of the 1923 Putsch." } },
        { t: '', ph: "fotos/koenigsplatz.jpg", lat: 0, lng: 0,
          n: { pt: "Königsplatz", en: "Königsplatz" },
          d: { pt: "Manifestações e propaganda do regime nazista.", en: "Rallies and propaganda of the Nazi regime." } },
        { t: '', ph: "fotos/fuehrerbau.jpg", lat: 0, lng: 0,
          n: { pt: "Führerbau", en: "Führerbau" },
          d: { pt: "Edifício ligado ao poder nazista e ao Acordo de Munique de 1938.", en: "A building tied to Nazi power and to the 1938 Munich Agreement." }, cr: "G. Reck · CC BY-SA 4.0 · Wikimedia Commons (recorte)" },
        { t: '', ph: "fotos/ns-doku.jpg", lat: 0, lng: 0,
          n: { pt: "NS-Dokumentationszentrum", en: "NS Documentation Centre" },
          d: { pt: "No lugar onde se encontrava a central do partido nazista NSDAP, conta hoje a história do nacional-socialismo em Munique.", en: "On the site of the former NSDAP party headquarters, it now tells the history of National Socialism in Munich." }, cr: "Raimond Spekking · CC BY-SA 4.0 · Wikimedia Commons" },
        { t: '', ph: "fotos/lichthof-lmu.jpg", lat: 0, lng: 0,
          n: { pt: "A resistência da Rosa Branca", en: "The White Rose resistance" },
          d: { pt: "O átrio da Universidade de Munique, onde Hans e Sophie Scholl foram presos em 1943 ao espalhar os panfletos da Rosa Branca.", en: "The atrium of the University of Munich, where Hans and Sophie Scholl were arrested in 1943 while spreading the White Rose leaflets." }, cr: "Bob Jenkin · CC BY 2.0 · Wikimedia Commons" },
      ],
      photo: "fotos/feldherrnhalle.jpg",
      tagline: { pt: "A ascensão do nazismo, a resistência e as consequências", en: "The rise of Nazism, the resistance and the aftermath" },
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: "live", order: 3,
    },
  ];


  /* Os 3 passeios ganham datas pelo laco abaixo. */
  db.rules = [];

  /* Todo passeio no ar tem datas na demonstracao. Sem isto, os que nao tinham
     regra mostravam "me chame que eu te passo as datas" — numa vitrine feita
     para vender, parece passeio que nao acontece. Passeio privativo sai em
     qualquer dia; a Audiencia Papal, so na quarta. */
  const HORA_TIPO = { walk: '10:00', day: '08:00', carro: '09:00' };
  let nRegra = db.rules.length;
  for (const x of db.tours) {
    if (x.status !== 'live' || db.rules.some(r => r.tourId === x.id)) continue;
    db.rules.push({ id: 'r' + (++nRegra), tourId: x.id,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      time: HORA_TIPO[x.type] || '09:00',
      capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) });
  }

  db.coupons = [
    { code: 'VOLTA10', pct: 10, until: '2026-12-31', oncePerPerson: true, uses: [] },
    { code: 'AMIGO15', pct: 15, until: '2026-12-31', oncePerPerson: true, uses: [] },
  ];

  /* ---- clientes e reservas de exemplo (histórico crível) ---- */
  const people = [
    ['Patrícia Menezes',  'patricia.menezes@email.com', '+55 11 98123 4455', 'pat.menezes',  'instagram'],
    ['Rodrigo Tavares',   'rodrigo.tavares@email.com',  '+55 21 99654 1122', '',             'friend'],
    ['Luciana Prado',     'luciana.prado@email.com',    '+55 31 98877 3344', 'lu.prado',     'instagram'],
    ['Fernando Aguiar',   'fernando.aguiar@email.com',  '+351 912 445 778',  '',             'friend'],
    ['Cristina Bonatto',  'cris.bonatto@email.com',     '+55 51 99231 7788', 'cris.bonatto', 'whatsapp'],
    ['Marcelo Yamada',    'm.yamada@email.com',         '+55 11 97744 2211', '',             'site'],
    ['Renata Coutinho',   'renata.coutinho@email.com',  '+55 41 99812 3399', 'recoutinho',   'friend'],
    ['Paulo Sérgio Lima', 'ps.lima@email.com',          '+55 85 98122 6677', '',             'agency'],
  ];
  const plan = [
    /* [pessoa, passeio, dias atrás, pax, quitado?] — só os 3 passeios dele */
    [0, 'centro-historico', 46, 2, true], [1, 'panoramica',     39, 4, true],
    [2, 'terceiro-reich',   33, 2, true], [3, 'centro-historico', 27, 5, true],
    [4, 'panoramica',       22, 2, true], [5, 'terceiro-reich', 13, 4, true],
    [6, 'centro-historico',  9, 3, true], [7, 'panoramica',      5, 6, true],
    [1, 'centro-historico', -4, 4, false],[3, 'terceiro-reich', -8, 2, false],
    [6, 'panoramica',      -11, 2, true],
  ];
  let n = 0;
  for (const [pi, tourId, back, pax, settled] of plan) {
    const [name, email, whats, insta, origin] = people[pi];
    const x = db.tours.find(z => z.id === tourId);
    const date = addDays(isoToday(), -back);
    const rule = db.rules.find(r => r.tourId === tourId);
    const time = rule ? rule.time : '10:00';
    const total = x.priceMode === 'transfer' ? transferPreco(x, pax, 0, time)
                : x.priceMode === 'tabela' ? tabelaPreco(x, pax)
                : x.priceMode === 'session' ? x.price : x.price * pax;
    const created = addDays(date, -(7 + (n % 9)));
    const payments = [];
    if (x.payPolicy === 'split') {
      payments.push({ amount: Math.round(total / 2), date: created, method: 'card', kind: 'deposit' });
      if (settled) payments.push({ amount: total - Math.round(total / 2), date: addDays(date, -1), method: 'card', kind: 'balance' });
    } else {
      payments.push({ amount: total, date: created, method: n % 3 === 0 ? 'applepay' : 'card', kind: 'full' });
    }
    db.bookings.push({
      id: 'demo' + (++n), code: PREFIXO + '-' + (2100 + n * 37 % 7800),
      tourId, date, time, name, email, whats, insta, pax, total,
      coupon: null, discount: 0, policy: x.payPolicy, payments,
      consent: (n % 3 !== 0)
        ? { ok: true, at: created + 'T10:00:00.000Z', src: 'checkout' }
        : { ok: false },
      status: 'confirmed', createdAt: created + 'T10:00:00.000Z', origin,
    });
  }
  return db;
}

/* apaga tudo — o guia começa do zero */
function clearAll() {
  DB = _blank();
  DB.demo = false;
  save();
}
function restoreDemo() { DB = _seed(); save(); }

/* ---------- migração de ajustes ----------
   Quem já usa o app tem um DB salvo — e a nuvem também. Sem isto,
   todo campo novo que a gente criar nasce vazio para eles e a tela
   quebra em silêncio. Preenche só o que falta; nunca sobrescreve. */
function fillSettings(s) {
  const d = _blank().settings;
  s = s || {};
  for (const k of Object.keys(d)) {
    if (s[k] === undefined || s[k] === null || s[k] === '') s[k] = d[k];
  }
  /* bio é objeto: garante os dois idiomas */
  if (typeof s.bio !== 'object' || !s.bio) s.bio = d.bio;
  else { if (!s.bio.pt) s.bio.pt = d.bio.pt; if (!s.bio.en) s.bio.en = d.bio.en; }
  return s;
}

let DB = null;
/* Versao dos dados de DEMONSTRACAO. Sobe quando o catalogo de exemplo muda.

   Sem isto, quem abriu o link uma vez fica para sempre com os dados daquele
   dia: o navegador guarda a demonstracao e nunca mais olha o catalogo novo.
   Aconteceu em 18/09/2026 — a v1.57 trouxe a tabela de transfer de 2026 e
   os links de parceira, e quem tinha aberto a v1.56 continuava vendo o
   transfer antigo (que nem funcionava mais) e nenhum link.

   So vale para a DEMONSTRACAO e sem nuvem: dados de verdade nunca sao
   trocados por exemplo. Os pedidos de roteiro feitos no aparelho ficam. */
const SEED_VER = 10;  /* 8: pedidos do Mario de 22/09 (sem Áustria, sem roteiro, sem cupom, site)
                         9: fotos novas nos 3 passeios no ar, com os créditos (06/10)
                        10: só os 3 passeios; os 15 rascunhos saíram (06/10) */

function load() {
  try { DB = JSON.parse(localStorage.getItem(DB_KEY)) || null; } catch (e) { DB = null; }
  /* 14/10/2026: aparelho que abriu o PROTOTIPO guardou as reservas e
     clientes de exemplo (DB.demo). Com nuvem, a verdade e o banco: os dados
     de exemplo vao fora e o aparelho recebe o que esta la. Sem isto o painel
     do Mario mostrava a Cristina Bonatto e companhia com o banco zerado. */
  if (DB && DB.demo && temNuvem()) {
    const lang = DB.settings && DB.settings.lang;
    /* a fila de envios do tempo da demonstração também vai embora: senão as
       reservas de exemplo subiriam para o banco de verdade (18/10/2026) */
    try { localStorage.removeItem(typeof QUEUE_KEY !== 'undefined' ? QUEUE_KEY : 'mario_queue_v1'); } catch (e) {}
    DB = _blank();
    if (lang) DB.settings = { ...(DB.settings || {}), lang };
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  }
  if (DB && DB.demo && !temNuvem() && (+DB.seedVer || 1) < SEED_VER) {
    const pedidos = DB.pedidos || [];
    DB = _seed();
    DB.pedidos = pedidos;
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  }
  /* O app esta em producao. Aparelho novo (ou navegador limpo) tem que
     comecar VAZIO e receber o que esta na nuvem — nunca publicar um catalogo
     inventado por cima do dela. Antes isto semeava a demonstracao e o save()
     empurrava para a nuvem: bastava ela instalar no celular para os passeios
     reais virarem os ficticios. A demonstracao so volta pelo botao no ADM. */
  if (!DB || !DB.tours) {
    /* Sem nuvem configurada (config.js vazio) o app e um prototipo: nasce com
       os passeios de exemplo, e nao existe nuvem para onde empurra-los.
       Com nuvem, aparelho novo comeca VAZIO e recebe o que esta la. */
    DB = temNuvem() ? _blank() : _seed();
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  }
  DB.settings = fillSettings(DB.settings);
  return DB;
}
function save() {
  localStorage.setItem(DB_KEY, JSON.stringify(DB));
  if (typeof cloudPushState === 'function') cloudPushState();
}
function resetDemo() { DB = _seed(); save(); }

const uid = () => Math.random().toString(36).slice(2, 9);
const bookCode = () => PREFIXO + '-' + Math.floor(1000 + Math.random() * 9000);

/* ---------- passeios ---------- */
const Tours = {
  all()      { return [...DB.tours].sort((a, b) => a.order - b.order); },
  live()     { return Tours.all().filter(t => t.status !== 'draft'); },
  get(id)    { return DB.tours.find(t => t.id === id); },
  create(t)  { t.id = uid(); t.order = DB.tours.length + 1; DB.tours.push(t); save(); return t; },
  update(id, patch) { Object.assign(Tours.get(id), patch); save(); },
  duplicate(id) {
    const src = Tours.get(id); if (!src) return null;
    const cp = JSON.parse(JSON.stringify(src));
    cp.id = uid(); cp.order = DB.tours.length + 1; cp.status = 'draft';
    cp.name = { pt: src.name.pt + ' (cópia)', en: src.name.en + ' (copy)' };
    DB.tours.push(cp); save(); return cp;
  },
  remove(id) {
    DB.tours = DB.tours.filter(t => t.id !== id);
    DB.rules = DB.rules.filter(r => r.tourId !== id);
    DB.departures = DB.departures.filter(d => d.tourId !== id);
    save();
  },
  futureBookings(id) {
    const today = isoToday();
    return DB.bookings.filter(b => b.tourId === id && b.status === 'confirmed' && b.date >= today);
  },
};

/* ---------- calendário ---------- */
function isoToday() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

const Cal = {
  rulesFor(tourId) { return DB.rules.filter(r => r.tourId === tourId); },
  addRule(r) { r.id = uid(); DB.rules.push(r); save(); return r; },
  removeRule(id) { DB.rules = DB.rules.filter(r => r.id !== id); save(); },
  addDeparture(d) { d.id = uid(); DB.departures.push(d); save(); return d; },
  removeDeparture(id) { DB.departures = DB.departures.filter(d => d.id !== id); save(); },
  addBlock(b) { b.id = uid(); DB.blocks.push(b); save(); return b; },
  removeBlock(id) { DB.blocks = DB.blocks.filter(x => x.id !== id); save(); },
  blocked(date) { return DB.blocks.some(b => date >= b.from && date <= b.until); },

  /* todas as saídas de um passeio num intervalo: regras expandidas + avulsas − bloqueios */
  departures(tourId, fromIso, toIso) {
    const out = [];
    for (const r of Cal.rulesFor(tourId)) {
      let d = fromIso < r.from ? r.from : fromIso;
      const end = toIso < r.until ? toIso : r.until;
      while (d <= end) {
        const wd = new Date(d + 'T12:00:00').getDay();
        if (r.weekdays.includes(wd) && !Cal.blocked(d)) {
          out.push({ tourId, date: d, time: r.time, capacity: r.capacity, ruleId: r.id });
        }
        d = addDays(d, 1);
      }
    }
    for (const dep of DB.departures.filter(x => x.tourId === tourId)) {
      if (dep.date >= fromIso && dep.date <= toIso && !Cal.blocked(dep.date)) out.push(dep);
    }
    out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return out;
  },

  seatsLeft(tourId, date, time, capacity) {
    /* logada: conta pelas reservas. Visitante: usa a contagem pública,
       que não expõe nome nem telefone de ninguém. */
    const local = DB.bookings
      .filter(b => b.tourId === tourId && b.date === date && b.time === time && b.status === 'confirmed')
      .reduce((s, b) => s + b.pax, 0);
    let taken = local;
    if (Array.isArray(DB.seatCounts) && DB.seatCounts.length) {
      const row = DB.seatCounts.find(c => c.tourId === tourId && c.date === date && c.time === time);
      taken = Math.max(local, row ? row.pax : 0);
    }
    return Math.max(0, capacity - taken);
  },
};

/* ---------- cupons ---------- */
const Coupons = {
  all() { return DB.coupons; },
  create(c) { DB.coupons.push(c); save(); },
  remove(code) { DB.coupons = DB.coupons.filter(c => c.code !== code); save(); },
  validate(code, email) {
    const c = DB.coupons.find(x => x.code.toUpperCase() === String(code).toUpperCase());
    if (!c) return { ok: false, reason: 'notfound' };
    if (c.until && isoToday() > c.until) return { ok: false, reason: 'expired' };
    if (c.oncePerPerson && email && c.uses.includes(email)) return { ok: false, reason: 'used' };
    return { ok: true, coupon: c };
  },
  consume(code, email) {
    const c = DB.coupons.find(x => x.code === code);
    if (c && email && !c.uses.includes(email)) { c.uses.push(email); save(); }
  },
};

/* ---------- reservas e pagamentos ---------- */
const Bookings = {
  all() { return [...DB.bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
  get(id) { return DB.bookings.find(b => b.id === id); },
  byCode(code) { return DB.bookings.find(b => b.code === code); },

  create({ tourId, date, time, name, email, whats, insta, pax, coupon, policy, origin, consent, opcao, group, adultos, criancas, idades }) {
    const tour = Tours.get(tourId);
    /* Tem que ser o MESMO calculo que a tela mostrou. tour.price * pax ignora
       o preco escalonado (195 para as 3 primeiras, 225 depois) e gravava a
       reserva abaixo do que a pessoa acabou de ler. */
    /* O veiculo tem que vir junto: sem ele, uma reserva de minivan as 22h
       era gravada pelo valor do carro diurno. A tela mostrava 130 e o caixa
       guardava 90, e so o extrato no fim do mes acusaria. */
    const pr0 = Bookings.precoDe(tour, tourId, date, time, pax, { opcao });
    const base = pr0.total;
    let discount = 0, couponCode = null;
    if (coupon) {
      const v = Coupons.validate(coupon, email);
      if (v.ok) { discount = Math.round(base * v.coupon.pct) / 100 * 1; discount = Math.round(base * v.coupon.pct / 100); couponCode = v.coupon.code; }
    }
    /* ingressos por idade: somados ao total, porque e ela quem compra */
    const nAdultos = Number.isFinite(+adultos) && adultos !== undefined ? +adultos : pax;
    const ing = ingressosDe(tour, nAdultos, idades || []);
    const total = base - discount + ing.total;
    const b = {
      id: uid(), code: bookCode(), tourId, date, time,
      name, email, whats, insta: insta || '', pax, total,
      coupon: couponCode, discount, policy,
      /* quem vem: adultos e menores de 18. O preco e pelo total; a divisao e
         para ela saber quem e crianca (ingresso, cadeirinha, ritmo). */
      adultos: Number.isFinite(+adultos) && adultos !== undefined ? +adultos : pax,
      criancas: +criancas || 0,
      idades: (idades || []).map(v => (v === '' || v == null) ? null : +v),
      ingressos: ing.total || ing.totalDia ? { linhas: ing.linhas, total: ing.total, noDia: ing.noDia, totalDia: ing.totalDia } : null,
      veiculo: pr0.veiculo || '', malas: pr0.malas || '',
      /* Transfer: o que se paga antes e o SINAL da tabela dela, nao a metade.
         O resto e no dia. */
      sinal: tour && tour.priceMode === 'transfer' ? (pr0.sinal || 0) : 0,
      /* QUEM MAIS VEM NO GRUPO.

         A Ingrid pediu isto em audio: ate hoje ela so registra quem fez a
         reserva, mas muita gente volta depois por indicacao de alguem que
         VEIO JUNTO e nunca falou com ela. Sem os nomes do grupo, essa
         pessoa nao existe na base dela e a indicacao se perde. */
      group: Array.isArray(group) ? group.filter(g => g && g.nome).map(g => ({
        nome: String(g.nome).trim(),
        nasc: String(g.nasc || '').trim(),
      })) : [],
      consent: consent ? { ok: true, at: new Date().toISOString(), src: 'checkout' } : { ok: false },
      payments: [], status: 'confirmed',
      createdAt: new Date().toISOString(), origin: origin || 'site',
      /* Em que idioma ele reservou. Sem isto o e-mail de recibo sai em
         portugues para um frances que leu a tela inteira em ingles. */
      lang: (typeof LANG !== 'undefined' && LANG === 'en') ? 'en' : 'pt',
    };
    /* Aqui havia um pagamento inventado: toda reserva nascia marcada como paga
       no cartao. O painel, o caixa e os relatorios contavam dinheiro que nunca
       entrou. A reserva nasce sem pagamento nenhum — quem registra e o guia,
       quando o dinheiro cai de verdade. E aqui que o Stripe entra um dia. */
    DB.bookings.push(b);
    if (couponCode) Coupons.consume(couponCode, email);
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudPushBooking === 'function') cloudPushBooking(b);
    if (couponCode && typeof cloudPushState === 'function') cloudPushState();
    return b;
  },

  /* Reserva fechada fora do app (WhatsApp, Instagram, na rua). O guia
     informa o que combinou e quanto ja recebeu — nada e inventado aqui. */
  /* Ela aperta "avisar cliente" quando o dinheiro caiu de verdade. Isto so
     MARCA a reserva; quem manda o e-mail e o robo, de meia em meia hora.
     O e-mail nao pode sair daqui: mandar exige a chave do Resend, e chave
     dentro do navegador fica publica para qualquer um.

     Nao ha "desmarcar": uma vez que o e-mail saiu, ele saiu. Deixar
     desmarcar so criaria um botao que promete desfazer o que nao volta. */
  confirmarCliente(id) {
    const b = Bookings.get(id);
    if (!b || b.clienteConfirmado) return null;
    b.clienteConfirmado = { em: new Date().toISOString() };
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b);
    return b;
  },

  criarManual({ tourId, date, time, name, whats, email, pax, total, recebido, metodo }) {
    const b = {
      id: uid(), code: bookCode(), tourId, date, time,
      name, email: email || '', whats: whats || '', insta: '',
      pax: +pax || 1, total: Math.max(0, +total || 0),
      coupon: null, discount: 0, policy: 'full',
      consent: { ok: false },
      payments: [], status: 'confirmed',
      createdAt: new Date().toISOString(), origin: 'manual',
    };
    const val = Math.max(0, Math.min(+recebido || 0, b.total));
    if (val > 0) {
      b.payments.push({ amount: val, date: isoToday(), method: metodo || 'other',
                        kind: val >= b.total ? 'full' : 'deposit' });
    }
    DB.bookings.push(b);
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudPushBooking === 'function') cloudPushBooking(b);
    return b;
  },

  paid(b)   { return b.payments.reduce((s, p) => s + p.amount, 0); },
  /* ---------- preco escalonado ----------
     O guia vende as primeiras vagas de cada data mais barato: 195 para
     os 3 primeiros, 225 depois. O calculo e por DATA, nao por reserva —
     quem chega quando ja ha 2 vendidos leva 1 barato e o resto caro. */
  precoDe(x, tourId, date, time, pax, opt) {
    const cheio = +x.price || 0;
    const tarde = +x.priceLate || 0;
    const vagasBaratas = +x.earlySeats || 0;
    if (x.priceMode === 'transfer') {
      const opcao = (opt && opt.opcao) || 0;
      const l = transferLinha(x, pax, opcao);
      const v = transferPreco(x, pax, opcao, time);
      return { total: v, linhas: [{ qtd: 1, valor: v, fechado: true }],
               veiculo: l ? l.veiculo : '', malas: l ? l.malas : '', sinal: l ? +l.sinal || 0 : 0,
               noturno: transferNoturno(time), consultar: v === 0 };
    }
    if (x.priceMode === 'tabela') {
      const v = tabelaPreco(x, pax);
      return { total: v, linhas: [{ qtd: pax, valor: v, fechado: true }], consultar: v === 0 };
    }
    if (x.priceMode === 'session') return { total: cheio, linhas: [{ qtd: 1, valor: cheio }] };
    if (!tarde || !vagasBaratas) return { total: cheio * pax, linhas: [{ qtd: pax, valor: cheio }] };

    const jaVendidos = Bookings.vendidosEm(tourId, date, time);
    const baratas = Math.max(0, Math.min(pax, vagasBaratas - jaVendidos));
    const caras = pax - baratas;
    const linhas = [];
    if (baratas) linhas.push({ qtd: baratas, valor: cheio });
    if (caras)   linhas.push({ qtd: caras,   valor: tarde });
    return { total: baratas * cheio + caras * tarde, linhas, baratasRestantes: Math.max(0, vagasBaratas - jaVendidos) };
  },

  /* lugares ja vendidos numa saida — base do preco escalonado e das vagas */
  vendidosEm(tourId, date, time) {
    const local = DB.bookings
      .filter(b => b.tourId === tourId && b.date === date && b.time === time && b.status !== 'cancelled')
      .reduce((s, b) => s + b.pax, 0);
    let n = local;
    if (Array.isArray(DB.seatCounts) && DB.seatCounts.length) {
      const row = DB.seatCounts.find(c => c.tourId === tourId && c.date === date && c.time === time);
      if (row) n = Math.max(local, +row.pax);
    }
    return n;
  },
  due(b)    { return Math.max(0, b.total - Bookings.paid(b)); },
  /* Cada passeio tem seu prazo. O de Natal cobra o saldo 30 dias antes,
     nao na vespera — usar um numero fixo aqui cobraria tarde demais. */
  dueDate(b){
    /* transfer: o sinal garante, o resto e no dia */
    if (b.policy === 'sinal') return b.date;
    const x = Tours.get(b.tourId);
    const dias = (x && +x.balanceDays) || 1;
    return addDays(b.date, -dias);
  },
  payBalance(id, method) {
    const b = Bookings.get(id); if (!b) return;
    const due = Bookings.due(b); if (due <= 0) return;
    b.payments.push({ amount: due, date: isoToday(), method: method || 'card', kind: 'balance' });
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b);
  },
  cancel(id) { const b = Bookings.get(id); if (b) { b.status = 'cancelled';
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b); } },

  /* extrato: uma linha por PAGAMENTO (é o que o contador quer) */
  statement(fromIso, toIso) {
    const rows = [];
    for (const b of DB.bookings) {
      for (const p of b.payments) {
        if (p.date >= fromIso && p.date <= toIso) {
          rows.push({ date: p.date, client: b.name, tourId: b.tourId,
                      kind: p.kind, method: p.method, amount: p.amount, code: b.code });
        }
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  },
};

load();

/* ---------- pedidos de roteiro personalizado ----------
   O que o cliente respondeu em "Monte seu roteiro". A entrega de verdade e
   pelo WhatsApp dela (a mensagem sai pronta); isto aqui e a memoria, para
   ela ver no painel quem pediu, quando, e se ja respondeu.

   Com a nuvem ligada, o pedido de um cliente vive no aparelho DELE ate
   existir uma tabela propria no Supabase — anotado na entrega. */
const Roteiros = {
  all() { return [...(DB.pedidos || [])].sort((a, b) => (b.criado || '').localeCompare(a.criado || '')); },
  cria(r) {
    const limpa = (v) => String(v || '').trim();
    const ped = {
      id: uid(), criado: new Date().toISOString(), respondido: false,
      nome: limpa(r.nome), whats: limpa(r.whats), email: limpa(r.email),
      ini: limpa(r.ini), fim: limpa(r.fim),
      adultos: Math.max(1, +r.adultos || 1), criancas: Math.max(0, +r.criancas || 0), idades: limpa(r.idades),
      onde: [...(r.onde || [])], ondeOutro: limpa(r.ondeOutro),
      gosto: [...(r.gosto || [])], precisa: [...(r.precisa || [])], ritmo: r.ritmo || '',
      obs: limpa(r.obs),
      lang: (typeof LANG !== 'undefined' && LANG === 'en') ? 'en' : 'pt',
    };
    DB.pedidos = DB.pedidos || [];
    DB.pedidos.push(ped);
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    return ped;
  },
  marca(id, respondido) {
    const p = (DB.pedidos || []).find(x => x.id === id);
    if (!p) return;
    p.respondido = !!respondido;
    save();
  },
};

/* ---------- clientes (derivados das reservas) ---------- */
const Clients = {
  all() {
    const map = new Map();
    for (const b of DB.bookings) {
      if (b.status === 'cancelled') continue;
      const key = (b.email || b.whats || b.name).toLowerCase();
      const c = map.get(key) || { name: b.name, email: b.email, whats: b.whats, insta: b.insta,
                                  tours: 0, spent: 0, last: '', origins: new Set(), consent: false, consentAt: '' };
      c.tours += 1;
      c.spent += Bookings.paid(b);
      if (b.date > c.last) c.last = b.date;
      if (b.origin) c.origins.add(b.origin);
      if (b.consent && b.consent.ok) { c.consent = true; c.consentAt = b.consent.at; }
      if (!c.insta && b.insta) c.insta = b.insta;
      map.set(key, c);

      /* QUEM VEIO JUNTO tambem e cliente.

         A Ingrid explicou o porque: muita gente volta anos depois por
         indicacao de alguem que estava NO GRUPO e nunca falou com ela. Se a
         base so tem quem reservou, essa pessoa chega do nada e a indicacao
         se perde. Aqui ela entra com o nome, a data de nascimento e por
         quem veio.

         Nao tem e-mail nem WhatsApp: a chave e o nome. Homonimo junta os
         dois, e tudo bem — e melhor que nao existir. */
      for (const g of (b.group || [])) {
        /* Trim aqui tambem, e nao so em create(): reserva que chega da nuvem
           nao passa por create, e um nome so com espacos viraria um cliente
           sem nome na base dela. */
        const gnome = String((g && g.nome) || '').trim();
        if (!gnome) continue;
        const gk = 'g:' + gnome.toLowerCase();
        const gc = map.get(gk) || { name: gnome, email: '', whats: '', insta: '',
                                    nasc: String((g && g.nasc) || '').trim(), veioCom: b.name, acompanhante: true,
                                    tours: 0, spent: 0, last: '', origins: new Set(),
                                    consent: false, consentAt: '' };
        gc.tours += 1;
        if (b.date > gc.last) gc.last = b.date;
        if (!gc.nasc && g.nasc) gc.nasc = String(g.nasc).trim();
        if (b.origin) gc.origins.add(b.origin);
        map.set(gk, gc);
      }
    }
    /* Acompanhante nao gastou nada por si: ordenar so por gasto jogaria todos
       para o fim da lista. Quem gastou vem primeiro; depois, os mais recentes. */
    return [...map.values()].sort((a, b) =>
      (b.spent - a.spent) || (b.last || '').localeCompare(a.last || ''));
  },
};

/* ---------- relatórios ---------- */
const Reports = {
  /* receita por mês do ano corrente */
  byMonth(year) {
    /* "Recebido" tem que ser dinheiro que ja entrou. Sem este corte, um saldo
       agendado para amanha entrava no grafico como recebido hoje — e o total
       do topo (que so conta ate hoje) discordava do grafico na mesma tela. */
    const hoje = isoToday();
    const out = Array(12).fill(0);
    for (const b of DB.bookings) {
      for (const p of b.payments) {
        if (!p.date || p.date > hoje) continue;
        if (p.date.slice(0, 4) === String(year)) out[+p.date.slice(5, 7) - 1] += p.amount;
      }
    }
    return out;
  },
  /* receita das últimas 8 semanas */
  byWeek(weeks = 8) {
    const out = [];
    let end = isoToday();
    for (let i = 0; i < weeks; i++) {
      const start = addDays(end, -6);
      let sum = 0;
      for (const b of DB.bookings) {
        for (const p of b.payments) if (p.date >= start && p.date <= end) sum += p.amount;
      }
      out.unshift({ label: start.slice(8) + '/' + start.slice(5, 7), value: sum });
      end = addDays(start, -1);
    }
    return out;
  },
  /* desempenho por passeio no intervalo */
  byTour(fromIso, toIso) {
    return Tours.all().map(x => {
      const bs = DB.bookings.filter(b => b.tourId === x.id && b.status !== 'cancelled'
                                    && b.date >= fromIso && b.date <= toIso);
      const deps = new Set(bs.map(b => b.date + b.time));
      const pax = bs.reduce((s, b) => s + b.pax, 0);
      const revenue = bs.reduce((s, b) => s + Bookings.paid(b), 0);
      const seats = deps.size * (x.max || 1);
      return { tour: x, departures: deps.size, pax, revenue,
               occupancy: seats ? Math.round(pax / seats * 100) : 0 };
    }).filter(r => r.departures > 0 || r.revenue > 0);
  },
  /* de onde vieram as reservas */
  byOrigin(fromIso, toIso) {
    const map = {};
    let total = 0;
    for (const b of DB.bookings) {
      if (b.status === 'cancelled' || b.date < fromIso || b.date > toIso) continue;
      const o = b.origin || 'site';
      map[o] = (map[o] || 0) + 1; total++;
    }
    return Object.entries(map)
      .map(([k, n]) => ({ origin: k, n, pct: total ? Math.round(n / total * 100) : 0 }))
      .sort((a, b) => b.n - a.n);
  },
  totals(fromIso, toIso) {
    const bs = DB.bookings.filter(b => b.status !== 'cancelled' && b.date >= fromIso && b.date <= toIso);
    const revenue = DB.bookings.reduce((s, b) =>
      s + b.payments.filter(p => p.date >= fromIso && p.date <= toIso).reduce((t, p) => t + p.amount, 0), 0);
    const pax = bs.reduce((s, b) => s + b.pax, 0);
    const deps = new Set(bs.map(b => b.tourId + b.date + b.time)).size;
    const due = bs.reduce((s, b) => s + Bookings.due(b), 0);
    return { revenue, pax, deps, bookings: bs.length, due,
             ticket: bs.length ? Math.round(revenue / pax || 0) : 0 };
  },
};
