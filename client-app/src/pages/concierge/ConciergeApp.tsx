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
  DoorOpen, Package, PartyPopper, Bell, BellOff, Check, RefreshCw,
  LogOut, Clock, Users, PhoneCall, Send, AlertTriangle, Search, X,
} from 'lucide-react';
import Logo from '../../components/Logo';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, currentIntlLocale, t } from '../../lib/i18n';

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
  host_mobile_phone?: string | null;
  host_home_phone?: string | null;
  host_phone?: string | null;
  expected_guests?: number | null;
  guest_list?: string | null;
  recurring_days?: string | null;
  recurring_until?: string | null;
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
  mobile_phone?: string | null;
  home_phone?: string | null;
  phone?: string | null;
}
interface PartyRow {
  id: number | string;
  starts_at: string | null;
  ends_at: string | null;
  expected_guests: number | null;
  guest_list: string | null;
  notes: string | null;
  amenity_name: string;
  amenity_icon: string;
  first_name: string;
  last_name: string;
  unit_number: string | null;
  mobile_phone?: string | null;
  home_phone?: string | null;
  phone?: string | null;
}
interface ResidentRow {
  id: number;
  first_name: string;
  last_name: string;
  unit_number: string | null;
  mobile_phone?: string | null;
  home_phone?: string | null;
  phone?: string | null;
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
  return d.toLocaleTimeString(currentIntlLocale(), { hour: '2-digit', minute: '2-digit' });
}

function visitorTypeLabel(value: string): string {
  return t(({ guest: 'Visita', delivery: 'Entrega', service: 'Serviço', rideshare: 'App' } as Record<string, string>)[value] || value);
}

function contactNumbers(row: {
  mobile_phone?: string | null;
  home_phone?: string | null;
  phone?: string | null;
  host_mobile_phone?: string | null;
  host_home_phone?: string | null;
  host_phone?: string | null;
}) {
  return [
    ['Celular', row.host_mobile_phone ?? row.mobile_phone],
    ['Casa', row.host_home_phone ?? row.home_phone],
    ['Tel', row.host_phone ?? row.phone],
  ].filter(([, value], idx, all) => {
    if (!value) return false;
    return all.findIndex(([, other]) => other === value) === idx;
  }) as Array<[string, string]>;
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
  const [residents, setResidents] = useState<ResidentRow[]>([]);
  const [search, setSearch] = useState('');
  const [walkup, setWalkup] = useState({
    resident_id: '',
    visitor_name: '',
    visitor_type: 'guest',
    notes: '',
  });
  const [loading, setLoading] = useState(true);
  const [creatingWalkup, setCreatingWalkup] = useState(false);
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
              `${t('Novo visitante')} - ${v.visitor_name}`,
              `${visitorTypeLabel(v.visitor_type)} ${t('para')} ${v.host_first} (${v.unit_number || t('s/n')})`
            );
          }
        }
        for (const p of next.packages) {
          if (!seenPackages.current.has(p.id)) {
            notify(
              `${t('Nova encomenda')} - ${p.carrier}`,
              `${t('Para')} ${p.first_name} ${p.last_name} (${p.unit_number || t('s/n')})`
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
    apiGet<ResidentRow[]>('/users/residents').then(setResidents).catch(() => {});
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function requestNotifications() {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotifPerm(result as any);
    if (result === 'granted') {
      toast.success(t('Notificações ativadas'));
    } else if (result === 'denied') {
      toast.error(t('Notificações bloqueadas — habilite nas configurações do navegador'));
    }
  }

  async function markArrived(v: VisitorRow) {
    try {
      await apiPost(`/visitors/${v.id}/arrived`);
      toast.success(`${v.visitor_name} ${t('liberado(a)')}`);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao liberar'));
    }
  }

  async function pickupPackage(p: PackageRow) {
    try {
      await apiPost(`/packages/${p.id}/pickup`);
      toast.success(`${t('Encomenda de')} ${p.first_name} ${t('retirada')}`);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha'));
    }
  }

  async function notifyResident(target_type: 'visitor' | 'package', target_id: number, message_type: 'visitor_arrived' | 'package_arrived' | 'food_delivery_arrived') {
    try {
      await apiPost('/concierge/notify', { target_type, target_id, message_type });
      toast.success(t('Morador avisado'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao avisar'));
    }
  }

  async function createWalkup(e: React.FormEvent) {
    e.preventDefault();
    if (!walkup.resident_id || !walkup.visitor_name.trim()) return;
    setCreatingWalkup(true);
    try {
      await apiPost('/concierge/walkup', {
        resident_id: Number(walkup.resident_id),
        visitor_name: walkup.visitor_name.trim(),
        visitor_type: walkup.visitor_type,
        notes: walkup.notes.trim() || null,
      });
      toast.success(t('Morador avisado para aprovar no app'));
      setWalkup({ resident_id: '', visitor_name: '', visitor_type: 'guest', notes: '' });
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao avisar'));
    } finally {
      setCreatingWalkup(false);
    }
  }

  const totals = useMemo(() => ({
    visitors: data?.visitors.filter((v) => v.status !== 'completed' && v.status !== 'arrived').length || 0,
    packages: data?.packages.length || 0,
    parties: data?.parties.length || 0,
  }), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hay = (...values: Array<string | number | null | undefined>) => values
      .filter((value) => value !== null && value !== undefined)
      .join(' ')
      .toLowerCase();
    if (!q || !data) return {
      visitors: data?.visitors || [],
      packages: data?.packages || [],
      parties: data?.parties || [],
    };
    return {
      visitors: data.visitors.filter((v) => hay(
        v.visitor_name, v.visitor_type, v.host_first, v.host_last, v.unit_number,
        v.notes, v.guest_list, v.host_mobile_phone, v.host_home_phone, v.host_phone,
      ).includes(q)),
      packages: data.packages.filter((p) => hay(
        p.carrier, p.description, p.first_name, p.last_name, p.unit_number,
        p.mobile_phone, p.home_phone, p.phone,
      ).includes(q)),
      parties: data.parties.filter((party) => hay(
        party.amenity_name, party.first_name, party.last_name, party.unit_number,
        party.guest_list, party.notes, party.mobile_phone, party.home_phone, party.phone,
      ).includes(q)),
    };
  }, [data, search]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-cream-50/80 backdrop-blur-xl border-b border-white/40 px-4 py-3 flex items-center gap-3">
        <Logo size={22} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-dusk-500 truncate">{user?.first_name} · {t('Portaria')}</div>
          <div className="text-[11px] text-dusk-300">{new Date().toLocaleDateString(currentIntlLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <button onClick={() => load()} title={t('Atualizar')} aria-label={t('Atualizar')} className="p-2 rounded-full hover:bg-white/60 text-dusk-400">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {notifPerm === 'default' && (
          <button onClick={requestNotifications} title={t('Ativar notificações')} className="p-2 rounded-full bg-sage-100 hover:bg-sage-200 text-sage-700">
            <Bell className="w-4 h-4" />
          </button>
        )}
        {notifPerm === 'denied' && (
          <span title={t('Notificações bloqueadas')} className="p-2 rounded-full text-peach-500">
            <BellOff className="w-4 h-4" />
          </span>
        )}
        {notifPerm === 'granted' && (
          <span title={t('Notificações ativadas')} className="p-2 rounded-full text-sage-700">
            <Bell className="w-4 h-4" />
          </span>
        )}
        <button onClick={() => { logout(); }} title={t('Sair')} aria-label={t('Sair')} className="p-2 rounded-full hover:bg-white/60 text-dusk-400">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 px-4 py-4 max-w-2xl mx-auto w-full space-y-6">
        <GlassCard className="p-3 sticky top-[65px] z-10">
          <label className="relative block">
            <Search className="w-5 h-5 text-dusk-300 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="input pl-10 pr-10 text-lg"
              placeholder={t('Search unit, resident, visitor, package, or party')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('Search front desk queue')}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dusk-300 hover:text-dusk-500"
                aria-label={t('Clear search')}
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </label>
          {search && (
            <div className="text-xs text-dusk-300 mt-2 px-1">
              {filtered.visitors.length + filtered.packages.length + filtered.parties.length} {t('matching front desk items')}
            </div>
          )}
        </GlassCard>

        <section>
          <h2 className="font-display text-xl text-dusk-500 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> {t('Chegada sem pré-aprovação')}
          </h2>
          <GlassCard className="p-4">
            <form onSubmit={createWalkup} className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs text-dusk-300">
                  {t('Apartamento / morador')}
                  <select
                    className="input mt-1"
                    value={walkup.resident_id}
                    onChange={(e) => setWalkup({ ...walkup, resident_id: e.target.value })}
                    required
                  >
                    <option value="">{t('Selecionar')}</option>
                    {residents.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.unit_number ? `${r.unit_number} · ` : ''}{r.first_name} {r.last_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-dusk-300">
                  {t('Tipo')}
                  <select
                    className="input mt-1"
                    value={walkup.visitor_type}
                    onChange={(e) => setWalkup({ ...walkup, visitor_type: e.target.value })}
                  >
                    <option value="guest">{t('Visita')}</option>
                    <option value="delivery">{t('Entrega / comida')}</option>
                    <option value="service">{t('Serviço')}</option>
                    <option value="rideshare">{t('App / motorista')}</option>
                  </select>
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  className="input"
                  placeholder={t('Nome, empresa ou app')}
                  value={walkup.visitor_name}
                  onChange={(e) => setWalkup({ ...walkup, visitor_name: e.target.value })}
                  required
                />
                <input
                  className="input"
                  placeholder={t('Observação opcional')}
                  value={walkup.notes}
                  onChange={(e) => setWalkup({ ...walkup, notes: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-dusk-300">
                  {t('O morador aprova no app. Se não responder, use os telefones abaixo para confirmar.')}
                </div>
                <Button type="submit" size="sm" variant="primary" loading={creatingWalkup} leftIcon={<Send className="w-3.5 h-3.5" />}>
                  {t('Avisar morador')}
                </Button>
              </div>
            </form>
          </GlassCard>
        </section>

        {/* Section: Visitors */}
        <section>
          <h2 className="font-display text-xl text-dusk-500 mb-3 flex items-center gap-2">
            <DoorOpen className="w-5 h-5" /> {t('Visitantes hoje')}
            {totals.visitors > 0 && <Badge tone="peach">{totals.visitors}</Badge>}
          </h2>
          {(!data || filtered.visitors.length === 0) ? (
            <GlassCard className="p-5 text-sm text-dusk-300 text-center">
              {loading ? t('Carregando…') : search ? t('No matching arrivals.') : t('Nenhum visitante esperado hoje.')}
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {filtered.visitors.map((v) => (
                <GlassCard key={v.id} variant="clay" className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                      <DoorOpen className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-dusk-500 truncate">{v.visitor_name}</span>
                        <Badge tone={v.status === 'approved' ? 'sage' : v.status === 'pending' ? 'warning' : 'neutral'}>
                          {v.status === 'approved' ? t('liberado') : v.status === 'pending' ? t('aguardando') : t(v.status)}
                        </Badge>
                        <Badge tone="neutral">{visitorTypeLabel(v.visitor_type)}</Badge>
                      </div>
                      <div className="text-xs text-dusk-300 mt-1 flex items-center gap-1.5 flex-wrap">
                        <Users className="w-3 h-3" />
                        {v.host_first} {v.host_last}
                        {v.unit_number && <span className="font-mono">· {t('Apto')} {v.unit_number}</span>}
                        {v.expected_at && <><Clock className="w-3 h-3 ml-1" /> {timeOnly(v.expected_at)}</>}
                      </div>
                      {contactNumbers(v).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-dusk-300">
                          {contactNumbers(v).map(([label, value]) => (
                            <span key={`${label}-${value}`} className="rounded-full bg-white/55 px-2.5 py-1 inline-flex items-center gap-1">
                              <PhoneCall className="w-3 h-3" /> {t(label)}: {value}
                            </span>
                          ))}
                        </div>
                      )}
                      {v.notes && <div className="text-[12px] text-dusk-300 mt-1 italic">"{v.notes}"</div>}
                      <div className="mt-3 flex gap-2 flex-wrap">
                        {v.status === 'pending' && (
                          <>
                            <Badge tone="warning">{t('Precisa aprovação do morador')}</Badge>
                            <Button size="sm" variant="ghost" onClick={() => notifyResident('visitor', v.id, 'visitor_arrived')} leftIcon={<Bell className="w-3.5 h-3.5" />}>{t('Avisar morador')}</Button>
                            <Button size="sm" variant="primary" onClick={() => markArrived(v)} leftIcon={<Check className="w-3.5 h-3.5" />}>{t('Registrar entrada por telefone')}</Button>
                          </>
                        )}
                        {v.status === 'approved' && (
                          <Button size="sm" variant="primary" onClick={() => markArrived(v)} leftIcon={<Check className="w-3.5 h-3.5" />}>{t('Já pré-aprovado · registrar entrada')}</Button>
                        )}
                      </div>
                      {v.guest_list && (
                        <details className="mt-2">
                          <summary className="text-xs text-dusk-400 underline decoration-dotted underline-offset-4 cursor-pointer">
                            {t('Lista da festa')} ({v.guest_list.split('\n').filter(Boolean).length})
                          </summary>
                          <pre className="text-xs text-dusk-400 mt-2 whitespace-pre-wrap font-sans bg-white/40 rounded-xl p-2">
                            {v.guest_list}
                          </pre>
                        </details>
                      )}
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
            <Package className="w-5 h-5" /> {t('Encomendas pendentes')}
            {totals.packages > 0 && <Badge tone="peach">{totals.packages}</Badge>}
          </h2>
          {(!data || filtered.packages.length === 0) ? (
            <GlassCard className="p-5 text-sm text-dusk-300 text-center">
              {search ? t('No matching arrivals.') : t('Nenhuma encomenda aguardando retirada.')}
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {filtered.packages.map((p) => (
                <GlassCard key={p.id} variant="clay" className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-dusk-500 truncate">{p.first_name} {p.last_name}</span>
                      {p.unit_number && <Badge tone="neutral">{t('Apto')} {p.unit_number}</Badge>}
                    </div>
                    <div className="text-xs text-dusk-300 mt-0.5">
                      {p.carrier}{p.description ? ` · ${p.description}` : ''} · {t('chegou')} {formatDateTime(p.arrived_at)}
                    </div>
                    {contactNumbers(p).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-dusk-300">
                        {contactNumbers(p).map(([label, value]) => (
                          <span key={`${label}-${value}`} className="rounded-full bg-white/55 px-2.5 py-1 inline-flex items-center gap-1">
                            <PhoneCall className="w-3 h-3" /> {t(label)}: {value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => notifyResident('package', p.id, 'package_arrived')} leftIcon={<Bell className="w-3.5 h-3.5" />}>{t('Avisar encomenda')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => notifyResident('package', p.id, 'food_delivery_arrived')} leftIcon={<Bell className="w-3.5 h-3.5" />}>{t('Avisar comida')}</Button>
                    <Button size="sm" variant="primary" onClick={() => pickupPackage(p)} leftIcon={<Check className="w-3.5 h-3.5" />}>{t('Entregue ao morador')}</Button>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </section>

        {/* Section: Parties / events */}
        {data && filtered.parties.length > 0 && (
          <section>
            <h2 className="font-display text-xl text-dusk-500 mb-3 flex items-center gap-2">
              <PartyPopper className="w-5 h-5" /> {t('Eventos hoje')}
            </h2>
            <div className="space-y-3">
              {filtered.parties.map((party) => (
                <GlassCard key={party.id} variant="clay-peach" className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                      <PartyPopper className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-dusk-500">{party.amenity_name}</span>
                        {(party.expected_guests || 0) > 0 && (
                          <Badge tone="peach">{party.expected_guests} {t('convidados')}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-dusk-300 mt-1">
                        {timeOnly(party.starts_at)}{party.ends_at ? `–${timeOnly(party.ends_at)}` : ''} ·
                        {' '}{party.first_name} {party.last_name}
                        {party.unit_number && <span className="font-mono"> · {t('Apto')} {party.unit_number}</span>}
                      </div>
                      {contactNumbers(party).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-dusk-300">
                          {contactNumbers(party).map(([label, value]) => (
                            <span key={`${label}-${value}`} className="rounded-full bg-white/55 px-2.5 py-1 inline-flex items-center gap-1">
                              <PhoneCall className="w-3 h-3" /> {t(label)}: {value}
                            </span>
                          ))}
                        </div>
                      )}
                      {party.notes && <div className="text-[12px] text-dusk-300 mt-1 italic">"{party.notes}"</div>}
                      {party.guest_list && (
                        <details className="mt-2">
                          <summary className="text-xs text-dusk-400 underline decoration-dotted underline-offset-4 cursor-pointer">
                            {t('Lista de convidados')} ({party.guest_list.split('\n').filter(Boolean).length})
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
          {t('Atualiza a cada')} {POLL_MS / 1000}s {t('automaticamente')}
        </footer>
      </main>
    </div>
  );
}
