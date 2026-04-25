import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MessageCircle, Save, User } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPatch } from '../../lib/api';
import { track } from '../../lib/analytics';

interface Me {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  phone: string | null;
  whatsapp_opt_in: number;
}

export default function Settings() {
  const [me, setMe] = useState<Me | null>(null);
  const [form, setForm] = useState({ phone: '', whatsapp_opt_in: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<Me>('/users/me').then((m) => {
      setMe(m);
      setForm({ phone: m.phone || '', whatsapp_opt_in: !!m.whatsapp_opt_in });
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      const updated = await apiPatch<Me>('/users/me', {
        phone: form.phone || null,
        whatsapp_opt_in: form.whatsapp_opt_in,
      });
      track('whatsapp_optin_set', { opt_in: form.whatsapp_opt_in, has_phone: Boolean(form.phone) });
      setMe(updated);
      toast.success('Preferences saved');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  if (!me) return null;

  return (
    <>
      <PageHeader title="Settings" subtitle="Profile + notification preferences" />

      <GlassCard variant="clay" className="p-6 mb-6">
        <h3 className="font-display text-lg text-dusk-500 mb-3 flex items-center gap-2"><User className="w-5 h-5" /> Profile</h3>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs text-dusk-300 uppercase tracking-wider">Name</label>
            <div className="text-dusk-500 mt-1">{me.first_name} {me.last_name}</div>
          </div>
          <div>
            <label className="text-xs text-dusk-300 uppercase tracking-wider">Email</label>
            <div className="text-dusk-500 mt-1">{me.email}</div>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <h3 className="font-display text-lg text-dusk-500 mb-1 flex items-center gap-2"><MessageCircle className="w-5 h-5" /> WhatsApp notifications</h3>
        <p className="text-sm text-dusk-400 mb-4">
          Receba avisos no WhatsApp: convocação de assembleia, abertura de votação, chegada de encomenda.
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-dusk-300 uppercase tracking-wider">Número com DDD (ex: +55 11 99999-0000)</label>
            <input
              className="input mt-1"
              type="tel"
              placeholder="+55 11 99999-0000"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-dusk-500 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-dusk-200"
                checked={form.whatsapp_opt_in}
                onChange={(e) => setForm({ ...form, whatsapp_opt_in: e.target.checked })}
              />
              Autorizar notificações pelo WhatsApp
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between mt-4">
          <div>
            {me.whatsapp_opt_in && me.phone
              ? <Badge tone="sage">Ativo · {me.phone}</Badge>
              : <Badge tone="neutral">Desativado</Badge>}
          </div>
          <Button variant="primary" size="sm" onClick={save} loading={saving} leftIcon={<Save className="w-4 h-4" />}>
            Save
          </Button>
        </div>
      </GlassCard>
    </>
  );
}
