// Live WhatsApp/WAHA session status, rendered in the board sidebar so it's
// visible on every page. Three states with distinct colours:
//   sage   = configured + reachable + session WORKING (or twilio active)
//   peach  = configured but unreachable / session disconnected
//   neutral= not configured (no creds in env)
//
// Polls /api/service-contacts/whatsapp/health every 60s — the server
// caches for 60s so the actual provider ping happens at most once per
// minute regardless of how many admins are looking at this.
import React, { useEffect, useState } from 'react';
import { MessageCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { apiGet } from '../lib/api';
import { t, useLocale } from '../lib/i18n';

interface Health {
  configured: boolean;
  provider: string;
  reachable: boolean;
  session_status: string | null;
  me_phone: string | null;
  me_name: string | null;
  checked_at: string;
  error: string | null;
}

export default function WhatsAppHealthPill() {
  const { locale } = useLocale();
  const tr = (k: string) => t(k, locale);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      apiGet<Health>('/service-contacts/whatsapp/health')
        .then((h) => { if (alive) { setHealth(h); setLoading(false); } })
        .catch(() => { if (alive) { setHealth(null); setLoading(false); } });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl bg-white/50 border border-white/70 p-2.5 text-xs text-dusk-300 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {tr('Verificando WhatsApp…')}
      </div>
    );
  }

  // No health data = endpoint unreachable / non-admin user. Render nothing.
  if (!health) return null;

  // Not configured — show neutral chip so the admin knows the feature
  // exists but isn't wired up. Useful for fresh installs.
  if (!health.configured) {
    return (
      <div className="rounded-2xl bg-white/50 border border-white/70 p-2.5 text-xs text-dusk-300 flex items-start gap-2">
        <MessageCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold text-dusk-400">WhatsApp</div>
          <div>{tr('Não configurado')}</div>
        </div>
      </div>
    );
  }

  // Configured but session is down — admin needs to know NOW. Peach tone
  // matches the rest of the "needs your eyes" palette.
  if (!health.reachable) {
    return (
      <div className="rounded-2xl bg-peach-100/60 border border-peach-300/60 p-2.5 text-xs text-dusk-500 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-peach-700" />
        <div>
          <div className="font-semibold">WhatsApp {tr('desconectado')}</div>
          <div className="text-dusk-400 mt-0.5">{health.error || tr('verifique a sessão')}</div>
        </div>
      </div>
    );
  }

  // Happy path: session live, show the actual sending number so the admin
  // can recognise the conversation on their own phone.
  return (
    <div className="rounded-2xl bg-sage-100/60 border border-sage-300/60 p-2.5 text-xs text-dusk-500 flex items-start gap-2">
      <MessageCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sage-700" />
      <div className="min-w-0">
        <div className="font-semibold">WhatsApp {tr('conectado')}</div>
        {health.me_name && <div className="text-dusk-400 mt-0.5 truncate">{health.me_name}</div>}
        {health.me_phone && <div className="text-dusk-300 mt-0.5 truncate">{health.me_phone}</div>}
      </div>
    </div>
  );
}
