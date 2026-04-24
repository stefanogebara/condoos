import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Users, Vote, Sparkles, Calendar, Package, Waves, Gavel, MessageCircle, ShieldCheck, FileText, Check } from 'lucide-react';
import Logo from '../components/Logo';
import Button from '../components/Button';
import GlassCard from '../components/GlassCard';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Nav */}
      <nav className="sticky top-0 z-30 px-6 lg:px-12 py-4 flex items-center justify-between backdrop-blur-xl bg-cream-50/40 border-b border-white/30">
        <Logo />
        <div className="hidden md:flex items-center gap-1 text-sm text-dusk-300">
          <a href="#features"  className="px-3 py-1.5 rounded-full hover:bg-white/50 transition">Funcionalidades</a>
          <a href="#ago"       className="px-3 py-1.5 rounded-full hover:bg-white/50 transition">AGO</a>
          <a href="#loop"      className="px-3 py-1.5 rounded-full hover:bg-white/50 transition">Como funciona</a>
          <a href="#faq"       className="px-3 py-1.5 rounded-full hover:bg-white/50 transition">Dúvidas</a>
          <a href="https://github.com/stefanogebara/condoos" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-full hover:bg-white/50 transition">GitHub</a>
        </div>
        <Link to="/login"><Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-4 h-4" />}>Entrar</Button></Link>
      </nav>

      {/* Hero — tighter, more confident, Inter Tight first */}
      <section className="relative px-6 lg:px-12 pt-20 pb-28">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_1fr] gap-14 items-center">
          <div className="relative z-10 animate-fade-up">
            <div className="inline-flex items-center gap-3 mb-10">
              <span className="chip">
                <span className="w-1.5 h-1.5 rounded-full bg-sage-400" />
                Acesso antecipado · Para condomínios brasileiros
              </span>
            </div>

            <h1 className="font-display text-dusk-500 leading-[0.95] tracking-tightest"
                style={{ fontSize: 'clamp(3rem, 7vw, 5.5rem)', fontWeight: 600 }}>
              Seu condomínio,
              <br />
              <span className="italic text-dusk-400">em paz.</span>
            </h1>

            <p className="mt-8 text-[17px] md:text-[19px] text-dusk-300 max-w-xl leading-[1.55] tracking-tight">
              Encomendas, visitantes, áreas comuns, votação — e uma IA que transforma reclamações
              em propostas prontas pra pauta e atas em linguagem humana.
            </p>

            <div className="mt-10 flex items-center gap-3 flex-wrap">
              <Link to="/login">
                <Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-5 h-5" />}>
                  Testar a demo
                </Button>
              </Link>
              <a href="#features">
                <Button variant="ghost" size="lg">Ver por dentro</Button>
              </a>
            </div>

            <div className="mt-14 flex items-center gap-6 flex-wrap text-xs uppercase tracking-[0.14em] text-dusk-200 font-medium">
              <span>Claude Haiku</span>
              <span className="w-1 h-1 rounded-full bg-dusk-200/60" />
              <span>Inter Tight</span>
              <span className="w-1 h-1 rounded-full bg-dusk-200/60" />
              <span>Gemini Image</span>
              <span className="w-1 h-1 rounded-full bg-dusk-200/60" />
              <span>SQLite</span>
            </div>
          </div>

          {/* Hero image + floating glass cards */}
          <div className="relative flex items-center justify-center animate-fade-up">
            <div className="relative w-full max-w-[560px] aspect-[4/3] flex items-center justify-center">
              <img
                src="/images/characters/hero-community-01.jpg"
                alt="Uma comunidade de moradores reunida no saguão, um deles segurando o celular com o CondoOS"
                className="w-full h-full object-cover rounded-[36px] shadow-clay-lg animate-float-slow"
              />
              {/* Subtle gradient overlay so the glass cards stay legible */}
              <div className="absolute inset-0 rounded-[36px] bg-gradient-to-br from-cream-50/40 via-transparent to-dusk-500/15 pointer-events-none" />
              <GlassCard className="absolute top-6 -left-2 p-3 px-4 hidden md:flex items-center gap-3 w-56">
                <div className="w-9 h-9 rounded-xl bg-sage-200 flex items-center justify-center text-sage-700"><Package className="w-4 h-4" /></div>
                <div>
                  <div className="text-xs text-dusk-200">2 encomendas</div>
                  <div className="text-sm font-semibold text-dusk-500">Apto 704 · Maya</div>
                </div>
              </GlassCard>
              <GlassCard className="absolute bottom-10 -right-2 p-3 px-4 hidden md:flex items-center gap-3 w-60">
                <div className="w-9 h-9 rounded-xl bg-peach-100 flex items-center justify-center text-peach-500"><Vote className="w-4 h-4" /></div>
                <div>
                  <div className="text-xs text-dusk-200">Votação passando</div>
                  <div className="text-sm font-semibold text-dusk-500">Trocar ar do saguão · 4-1</div>
                </div>
              </GlassCard>
              <GlassCard className="absolute bottom-0 left-6 p-3 px-4 hidden lg:flex items-center gap-3 w-52">
                <div className="w-9 h-9 rounded-xl bg-dusk-100 flex items-center justify-center text-dusk-400"><Sparkles className="w-4 h-4" /></div>
                <div>
                  <div className="text-xs text-dusk-200">IA redigiu</div>
                  <div className="text-sm font-semibold text-dusk-500">3 novas propostas</div>
                </div>
              </GlassCard>
            </div>
          </div>
        </div>
      </section>

      {/* Pull quote — breathe */}
      <section className="relative px-6 lg:px-12 pb-24">
        <div className="max-w-4xl mx-auto text-center">
          <p className="font-display text-2xl md:text-4xl leading-[1.2] tracking-tight text-dusk-400">
            "<span className="italic text-dusk-500">Talvez a gente procure nos galhos o que só se encontra nas raízes.</span>"
          </p>
          <p className="mt-5 text-sm uppercase tracking-[0.16em] text-dusk-200 font-medium">um jeito mais calmo de cuidar do prédio</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative px-6 lg:px-12 pb-28 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-12">
            <span className="chip mb-4"><span className="w-1.5 h-1.5 rounded-full bg-sage-400" /> tudo em um sistema</span>
            <h2 className="font-display text-4xl md:text-5xl text-dusk-500 tracking-tight leading-[1.05] mt-4">
              Tudo que o prédio precisa para rodar.
            </h2>
            <p className="text-dusk-300 mt-4 text-lg leading-relaxed">
              Troque planilhas, grupos de WhatsApp e avisos em papel por um único sistema tranquilo.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { icon: Package,  color: 'sage',  title: 'Encomendas & visitantes', body: 'Fila da portaria em tempo real. Aprove visita pelo celular.' },
              { icon: Waves,    color: 'peach', title: 'Áreas comuns & reservas', body: 'Piscina, academia, salão. Morador reserva. Sem conflito.' },
              { icon: Vote,     color: 'sage',  title: 'Propostas & votação',     body: 'Reclamação vira decisão. Contagem ao vivo. Transparência total.' },
              { icon: Calendar, color: 'peach', title: 'Reuniões',                body: 'Cole as anotações. Saia com resumo, decisões e tarefas.' },
              { icon: Sparkles, color: 'sage',  title: 'Copiloto IA',             body: 'Agrupa reclamações, redige propostas, explica aos moradores.' },
              { icon: Users,    color: 'peach', title: 'Morador em primeiro',     body: 'Comunicado em linguagem humana. Ninguém lê convenção.' },
            ].map((f, i) => (
              <GlassCard key={i} variant="clay" hover className="p-7">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-5 ${
                  f.color === 'sage' ? 'bg-sage-200 text-sage-700' : 'bg-peach-100 text-peach-500'
                }`}>
                  <f.icon className="w-6 h-6" />
                </div>
                <h3 className="font-display text-[20px] font-semibold text-dusk-500 tracking-tight leading-tight">{f.title}</h3>
                <p className="text-[15px] text-dusk-300 leading-relaxed mt-2">{f.body}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* AI callout — dusk landscape with glass cards */}
      <section id="ai" className="relative px-6 lg:px-12 pb-28 scroll-mt-20">
        <div className="max-w-7xl mx-auto relative overflow-hidden rounded-[40px] shadow-clay-lg">
          <img src="/images/bg-dusk.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-dusk-500/10 via-transparent to-dusk-500/30" />
          <div className="relative p-10 md:p-16 text-cream-50">
            <span className="chip bg-white/20 border-white/30 text-cream-50"><Sparkles className="w-3.5 h-3.5" /> Copiloto IA</span>
            <h2 className="font-display text-4xl md:text-[56px] mt-5 max-w-3xl tracking-tightest leading-[1.02]">
              De "o ar do saguão não funciona" à decisão do síndico — em minutos.
            </h2>
            <p className="mt-5 text-cream-50/80 text-lg max-w-xl leading-relaxed">
              Seis momentos de IA, uma interface tranquila. Fallbacks para a demo nunca travar.
            </p>
            <div className="mt-12 grid md:grid-cols-3 gap-5">
              <GlassCard variant="glass-dark" className="p-6">
                <div className="text-xs uppercase tracking-[0.12em] opacity-70 mb-3 font-medium">01 · Morador</div>
                <p className="text-cream-50/95 text-[15px] leading-relaxed italic">"O ar do saguão mal funciona. Ontem marcou 30°C aqui dentro."</p>
              </GlassCard>
              <GlassCard variant="glass-dark" className="p-6">
                <div className="text-xs uppercase tracking-[0.12em] opacity-70 mb-3 font-medium">02 · IA redige</div>
                <p className="font-semibold text-[16px]">Trocar o ar-condicionado do saguão</p>
                <p className="text-[13px] opacity-80 mt-2 leading-relaxed">Manutenção · ~R$ 47.000 · orçamento de 5 TR da Cool Breeze HVAC.</p>
              </GlassCard>
              <GlassCard variant="glass-dark" className="p-6">
                <div className="text-xs uppercase tracking-[0.12em] opacity-70 mb-3 font-medium">03 · Síndico abre votação</div>
                <p className="text-[15px] leading-relaxed">Votação abre → moradores aprovam → IA publica o anúncio em linguagem humana.</p>
              </GlassCard>
            </div>
          </div>
        </div>
      </section>

      {/* AGO / Brazilian section — the moat */}
      <section id="ago" className="relative px-6 lg:px-12 pb-28 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center mb-14">
            <div className="max-w-xl">
              <Badge tone="peach" className="mb-4"><Gavel className="w-3 h-3" /> Compliance brasileira</Badge>
              <h2 className="font-display text-4xl md:text-5xl text-dusk-500 tracking-tight leading-[1.05] mt-4">
                AGO no app.
                <br />
                <span className="italic text-dusk-400">Ata gerada pela IA.</span>
              </h2>
              <p className="text-dusk-300 mt-4 text-lg leading-relaxed">
                Convocação com 8 dias de antecedência, procurações digitais, quórum aplicado automaticamente,
                votação por maioria simples ou 2/3 (convenção), e a ata sai pronta no fim da sessão.
                Tudo alinhado ao Código Civil Art. 1350.
              </p>
            </div>
            <div className="relative">
              <img
                src="/images/characters/char-ago-assembly.jpg"
                alt="Condo residents seated around a table at an AGO assembly meeting"
                className="w-full rounded-[32px] shadow-clay-lg"
              />
              <GlassCard className="absolute -bottom-5 -left-3 p-3 px-4 flex items-center gap-3 w-56">
                <div className="w-9 h-9 rounded-xl bg-sage-200 flex items-center justify-center text-sage-700"><ShieldCheck className="w-4 h-4" /></div>
                <div>
                  <div className="text-xs text-dusk-200">Quórum atingido</div>
                  <div className="text-sm font-semibold text-dusk-500">12 de 16 presentes</div>
                </div>
              </GlassCard>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            {[
              { icon: FileText,    title: 'Pauta auto-gerada',    body: 'A IA monta a pauta a partir das propostas abertas — contas, orçamento, assuntos do síndico.' },
              { icon: Users,       title: 'Procurações digitais', body: 'Moradores concedem procuração a outro proprietário em 10s. Voto com peso correto.' },
              { icon: ShieldCheck, title: 'Quórum por item',      body: 'Maioria simples, 2/3 ou unanimidade — aplicado por tipo de pauta (convenção, orçamento, eleição).' },
              { icon: Sparkles,    title: 'Ata em PT-BR',         body: 'Fechou a sessão? A ata já está escrita, com presença, votos e deliberações. Só revisar.' },
            ].map((f, i) => (
              <GlassCard key={i} variant="clay" hover className="p-6">
                <div className="w-11 h-11 rounded-2xl bg-peach-100 text-peach-700 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-display text-[18px] font-semibold text-dusk-500 tracking-tight leading-tight">{f.title}</h3>
                <p className="text-[14px] text-dusk-300 leading-relaxed mt-2">{f.body}</p>
              </GlassCard>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-4 flex-wrap text-xs uppercase tracking-[0.14em] text-dusk-200 font-medium">
            <span>Código Civil Art. 1350</span>
            <span className="w-1 h-1 rounded-full bg-dusk-200/60" />
            <span>LGPD</span>
            <span className="w-1 h-1 rounded-full bg-dusk-200/60" />
            <span>Assinatura digital opcional</span>
          </div>
        </div>
      </section>

      {/* How it works — the full loop */}
      <section id="loop" className="relative px-6 lg:px-12 pb-28 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-12">
            <span className="chip mb-4"><span className="w-1.5 h-1.5 rounded-full bg-sage-400" /> uma semana no CondoOS</span>
            <h2 className="font-display text-4xl md:text-5xl text-dusk-500 tracking-tight leading-[1.05] mt-4">
              Da reclamação
              <br />
              <span className="italic text-dusk-400">ao WhatsApp.</span>
            </h2>
            <p className="text-dusk-300 mt-4 text-lg leading-relaxed">
              Uma semana real. De "o ar do saguão não tá funcionando" até o morador ler a decisão no celular.
            </p>
          </div>

          <div className="relative">
            <div className="absolute left-[22px] top-6 bottom-6 w-px bg-dusk-200/40 hidden md:block" />
            <div className="space-y-5">
              {[
                { day: 'Seg',    icon: MessageCircle, color: 'sage',  title: 'Morador reclama na aba Sugerir', body: '"O ar do saguão tá quebrado. Ontem marcou 30°C aqui dentro." A IA transforma em proposta estruturada (Manutenção · ~R$ 47.000).' },
                { day: 'Ter',    icon: Users,         color: 'peach', title: 'Discussão entre vizinhos',        body: 'Comentários, fotos, sugestões. A IA resume a thread em pontos de acordo e desacordo para o síndico.' },
                { day: 'Qua',    icon: Vote,          color: 'sage',  title: 'Votação abre com quórum + janela', body: 'Síndico define quórum (50%) e janela (48h). WhatsApp dispara para todos os moradores elegíveis.' },
                { day: 'Sex',    icon: Gavel,         color: 'peach', title: 'Fechamento automático + decisão', body: 'Janela expirou, quórum batido. Outcome resolvido, síndico fecha com um clique e a IA escreve a comunicação oficial.' },
                { day: 'Sáb',    icon: Sparkles,      color: 'sage',  title: 'Anúncio em linguagem humana',     body: 'Morador recebe no WhatsApp: "Aprovada a troca do ar do saguão. Instalação na semana do dia 5." Sem juridiquês.' },
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-5 relative">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 shadow-clay-sm bg-cream-50 border-2 ${
                    step.color === 'sage' ? 'text-sage-700 border-sage-300' : 'text-peach-700 border-peach-300'
                  }`}>
                    <step.icon className="w-5 h-5" />
                  </div>
                  <GlassCard variant="clay" className="flex-1 p-5 flex items-start gap-4">
                    <div className="font-mono text-xs uppercase tracking-widest text-dusk-200 shrink-0 pt-1">{step.day}</div>
                    <div>
                      <h4 className="font-display text-[17px] font-semibold text-dusk-500 tracking-tight">{step.title}</h4>
                      <p className="text-[14px] text-dusk-300 mt-1 leading-relaxed">{step.body}</p>
                    </div>
                  </GlassCard>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Every resident — accessibility + Brazilian warmth (text-left, image-right for rhythm) */}
      <section id="every-resident" className="relative px-6 lg:px-12 pb-28">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="max-w-xl order-2 lg:order-1">
            <Badge tone="sage" className="mb-4">Para cada morador</Badge>
            <h2 className="font-display text-4xl md:text-5xl text-dusk-500 tracking-tight leading-[1.05]">
              Do adolescente de skate
              <br />
              <span className="italic text-dusk-400">à Dona Teresa de 72.</span>
            </h2>
            <p className="text-dusk-300 mt-4 text-lg leading-relaxed">
              Todos votam. Todos se inteiram. Ninguém precisa virar especialista em condomínio.
              A IA explica em linguagem humana. O WhatsApp entrega o aviso onde o morador já está.
            </p>
            <ul className="mt-6 space-y-3 text-dusk-400">
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-sage-700 shrink-0 mt-0.5" /><span><strong className="text-dusk-500">Fonte grande, contraste alto</strong> — sem lupa, sem desculpa.</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-sage-700 shrink-0 mt-0.5" /><span><strong className="text-dusk-500">Notificação no WhatsApp</strong> — chega onde o morador já passa o dia.</span></li>
              <li className="flex items-start gap-3"><Check className="w-5 h-5 text-sage-700 shrink-0 mt-0.5" /><span><strong className="text-dusk-500">Explicação em linguagem humana</strong> — a IA traduz o juridiquês antes do voto.</span></li>
            </ul>
          </div>
          <div className="relative order-1 lg:order-2">
            <img
              src="/images/characters/char-elderly-confident.jpg"
              alt="Uma moradora mais velha usando o CondoOS no celular na mesa da cozinha"
              className="w-full rounded-[32px] shadow-clay-lg"
            />
            <GlassCard className="absolute -top-4 -right-3 p-3 px-4 flex items-center gap-3 w-52">
              <div className="w-9 h-9 rounded-xl bg-peach-100 flex items-center justify-center text-peach-500"><MessageCircle className="w-4 h-4" /></div>
              <div>
                <div className="text-xs text-dusk-200">Nova mensagem</div>
                <div className="text-sm font-semibold text-dusk-500">Votação aberta</div>
              </div>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* Votação no bolso — the money-shot clay-phone UI + relaxed-sofa voting */}
      <section className="relative px-6 lg:px-12 pb-28">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <Badge tone="sage" className="mb-4">Votação no bolso</Badge>
            <h2 className="font-display text-4xl md:text-5xl text-dusk-500 tracking-tight leading-[1.05]">
              3 segundos.
              <br />
              <span className="italic text-dusk-400">Enquanto pega o café.</span>
            </h2>
            <p className="text-dusk-300 mt-4 text-lg leading-relaxed">
              Proposta abriu? O morador vota sem sair do sofá. Contagem ao vivo,
              janela de 48 horas, fechamento automático — o síndico nem precisa ligar no grupo.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5 items-center">
            <div className="relative rounded-[32px] overflow-hidden shadow-clay-lg bg-cream-50/60">
              <img
                src="/images/characters/char-phone-closeup-ui.jpg"
                alt="Mão segurando o celular com a tela de votação em claymorphism — 'Vote tally' com gráfico de pizza"
                className="w-full aspect-square object-cover"
              />
              <GlassCard className="absolute bottom-5 left-5 p-3 px-4 flex items-center gap-3 w-56">
                <div className="w-9 h-9 rounded-xl bg-sage-200 flex items-center justify-center text-sage-700"><Vote className="w-4 h-4" /></div>
                <div>
                  <div className="text-xs text-dusk-200">Fecha em 2d 4h</div>
                  <div className="text-sm font-semibold text-dusk-500">Sim 9 · Não 2 · Abs 1</div>
                </div>
              </GlassCard>
            </div>
            <div className="relative rounded-[32px] overflow-hidden shadow-clay-lg">
              <img
                src="/images/characters/char-voting-phone.jpg"
                alt="Morador no sofá tocando no celular para votar"
                className="w-full aspect-square object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-dusk-500/70 to-transparent text-cream-50">
                <div className="text-xs uppercase tracking-[0.14em] text-cream-50/80 font-medium">Sem fila, sem burocracia</div>
                <h3 className="font-display text-2xl mt-1">Voto que cabe no dia do morador.</h3>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Day-to-day band — packages + visitors + WhatsApp + family, PT-BR */}
      <section className="relative px-6 lg:px-12 pb-28">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-5">
            <div className="relative rounded-[32px] overflow-hidden shadow-clay-lg group">
              <img src="/images/characters/char-package-arrival.jpg" alt="Porteiro entregando uma encomenda para a moradora" className="w-full h-[340px] object-cover transition-transform duration-700 group-hover:scale-[1.02]" />
              <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-dusk-500/70 to-transparent">
                <div className="text-xs uppercase tracking-[0.14em] text-cream-50/80 font-medium">Portaria</div>
                <h3 className="font-display text-2xl text-cream-50 mt-1">Encomenda chegou? O morador sabe.</h3>
                <p className="text-sm text-cream-50/80 mt-1">Notificação no app e no WhatsApp — sem o grupo do prédio virar caos.</p>
              </div>
            </div>
            <div className="relative rounded-[32px] overflow-hidden shadow-clay-lg group">
              <img src="/images/characters/char-whatsapp-msg.jpg" alt="Mão segurando o celular com mensagem do CondoOS no WhatsApp" className="w-full h-[340px] object-cover transition-transform duration-700 group-hover:scale-[1.02]" />
              <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-dusk-500/70 to-transparent">
                <div className="text-xs uppercase tracking-[0.14em] text-cream-50/80 font-medium">WhatsApp</div>
                <h3 className="font-display text-2xl text-cream-50 mt-1">Aviso onde o morador já está.</h3>
                <p className="text-sm text-cream-50/80 mt-1">Convocação de AGO, abertura de votação, chegada de encomenda — direto no WhatsApp.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative px-6 lg:px-12 pb-28 scroll-mt-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl text-dusk-500 tracking-tight leading-[1.05]">
              Dúvidas frequentes
            </h2>
          </div>
          <div className="space-y-3">
            {[
              { q: 'Quanto custa?', a: 'Durante o beta (2026), grátis para até 50 unidades. Planos pagos a partir de R$ 2/unidade/mês quando sairmos do beta. Sem setup fee.' },
              { q: 'Como funciona a LGPD?', a: 'Dados pessoais ficam em servidores no Brasil. Apenas dados essenciais (nome, unidade, voto) são armazenados. Morador pode exportar ou deletar a qualquer momento.' },
              { q: 'A ata gerada pela IA tem validade legal?', a: 'A IA gera o rascunho. O síndico/secretário revisa e assina — é o ato jurídico humano que dá validade, como sempre foi.' },
              { q: 'Funciona sem internet?', a: 'Durante a assembleia presencial, sim — os votos ficam em fila no celular e sincronizam quando a conexão voltar. Já validado em prédios com Wi-Fi ruim no saguão.' },
              { q: 'Inquilinos votam?', a: 'Não. Por padrão, só proprietários ativos (Código Civil). Em propostas não-estatutárias, o síndico pode abrir voto para todos os residentes.' },
              { q: 'Podemos migrar do sistema atual?', a: 'CSV de moradores → importado em 1 clique. Histórico de atas antigas → importamos em PDF na ativação. Zero digitação para o síndico.' },
            ].map((item, i) => (
              <details key={i} className="group">
                <summary className="cursor-pointer list-none">
                  <GlassCard className="p-5 flex items-start justify-between gap-4 group-hover:bg-cream-50/60 transition">
                    <h4 className="font-display text-[17px] font-semibold text-dusk-500 tracking-tight">{item.q}</h4>
                    <span className="text-dusk-300 group-open:rotate-45 transition-transform text-xl leading-none shrink-0">+</span>
                  </GlassCard>
                </summary>
                <div className="px-5 py-4 text-[15px] text-dusk-400 leading-relaxed">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative px-6 lg:px-12 pb-28">
        <div className="max-w-4xl mx-auto text-center relative">
          <img
            src="/images/characters/char-brazilian-family.jpg"
            alt=""
            aria-hidden
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] max-w-full opacity-20 blur-[2px] rounded-[40px] pointer-events-none select-none"
          />
          <h2 className="font-display text-4xl md:text-5xl text-dusk-500 tracking-tight leading-[1.05] relative">
            Vai que é hoje.
          </h2>
          <p className="text-dusk-300 mt-4 text-lg max-w-xl mx-auto relative">
            Entre com o Google em 10 segundos. Demo pronta para mostrar ao síndico no próximo grupo do prédio.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 flex-wrap relative">
            <Link to="/login">
              <Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-5 h-5" />}>
                Entrar e explorar a demo
              </Button>
            </Link>
            <a href="https://github.com/stefanogebara/condoos" target="_blank" rel="noreferrer">
              <Button variant="ghost" size="lg">Ver código no GitHub</Button>
            </a>
          </div>
          <div className="mt-6 flex items-center justify-center gap-4 flex-wrap text-xs text-dusk-300 relative">
            <span className="inline-flex items-center gap-1.5"><Check className="w-3 h-3 text-sage-700" /> Login com Google</span>
            <span className="inline-flex items-center gap-1.5"><Check className="w-3 h-3 text-sage-700" /> Dados seus ficam seus</span>
            <span className="inline-flex items-center gap-1.5"><Check className="w-3 h-3 text-sage-700" /> Sem cartão de crédito no beta</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 lg:px-12 py-12 border-t border-white/40 bg-cream-50/30 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-dusk-300">
          <Logo size={22} />
          <p className="font-mono text-xs text-dusk-200">© 2026 CondoOS · feito em hackathon, desenhado para humanos</p>
          <div className="flex items-center gap-4 text-xs">
            <Link to="/design" className="hover:text-dusk-500 transition">Design system</Link>
            <a href="https://github.com/stefanogebara/condoos" target="_blank" rel="noreferrer" className="hover:text-dusk-500 transition">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
