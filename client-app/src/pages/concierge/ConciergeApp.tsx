// Concierge / Porteiro single-page app — mobile-first, no sidebar.
//
// Polls /api/concierge/today every 20s. New visitors / packages / parties
// since the last poll fire a Browser Notification (after one-time consent).
// All three sections render inline so the porteiro doesn't have to navigate.
//
// v1: only browser notifications. Real Web Push (VAPID + service worker)
// is a follow-up — works only when the page is open, but that's the realistic
// guard scenario at the desk anyway.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  DoorOpen, Package, PartyPopper, Bell, BellOff, Check, X, RefreshCw,
  LogOut, Clock, Users,
} from 'lucide-react';
import Logo from '../../components/Logo';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/i18n';

interface VisitorRow {
  id: number;
  visitor_name: string;
  visitor_type: string;
  expected_at: string | null;
  status: 'pending' | 'approved' | 'arrived' | 'completed' | 'denied';
  notes: string | null;
  created_at: string;
  decided_at: string | null;
  host_first: string;
  host_last: string;
  unit_number: string | null;
}
interface PackageRow {
  id: number;
  carrier: string;
  description: string | null;
  arrived_at: string;
  status: string;
  first_name: string;
  last_name: string;
  unit_number: string | null;
}
interface PartyRow {
  id: number;
  starts_at: string;
  ends_at: string;
  expected_guests: number | null;
  guest_list: string | null;
  notes: string | null;
  amenity_name: string;
  amenity_icon: string;
  first_name: string;
  last_name: string;
  unit_number: string | null;
}
interface TodayPayload {
  visitors: VisitorRow[];
  packages: PackageRow[];
  parties: PartyRow[];
  today: string;
}

const POLL_MS = 20_000;

function timeOnly(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function VISITOR_TYPE_LABEL(t: string): string {
  return ({ guest: 'Visita', delivery: 'Entrega', service: 'Serviço', rideshare: 'App' } as Record<string, string>)[t] || t;
}

function notify(title: string, body: string) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/favicon.svg', tag: title });
  } catch { /* some browsers throw on focus-blocked notifications */ }
}

export default function ConciergeApp() {
  const { user, logout } = useAuth();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifPerm, setNotifPerm] = useState<'default' | 'granted' | 'denied' | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as any)
  );
  // Track the IDs we've already seen so we only fire a notification once.
  const seenVisitors = useRef<Set<number>>(new Set());
  const seenPackages = useRef<Set<number>>(new Set());
  const isFirstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await apiGet<TodayPayload>('/concierge/today');
      // Diff against previous state to surface new arrivals.
      if (!isFirstLoad.current) {
        for (const v of next.visitors) {
          if (!seenVisitors.current.has(v.id) && v.status !== 'arrived' && v.status !== 'completed') {
            notify(
              `Novo visitante — ${v.visitor_name}`,
              `${VISITOR_TYPE_LABEL(v.visitor_type)} para ${v.host_first} (${v.unit_number || 's/n'})`
            );
          }
        }
        for (const p of next.packages) {
          if (!seenPackages.current.has(p.id)) {
            notify(
              `Nova encomenda — ${p.carrier}`,
              `Para ${p.first_name} ${p.last_name} (${p.unit_number || 's/n'})`
            );
          }
        }
      }
      seenVisitors.current = new Set(next.visitors.map((v) => v.id));
      seenPackages.current = new Set(next.packages.map((p) => p.id));
      isFirstLoad.current = false;
      setData(next);
    } catch (err) {
      // Polling shouldn't spam toasts — just leave the previous data on screen.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function requestNotifications() {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotifPerm(result as any);
    if (result === 'granted') {
      toast.success('Notificações ativadas');
    } else if (result === 'denied') {
      toast.error('Notificações bloqueadas — habilite nas configurações do navegador');
    }
  }

  async function markArrived(v: VisitorRow) {
    try {
      await apiPost(`/visitors/${v.id}/arrived`);
      toast.success(`${v.visitor_name} liberado(a)`);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao liberar');
    }
  }

  async function decideVisitor(v: VisitorRow, decision: 'approved' | 'denied') {
    try {
      await apiPost(`/visitors/${v.id}/decide`, { decision });
      toast.success(decision === 'approved' ? `${v.visitor_name} aprovado(a)` : `${v.visitor_name} negado(a)`);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao decidir');
    }
  }

  async function pickupPackage(p: PackageRow) {
    try {
      await apiPost(`/packages/${p.id}/pickup`);
      toast.success(`Encomenda de ${p.first_name} retirada`);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha');
    }
  }

  const totals = useMemo(() => ({
    visitors: data?.visitors.filter((v) => v.status !== 'completed' && v.status !== 'arrived').length || 0,
    packages: data?.packages.length || 0,
    parties: data?.parties.length || 0,
  }), [data]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-cream-50/80 backdrop-blur-xl border-b border-white/40 px-4 py-3 flex items-center gap-3">
        <Logo size={22} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-dusk-500 truncate">{user?.first_name} · Portaria</div>
          <div className="text-[11px] text-dusk-300">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <button onClick={() => load()} title="Atualizar" aria-label="Atualizar" className="p-2 rounded-full hover:bg-white/60 text-dusk-400">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {notifPerm === 'default' && (
          <button onClick={requestNotifications} title="Ativar notificações" className="p-2 rounded-full bg-sage-100 hover:bg-sage-200 text-sage-700">
            <Bell className="w-4 h-4" />
          </button>
        )}
        {notifPerm === 'denied' && (
          <span title="Notificações bloqueadas" className="p-2 rounded-full text-peach-500">
            <BellOff className="w-4 h-4" />
          </span>
        )}
        {notifPerm === 'granted' && (
          <span title="Notificações ativadas" className="p-2 rounded-full text-sage-700">
            <Bell className="w-4 h-4" />
          </span>
        )}
        <button onClick={() => { logout(); }} title="Sair" aria-label="Sair" className="p-2 rounded-full hover:bg-white/60 text-dusk-400">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 px-4 py-4 max-w-2xl mx-auto w-full space-y-6">
        {/* Section: Visitors */}
        <section>
          <h2 className="font-display text-xl text-dusk-500 mb-3 flex items-center gap-2">
            <DoorOpen className="w-5 h-5" /> Visitantes hoje
            {totals.visitors > 0 && <Badge tone="peach">{totals.visitors}</Badge>}
          </h2>
          {(!data || data.visitors.length === 0) ? (
            <GlassCard className="p-5 text-sm text-dusk-300 text-center">
              {loading ? 'Carregando…' : 'Nenhum visitante esperado hoje.'}
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {data.visitors.map((v) => (
                <GlassCard key={v.id} variant="clay" className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                      <DoorOpen className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-dusk-500 truncate">{v.visitor_name}</span>
                        <Badge tone={v.status === 'approved' ? 'sage' : v.status === 'pending' ? 'warning' : 'neutral'}>
                          {v.status === 'approved' ? 'liberado' : v.status === 'pending' ? 'aguardando' : v.status}
                        </Badge>
                        <Badge tone="neutral">{VISITOR_TYPE_LABEL(v.visitor_type)}</Badge>
                      </div>
                      <div className="text-xs text-dusk-300 mt-1 flex items-center gap-1.5 flex-wrap">
                        <Users className="w-3 h-3" />
                        {v.host_first} {v.host_last}
                        {v.unit_number && <span className="font-mono">· Apto {v.unit_number}</span>}
                        {v.expected_at && <><Clock className="w-3 h-3 ml-1" /> {timeOnly(v.expected_at)}</>}
                      </div>
                      {v.notes && <div className="text-[12px] text-dusk-300 mt-1 italic">"{v.notes}"</div>}
                      <div className="mt-3 flex gap-2 flex-wrap">
                        {v.status === 'pending' && (
                          <>
                            <Button size="sm" variant="primary" onClick={() => decideVisitor(v, 'approved')} leftIcon={<Check className="w-3.5 h-3.5" />}>Liberar</Button>
                            <Button size="sm" variant="ghost" onClick={() => decideVisitor(v, 'denied')} leftIcon={<X className="w-3.5 h-3.5" />}>Negar</Button>
                          </>
                        )}
                        {v.status === 'approved' && (
                          <Button size="sm" variant="primary" onClick={() => markArrived(v)} leftIcon={<Check className="w-3.5 h-3.5" />}>Marcar como chegou</Button>
                        )}
                      </div>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </section>

        {/* Section: Packages */}
        <section>
          <h2 className="font-display text-xl text-dusk-500 mb-3 flex items-center gap-2">
            <Package className="w-5 h-5" /> Encomendas pendentes
            {totals.packages > 0 && <Badge tone="peach">{totals.packages}</Badge>}
          </h2>
          {(!data || data.packages.length === 0) ? (
            <GlassCard className="p-5 text-sm text-dusk-300 text-center">
              Nenhuma encomenda aguardando retirada.
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {data.packages.map((p) => (
                <GlassCard key={p.id} variant="clay" className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-dusk-500 truncate">{p.first_name} {p.last_name}</span>
                      {p.unit_number && <Badge tone="neutral">Apto {p.unit_number}</Badge>}
                    </div>
                    <div className="text-xs text-dusk-300 mt-0.5">
                      {p.carrier}{p.description ? ` · ${p.description}` : ''} · chegou {formatDateTime(p.arrived_at)}
                    </div>
                  </div>
                  <Button size="sm" variant="primary" onClick={() => pickupPackage(p)} leftIcon={<Check className="w-3.5 h-3.5" />}>Retirar</Button>
                </GlassCard>
              ))}
            </div>
          )}
        </section>

        {/* Section: Parties / events */}
        {data && data.parties.length > 0 && (
          <section>
            <h2 className="font-display text-xl text-dusk-500 mb-3 flex items-center gap-2">
              <PartyPopper className="w-5 h-5" /> Eventos hoje
            </h2>
            <div className="space-y-3">
              {data.parties.map((party) => (
                <GlassCard key={party.id} variant="clay-peach" className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                      <PartyPopper className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-dusk-500">{party.amenity_name}</span>
                        {(party.expected_guests || 0) > 0 && (
                          <Badge tone="peach">{party.expected_guests} convidados</Badge>
                        )}
                      </div>
                      <div className="text-xs text-dusk-300 mt-1">
                        {timeOnly(party.starts_at)}–{timeOnly(party.ends_at)} ·
                        {' '}{party.first_name} {party.last_name}
                        {party.unit_number && <span className="font-mono"> · Apto {party.unit_number}</span>}
                      </div>
                      {party.notes && <div className="text-[12px] text-dusk-300 mt-1 italic">"{party.notes}"</div>}
                      {party.guest_list && (
                        <details className="mt-2">
                          <summary className="text-xs text-dusk-400 underline decoration-dotted underline-offset-4 cursor-pointer">
                            Lista de convidados ({party.guest_list.split('\n').filter(Boolean).length})
                          </summary>
                          <pre className="text-xs text-dusk-400 mt-2 whitespace-pre-wrap font-sans bg-white/40 rounded-xl p-2">
                            {party.guest_list}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          </section>
        )}

        <footer className="text-center text-[11px] text-dusk-200 pt-6 pb-10">
          Atualiza a cada {POLL_MS / 1000}s automaticamente
        </footer>
      </main>
    </div>
  );
}
