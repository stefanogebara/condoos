import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bell, Home, Save, Smartphone, User } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import { apiGet, apiPatch } from '../../lib/api';
import { t } from '../../lib/i18n';

interface Me {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  phone: string | null;
  mobile_phone: string | null;
  home_phone: string | null;
  whatsapp_opt_in: number;
}

export default function Settings() {
  const [me, setMe] = useState<Me | null>(null);
  const [mobilePhone, setMobilePhone] = useState('');
  const [homePhone, setHomePhone] = useState('');
  const [whatsAppOptIn, setWhatsAppOptIn] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<Me>('/users/me').then((m) => {
      setMe(m);
      setMobilePhone(m.mobile_phone || m.phone || '');
      setHomePhone(m.home_phone || '');
      setWhatsAppOptIn(!!m.whatsapp_opt_in);
    }).catch(() => {});
  }, []);

  if (!me) return null;

  async function savePreferences() {
    setSaving(true);
    try {
      const mobile = mobilePhone.trim();
      const home = homePhone.trim();
      const updated = await apiPatch<Me>('/users/me', {
        mobile_phone: mobile || null,
        home_phone: home || null,
        phone: mobile || home || null,
        whatsapp_opt_in: whatsAppOptIn,
      });
      setMe(updated);
      setMobilePhone(updated.mobile_phone || updated.phone || '');
      setHomePhone(updated.home_phone || '');
      setWhatsAppOptIn(!!updated.whatsapp_opt_in);
      toast.success(t('Preferências salvas'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Não foi possível salvar'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title={t('Preferências')} subtitle={t('Perfil e notificações')} />

      <GlassCard variant="clay" className="p-6 mb-6">
        <h3 className="font-display text-lg text-dusk-500 mb-3 flex items-center gap-2"><User className="w-5 h-5" /> {t('Perfil')}</h3>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs text-dusk-300 uppercase tracking-wider">{t('Nome')}</label>
            <div className="text-dusk-500 mt-1">{me.first_name} {me.last_name}</div>
          </div>
          <div>
            <label className="text-xs text-dusk-300 uppercase tracking-wider">{t('Email')}</label>
            <div className="text-dusk-500 mt-1">{me.email}</div>
          </div>
        </div>
      </GlassCard>

      <GlassCard variant="clay" className="p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-display text-lg text-dusk-500 mb-1 flex items-center gap-2">
              <Bell className="w-5 h-5" />
              {t('Notificações no WhatsApp')}
            </h3>
            <p className="text-sm text-dusk-300 max-w-2xl">
              {t('Receba avisos no WhatsApp: convocação de assembleia, abertura de votação, chegada de encomenda.')}
            </p>
          </div>
          <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-dusk-400">
            {whatsAppOptIn ? t('Ativo') : t('Desativado')}
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-3 mt-5">
          <label className="block">
            <span className="text-xs text-dusk-300 uppercase tracking-wider flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5" />
              {t('Celular')}
            </span>
            <input
              className="input mt-1"
              type="tel"
              value={mobilePhone}
              onChange={(e) => setMobilePhone(e.target.value)}
              placeholder="+1 305 555 0704"
              maxLength={40}
            />
          </label>
          <label className="block">
            <span className="text-xs text-dusk-300 uppercase tracking-wider flex items-center gap-1.5">
              <Home className="w-3.5 h-3.5" />
              {t('Casa')}
            </span>
            <input
              className="input mt-1"
              type="tel"
              value={homePhone}
              onChange={(e) => setHomePhone(e.target.value)}
              placeholder="+1 305 555 1704"
              maxLength={40}
            />
          </label>
        </div>

        <label className="mt-5 flex items-center gap-3 text-sm text-dusk-400">
          <input
            type="checkbox"
            className="w-5 h-5 accent-sage-600"
            checked={whatsAppOptIn}
            onChange={(e) => setWhatsAppOptIn(e.target.checked)}
          />
          <span>{t('Autorizar notificações pelo WhatsApp')}</span>
        </label>

        <div className="mt-6 flex justify-end">
          <Button
            type="button"
            onClick={savePreferences}
            loading={saving}
            leftIcon={<Save className="w-4 h-4" />}
          >
            {t('Salvar preferências')}
          </Button>
        </div>
      </GlassCard>

    </>
  );
}
