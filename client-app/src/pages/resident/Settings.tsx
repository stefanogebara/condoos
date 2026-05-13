import React, { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import { apiGet } from '../../lib/api';
import { t } from '../../lib/i18n';

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

  useEffect(() => {
    apiGet<Me>('/users/me').then((m) => {
      setMe(m);
    }).catch(() => {});
  }, []);

  if (!me) return null;

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

    </>
  );
}
