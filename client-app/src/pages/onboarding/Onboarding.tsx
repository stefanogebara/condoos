import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Plus, LogIn, ArrowRight, Clock } from 'lucide-react';
import Logo from '../../components/Logo';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { track } from '../../lib/analytics';
import { t } from '../../lib/i18n';

interface Membership {
  id: number;
  status: 'pending' | 'active' | 'revoked' | 'moved_out';
  relationship: 'owner' | 'tenant' | 'occupant';
  unit_number: string;
  building_name: string;
  condo_name: string;
  condo_address: string;
}
interface AuthConfig {
  private_create_building_required?: boolean;
}

function relationshipLabel(value: Membership['relationship']) {
  return t(value);
}

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [privateCreateBuildingRequired, setPrivateCreateBuildingRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    track('onboarding_view');
    apiGet<AuthConfig>('/auth/config')
      .then((cfg) => setPrivateCreateBuildingRequired(!!cfg.private_create_building_required))
      .catch(() => {});
    apiGet<Membership[]>('/onboarding/me')
      .then((rows) => {
        setMemberships(rows);
        // If user already has an active membership, skip onboarding.
        if (rows.some((r) => r.status === 'active')) {
          navigate(user?.role === 'board_admin' ? '/board' : '/app', { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, navigate]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-dusk-300">{t('Carregando…')}</div>;
  }

  const pending = memberships.find((m) => m.status === 'pending');

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="px-6 lg:px-12 py-5 flex items-center justify-between">
        <Link to="/"><Logo /></Link>
        <span className="text-sm text-dusk-300">{t('Olá')}, {user?.first_name} · <button onClick={() => { localStorage.clear(); window.location.href = '/login'; }} className="text-dusk-400 hover:text-dusk-500">{t('Sair')}</button></span>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl animate-fade-up">
          <div className="text-center mb-10">
            <Badge tone="sage" className="mb-4">{t('Passo 1 de 2')}</Badge>
            <h1 className="font-display text-4xl md:text-5xl text-dusk-500 tracking-tight leading-tight">
              {t('Vamos encontrar seu prédio.')}
            </h1>
            <p className="mt-4 text-dusk-300 text-lg max-w-xl mx-auto">
              {t('Se seu prédio já está no CondoOS, entre com o código que o síndico mandou.')}
              {' '}
              {t(privateCreateBuildingRequired
                ? 'Novos prédios são ativados pela administradora ou equipe CONDOS com código privado.'
                : 'Se não, monte um novo — você é o primeiro síndico.')}
            </p>
          </div>

          {pending && (
            <GlassCard variant="clay-peach" className="p-6 mb-8 text-center">
              <Clock className="w-6 h-6 mx-auto mb-3 text-peach-500" />
              <div className="font-display text-xl text-dusk-500">{t('Aguardando aprovação')}</div>
              <p className="text-dusk-400 text-sm mt-2">
                {t('Você reivindicou')} <span className="font-semibold">{t('Unidade')} {pending.unit_number}</span> {t('em')} {pending.condo_name} {t('como')} {relationshipLabel(pending.relationship)}.
                {' '}{t('O administrador vai analisar em breve.')}
              </p>
            </GlassCard>
          )}

          <div className="grid md:grid-cols-2 gap-5">
            <Link to="/onboarding/join" onClick={() => track('onboarding_join_clicked')}>
              <GlassCard variant="clay" hover className="p-8 h-full">
                <div className="w-14 h-14 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center mb-5">
                  <LogIn className="w-7 h-7" />
                </div>
                <h2 className="font-display text-2xl text-dusk-500 tracking-tight">{t('Entrar num prédio')}</h2>
                <p className="text-sm text-dusk-300 mt-2 leading-relaxed">
                  {t('Tenho um código de convite de 6 caracteres do meu administrador. Vou inserir, escolher minha unidade e ocupar meu lugar.')}
                </p>
                <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-dusk-500">
                  {t('Inserir código')} <ArrowRight className="w-4 h-4" />
                </div>
              </GlassCard>
            </Link>

            <Link to="/onboarding/create" onClick={() => track('onboarding_create_clicked')}>
              <GlassCard variant="clay-sage" hover className="p-8 h-full">
                <div className="w-14 h-14 rounded-2xl bg-dusk-400/90 text-cream-50 flex items-center justify-center mb-5">
                  <Plus className="w-7 h-7" />
                </div>
                <h2 className="font-display text-2xl text-dusk-500 tracking-tight">{t(privateCreateBuildingRequired ? 'Ativar prédio aprovado' : 'Montar um novo prédio')}</h2>
                <p className="text-sm text-dusk-300 mt-2 leading-relaxed">
                  {t(privateCreateBuildingRequired
                    ? 'Criação privada para administradoras e prédios aprovados. Tenha em mãos o código de ativação antes de começar.'
                    : 'Meu condomínio ainda não está no sistema. Me guie pelo cadastro: nome, unidades e código de convite.')}
                </p>
                <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-dusk-500">
                  {t(privateCreateBuildingRequired ? 'Ativar com código privado' : 'Começar o cadastro')} <ArrowRight className="w-4 h-4" />
                </div>
              </GlassCard>
            </Link>
          </div>

          <div className="mt-10 text-center text-xs text-dusk-200">
            <Building2 className="w-3.5 h-3.5 inline-block mr-1 align-[-2px]" />
            {t('Só explorando?')} <Link to="/login?intent=demo" className="underline hover:text-dusk-400">{t('Entre como demo (administrador ou morador)')}</Link>.
          </div>
        </div>
      </main>
    </div>
  );
}
