import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

export type AppLocale = 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR';

type Copy = Record<AppLocale, string>;

const STORAGE_KEY = 'condoos_locale';
const LOCATION_STORAGE_KEY = 'condoos_locale_source';

export const LOCALE_OPTIONS: Array<{ locale: AppLocale; label: string; short: string }> = [
  { locale: 'pt-BR', label: 'Português', short: 'PT' },
  { locale: 'en-US', label: 'English', short: 'EN' },
  { locale: 'es-ES', label: 'Español', short: 'ES' },
  { locale: 'fr-FR', label: 'Français', short: 'FR' },
];

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function readManualLocale(): AppLocale | null {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const source = readLocaleSource();
  if (source === 'location') return null;
  if (stored && isAppLocale(stored)) return stored;
  return null;
}

function readLocationOverride(): AppLocale | null {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (readLocaleSource() === 'location' && stored && isAppLocale(stored)) return stored;
  return null;
}

function readLocaleSource(): 'manual' | 'location' | null {
  const source = typeof localStorage !== 'undefined'
    ? localStorage.getItem(LOCATION_STORAGE_KEY)
    : null;
  if (source === 'manual' || source === 'location') return source;
  return null;
}

function localeFromTimeZone(timeZone?: string): AppLocale | null {
  if (!timeZone) return null;
  const zone = timeZone.toLowerCase();

  if ([
    'america/araguaina',
    'america/bahia',
    'america/belem',
    'america/boa_vista',
    'america/campo_grande',
    'america/cuiaba',
    'america/eirunepe',
    'america/fortaleza',
    'america/maceio',
    'america/manaus',
    'america/noronha',
    'america/porto_velho',
    'america/recife',
    'america/rio_branco',
    'america/santarem',
    'america/sao_paulo',
  ].includes(zone)) return 'pt-BR';

  if ([
    'america/adak',
    'america/anchorage',
    'america/boise',
    'america/chicago',
    'america/denver',
    'america/detroit',
    'america/indiana/indianapolis',
    'america/indiana/knox',
    'america/indiana/marengo',
    'america/indiana/petersburg',
    'america/indiana/tell_city',
    'america/indiana/vevay',
    'america/indiana/vincennes',
    'america/indiana/winamac',
    'america/juneau',
    'america/kentucky/louisville',
    'america/kentucky/monticello',
    'america/los_angeles',
    'america/menominee',
    'america/metlakatla',
    'america/new_york',
    'america/nome',
    'america/north_dakota/beulah',
    'america/north_dakota/center',
    'america/north_dakota/new_salem',
    'america/phoenix',
    'america/sitka',
    'america/yakutat',
    'pacific/honolulu',
  ].includes(zone)) return 'en-US';

  if (zone === 'europe/paris' || zone === 'europe/monaco') return 'fr-FR';
  if (zone === 'europe/madrid' || zone === 'africa/ceuta' || zone === 'atlantic/canary') return 'es-ES';

  if ([
    'america/argentina/buenos_aires',
    'america/argentina/catamarca',
    'america/argentina/cordoba',
    'america/argentina/jujuy',
    'america/argentina/la_rioja',
    'america/argentina/mendoza',
    'america/argentina/rio_gallegos',
    'america/argentina/salta',
    'america/argentina/san_juan',
    'america/argentina/san_luis',
    'america/argentina/tucuman',
    'america/argentina/ushuaia',
    'america/asuncion',
    'america/bogota',
    'america/cancun',
    'america/caracas',
    'america/costa_rica',
    'america/el_salvador',
    'america/guatemala',
    'america/guayaquil',
    'america/havana',
    'america/la_paz',
    'america/lima',
    'america/managua',
    'america/mexico_city',
    'america/monterrey',
    'america/montevideo',
    'america/panama',
    'america/santiago',
    'america/santo_domingo',
    'america/tegucigalpa',
  ].includes(zone)) return 'es-ES';

  if ([
    'america/cayenne',
    'america/guadeloupe',
    'america/martinique',
    'america/port-au-prince',
    'america/st_barthelemy',
    'america/st_martin',
    'indian/reunion',
    'pacific/noumea',
    'pacific/tahiti',
  ].includes(zone)) return 'fr-FR';

  return null;
}

function localeFromCoordinates(latitude: number, longitude: number): AppLocale | null {
  if (latitude >= -34 && latitude <= 6 && longitude >= -74 && longitude <= -34) return 'pt-BR';
  if (latitude >= 18 && latitude <= 72 && longitude >= -170 && longitude <= -60) return 'en-US';
  if (latitude >= 35 && latitude <= 44.5 && longitude >= -10 && longitude <= 5) return 'es-ES';
  if (latitude >= 41 && latitude <= 52 && longitude >= -5.5 && longitude <= 10) return 'fr-FR';
  return null;
}

function browserLocale(): AppLocale {
  const languages = typeof navigator !== 'undefined' && navigator.languages?.length
    ? navigator.languages
    : [typeof navigator !== 'undefined' ? navigator.language : 'pt-BR'];

  for (const raw of languages) {
    const lang = raw.toLowerCase();
    if (lang.startsWith('pt')) return 'pt-BR';
    if (lang.startsWith('es')) return 'es-ES';
    if (lang.startsWith('fr')) return 'fr-FR';
    if (lang.startsWith('en')) return 'en-US';
  }
  return 'en-US';
}

function locationLocale(): AppLocale | null {
  const timeZone = typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : undefined;
  return localeFromTimeZone(timeZone);
}

function detectAutoLocale(): AppLocale {
  // Browser language is a stronger signal of the user's preferred locale
  // than timezone. Bug we hit: a user physically in Spain (with a
  // ne-Madrid timezone but `Europe/Paris` reported by their device) was
  // getting French. By trusting `navigator.languages` first we honour
  // their explicit preference; we still fall back to timezone for users
  // whose browser default doesn't match any of our four locales.
  const browser = browserLocale();
  if (browser !== 'en-US') return browser; // explicit non-English preference wins
  // navigator.languages defaulted to en-US (no PT/ES/FR signal). Use
  // timezone if it points us to one of the supported regions; otherwise
  // keep the en-US fallback.
  const fromZone = locationLocale();
  return fromZone || browser;
}

function detectLocale(): AppLocale {
  const manual = readManualLocale();
  if (manual) return manual;
  const locationOverride = readLocationOverride();
  if (locationOverride) return locationOverride;
  return detectAutoLocale();
}

async function detectPreciseLocationLocale(): Promise<AppLocale> {
  const fallback = detectAutoLocale();
  if (typeof navigator === 'undefined' || !navigator.geolocation) return fallback;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve(localeFromCoordinates(position.coords.latitude, position.coords.longitude) || fallback);
      },
      () => resolve(fallback),
      { enableHighAccuracy: false, maximumAge: 24 * 60 * 60 * 1000, timeout: 3000 },
    );
  });
}

function isAppLocale(value: string): value is AppLocale {
  return value === 'pt-BR' || value === 'en-US' || value === 'es-ES' || value === 'fr-FR';
}

const phrases: Copy[] = [
  c('Carregando...', 'Loading...', 'Cargando...', 'Chargement...'),
  c('Loading...', 'Loading...', 'Cargando...', 'Chargement...'),
  c('Fechar menu', 'Close menu', 'Cerrar menú', 'Fermer le menu'),
  c('Abrir menu', 'Open menu', 'Abrir menú', 'Ouvrir le menu'),
  c('Sair', 'Sign out', 'Cerrar sesión', 'Se déconnecter'),
  c('Morador', 'Resident', 'Residente', 'Résident'),
  c('Síndico', 'Board admin', 'Administrador', 'Syndic'),
  c('Unit', 'Unit', 'Unidad', 'Lot'),
  c('Apto', 'Unit', 'Unidad', 'Lot'),

  // Global navigation
  c('Início', 'Overview', 'Inicio', 'Accueil'),
  c('Visão geral', 'Overview', 'Resumen', 'Vue d’ensemble'),
  c('Encomendas', 'Packages', 'Paquetes', 'Colis'),
  c('Visitantes', 'Visitors', 'Visitantes', 'Visiteurs'),
  c('Áreas comuns', 'Amenities', 'Áreas comunes', 'Espaces communs'),
  c('Comunicados', 'Announcements', 'Avisos', 'Annonces'),
  c('Propostas', 'Proposals', 'Propuestas', 'Propositions'),
  c('Assembleias', 'Assemblies', 'Asambleas', 'Assemblées'),
  c('Reuniões', 'Meetings', 'Reuniones', 'Réunions'),
  c('Sugerir', 'Suggest', 'Sugerir', 'Suggérer'),
  c('Preferências', 'Settings', 'Preferencias', 'Préférences'),
  c('Sugestões', 'Suggestions', 'Sugerencias', 'Suggestions'),
  c('Pendentes', 'Pending', 'Pendientes', 'En attente'),
  c('Moradores', 'Residents', 'Residentes', 'Résidents'),
  c('Funcionalidades', 'Features', 'Funciones', 'Fonctionnalités'),
  c('Como funciona', 'How it works', 'Cómo funciona', 'Fonctionnement'),
  c('Dúvidas', 'FAQ', 'Preguntas', 'FAQ'),
  c('Entrar', 'Sign in', 'Entrar', 'Connexion'),
  c('Testar a demo', 'Try the demo', 'Probar la demo', 'Essayer la démo'),
  c('Ver por dentro', 'See inside', 'Ver por dentro', 'Voir l’intérieur'),
  c('Controles de idioma', 'Language controls', 'Controles de idioma', 'Contrôles de langue'),
  c('Idioma', 'Language', 'Idioma', 'Langue'),
  c('Usar localização', 'Use location', 'Usar ubicación', 'Utiliser la localisation'),
  c('Usando localização', 'Using location', 'Usando ubicación', 'Localisation utilisée'),
  c('Detectando localização...', 'Detecting location...', 'Detectando ubicación...', 'Détection de la localisation...'),

  // Login
  c('Sou síndico', 'I am the board admin', 'Soy administrador', 'Je suis syndic'),
  c('Tenho um código', 'I have a code', 'Tengo un código', 'J’ai un code'),
  c('Vamos montar seu prédio', 'Let’s set up your building', 'Vamos a configurar tu edificio', 'Configurons votre immeuble'),
  c('Entre com o Google e em poucos cliques seu condomínio está no ar — com código de convite pronto pros moradores.', 'Sign in with Google and your condo is live in a few clicks — with an invite code ready for residents.', 'Entra con Google y tu condominio estará listo en pocos clics, con código de invitación para residentes.', 'Connectez-vous avec Google et votre copropriété est prête en quelques clics, avec un code d’invitation pour les résidents.'),
  c('Entrar no seu prédio', 'Join your building', 'Entrar a tu edificio', 'Rejoindre votre immeuble'),
  c('Faça login com Google. Em seguida, você insere o código que o síndico mandou e escolhe sua unidade.', 'Sign in with Google. Then enter the code from your board admin and choose your unit.', 'Inicia sesión con Google. Luego ingresa el código del administrador y elige tu unidad.', 'Connectez-vous avec Google. Entrez ensuite le code du syndic et choisissez votre lot.'),
  c('Explorar o CondoOS', 'Explore CondoOS', 'Explorar CondoOS', 'Explorer CondoOS'),
  c('Use uma das contas de demo abaixo para ver o sistema por dentro — síndico ou morador.', 'Use one of the demo accounts below to see the system from the inside — board admin or resident.', 'Usa una de las cuentas demo abajo para ver el sistema por dentro: administrador o residente.', 'Utilisez l’un des comptes démo ci-dessous pour voir le système de l’intérieur : syndic ou résident.'),
  c('Um lugar tranquilo para o prédio pensar.', 'A calm, soft place for a building to think.', 'Un lugar tranquilo para que el edificio piense.', 'Un espace calme pour qu’un immeuble réfléchisse.'),
  c('Entre com Google, com uma conta demo ou manualmente. Sem cartão, sem setup.', 'Sign in with Google, a demo account, or manually. No card, no setup.', 'Entra con Google, una cuenta demo o manualmente. Sin tarjeta, sin configuración.', 'Connectez-vous avec Google, un compte démo ou manuellement. Pas de carte, pas de configuration.'),
  c('Entre com Google ou com as credenciais que o seu prédio te forneceu.', 'Sign in with Google or with the credentials your building provided.', 'Entra con Google o con las credenciales que te dio tu edificio.', 'Connectez-vous avec Google ou avec les identifiants fournis par votre immeuble.'),
  c('com IA', 'AI-powered', 'con IA', 'propulsé par IA'),
  c('Bem-vindo de volta', 'Welcome back', 'Bienvenido de vuelta', 'Bon retour'),
  c('Entre no seu prédio.', 'Sign in to your building.', 'Entra a tu edificio.', 'Connectez-vous à votre immeuble.'),
  c('Demo com 1 clique', 'One-click demo', 'Demo en un clic', 'Démo en un clic'),
  c('ou entre com', 'or continue with', 'o continúa con', 'ou continuer avec'),
  c('ou manualmente', 'or manually', 'o manualmente', 'ou manuellement'),
  c('voce@predio.com.br', 'you@building.dev', 'tu@edificio.dev', 'vous@immeuble.dev'),
  c('senha', 'password', 'contraseña', 'mot de passe'),
  c('Email ou senha incorretos', 'Invalid email or password', 'Email o contraseña incorrectos', 'E-mail ou mot de passe incorrect'),
  c('Falha ao entrar', 'Sign-in failed', 'Error al iniciar sesión', 'Échec de connexion'),
  c('Nenhuma credencial do Google recebida', 'No Google credential received', 'No se recibió credencial de Google', 'Aucun identifiant Google reçu'),
  c('Falha ao entrar com Google', 'Google sign-in failed', 'Error con Google', 'Échec de la connexion Google'),
  c('Login com Google cancelado', 'Google sign-in was cancelled', 'Inicio con Google cancelado', 'Connexion Google annulée'),
  c('Código detectado:', 'Code detected:', 'Código detectado:', 'Code détecté :'),
  c('A calm, soft place for a building to think.', 'A calm, soft place for a building to think.', 'Un lugar tranquilo para que el edificio piense.', 'Un espace calme pour qu’un immeuble réfléchisse.'),
  c('Sign in with a demo account, Google, or manually. No account needed for the demo.', 'Sign in with a demo account, Google, or manually. No account needed for the demo.', 'Entra con una cuenta demo, Google o manualmente. No necesitas cuenta para la demo.', 'Connectez-vous avec un compte démo, Google ou manuellement. Aucun compte requis pour la démo.'),
  c('Sign in with Google or your building credentials.', 'Sign in with Google or your building credentials.', 'Entra con Google o con las credenciales de tu edificio.', 'Connectez-vous avec Google ou vos identifiants d’immeuble.'),
  c('claymorphism', 'claymorphism', 'claymorphism', 'claymorphism'),
  c('glassmorphism', 'glassmorphism', 'glassmorphism', 'glassmorphism'),
  c('AI-powered', 'AI-powered', 'con IA', 'propulsé par IA'),
  c('Welcome back', 'Welcome back', 'Bienvenido de vuelta', 'Bon retour'),
  c('Sign in to your building.', 'Sign in to your building.', 'Entra a tu edificio.', 'Connectez-vous à votre immeuble.'),
  c('One-click demo', 'One-click demo', 'Demo en un clic', 'Démo en un clic'),
  c('Board admin', 'Board admin', 'Administrador', 'Syndic'),
  c('Resident', 'Resident', 'Residente', 'Résident'),
  c('or continue with', 'or continue with', 'o continúa con', 'ou continuer avec'),
  c('or manually', 'or manually', 'o manualmente', 'ou manuellement'),
  c('password', 'password', 'contraseña', 'mot de passe'),
  c('Sign in', 'Sign in', 'Entrar', 'Connexion'),
  c('Invalid credentials', 'Invalid credentials', 'Credenciales inválidas', 'Identifiants invalides'),
  c('Sign in failed', 'Sign in failed', 'Error al entrar', 'Échec de la connexion'),
  c('Login failed', 'Login failed', 'Error al entrar', 'Échec de la connexion'),
  c('No Google credential received', 'No Google credential received', 'No se recibió credencial de Google', 'Aucun identifiant Google reçu'),
  c('Google sign-in failed', 'Google sign-in failed', 'Error con Google', 'Échec de la connexion Google'),
  c('Google sign-in was cancelled', 'Google sign-in was cancelled', 'Inicio con Google cancelado', 'Connexion Google annulée'),
  c('Novo no CondoOS?', 'New to CondoOS?', '¿Nuevo en CondoOS?', 'Nouveau sur CondoOS ?'),
  c('Criar conta com código', 'Create account with code', 'Crear cuenta con código', 'Créer un compte avec un code'),
  c('Entre no prédio do administrador.', 'Join the building from your admin.', 'Entra al edificio del administrador.', "Rejoignez l'immeuble de votre syndic."),
  c('Criar um prédio', 'Create a building', 'Crear un edificio', 'Créer un immeuble'),
  c('Comece como administrador.', 'Start as the admin.', 'Empieza como administrador.', 'Commencez comme syndic.'),
  c('Entre no seu prédio sem pedir ajuda na portaria.', 'Join your building without asking the front desk for help.', 'Entra a tu edificio sin pedir ayuda en portería.', "Rejoignez votre immeuble sans demander d'aide à l'accueil."),
  c('Crie sua conta, use o código do administrador e escolha sua unidade.', 'Create your account, use the admin code, and choose your unit.', 'Crea tu cuenta, usa el código del administrador y elige tu unidad.', 'Créez votre compte, utilisez le code du syndic et choisissez votre lot.'),
  c('Voltar para entrar', 'Back to sign in', 'Volver a entrar', 'Retour à la connexion'),
  c('Novo administrador', 'New admin', 'Nuevo administrador', 'Nouveau syndic'),
  c('Novo morador', 'New resident', 'Nuevo residente', 'Nouveau résident'),
  c('Crie sua conta de administrador', 'Create your admin account', 'Crea tu cuenta de administrador', 'Créez votre compte syndic'),
  c('Crie sua conta para entrar', 'Create your account to join', 'Crea tu cuenta para unirte', 'Créez votre compte pour rejoindre'),
  c('Depois de criar sua conta, configuramos o prédio e geramos o código para moradores.', 'After you create your account, we set up the building and generate the resident code.', 'Después de crear tu cuenta, configuramos el edificio y generamos el código para residentes.', 'Après avoir créé votre compte, nous configurons l’immeuble et générons le code résident.'),
  c('Depois de criar sua conta, insira o código do administrador e escolha sua unidade.', 'After you create your account, enter the admin code and choose your unit.', 'Después de crear tu cuenta, ingresa el código del administrador y elige tu unidad.', 'Après avoir créé votre compte, entrez le code du syndic et choisissez votre lot.'),
  c('ou com email', 'or with email', 'o con email', 'ou avec e-mail'),
  c('Nome', 'First name', 'Nombre', 'Prénom'),
  c('Sobrenome', 'Last name', 'Apellido', 'Nom'),
  c('Senha', 'Password', 'Contraseña', 'Mot de passe'),
  c('senha de 12+ caracteres', 'password, 12+ characters', 'contraseña de 12+ caracteres', 'mot de passe de 12 caractères ou plus'),
  c('Código de convite', 'Invite code', 'Código de invitación', 'Code d’invitation'),
  c('Criar conta e prédio', 'Create account and building', 'Crear cuenta y edificio', 'Créer le compte et l’immeuble'),
  c('Criar conta e entrar', 'Create account and join', 'Crear cuenta y unirme', 'Créer le compte et rejoindre'),
  c('Já tem conta?', 'Already have an account?', '¿Ya tienes cuenta?', 'Vous avez déjà un compte ?'),
  c('O administrador aprova seu acesso se o prédio exigir.', 'The admin approves your access if the building requires it.', 'El administrador aprueba tu acceso si el edificio lo requiere.', 'Le syndic approuve votre accès si l’immeuble l’exige.'),
  c('Você pode administrar mesmo sem morar no prédio.', 'You can manage even if you do not live in the building.', 'Puedes administrar aunque no vivas en el edificio.', 'Vous pouvez gérer même si vous n’habitez pas dans l’immeuble.'),
  c('Conta criada', 'Account created', 'Cuenta creada', 'Compte créé'),
  c('Esse email já tem conta. Entre com sua senha.', 'That email already has an account. Sign in with your password.', 'Ese email ya tiene cuenta. Entra con tu contraseña.', 'Cet e-mail a déjà un compte. Connectez-vous avec votre mot de passe.'),
  c('Use uma senha com pelo menos 12 caracteres.', 'Use a password with at least 12 characters.', 'Usa una contraseña de al menos 12 caracteres.', 'Utilisez un mot de passe d’au moins 12 caractères.'),
  c('Use um email válido.', 'Use a valid email.', 'Usa un email válido.', 'Utilisez un e-mail valide.'),
  c('Não conseguimos falar com o servidor. Tente novamente em alguns segundos.', 'We could not reach the server. Try again in a few seconds.', 'No pudimos conectar con el servidor. Inténtalo de nuevo en unos segundos.', 'Nous n’avons pas pu joindre le serveur. Réessayez dans quelques secondes.'),
  c('Confira os dados e use uma senha com pelo menos 12 caracteres.', 'Check the details and use a password with at least 12 characters.', 'Revisa los datos y usa una contraseña de al menos 12 caracteres.', 'Vérifiez les informations et utilisez un mot de passe d’au moins 12 caractères.'),
  c('Falha ao criar conta', 'Could not create account', 'No se pudo crear la cuenta', 'Impossible de créer le compte'),

  // Landing
  c('Acesso antecipado · Para condomínios brasileiros', 'Early access · For modern condos', 'Acceso anticipado · Para condominios modernos', 'Accès anticipé · Pour copropriétés modernes'),
  c('Seu condomínio,', 'Your condo,', 'Tu condominio,', 'Votre copropriété,'),
  c('em paz.', 'at peace.', 'en paz.', 'en paix.'),
  c('Encomendas, visitantes, áreas comuns, votação — e uma IA que transforma reclamações em propostas prontas pra pauta e atas em linguagem humana.', 'Packages, visitors, amenities, voting — and AI that turns complaints into agenda-ready proposals and minutes into plain language.', 'Paquetes, visitantes, áreas comunes, votaciones — e IA que convierte quejas en propuestas listas para agenda y actas claras.', 'Colis, visiteurs, espaces communs, votes — et une IA qui transforme les plaintes en propositions prêtes pour l’ordre du jour et les procès-verbaux en langage clair.'),
  c('2 encomendas', '2 packages', '2 paquetes', '2 colis'),
  c('Votação passando', 'Vote passing', 'Votación aprobándose', 'Vote en passe d’être adopté'),
  c('Trocar ar do saguão · 4-1', 'Replace lobby AC · 4-1', 'Cambiar el aire del vestíbulo · 4-1', 'Remplacer la clim du hall · 4-1'),
  c('IA redigiu', 'AI drafted', 'IA redactó', 'IA rédigée'),
  c('3 novas propostas', '3 new proposals', '3 propuestas nuevas', '3 nouvelles propositions'),
  c('Talvez a gente procure nos galhos o que só se encontra nas raízes.', 'Maybe we look in the branches for what can only be found in the roots.', 'Quizá buscamos en las ramas lo que solo se encuentra en las raíces.', 'Peut-être cherchons-nous dans les branches ce qui ne se trouve que dans les racines.'),
  c('um jeito mais calmo de cuidar do prédio', 'a calmer way to run the building', 'una forma más tranquila de cuidar el edificio', 'une manière plus calme de gérer l’immeuble'),
  c('tudo em um sistema', 'everything in one system', 'todo en un sistema', 'tout dans un seul système'),
  c('Tudo que o prédio precisa para rodar.', 'Everything the building needs to run.', 'Todo lo que el edificio necesita para funcionar.', 'Tout ce dont l’immeuble a besoin pour tourner.'),
  c('Troque planilhas, grupos de WhatsApp e avisos em papel por um único sistema tranquilo.', 'Replace spreadsheets, WhatsApp groups, and paper notices with one calm system.', 'Reemplaza planillas, grupos de WhatsApp y avisos en papel por un sistema tranquilo.', 'Remplacez les tableurs, groupes WhatsApp et affiches papier par un système apaisé.'),
  c('Encomendas & visitantes', 'Packages & visitors', 'Paquetes y visitantes', 'Colis et visiteurs'),
  c('Fila da portaria em tempo real. Aprove visita pelo celular.', 'Real-time front desk queue. Approve visitors from your phone.', 'Cola de recepción en tiempo real. Aprueba visitas desde el celular.', 'File de conciergerie en temps réel. Validez les visiteurs depuis le mobile.'),
  c('Áreas comuns & reservas', 'Amenities & bookings', 'Áreas comunes y reservas', 'Espaces communs et réservations'),
  c('Piscina, academia, salão. Morador reserva. Sem conflito.', 'Pool, gym, party room. Residents book without conflicts.', 'Piscina, gimnasio, salón. Reservas sin conflictos.', 'Piscine, salle de sport, salle commune. Réservations sans conflit.'),
  c('Propostas & votação', 'Proposals & voting', 'Propuestas y votación', 'Propositions et votes'),
  c('Reclamação vira decisão. Contagem ao vivo. Transparência total.', 'Complaints become decisions. Live tally. Full transparency.', 'Las quejas se vuelven decisiones. Conteo en vivo. Transparencia total.', 'Les plaintes deviennent décisions. Décompte en direct. Transparence totale.'),
  c('Copiloto IA', 'AI copilot', 'Copiloto IA', 'Copilote IA'),
  c('Compliance brasileira', 'Brazilian compliance', 'Cumplimiento brasileño', 'Conformité brésilienne'),
  c('Ata gerada pela IA.', 'AI-generated minutes.', 'Acta generada por IA.', 'Procès-verbal généré par IA.'),
  c('Quórum atingido', 'Quorum reached', 'Quórum alcanzado', 'Quorum atteint'),
  c('12 de 16 presentes', '12 of 16 present', '12 de 16 presentes', '12 sur 16 présents'),
  c('Para cada morador', 'For every resident', 'Para cada residente', 'Pour chaque résident'),
  c('Fonte grande, contraste alto', 'Large type, high contrast', 'Letra grande, alto contraste', 'Grande police, fort contraste'),
  c('Notificação no WhatsApp', 'WhatsApp notifications', 'Notificaciones por WhatsApp', 'Notifications WhatsApp'),
  c('Explicação em linguagem humana', 'Plain-language explanation', 'Explicación en lenguaje claro', 'Explication en langage clair'),
  c('Votação aberta', 'Voting open', 'Votación abierta', 'Vote ouvert'),
  c('Votação no bolso', 'Voting in your pocket', 'Votación en tu bolsillo', 'Vote dans la poche'),
  c('Portaria', 'Front desk', 'Portería', 'Conciergerie'),
  c('WhatsApp', 'WhatsApp', 'WhatsApp', 'WhatsApp'),
  c('Ver código no GitHub', 'View code on GitHub', 'Ver código en GitHub', 'Voir le code sur GitHub'),
  c('Login com Google', 'Google login', 'Login con Google', 'Connexion Google'),
  c('Dados seus ficam seus', 'Your data stays yours', 'Tus datos siguen siendo tuyos', 'Vos données restent à vous'),
  c('Sem cartão de crédito no beta', 'No credit card in beta', 'Sin tarjeta durante la beta', 'Pas de carte bancaire en bêta'),
  c('feito em hackathon, desenhado para humanos', 'built in a hackathon, designed for humans', 'hecho en hackathon, diseñado para humanos', 'créé en hackathon, conçu pour les humains'),
  c('AGO', 'Annual meeting', 'Asamblea anual', 'AG annuelle'),
  c('Sou síndico — montar meu prédio', 'I manage a building — set it up', 'Administro un edificio — configurarlo', 'Je gère un immeuble — le configurer'),
  c('Sou morador — tenho um código', 'I am a resident — I have a code', 'Soy residente — tengo un código', 'Je suis résident — j’ai un code'),
  c('Só explorar (demo)', 'Just explore (demo)', 'Solo explorar (demo)', 'Explorer seulement (démo)'),
  c('Uma comunidade de moradores reunida no saguão, um deles segurando o celular com o CondoOS', 'A resident community gathered in the lobby, one person holding a phone with CondoOS', 'Una comunidad de residentes reunida en el vestíbulo, una persona sosteniendo un celular con CondoOS', 'Une communauté de résidents réunie dans le hall, une personne tenant un téléphone avec CondoOS'),
  c('Apto 704 · Maya', 'Unit 704 · Maya', 'Unidad 704 · Maya', 'Lot 704 · Maya'),
  c('Cole as anotações. Saia com resumo, decisões e tarefas.', 'Paste the notes. Leave with a summary, decisions, and tasks.', 'Pega las notas. Sal con resumen, decisiones y tareas.', 'Collez les notes. Repartez avec résumé, décisions et tâches.'),
  c('Agrupa reclamações, redige propostas, explica aos moradores.', 'Clusters complaints, drafts proposals, explains them to residents.', 'Agrupa quejas, redacta propuestas y las explica a residentes.', 'Regroupe les plaintes, rédige les propositions et les explique aux résidents.'),
  c('Morador em primeiro', 'Resident first', 'Residente primero', 'Le résident d’abord'),
  c('Comunicado em linguagem humana. Ninguém lê convenção.', 'Plain-language notices. Nobody reads bylaws for fun.', 'Avisos en lenguaje claro. Nadie lee el reglamento por gusto.', 'Annonces en langage clair. Personne ne lit le règlement par plaisir.'),
  c('De "o ar do saguão não funciona" à decisão do síndico — em minutos.', 'From "the lobby AC is not working" to a board decision — in minutes.', 'De "el aire del vestíbulo no funciona" a la decisión del administrador — en minutos.', 'De « la clim du hall ne marche pas » à la décision du syndic — en quelques minutes.'),
  c('Seis momentos de IA, uma interface tranquila. Fallbacks para a demo nunca travar.', 'Six AI moments, one calm interface. Demo fallbacks keep everything running.', 'Seis momentos de IA, una interfaz tranquila. Fallbacks para que la demo nunca se bloquee.', 'Six moments d’IA, une interface calme. Des fallbacks pour que la démo ne bloque jamais.'),
  c('01 · Morador', '01 · Resident', '01 · Residente', '01 · Résident'),
  c('"O ar do saguão mal funciona. Ontem marcou 30°C aqui dentro."', '"The lobby AC barely works. Yesterday it hit 30°C in here."', '"El aire del vestíbulo casi no funciona. Ayer llegó a 30°C aquí dentro."', '« La clim du hall fonctionne à peine. Hier il faisait 30°C ici. »'),
  c('02 · IA redige', '02 · AI drafts', '02 · IA redacta', '02 · L’IA rédige'),
  c('Trocar o ar-condicionado do saguão', 'Replace the lobby air conditioner', 'Cambiar el aire acondicionado del vestíbulo', 'Remplacer la climatisation du hall'),
  c('Manutenção · ~R$ 47.000 · orçamento de 5 TR da Cool Breeze HVAC.', 'Maintenance · ~R$ 47,000 · 5 TR quote from Cool Breeze HVAC.', 'Mantenimiento · ~R$ 47.000 · presupuesto de 5 TR de Cool Breeze HVAC.', 'Maintenance · ~47 000 R$ · devis 5 TR de Cool Breeze HVAC.'),
  c('03 · Síndico abre votação', '03 · Board opens voting', '03 · El administrador abre la votación', '03 · Le syndic ouvre le vote'),
  c('Votação abre → moradores aprovam → IA publica o anúncio em linguagem humana.', 'Voting opens -> residents approve -> AI publishes a plain-language announcement.', 'Se abre la votación -> residentes aprueban -> la IA publica un aviso claro.', 'Le vote s’ouvre -> les résidents approuvent -> l’IA publie une annonce claire.'),
  c('AGO no app.', 'Annual meeting in the app.', 'Asamblea anual en la app.', 'AG annuelle dans l’app.'),
  c('Moradores em torno da mesa em uma assembleia geral ordinária', 'Residents around a table during an annual meeting', 'Residentes alrededor de una mesa en una asamblea anual', 'Résidents autour d’une table pendant une assemblée annuelle'),
  c('Convocação com 8 dias de antecedência, procurações digitais, quórum aplicado automaticamente, votação por maioria simples ou 2/3 (convenção), e a ata sai pronta no fim da sessão. Tudo alinhado ao Código Civil Art. 1350.', 'Eight-day notice, digital proxies, automatic quorum, simple majority or two-thirds voting when bylaws require it, and minutes ready at the end. Aligned with Brazilian Civil Code Art. 1350.', 'Convocatoria con 8 días de anticipación, poderes digitales, quórum automático, mayoría simple o 2/3 según el reglamento, y acta lista al final. Alineado con el Código Civil brasileño Art. 1350.', 'Convocation 8 jours à l’avance, procurations numériques, quorum automatique, majorité simple ou 2/3 selon le règlement, et procès-verbal prêt à la fin. Conforme au Code civil brésilien art. 1350.'),
  c('Pauta auto-gerada', 'Auto-generated agenda', 'Agenda autogenerada', 'Ordre du jour généré automatiquement'),
  c('A IA monta a pauta a partir das propostas abertas — contas, orçamento, assuntos do síndico.', 'AI builds the agenda from open proposals — accounts, budget, and board topics.', 'La IA arma la agenda desde las propuestas abiertas: cuentas, presupuesto y temas del administrador.', 'L’IA prépare l’ordre du jour à partir des propositions ouvertes : comptes, budget et sujets du syndic.'),
  c('Procurações digitais', 'Digital proxies', 'Poderes digitales', 'Procurations numériques'),
  c('Moradores concedem procuração a outro proprietário em 10s. Voto com peso correto.', 'Residents grant a proxy to another owner in 10 seconds. Votes keep the correct weight.', 'Los residentes dan poder a otro propietario en 10 segundos. El voto mantiene el peso correcto.', 'Les résidents donnent procuration à un autre propriétaire en 10 s. Le vote garde le bon poids.'),
  c('Quórum por item', 'Quorum per item', 'Quórum por punto', 'Quorum par point'),
  c('Maioria simples, 2/3 ou unanimidade — aplicado por tipo de pauta (convenção, orçamento, eleição).', 'Simple majority, two-thirds, or unanimity — applied by agenda type (bylaws, budget, election).', 'Mayoría simple, 2/3 o unanimidad, aplicada por tipo de punto (reglamento, presupuesto, elección).', 'Majorité simple, 2/3 ou unanimité, appliquée par type de point (règlement, budget, élection).'),
  c('Ata em PT-BR', 'Minutes in plain language', 'Acta en lenguaje claro', 'Procès-verbal en langage clair'),
  c('Fechou a sessão? A ata já está escrita, com presença, votos e deliberações. Só revisar.', 'Closed the session? The minutes are already written with attendance, votes, and decisions. Just review.', '¿Cerraste la sesión? El acta ya está escrita con asistencia, votos y decisiones. Solo revisa.', 'Session terminée ? Le procès-verbal est déjà rédigé avec présence, votes et décisions. Il suffit de relire.'),
  c('Assinatura digital opcional', 'Optional digital signature', 'Firma digital opcional', 'Signature numérique facultative'),
  c('uma semana no CondoOS', 'one week in CondoOS', 'una semana en CondoOS', 'une semaine dans CondoOS'),
  c('Da reclamação', 'From complaint', 'De la queja', 'De la plainte'),
  c('ao WhatsApp.', 'to WhatsApp.', 'a WhatsApp.', 'à WhatsApp.'),
  c('Uma semana real. De "o ar do saguão não tá funcionando" até o morador ler a decisão no celular.', 'A real week. From "the lobby AC is not working" to the resident reading the decision on their phone.', 'Una semana real. Desde "el aire del vestíbulo no funciona" hasta que el residente lee la decisión en el celular.', 'Une vraie semaine. De « la clim du hall ne marche pas » jusqu’à la décision lue sur le téléphone.'),
  c('Seg', 'Mon', 'Lun', 'Lun'),
  c('Ter', 'Tue', 'Mar', 'Mar'),
  c('Qua', 'Wed', 'Mié', 'Mer'),
  c('Sex', 'Fri', 'Vie', 'Ven'),
  c('Sáb', 'Sat', 'Sáb', 'Sam'),
  c('Morador reclama na aba Sugerir', 'Resident complains in the Suggest tab', 'El residente reclama en la pestaña Sugerir', 'Le résident signale dans l’onglet Suggérer'),
  c('"O ar do saguão tá quebrado. Ontem marcou 30°C aqui dentro." A IA transforma em proposta estruturada (Manutenção · ~R$ 47.000).', '"The lobby AC is broken. Yesterday it hit 30°C in here." AI turns it into a structured proposal (Maintenance · ~R$ 47,000).', '"El aire del vestíbulo está roto. Ayer llegó a 30°C aquí dentro." La IA lo convierte en una propuesta estructurada (Mantenimiento · ~R$ 47.000).', '« La clim du hall est cassée. Hier il faisait 30°C ici. » L’IA le transforme en proposition structurée (Maintenance · ~47 000 R$).'),
  c('Discussão entre vizinhos', 'Neighbor discussion', 'Discusión entre vecinos', 'Discussion entre voisins'),
  c('Comentários, fotos, sugestões. A IA resume a thread em pontos de acordo e desacordo para o síndico.', 'Comments, photos, suggestions. AI summarizes the thread into agreement and disagreement points for the board.', 'Comentarios, fotos, sugerencias. La IA resume el hilo en acuerdos y desacuerdos para el administrador.', 'Commentaires, photos, suggestions. L’IA résume le fil en points d’accord et de désaccord pour le syndic.'),
  c('Votação abre com quórum + janela', 'Voting opens with quorum + window', 'Votación abierta con quórum + plazo', 'Vote ouvert avec quorum + fenêtre'),
  c('Síndico define quórum (50%) e janela (48h). WhatsApp dispara para todos os moradores elegíveis.', 'The board sets quorum (50%) and a 48-hour window. WhatsApp notifies every eligible resident.', 'El administrador define quórum (50%) y plazo (48h). WhatsApp avisa a todos los residentes elegibles.', 'Le syndic définit le quorum (50 %) et la fenêtre (48 h). WhatsApp prévient tous les résidents éligibles.'),
  c('Fechamento automático + decisão', 'Automatic closing + decision', 'Cierre automático + decisión', 'Clôture automatique + décision'),
  c('Janela expirou, quórum batido. Outcome resolvido, síndico fecha com um clique e a IA escreve a comunicação oficial.', 'The window expires and quorum is met. The outcome is resolved, the board closes with one click, and AI writes the official notice.', 'El plazo termina y se alcanza el quórum. Resultado resuelto, el administrador cierra con un clic y la IA redacta el aviso oficial.', 'La fenêtre expire et le quorum est atteint. Résultat décidé, le syndic clôture en un clic et l’IA rédige l’annonce officielle.'),
  c('Anúncio em linguagem humana', 'Plain-language announcement', 'Aviso en lenguaje claro', 'Annonce en langage clair'),
  c('Morador recebe no WhatsApp: "Aprovada a troca do ar do saguão. Instalação na semana do dia 5." Sem juridiquês.', 'Residents get a WhatsApp message: "Lobby AC replacement approved. Installation during the week of the 5th." No legalese.', 'El residente recibe en WhatsApp: "Aprobado el cambio del aire del vestíbulo. Instalación la semana del día 5." Sin lenguaje legal.', 'Le résident reçoit sur WhatsApp : « Remplacement de la clim du hall approuvé. Installation la semaine du 5. » Sans jargon juridique.'),
  c('Do adolescente de skate', 'From the teen on a skateboard', 'Del adolescente en skate', 'De l’ado en skate'),
  c('à Dona Teresa de 72.', 'to 72-year-old Dona Teresa.', 'a Doña Teresa de 72.', 'à Dona Teresa, 72 ans.'),
  c('Todos votam. Todos se inteiram. Ninguém precisa virar especialista em condomínio. A IA explica em linguagem humana. O WhatsApp entrega o aviso onde o morador já está.', 'Everyone votes. Everyone understands. Nobody needs to become a condo expert. AI explains in plain language. WhatsApp delivers notices where residents already are.', 'Todos votan. Todos entienden. Nadie necesita volverse experto en condominios. La IA explica en lenguaje claro. WhatsApp entrega el aviso donde el residente ya está.', 'Tout le monde vote. Tout le monde comprend. Personne n’a besoin de devenir expert en copropriété. L’IA explique simplement. WhatsApp livre l’avis là où les résidents sont déjà.'),
  c('— sem lupa, sem desculpa.', '— no magnifier, no excuses.', '— sin lupa, sin excusas.', '— sans loupe, sans excuse.'),
  c('— chega onde o morador já passa o dia.', '— reaches residents where they already spend the day.', '— llega donde el residente ya pasa el día.', '— arrive là où les résidents passent déjà la journée.'),
  c('— a IA traduz o juridiquês antes do voto.', '— AI translates legalese before the vote.', '— la IA traduce el lenguaje legal antes del voto.', '— l’IA traduit le jargon juridique avant le vote.'),
  c('Uma moradora mais velha usando o CondoOS no celular na mesa da cozinha', 'An older resident using CondoOS on her phone at the kitchen table', 'Una residente mayor usando CondoOS en el celular en la mesa de la cocina', 'Une résidente âgée utilisant CondoOS sur son téléphone à la table de cuisine'),
  c('Nova mensagem', 'New message', 'Nuevo mensaje', 'Nouveau message'),
  c('3 segundos.', '3 seconds.', '3 segundos.', '3 secondes.'),
  c('Enquanto pega o café.', 'While grabbing coffee.', 'Mientras toma café.', 'Le temps de prendre un café.'),
  c('Proposta abriu? O morador vota sem sair do sofá. Contagem ao vivo, janela de 48 horas, fechamento automático — o síndico nem precisa ligar no grupo.', 'A proposal opens? Residents vote without leaving the sofa. Live tally, 48-hour window, automatic closing — the board does not need to chase the group chat.', '¿Se abrió una propuesta? El residente vota sin salir del sofá. Conteo en vivo, plazo de 48 horas, cierre automático: el administrador ni necesita escribir al grupo.', 'Une proposition s’ouvre ? Les résidents votent sans quitter le canapé. Décompte en direct, fenêtre de 48 h, clôture automatique : le syndic n’a pas besoin de relancer le groupe.'),
  c('Mão segurando o celular com a tela de votação em claymorphism — Vote tally com gráfico de pizza', 'Hand holding a phone with a claymorphism voting screen — vote tally with pie chart', 'Mano sosteniendo el celular con pantalla de votación claymorphism — conteo con gráfico circular', 'Main tenant un téléphone avec écran de vote claymorphism — décompte avec graphique circulaire'),
  c('Fecha em 2d 4h', 'Closes in 2d 4h', 'Cierra en 2d 4h', 'Se clôture dans 2 j 4 h'),
  c('Sim 9 · Não 2 · Abs 1', 'Yes 9 · No 2 · Abs 1', 'Sí 9 · No 2 · Abs 1', 'Oui 9 · Non 2 · Abs 1'),
  c('Morador no sofá tocando no celular para votar', 'Resident on the sofa tapping a phone to vote', 'Residente en el sofá tocando el celular para votar', 'Résident sur le canapé utilisant son téléphone pour voter'),
  c('Sem fila, sem burocracia', 'No lines, no bureaucracy', 'Sin fila, sin burocracia', 'Sans file, sans bureaucratie'),
  c('Voto que cabe no dia do morador.', 'Voting that fits a resident’s day.', 'Un voto que cabe en el día del residente.', 'Un vote qui tient dans la journée du résident.'),
  c('Porteiro entregando uma encomenda para a moradora', 'Doorman handing a package to a resident', 'Portero entregando un paquete a una residente', 'Gardien remettant un colis à une résidente'),
  c('Encomenda chegou? O morador sabe.', 'Package arrived? The resident knows.', '¿Llegó un paquete? El residente lo sabe.', 'Colis arrivé ? Le résident le sait.'),
  c('Notificação no app e no WhatsApp — sem o grupo do prédio virar caos.', 'Notification in the app and on WhatsApp — without turning the building group into chaos.', 'Notificación en la app y en WhatsApp, sin que el grupo del edificio se vuelva un caos.', 'Notification dans l’app et sur WhatsApp, sans transformer le groupe de l’immeuble en chaos.'),
  c('Mão segurando o celular com mensagem do CondoOS no WhatsApp', 'Hand holding a phone with a CondoOS WhatsApp message', 'Mano sosteniendo un celular con mensaje de CondoOS en WhatsApp', 'Main tenant un téléphone avec un message CondoOS sur WhatsApp'),
  c('Aviso onde o morador já está.', 'Notices where residents already are.', 'Avisos donde el residente ya está.', 'Avis là où les résidents sont déjà.'),
  c('Convocação de AGO, abertura de votação, chegada de encomenda — direto no WhatsApp.', 'Annual meeting notices, voting opens, package arrivals — straight to WhatsApp.', 'Convocatoria de asamblea anual, apertura de votación, llegada de paquete: directo a WhatsApp.', 'Convocation d’assemblée annuelle, ouverture de vote, arrivée de colis : directement sur WhatsApp.'),
  c('Dúvidas frequentes', 'Frequently asked questions', 'Preguntas frecuentes', 'Questions fréquentes'),
  c('Quanto custa?', 'How much does it cost?', '¿Cuánto cuesta?', 'Combien ça coûte ?'),
  c('Durante o beta (2026), grátis para até 50 unidades. Planos pagos a partir de R$ 2/unidade/mês quando sairmos do beta. Sem setup fee.', 'During beta (2026), free for up to 50 units. Paid plans start at R$ 2/unit/month after beta. No setup fee.', 'Durante el beta (2026), gratis hasta 50 unidades. Planes pagos desde R$ 2/unidad/mes al salir del beta. Sin costo de instalación.', 'Pendant la bêta (2026), gratuit jusqu’à 50 lots. Les offres payantes commencent à 2 R$/lot/mois après la bêta. Pas de frais de mise en place.'),
  c('Como funciona a LGPD?', 'How does LGPD work?', '¿Cómo funciona la LGPD?', 'Comment fonctionne la LGPD ?'),
  c('Dados pessoais ficam em servidores no Brasil. Apenas dados essenciais (nome, unidade, voto) são armazenados. Morador pode exportar ou deletar a qualquer momento.', 'Personal data stays on servers in Brazil. Only essential data (name, unit, vote) is stored. Residents can export or delete it anytime.', 'Los datos personales quedan en servidores en Brasil. Solo se almacenan datos esenciales (nombre, unidad, voto). El residente puede exportarlos o eliminarlos cuando quiera.', 'Les données personnelles restent sur des serveurs au Brésil. Seules les données essentielles (nom, lot, vote) sont stockées. Les résidents peuvent les exporter ou les supprimer à tout moment.'),
  c('A ata gerada pela IA tem validade legal?', 'Are AI-generated minutes legally valid?', '¿El acta generada por IA tiene validez legal?', 'Le procès-verbal généré par IA a-t-il une valeur légale ?'),
  c('A IA gera o rascunho. O síndico/secretário revisa e assina — é o ato jurídico humano que dá validade, como sempre foi.', 'AI generates the draft. The board admin or secretary reviews and signs it — the human legal act gives it validity, as always.', 'La IA genera el borrador. El administrador o secretario revisa y firma: el acto jurídico humano le da validez, como siempre.', 'L’IA génère le brouillon. Le syndic ou secrétaire relit et signe : l’acte juridique humain donne la validité, comme toujours.'),
  c('Funciona sem internet?', 'Does it work without internet?', '¿Funciona sin internet?', 'Cela fonctionne-t-il sans internet ?'),
  c('Durante a assembleia presencial, sim — os votos ficam em fila no celular e sincronizam quando a conexão voltar. Já validado em prédios com Wi-Fi ruim no saguão.', 'During an in-person meeting, yes — votes queue on the phone and sync when the connection returns. Already validated in buildings with poor lobby Wi-Fi.', 'Durante la asamblea presencial, sí: los votos quedan en cola en el celular y se sincronizan cuando vuelve la conexión. Ya validado en edificios con mal Wi-Fi en el vestíbulo.', 'Pendant une assemblée en présentiel, oui : les votes restent en file sur le téléphone et se synchronisent au retour de la connexion. Déjà validé dans des immeubles avec mauvais Wi-Fi dans le hall.'),
  c('Inquilinos votam?', 'Can tenants vote?', '¿Los inquilinos votan?', 'Les locataires votent-ils ?'),
  c('Não. Por padrão, só proprietários ativos (Código Civil). Em propostas não-estatutárias, o síndico pode abrir voto para todos os residentes.', 'No. By default, only active owners vote under the Civil Code. For non-statutory proposals, the board can open voting to all residents.', 'No. Por defecto, solo propietarios activos (Código Civil). En propuestas no estatutarias, el administrador puede abrir voto a todos los residentes.', 'Non. Par défaut, seuls les propriétaires actifs votent selon le Code civil. Pour les propositions non statutaires, le syndic peut ouvrir le vote à tous les résidents.'),
  c('Podemos migrar do sistema atual?', 'Can we migrate from our current system?', '¿Podemos migrar desde el sistema actual?', 'Peut-on migrer depuis notre système actuel ?'),
  c('CSV de moradores → importado em 1 clique. Histórico de atas antigas → importamos em PDF na ativação. Zero digitação para o síndico.', 'Resident CSV -> imported in one click. Old minutes -> imported as PDFs during activation. Zero typing for the board.', 'CSV de residentes -> importado en 1 clic. Histórico de actas antiguas -> importamos PDFs en la activación. Cero digitación para el administrador.', 'CSV des résidents -> importé en 1 clic. Anciennes minutes -> PDF importés à l’activation. Aucune ressaisie pour le syndic.'),
  c('Vai que é hoje.', 'Maybe today is the day.', 'Quizá hoy sea el día.', 'Et si c’était aujourd’hui ?'),
  c('Entre com o Google em 10 segundos. Sem cartão, sem setup — escolha o caminho certo abaixo.', 'Sign in with Google in 10 seconds. No card, no setup — choose the right path below.', 'Entra con Google en 10 segundos. Sin tarjeta, sin configuración: elige el camino correcto abajo.', 'Connectez-vous avec Google en 10 secondes. Pas de carte, pas de configuration : choisissez le bon chemin ci-dessous.'),
  c('© 2026 CondoOS · feito em hackathon, desenhado para humanos', '© 2026 CondoOS · built in a hackathon, designed for humans', '© 2026 CondoOS · hecho en hackathon, diseñado para humanos', '© 2026 CondoOS · créé en hackathon, conçu pour les humains'),
  c('Design system', 'Design system', 'Sistema de diseño', 'Système de design'),

  // Resident app
  c('Tudo aguardando você na portaria.', 'Everything waiting for you at the front desk.', 'Todo esperando por ti en portería.', 'Tout ce qui vous attend à la conciergerie.'),
  c('Nenhuma encomenda ainda', 'No packages yet', 'Aún no hay paquetes', 'Aucun colis pour le moment'),
  c('As entregas aparecem aqui no momento que chegam.', 'Deliveries appear here as soon as they arrive.', 'Las entregas aparecen aquí al llegar.', 'Les livraisons apparaissent ici dès leur arrivée.'),
  c('Aguardando retirada', 'Waiting for pickup', 'Esperando retiro', 'En attente de retrait'),
  c('aguardando', 'waiting', 'esperando', 'en attente'),
  c('Marcar retirada', 'Mark picked up', 'Marcar retirado', 'Marquer comme retiré'),
  c('Retiradas recentes', 'Recent pickups', 'Retiros recientes', 'Retraits récents'),
  c('Visitantes', 'Visitors', 'Visitantes', 'Visiteurs'),
  c('Avise sobre visitas, entregas ou serviços. A portaria recebe na hora.', 'Notify visitors, deliveries, or services. The front desk gets it immediately.', 'Avisa sobre visitas, entregas o servicios. Portería lo recibe al instante.', 'Prévenez pour les visiteurs, livraisons ou services. La conciergerie le reçoit immédiatement.'),
  c('Novo visitante', 'New visitor', 'Nuevo visitante', 'Nouveau visiteur'),
  c('Cancelar', 'Cancel', 'Cancelar', 'Annuler'),
  c('Nome do visitante', 'Visitor name', 'Nombre del visitante', 'Nom du visiteur'),
  c('Visita', 'Guest', 'Visita', 'Invité'),
  c('Entrega', 'Delivery', 'Entrega', 'Livraison'),
  c('Serviço', 'Service', 'Servicio', 'Service'),
  c('Aplicativo', 'Rideshare', 'App de transporte', 'VTC'),
  c('Observações (opcional)', 'Notes (optional)', 'Notas (opcional)', 'Notes (facultatif)'),
  c('Enviar solicitação', 'Send request', 'Enviar solicitud', 'Envoyer la demande'),
  c('Nenhum visitante registrado', 'No visitors registered', 'Ningún visitante registrado', 'Aucun visiteur enregistré'),
  c('Avise antes para a portaria estar preparada.', 'Notify ahead so the front desk is prepared.', 'Avisa antes para que portería se prepare.', 'Prévenez à l’avance pour préparer la conciergerie.'),
  c('Adicionar visitante', 'Add visitor', 'Agregar visitante', 'Ajouter un visiteur'),
  c('Confirmar reserva', 'Confirm booking', 'Confirmar reserva', 'Confirmer la réservation'),
  c('Próximas reservas', 'Upcoming bookings', 'Próximas reservas', 'Réservations à venir'),
  c('Nenhuma reserva futura no prédio.', 'No upcoming building bookings.', 'No hay reservas futuras.', 'Aucune réservation à venir.'),
  c('Você', 'You', 'Tú', 'Vous'),
  c('You', 'You', 'Tú', 'Vous'),
  c('Nenhuma assembleia agendada.', 'No assemblies scheduled.', 'No hay asambleas programadas.', 'Aucune assemblée planifiée.'),
  c('Redigido pela IA', 'AI-drafted', 'Redactado por IA', 'Rédigé par IA'),
  c('modo offline', 'offline mode', 'modo offline', 'mode hors ligne'),
  c('O que tá pegando?', 'What is going on?', '¿Qué está pasando?', 'Que se passe-t-il ?'),
  c('Pode ser informal. Escreva como falaria com um vizinho.', 'Informal is fine. Write like you would text a neighbor.', 'Puede ser informal. Escribe como hablarías con un vecino.', 'Vous pouvez être informel. Écrivez comme à un voisin.'),
  c('IA redigindo...', 'AI is drafting...', 'La IA está redactando...', 'L’IA rédige...'),
  c('Enviar', 'Submit', 'Enviar', 'Envoyer'),
  c('A IA está transformando sua ideia em uma proposta estruturada...', 'AI is turning your idea into a structured proposal...', 'La IA transforma tu idea en una propuesta estructurada...', 'L’IA transforme votre idée en proposition structurée...'),
  c('Proposta redigida pela IA', 'AI-drafted proposal', 'Propuesta redactada por IA', 'Proposition rédigée par IA'),
  c('Editar sugestão', 'Edit suggestion', 'Editar sugerencia', 'Modifier la suggestion'),
  c('Enviar ao síndico', 'Send to board', 'Enviar al administrador', 'Envoyer au syndic'),
  c('Preferências', 'Settings', 'Preferencias', 'Préférences'),
  c('Perfil e notificações', 'Profile and notifications', 'Perfil y notificaciones', 'Profil et notifications'),
  c('Profile', 'Profile', 'Perfil', 'Profil'),
  c('Name', 'Name', 'Nombre', 'Nom'),
  c('Email', 'Email', 'Email', 'E-mail'),
  c('WhatsApp notifications', 'WhatsApp notifications', 'Notificaciones de WhatsApp', 'Notifications WhatsApp'),
  c('Ativo', 'Active', 'Activo', 'Actif'),
  c('Desativado', 'Disabled', 'Desactivado', 'Désactivé'),
  c('Salvar preferências', 'Save preferences', 'Guardar preferencias', 'Enregistrer'),

  // Navigation — new pages
  c('Transparência', 'Transparency', 'Transparencia', 'Transparence'),
  c('Edifício', 'Building', 'Edificio', 'Immeuble'),
  c('Finanças', 'Finances', 'Finanzas', 'Finances'),
  c('Porteiro', 'Concierge', 'Portero', 'Portier'),

  // Resident overview promo card
  c('Seu prédio, num panorama.', 'Your building, at a glance.', 'Tu edificio, de un vistazo.', 'Votre immeuble, en un coup d\'œil.'),
  c('Um toque para retirar uma encomenda, aprovar uma visita, reservar a piscina ou opinar numa proposta.', 'One tap to pick up a package, approve a visitor, book the pool, or weigh in on a proposal.', 'Un toque para retirar un paquete, aprobar una visita, reservar la piscina u opinar en una propuesta.', 'Un toucher pour retirer un colis, approuver un visiteur, réserver la piscine ou voter sur une proposition.'),
  c('Sugerir algo', 'Suggest something', 'Sugerir algo', 'Suggérer quelque chose'),
  c('Reservar área comum', 'Book a common area', 'Reservar área común', 'Réserver un espace commun'),

  // Visitors — new features (tabs, pre-approve, status badges)
  c('Avise sobre visitas, entregas ou serviços. A portaria recebe na hora — e você pode pré-aprovar quem vem mais tarde.', 'Notify about visits, deliveries, or services. The front desk gets it immediately — and you can pre-approve future arrivals.', 'Avisa sobre visitas, entregas o servicios. Portería lo recibe al instante — y puedes preaprobar llegadas futuras.', 'Prévenez pour les visiteurs, livraisons ou services. La conciergerie le reçoit immédiatement — et vous pouvez pré-approuver les arrivées futures.'),
  c('Próximas', 'Upcoming', 'Próximas', 'À venir'),
  c('Histórico', 'History', 'Historial', 'Historique'),
  c('Quando chega', 'When they arrive', 'Cuándo llega', 'Quand arrive-t-il'),
  c('Pode marcar pra daqui a horas, dias ou semanas — a portaria fica avisada.', 'You can schedule hours, days, or weeks ahead — the front desk is notified.', 'Puedes marcarlo con horas, días o semanas de anticipación — portería queda avisada.', 'Vous pouvez planifier des heures, jours ou semaines à l\'avance — la conciergerie est notifiée.'),
  c('Pré-aprovar a entrada', 'Pre-approve entry', 'Pre-autorizar entrada', 'Pré-approuver l\'entrée'),
  c('Quando o visitante chegar, a portaria já tem liberação — sem precisar te ligar.', 'When the visitor arrives, the front desk already has clearance — no need to call.', 'Cuando llegue el visitante, portería ya tiene autorización — sin necesidad de llamar.', 'Quand le visiteur arrive, la conciergerie a déjà l\'autorisation — pas besoin d\'appeler.'),
  c('Pré-aprovar visita', 'Pre-approve visit', 'Pre-autorizar visita', 'Pré-approuver la visite'),
  c('pendente', 'pending', 'pendiente', 'en attente'),
  c('aprovado', 'approved', 'aprobado', 'approuvé'),
  c('negado', 'denied', 'rechazado', 'refusé'),
  c('chegou', 'arrived', 'llegó', 'arrivé'),
  c('concluído', 'completed', 'completado', 'terminé'),
  c('Previsto para ', 'Scheduled for ', 'Previsto para ', 'Prévu pour '),
  c('Esperado em ', 'Expected on ', 'Esperado el ', 'Prévu le '),

  // Amenities — party room / guest list
  c('Vai ter festa? Avise a portaria.', 'Having a party? Let the front desk know.', '¿Habrá fiesta? Avisa a portería.', 'Il y a une fête ? Prévenez la conciergerie.'),
  c('Quantos convidados e quem são. O porteiro libera por nome — sem ligação na hora.', 'How many guests and who they are. The doorman clears by name — no call needed.', 'Cuántos invitados y quiénes son. Portería los autoriza por nombre — sin llamada.', 'Combien d\'invités et qui ils sont. La conciergerie autorise par nom — sans appel.'),
  c('Quantos convidados (estimado)', 'How many guests (estimated)', 'Cantidad de invitados (estimado)', 'Nombre d\'invités (estimé)'),
  c('Observações para a portaria (opcional)', 'Notes for the front desk (optional)', 'Notas para portería (opcional)', 'Notes pour la conciergerie (facultatif)'),
  c('Lista de convidados (um nome por linha)', 'Guest list (one name per line)', 'Lista de invitados (un nombre por línea)', 'Liste d\'invités (un nom par ligne)'),
  c('A portaria recebe a lista no dia. Pode editar até a hora da festa.', 'The front desk gets the list on the day. You can edit until party time.', 'Portería recibe la lista el día de la fiesta. Puedes editar hasta la hora.', 'La conciergerie reçoit la liste le jour même. Vous pouvez modifier jusqu\'à l\'heure.'),
  c('Reservar:', 'Reserve:', 'Reservar:', 'Réserver :'),

  // Transparência / Finanças — shared strings
  c('Transparência', 'Transparency', 'Transparencia', 'Transparence'),
  c('Tudo que o condomínio gastou nos últimos 12 meses. Cada lançamento traz fornecedor, valor e — quando disponível — o recibo.', 'Everything the condo has spent in the last 12 months. Each entry shows the vendor, amount, and — when available — the receipt.', 'Todo lo que el condominio ha gastado en los últimos 12 meses. Cada entrada muestra el proveedor, monto y — cuando esté disponible — el recibo.', 'Tout ce que la copropriété a dépensé ces 12 derniers mois. Chaque entrée indique le fournisseur, le montant et — si disponible — le reçu.'),
  c('Para onde está indo o dinheiro', 'Where the money is going', 'A dónde va el dinero', 'Où va l\'argent'),
  c('Sem despesas registradas ainda.', 'No expenses recorded yet.', 'Aún no hay gastos registrados.', 'Aucune dépense enregistrée.'),
  c('Lançamentos', 'Expenses', 'Gastos', 'Dépenses'),
  c('Resumo por categoria', 'Summary by category', 'Resumen por categoría', 'Résumé par catégorie'),
  c('Nova despesa', 'New expense', 'Nuevo gasto', 'Nouvelle dépense'),
  c('Manutenção', 'Maintenance', 'Mantenimiento', 'Maintenance'),
  c('Segurança / portaria', 'Security / front desk', 'Seguridad / portería', 'Sécurité / conciergerie'),
  c('Contas (luz, água, gás)', 'Utilities (electricity, water, gas)', 'Servicios (luz, agua, gas)', 'Charges (électricité, eau, gaz)'),
  c('Limpeza', 'Cleaning', 'Limpieza', 'Nettoyage'),
  c('Seguro', 'Insurance', 'Seguro', 'Assurance'),
  c('Funcionários', 'Staff', 'Personal', 'Personnel'),
  c('Fundo de reserva', 'Reserve fund', 'Fondo de reserva', 'Fonds de réserve'),
  c('Onde o condomínio gasta. Cada lançamento aparece para os moradores no painel de transparência — coloque o link do recibo sempre que possível.', 'Where the condo spends. Every entry appears on the resident transparency dashboard — always attach the receipt link when possible.', 'Dónde gasta el condominio. Cada entrada aparece en el panel de transparencia de los residentes — adjunta siempre el enlace del recibo.', 'Où la copropriété dépense. Chaque entrée apparaît dans le tableau de transparence des résidents — joignez toujours le lien du reçu.'),

  // Board overview — stat cards + promo banners
  c('Sugestões novas', 'New suggestions', 'Sugerencias nuevas', 'Nouvelles suggestions'),
  c('Propostas ativas', 'Active proposals', 'Propuestas activas', 'Propositions actives'),
  c('Reuniões agendadas', 'Scheduled meetings', 'Reuniones programadas', 'Réunions planifiées'),
  c('Caixa de IA', 'AI inbox', 'Bandeja de IA', 'Boîte IA'),
  c('sugestões de moradores esperando', 'resident suggestions waiting', 'sugerencias de residentes esperando', 'suggestions de résidents en attente'),
  c('Agrupe, transforme em proposta ou descarte. Um clique cada.', 'Cluster, promote to a proposal, or dismiss. One click each.', 'Agrupa, transforma en propuesta o descarta. Un clic cada una.', 'Regroupez, transformez en proposition ou ignorez. Un clic chacune.'),
  c('Abrir caixa', 'Open inbox', 'Abrir bandeja', 'Ouvrir la boîte'),
  c('Reunião pronta?', 'Meeting ready?', '¿Reunión lista?', 'Réunion prête ?'),
  c('Cole as anotações. Receba o resumo, tarefas e o comunicado pros moradores.', 'Paste the notes. Get the summary, tasks, and resident announcement.', 'Pega las notas. Obtén el resumen, tareas y el comunicado para residentes.', 'Collez les notes. Obtenez le résumé, tâches et l\'annonce pour les résidents.'),
  c('Ver reuniões', 'See meetings', 'Ver reuniones', 'Voir les réunions'),

  // Board proposals — list + detail
  c('Todas as decisões em andamento. Abrir votação, discutir, resumir, encerrar.', 'All active decisions. Open voting, discuss, summarize, close.', 'Todas las decisiones activas. Abrir votación, discutir, resumir, cerrar.', 'Toutes les décisions actives. Ouvrir un vote, discuter, résumer, clore.'),
  c('Em votação', 'In voting', 'En votación', 'En vote'),
  c('Em discussão', 'In discussion', 'En discusión', 'En discussion'),
  c('Nova proposta', 'New proposal', 'Nueva propuesta', 'Nouvelle proposition'),
  c('Análise pré-votação', 'Pre-vote analysis', 'Análisis previo a la votación', 'Analyse pré-vote'),
  c('Custo não definido', 'Cost not defined', 'Costo no definido', 'Coût non défini'),
  c('Analisar com IA', 'Analyze with AI', 'Analizar con IA', 'Analyser avec IA'),
  c('Re-analisar com IA', 'Re-analyze with AI', 'Re-analizar con IA', 'Ré-analyser avec IA'),
  c('Os moradores precisam de uma estimativa de custo + riscos antes de votar. A IA gera tudo a partir do título e descrição — só revisar.', 'Residents need a cost estimate + risks before voting. AI generates it all from the title and description — just review.', 'Los residentes necesitan una estimación de costo + riesgos antes de votar. La IA lo genera todo a partir del título y descripción — solo revisa.', 'Les résidents ont besoin d\'une estimation de coût + risques avant de voter. L\'IA génère tout à partir du titre et de la description — il suffit de relire.'),
  c('Abrir votação', 'Open voting', 'Abrir votación', 'Ouvrir le vote'),
  c('Reprovar', 'Reject', 'Reprobar', 'Rejeter'),
  c('Salvar regras de votação', 'Save voting rules', 'Guardar reglas de votación', 'Enregistrer les règles de vote'),
  c('Comparecimento:', 'Turnout:', 'Participación:', 'Participation :'),
  c('Quórum atingido', 'Quorum reached', 'Quórum alcanzado', 'Quorum atteint'),
  c('Quórum ainda não atingido', 'Quorum not yet reached', 'Quórum aún no alcanzado', 'Quorum pas encore atteint'),
  c('Resumo da discussão', 'Discussion summary', 'Resumen de la discusión', 'Résumé de la discussion'),
  c('Resumir', 'Summarize', 'Resumir', 'Résumer'),
  c('Versão para morador', 'Resident version', 'Versión para residente', 'Version pour résident'),
  c('Gerar', 'Generate', 'Generar', 'Générer'),
  c('sim', 'yes', 'sí', 'oui'),
  c('não', 'no', 'no', 'non'),
  c('abst.', 'abst.', 'abst.', 'abst.'),

  // Edifício — building management
  c('1 bloco · 8 unidades', '1 block · 8 units', '1 bloque · 8 unidades', '1 bloc · 8 lots'),
  c('Novo bloco', 'New block', 'Nuevo bloque', 'Nouveau bloc'),
  c('Novo bloco', 'New block', 'Nuevo bloque', 'Nouveau bloc'),
  c('Adicionar unidade', 'Add unit', 'Agregar unidad', 'Ajouter un lot'),
  c('unidades', 'units', 'unidades', 'lots'),
  c('unidade', 'unit', 'unidad', 'lot'),
  c('andares', 'floors', 'pisos', 'étages'),
  c('andar', 'floor', 'piso', 'étage'),
  c('morador', 'resident', 'residente', 'résident'),
  c('moradores', 'residents', 'residentes', 'résidents'),
  c('Especial', 'Special', 'Especial', 'Spécial'),
  c('Operação', 'Operations', 'Operación', 'Opérations'),
  c('Rede de operação', 'Operations network', 'Red de operaciones', 'Réseau opérationnel'),
  c('Novo contato', 'New contact', 'Nuevo contacto', 'Nouveau contact'),
  c('Rede de serviços do condomínio', 'Condo service network', 'Red de servicios del condominio', 'Réseau de services de la copropriété'),
  c('Novo contato operacional', 'New operations contact', 'Nuevo contacto operativo', 'Nouveau contact opérationnel'),
  c('Editar contato operacional', 'Edit operations contact', 'Editar contacto operativo', 'Modifier le contact opérationnel'),
  c('Tipo de serviço', 'Service type', 'Tipo de servicio', 'Type de service'),
  c('Empresa / fornecedor', 'Company / vendor', 'Empresa / proveedor', 'Entreprise / fournisseur'),
  c('Pessoa de contato', 'Contact person', 'Persona de contacto', 'Personne à contacter'),
  c('O que resolve', 'What they handle', 'Qué resuelve', 'Ce qu’il prend en charge'),
  c('Atende emergência', 'Emergency available', 'Atiende emergencias', 'Disponible en urgence'),
  c('Fornecedor preferido', 'Preferred vendor', 'Proveedor preferido', 'Fournisseur préféré'),
  c('Último uso', 'Last used', 'Último uso', 'Dernière utilisation'),
  c('ativo', 'active', 'activo', 'actif'),
  c('inativo', 'inactive', 'inactivo', 'inactif'),
  c('preferido', 'preferred', 'preferido', 'préféré'),
  c('emergência', 'emergency', 'emergencia', 'urgence'),

  // Board app
  c('Tudo que precisa da sua atenção.', 'Everything that needs your attention.', 'Todo lo que necesita tu atención.', 'Tout ce qui demande votre attention.'),
  c('Não foi possível carregar parte dos dados. Atualize a página ou entre novamente.', 'Some data could not load. Refresh the page or sign in again.', 'No se pudo cargar parte de los datos. Actualiza o entra de nuevo.', 'Certaines données n’ont pas pu charger. Actualisez ou reconnectez-vous.'),
  c('em votação', 'voting', 'en votación', 'en vote'),
  c('em discussão', 'discussion', 'en discusión', 'en discussion'),
  c('aprovada', 'approved', 'aprobada', 'approuvée'),
  c('reprovada', 'rejected', 'rechazada', 'rejetée'),
  c('concluída', 'completed', 'concluida', 'terminée'),
  c('inconclusiva', 'inconclusive', 'inconclusa', 'non concluante'),
  c('Resident suggestions', 'Resident suggestions', 'Sugerencias de residentes', 'Suggestions des résidents'),
  c('Raw input from residents. Cluster related items, promote to proposals, or dismiss.', 'Raw input from residents. Cluster related items, promote to proposals, or dismiss.', 'Ideas de residentes. Agrupa temas, promueve propuestas o descarta.', 'Retours des résidents. Regroupez, transformez en propositions ou ignorez.'),
  c('Cluster with AI', 'Cluster with AI', 'Agrupar con IA', 'Regrouper avec IA'),
  c('Clustered with AI', 'Clustered with AI', 'Agrupado con IA', 'Regroupé par IA'),
  c('Promoted to a proposal', 'Promoted to a proposal', 'Promovido a propuesta', 'Transformé en proposition'),
  c('Cluster', 'Cluster', 'Grupo', 'Groupe'),
  c('Unclustered', 'Unclustered', 'Sin agrupar', 'Non regroupé'),
  c('Open suggestions', 'Open suggestions', 'Sugerencias abiertas', 'Suggestions ouvertes'),
  c('Dismiss', 'Dismiss', 'Descartar', 'Ignorer'),
  c('Promote', 'Promote', 'Promover', 'Promouvoir'),
  c('All clear! Run the AI clusterer above when new suggestions come in.', 'All clear! Run the AI clusterer above when new suggestions come in.', 'Todo listo. Usa el agrupador con IA cuando lleguen sugerencias.', 'Tout est clair. Lancez le regroupement IA quand de nouvelles suggestions arrivent.'),
  c('Nova assembleia', 'New assembly', 'Nueva asamblea', 'Nouvelle assemblée'),
  c('Assembleia criada — adicione itens à pauta', 'Assembly created — add agenda items', 'Asamblea creada — agrega puntos a la agenda', 'Assemblée créée — ajoutez des points à l’ordre du jour'),
  c('Create failed', 'Create failed', 'Error al crear', 'Échec de création'),
  c('Ordinária (AGO)', 'Ordinary (AGO)', 'Ordinaria (AGO)', 'Ordinaire (AGO)'),
  c('Extraordinária (AGE)', 'Extraordinary (AGE)', 'Extraordinaria (AGE)', 'Extraordinaire (AGE)'),
  c('1ª chamada', '1st call', '1ª convocatoria', '1er appel'),
  c('2ª chamada (optional — defaults to +30min)', '2nd call (optional — defaults to +30min)', '2ª convocatoria (opcional — +30 min por defecto)', '2e appel (facultatif — +30 min par défaut)'),
  c('Nenhuma assembleia ainda. Comece a AGO quando chegar o ciclo anual.', 'No assemblies yet. Start the AGO when the annual cycle arrives.', 'Aún no hay asambleas. Inicia la AGO cuando llegue el ciclo anual.', 'Aucune assemblée pour le moment. Lancez l’AGO au cycle annuel.'),
  c('Invite code', 'Invite code', 'Código de invitación', 'Code d’invitation'),
  c('Copied', 'Copied', 'Copiado', 'Copié'),
  c('Copy', 'Copy', 'Copiar', 'Copier'),
  c('Bulk import resident roster', 'Bulk import resident roster', 'Importar residentes en lote', 'Importer les résidents en lot'),
  c('Rows that need attention', 'Rows that need attention', 'Filas que necesitan atención', 'Lignes à vérifier'),
  c('pending', 'pending', 'pendiente', 'en attente'),
  c('emailed', 'emailed', 'enviado por email', 'envoyé par e-mail'),
  c('email failed', 'email failed', 'falló el email', 'échec e-mail'),
  c('Board', 'Board', 'Consejo', 'Conseil'),
  // PT slot was previously English ("Resident approved") so a PT user saw English; fixed in 2026-05 audit.
  c('Morador aprovado', 'Resident approved', 'Residente aprobado', 'Résident approuvé'),
  c('Pedido recusado', 'Request denied', 'Solicitud rechazada', 'Demande refusée'),
  c('Approve', 'Approve', 'Aprobar', 'Approuver'),
  c('Deny', 'Deny', 'Rechazar', 'Refuser'),

  // Onboarding
  c('Welcome', 'Welcome', 'Bienvenido', 'Bienvenue'),
  c('Welcome,', 'Welcome,', 'Bienvenido,', 'Bienvenue,'),
  c('Step 1 of 2', 'Step 1 of 2', 'Paso 1 de 2', 'Étape 1 sur 2'),
  c('Waiting for approval', 'Waiting for approval', 'Esperando aprobación', 'En attente d’approbation'),
  c('Join a building', 'Join a building', 'Unirse a un edificio', 'Rejoindre un immeuble'),
  c('Create a new building', 'Create a new building', 'Crear un edificio nuevo', 'Créer un nouvel immeuble'),
  c('Create a building', 'Create a building', 'Crear edificio', 'Créer un immeuble'),
  c('Building', 'Building', 'Edificio', 'Immeuble'),
  c('Structure', 'Structure', 'Estructura', 'Structure'),
  c('Preferences', 'Preferences', 'Preferencias', 'Préférences'),
  c('Done', 'Done', 'Listo', 'Terminé'),
  c('What\'s your building called?', 'What\'s your building called?', '¿Cómo se llama tu edificio?', 'Comment s’appelle votre immeuble ?'),
  c('Residents will see this name when they join.', 'Residents will see this name when they join.', 'Los residentes verán este nombre al unirse.', 'Les résidents verront ce nom en rejoignant.'),
  c('Building / tower name', 'Building / tower name', 'Nombre del edificio / torre', 'Nom de l’immeuble / tour'),
  c('Structure & your unit', 'Structure & your unit', 'Estructura y tu unidad', 'Structure et votre lot'),
  c('You can rename individual units later.', 'You can rename individual units later.', 'Puedes renombrar unidades después.', 'Vous pourrez renommer les lots plus tard.'),
  c('Unidades padrão', 'Default units', 'Unidades predeterminadas', 'Lots par défaut'),
  c('Unidades por andar', 'Units by floor', 'Unidades por piso', 'Lots par étage'),
  c('Edite os andares que fogem do padrão. Use 0 para andares sem apartamentos.', 'Edit the floors that differ from the default. Use 0 for floors without apartments.', 'Edita los pisos que se salen del patrón. Usa 0 para pisos sin apartamentos.', 'Modifiez les étages qui diffèrent du défaut. Utilisez 0 pour les étages sans appartements.'),
  c('Layout personalizado', 'Custom layout', 'Distribución personalizada', 'Plan personnalisé'),
  c('Mesmo padrão', 'Same pattern', 'Mismo patrón', 'Même modèle'),
  c('unidades neste bloco', 'units in this block', 'unidades en este bloque', 'lots dans ce bloc'),
  c('unidades no total', 'units total', 'unidades en total', 'lots au total'),
  c('Continuar', 'Continue', 'Continuar', 'Continuer'),
  c('Back', 'Back', 'Volver', 'Retour'),
  c('Create building', 'Create building', 'Crear edificio', 'Créer l’immeuble'),
  c('You\'re in.', 'You\'re in.', 'Ya estás dentro.', 'Vous y êtes.'),
  c('Copy code', 'Copy code', 'Copiar código', 'Copier le code'),
  c('Copied!', 'Copied!', '¡Copiado!', 'Copié !'),
  c('Enter your invite code', 'Enter your invite code', 'Ingresa tu código de invitación', 'Entrez votre code d’invitation'),
  c('Building found', 'Building found', 'Edificio encontrado', 'Immeuble trouvé'),
  c('Request sent', 'Request sent', 'Solicitud enviada', 'Demande envoyée'),
  c('Request to join', 'Request to join', 'Solicitar ingreso', 'Demander à rejoindre'),
  c('Join now', 'Join now', 'Unirse ahora', 'Rejoindre maintenant'),

  // Proposal detail — voter eligibility + quorum section
  c('Voltar', 'Back', 'Volver', 'Retour'),
  c('Encerrar e gerar decisão', 'Close and generate decision', 'Cerrar y generar decisión', 'Clore et générer la décision'),
  c('Votar como proprietário', 'Vote as owner', 'Votar como propietario', 'Voter en tant que propriétaire'),
  c('Redigido pela IA', 'AI-drafted', 'Redactado por IA', 'Rédigé par IA'),
  c('Só proprietários', 'Owners only', 'Solo propietarios', 'Propriétaires uniquement'),
  c('Um voto por unidade', 'One vote per unit', 'Un voto por unidad', 'Un vote par lot'),
  c('Todos os moradores votam', 'All residents vote', 'Todos los residentes votan', 'Tous les résidents votent'),
  c('Custos', 'Costs', 'Costos', 'Coûts'),
  c('Riscos e considerações', 'Risks and considerations', 'Riesgos y consideraciones', 'Risques et considérations'),
  c('Quem vota nesta proposta?', 'Who votes on this proposal?', '¿Quién vota en esta propuesta?', 'Qui vote sur cette proposition ?'),
  c('Defina antes de abrir a votação — não pode mudar depois.', 'Define before opening voting — can\'t change after.', 'Defina antes de abrir la votación — no se puede cambiar después.', 'Définissez avant d\'ouvrir le vote — impossible de modifier ensuite.'),
  c('Todos os moradores (incluindo inquilinos)', 'All residents (including tenants)', 'Todos los residentes (incluidos inquilinos)', 'Tous les résidents (locataires inclus)'),
  c('Só proprietários (capex / despesas do condomínio)', 'Owners only (capex / condo expenses)', 'Solo propietarios (capex / gastos del condominio)', 'Propriétaires uniquement (capex / charges)'),
  c('Um voto por unidade — contato principal', 'One vote per unit — primary contact', 'Un voto por unidad — contacto principal', 'Un vote par lot — contact principal'),
  c('Quórum e janela', 'Quorum & window', 'Quórum y ventana', 'Quorum et fenêtre'),
  c('Quórum + janela aplicados no fechamento. Quórum não batido → inconclusiva.', 'Quorum + window applied at close. Quorum not met → inconclusive.', 'Quórum + ventana aplicados al cierre. Quórum no alcanzado → inconclusiva.', 'Quorum + fenêtre appliqués à la clôture. Quorum non atteint → non concluant.'),
  c('Quórum', 'Quorum', 'Quórum', 'Quorum'),
  c('Abertura da votação', 'Voting opens', 'Apertura de la votación', 'Ouverture du vote'),
  c('Fechamento da votação', 'Voting closes', 'Cierre de la votación', 'Clôture du vote'),
  c('Sem quórum', 'No quorum', 'Sin quórum', 'Sans quorum'),
  c('Sim', 'Yes', 'Sí', 'Oui'),
  c('Não', 'No', 'No', 'Non'),
  c('Abstenção', 'Abstention', 'Abstención', 'Abstention'),
  c('peso', 'weight', 'peso', 'poids'),
  c('Inconclusiva', 'Inconclusive', 'Inconclusiva', 'Non concluante'),
  c('Próximos passos', 'Next steps', 'Próximos pasos', 'Prochaines étapes'),
  c('Resumo da decisão', 'Decision summary', 'Resumen de la decisión', 'Résumé de la décision'),
  c('Concordância', 'Agreement', 'Concordancia', 'Accord'),
  c('Discordância', 'Disagreement', 'Discordancia', 'Désaccord'),
  c('Em aberto', 'Open questions', 'Preguntas abiertas', 'Questions ouvertes'),
  c('Versão em linguagem simples para usar num comunicado.', 'Plain-language version to use in an announcement.', 'Versión en lenguaje sencillo para usar en un comunicado.', 'Version en langage simple pour un communiqué.'),

  // Proposal list form + categories
  c('Cancelar', 'Cancel', 'Cancelar', 'Annuler'),
  c('Encerradas', 'Closed', 'Cerradas', 'Clôturées'),
  c('Cria a proposta direto em discussão. Você define quórum + janela e abre a votação quando quiser.', 'Creates the proposal in discussion. Set the quorum + window and open voting when ready.', 'Crea la propuesta en discusión. Define quórum + ventana y abre la votación cuando quieras.', 'Crée la proposition en discussion. Définissez le quorum + fenêtre et ouvrez le vote quand vous voulez.'),
  c('Contexto, motivo, o que vai mudar. Quanto mais claro, mais fácil pros moradores votarem.', 'Context, reason, what will change. The clearer the easier for residents to vote.', 'Contexto, motivo, qué va a cambiar. Cuanto más claro, más fácil para los residentes votar.', 'Contexte, raison, ce qui va changer. Plus c\'est clair, plus c\'est facile pour les résidents de voter.'),
  c('Categoria', 'Category', 'Categoría', 'Catégorie'),
  c('Custo estimado (R$, opcional)', 'Estimated cost (optional)', 'Costo estimado (opcional)', 'Coût estimé (facultatif)'),
  c('Infraestrutura', 'Infrastructure', 'Infraestructura', 'Infrastructure'),
  c('Áreas comuns', 'Common areas', 'Áreas comunes', 'Parties communes'),
  c('Convivência', 'Community', 'Convivencia', 'Vie commune'),
  c('Convenção / regras', 'Convention / rules', 'Reglamento / normas', 'Règlement / règles'),
  c('Financeiro', 'Financial', 'Financiero', 'Financier'),
  c('Criar proposta', 'Create proposal', 'Crear propuesta', 'Créer une proposition'),
  c('por', 'by', 'por', 'par'),

  // Building (Edifício) admin
  c('blocos', 'blocks', 'bloques', 'blocs'),
  c('bloco', 'block', 'bloque', 'bloc'),
  c('Nenhum bloco cadastrado ainda. Use "Novo bloco" para começar.', 'No blocks yet. Use "New block" to get started.', 'Sin bloques aún. Use "Nuevo bloque" para empezar.', 'Aucun bloc encore. Utilisez "Nouveau bloc" pour commencer.'),
  c('Nome', 'Name', 'Nombre', 'Nom'),
  c('Andares', 'Floors', 'Pisos', 'Étages'),
  c('Unidades por andar (auto-gerar)', 'Units per floor (auto-generate)', 'Unidades por piso (auto-generar)', 'Lots par étage (auto-générer)'),
  c('0 = começar vazio e adicionar manualmente.', '0 = start empty and add manually.', '0 = empezar vacío y agregar manualmente.', '0 = commencer vide et ajouter manuellement.'),
  c('Criar bloco', 'Create block', 'Crear bloque', 'Créer un bloc'),
  c('Renomear bloco', 'Rename block', 'Renombrar bloque', 'Renommer le bloc'),
  c('Renomear', 'Rename', 'Renombrar', 'Renommer'),
  c('Apagar bloco (só se não tiver unidades)', 'Delete block (only if no units)', 'Eliminar bloque (solo sin unidades)', 'Supprimer le bloc (uniquement sans lots)'),
  c('Salvar', 'Save', 'Guardar', 'Enregistrer'),
  c('Apagar', 'Delete', 'Eliminar', 'Supprimer'),
  c('Tem morador vinculado', 'Has linked resident', 'Tiene residente vinculado', 'A un résident lié'),
  c('Remova as unidades antes de apagar o bloco.', 'Remove units before deleting the block.', 'Elimine las unidades antes de borrar el bloque.', 'Retirez les lots avant de supprimer le bloc.'),
  c('A unidade tem morador(es). Remova os vínculos antes de apagar.', 'Unit has resident(s). Remove links before deleting.', 'La unidad tiene residente(s). Elimine los vínculos antes de borrar.', 'Le lot a des résidents. Supprimez les liens avant de supprimer.'),

  // Concierge (porteiro) view
  c('Portaria', 'Front desk', 'Portería', 'Conciergerie'),
  c('Atualizar', 'Refresh', 'Actualizar', 'Actualiser'),
  c('Visitantes hoje', 'Today\'s visitors', 'Visitantes hoy', 'Visiteurs du jour'),
  c('Nenhum visitante esperado hoje.', 'No visitors expected today.', 'Ningún visitante esperado hoy.', 'Aucun visiteur prévu aujourd\'hui.'),
  c('liberado', 'cleared', 'autorizado', 'autorisé'),
  c('aguardando', 'waiting', 'esperando', 'en attente'),
  c('Visita', 'Visit', 'Visita', 'Visite'),
  c('Entrega', 'Delivery', 'Entrega', 'Livraison'),
  c('Serviço', 'Service', 'Servicio', 'Service'),
  c('Liberar', 'Clear', 'Autorizar', 'Autoriser'),
  c('Negar', 'Deny', 'Rechazar', 'Refuser'),
  c('Marcar como chegou', 'Mark as arrived', 'Marcar como llegó', 'Marquer comme arrivé'),
  c('Encomendas pendentes', 'Pending deliveries', 'Paquetes pendientes', 'Livraisons en attente'),
  c('Nenhuma encomenda aguardando retirada.', 'No deliveries waiting for pickup.', 'Ningún paquete esperando retiro.', 'Aucune livraison en attente de récupération.'),
  c('Retirar', 'Pick up', 'Retirar', 'Récupérer'),
  c('Apto', 'Unit', 'Apto', 'Apt.'),
  c('Eventos hoje', 'Today\'s events', 'Eventos de hoy', 'Événements du jour'),
  c('convidados', 'guests', 'invitados', 'invités'),
  c('Lista de convidados', 'Guest list', 'Lista de invitados', 'Liste d\'invités'),

  // Visitors page (resident)
  c('Visitantes', 'Visitors', 'Visitantes', 'Visiteurs'),
  c('Novo visitante', 'New visitor', 'Nuevo visitante', 'Nouveau visiteur'),
  c('Nome do visitante', 'Visitor name', 'Nombre del visitante', 'Nom du visiteur'),
  c('Aplicativo', 'App', 'Aplicación', 'Application'),
  c('Observações (opcional)', 'Notes (optional)', 'Notas (opcional)', 'Notes (facultatif)'),
  c('Disponível só para visitas marcadas para o futuro.', 'Available only for future visits.', 'Disponible solo para visitas futuras.', 'Disponible uniquement pour les visites futures.'),
  c('Enviar solicitação', 'Submit request', 'Enviar solicitud', 'Envoyer la demande'),
  c('Nenhum visitante registrado', 'No visitors registered', 'Ningún visitante registrado', 'Aucun visiteur enregistré'),
  c('Avise antes para a portaria estar preparada — você pode pré-aprovar para evitar ligação na hora.', 'Notify ahead so the front desk is ready — pre-approve to avoid a call at arrival.', 'Avisa antes para que portería esté preparada — puedes preautorizar para evitar una llamada.', 'Prévenez à l\'avance pour que la conciergerie soit prête — pré-approuvez pour éviter un appel.'),
  c('Adicionar visitante', 'Add visitor', 'Agregar visitante', 'Ajouter un visiteur'),
  c('Nada agendado por enquanto. Quando alguém estiver vindo, registre por aqui.', 'Nothing scheduled yet. When someone is coming, register them here.', 'Nada programado aún. Cuando venga alguien, regístralo aquí.', 'Rien de prévu pour l\'instant. Quand quelqu\'un vient, enregistrez-le ici.'),
  c('Sem histórico nos últimos 90 dias.', 'No history in the last 90 days.', 'Sin historial en los últimos 90 días.', 'Aucun historique ces 90 derniers jours.'),

  // Amenities page (resident)
  c('Reserve a piscina, academia, churrasqueira ou salão de festas. Sem conflitos.', 'Book the pool, gym, BBQ grill, or party room. No conflicts.', 'Reserva la piscina, gimnasio, parrilla o salón de fiestas. Sin conflictos.', 'Réservez la piscine, la salle de sport, le barbecue ou la salle des fêtes. Sans conflits.'),
  c('Início', 'Start', 'Inicio', 'Début'),
  c('Fim', 'End', 'Fin', 'Fin'),
  c('Escolha horários de início e fim válidos.', 'Choose valid start and end times.', 'Elige horarios de inicio y fin válidos.', 'Choisissez des horaires de début et de fin valides.'),
  c('O horário final precisa ser depois do início.', 'End time must be after start time.', 'El horario de fin debe ser después del inicio.', 'L\'heure de fin doit être après l\'heure de début.'),
  c('Reservar e avisar portaria', 'Book and notify front desk', 'Reservar y avisar a portería', 'Réserver et notifier la conciergerie'),
  c('Confirmar reserva', 'Confirm booking', 'Confirmar reserva', 'Confirmer la réservation'),
  c('Próximas reservas', 'Upcoming bookings', 'Próximas reservas', 'Réservations à venir'),
  c('Nenhuma reserva futura no prédio.', 'No upcoming bookings in the building.', 'No hay reservas futuras en el edificio.', 'Aucune réservation à venir dans l\'immeuble.'),
  c('Você', 'You', 'Tú', 'Vous'),

  // Shared / common
  c('Carregando…', 'Loading…', 'Cargando…', 'Chargement…'),
  c('Ativar notificações', 'Enable notifications', 'Activar notificaciones', 'Activer les notifications'),
  c('Sair', 'Sign out', 'Salir', 'Déconnexion'),
  c('Unidade', 'Unit', 'Unidad', 'Lot'),
  c('ver recibo', 'view receipt', 'ver recibo', 'voir le reçu'),
  c('Descrição', 'Description', 'Descripción', 'Description'),
  c('Valor (R$)', 'Amount (R$)', 'Valor (R$)', 'Montant (R$)'),
  c('Fornecedor (opcional)', 'Vendor (optional)', 'Proveedor (opcional)', 'Fournisseur (facultatif)'),
  c('Data', 'Date', 'Fecha', 'Date'),
  c('Link do recibo (opcional)', 'Receipt link (optional)', 'Enlace al recibo (opcional)', 'Lien du reçu (facultatif)'),
  c('Cole um link do Drive, Dropbox, ou foto hospedada. Os moradores podem clicar para conferir.', 'Paste a Drive, Dropbox, or hosted photo link. Residents can click to check.', 'Pega un enlace de Drive, Dropbox o foto hospedada. Los residentes pueden hacer clic para verificar.', 'Collez un lien Drive, Dropbox ou photo hébergée. Les résidents peuvent cliquer pour vérifier.'),
  c('Registrar despesa', 'Log expense', 'Registrar gasto', 'Enregistrer la dépense'),
  c('Sugestões dos moradores', 'Resident suggestions', 'Sugerencias de residentes', 'Suggestions des résidents'),
  c('O que os moradores estão pedindo. Agrupe semelhantes, promova a propostas ou descarte.', 'What residents are requesting. Cluster similar ones, promote to proposals, or dismiss.', 'Lo que piden los residentes. Agrupa similares, promueve a propuestas o descarta.', 'Ce que demandent les résidents. Regroupez les similaires, promouvez en propositions ou ignorez.'),
  c('Agrupar com IA', 'Cluster with AI', 'Agrupar con IA', 'Regrouper avec IA'),
  c('Redigir proposta', 'Draft proposal', 'Redactar propuesta', 'Rédiger une proposition'),

  // Board overview cards / labels
  c('Sugestões novas', 'New suggestions', 'Sugerencias nuevas', 'Nouvelles suggestions'),
  c('Propostas ativas', 'Active proposals', 'Propuestas activas', 'Propositions actives'),
  c('Reuniões agendadas', 'Meetings scheduled', 'Reuniones agendadas', 'Réunions prévues'),
  c('1 sugestão de morador esperando', '1 resident suggestion waiting', '1 sugerencia de residente esperando', '1 suggestion de résident en attente'),
  c('sugestões de moradores esperando', 'resident suggestions waiting', 'sugerencias de residentes esperando', 'suggestions de résidents en attente'),
  c('Instalar 4 carregadores de carro elétrico na garagem', 'Install 4 EV chargers in the garage', 'Instalar 4 cargadores eléctricos en el garaje', 'Installer 4 bornes de recharge dans le garage'),
  c('Podemos colocar carregadores de carro elétrico? Pelo menos 2 moradores têm EV.', 'Can we install EV chargers? At least 2 residents have EVs.', '¿Podemos poner cargadores eléctricos? Al menos 2 residentes tienen EV.', 'Peut-on installer des bornes de recharge ? Au moins 2 résidents ont un VE.'),
  c('Caixa de IA', 'AI inbox', 'Bandeja IA', 'Boîte IA'),
  c('Reunião pronta?', 'Meeting ready?', '¿Reunión lista?', 'Réunion prête ?'),
  c('Cole as anotações. Receba o resumo, tarefas e o comunicado pros moradores.', 'Paste your notes. Get the summary, tasks, and announcement for residents.', 'Pega las notas. Recibe el resumen, tareas y aviso para los residentes.', 'Collez vos notes. Recevez le résumé, les tâches et l’annonce pour les résidents.'),
  c('Ver reuniões', 'See meetings', 'Ver reuniones', 'Voir les réunions'),
  c('Abrir caixa', 'Open inbox', 'Abrir bandeja', 'Ouvrir la boîte'),
  c('Agrupe, transforme em proposta ou descarte. Um clique cada.', 'Cluster, turn into a proposal, or dismiss. One click each.', 'Agrupa, conviértelas en propuesta o descarta. Un clic cada una.', 'Regroupez, transformez en proposition ou ignorez. Un clic chacun.'),

  // Board edifício
  c('Bloco criado', 'Block created', 'Bloque creado', 'Bloc créé'),
  c('Bloco renomeado', 'Block renamed', 'Bloque renombrado', 'Bloc renommé'),
  c('Bloco apagado', 'Block deleted', 'Bloque eliminado', 'Bloc supprimé'),
  c('O bloco ainda tem unidades.', 'The block still has units.', 'El bloque todavía tiene unidades.', 'Le bloc contient encore des lots.'),
  c('Falha ao criar bloco', 'Failed to create block', 'Error al crear bloque', 'Échec de la création du bloc'),
  c('Falha ao renomear', 'Rename failed', 'Error al renombrar', 'Échec du renommage'),
  c('Falha ao apagar', 'Delete failed', 'Error al eliminar', 'Échec de la suppression'),
  c('Falha ao salvar', 'Save failed', 'Error al guardar', 'Échec de l’enregistrement'),
  c('Falha ao adicionar', 'Add failed', 'Error al añadir', 'Échec de l’ajout'),
  c('Já existe outra unidade com esse número neste bloco.', 'Another unit with this number already exists in this block.', 'Ya existe otra unidad con ese número en este bloque.', 'Un autre lot avec ce numéro existe déjà dans ce bloc.'),
  c('Unidade apagada', 'Unit deleted', 'Unidad eliminada', 'Lot supprimé'),
  c('ex: Torre B, Cobertura', 'e.g. Tower B, Penthouse', 'ej.: Torre B, Ático', 'ex. Tour B, Penthouse'),
  c('Nº (ex: 1502)', 'No. (e.g. 1502)', 'Nº (ej.: 1502)', 'N° (ex. 1502)'),
  c('Andar', 'Floor', 'Piso', 'Étage'),
  c('Renomear', 'Rename', 'Renombrar', 'Renommer'),
  c('Apagar', 'Delete', 'Eliminar', 'Supprimer'),
  c('Apagar bloco', 'Delete block', 'Eliminar bloque', 'Supprimer le bloc'),
  c('Adicionar unidade', 'Add unit', 'Añadir unidad', 'Ajouter un lot'),
  c('Bloco', 'Block', 'Bloque', 'Bloc'),
  c('Unidade', 'Unit', 'Unidad', 'Lot'),
  c('unidades', 'units', 'unidades', 'lots'),
  c('blocos', 'blocks', 'bloques', 'blocs'),
  c('bloco', 'block', 'bloque', 'bloc'),

  // Board finanças
  c('Administração', 'Admin', 'Administración', 'Administration'),
  c('Manutenção', 'Maintenance', 'Mantenimiento', 'Maintenance'),
  c('Limpeza', 'Cleaning', 'Limpieza', 'Nettoyage'),
  c('Segurança', 'Security', 'Seguridad', 'Sécurité'),
  c('Equipe', 'Staff', 'Personal', 'Personnel'),
  c('Obras / infraestrutura', 'Construction / infrastructure', 'Obras / infraestructura', 'Travaux / infrastructure'),
  c('Áreas comuns / amenidades', 'Amenities', 'Áreas comunes / amenidades', 'Espaces communs / équipements'),
  c('Seguros', 'Insurance', 'Seguros', 'Assurances'),
  c('Impostos / taxas', 'Taxes / fees', 'Impuestos / tasas', 'Impôts / taxes'),
  c('Reserva', 'Reserve', 'Reserva', 'Réserve'),
  c('Outros', 'Other', 'Otros', 'Autres'),
  c('Utilidades', 'Utilities', 'Servicios', 'Services'),
  c('Despesa apagada', 'Expense deleted', 'Gasto eliminado', 'Dépense supprimée'),
  c('Despesa registrada — visível para os moradores', 'Expense logged — visible to residents', 'Gasto registrado — visible para los residentes', 'Dépense enregistrée — visible pour les résidents'),
  c('Falha ao registrar', 'Log failed', 'Error al registrar', 'Échec de l’enregistrement'),
  c('Valor inválido — use números (ex: 1500 ou 1500,00)', 'Invalid amount — use numbers (e.g. 1500 or 1500.00)', 'Valor inválido — usa números (ej.: 1500 o 1500,00)', 'Montant invalide — utilisez des chiffres (ex. 1500 ou 1500,00)'),
  c('Tudo que você lançar aqui aparece automaticamente na Transparência dos moradores.', 'Anything you log here shows up automatically in the residents\' Transparency view.', 'Todo lo que registres aquí aparece automáticamente en la Transparencia para residentes.', 'Tout ce que vous enregistrez ici apparaît automatiquement dans la Transparence des résidents.'),
  c('ex: Substituição do ar do saguão', 'e.g. Lobby AC replacement', 'ej.: Reemplazo del aire del vestíbulo', 'ex. remplacement de la clim du hall'),
  c('ex: 47000 ou 47000,00', 'e.g. 47000 or 47000.00', 'ej.: 47000 o 47000,00', 'ex. 47000 ou 47000,00'),
  c('ex: Cool Breeze HVAC', 'e.g. Cool Breeze HVAC', 'ej.: Cool Breeze HVAC', 'ex. Cool Breeze HVAC'),
  c('Apagar despesa', 'Delete expense', 'Eliminar gasto', 'Supprimer la dépense'),
  c('Proposta:', 'Proposal:', 'Propuesta:', 'Proposition :'),
  c('Nenhuma despesa registrada nos últimos 12 meses. Comece pelas contas fixas (luz, água, condomínio da empresa de portaria).', 'No expenses logged in the last 12 months. Start with the fixed bills (electricity, water, front-desk staffing).', 'Sin gastos registrados en los últimos 12 meses. Empieza por las cuentas fijas (luz, agua, portería).', 'Aucune dépense enregistrée sur les 12 derniers mois. Commencez par les factures fixes (électricité, eau, conciergerie).'),

  // Board announcements
  c('Tudo que você enviou aos moradores — incluindo os gerados pela IA após reuniões e decisões.', 'Everything you sent to residents — including AI-generated ones after meetings and decisions.', 'Todo lo que enviaste a los residentes — incluyendo los generados por IA tras reuniones y decisiones.', 'Tout ce que vous avez envoyé aux résidents — y compris ceux générés par l’IA après réunions et décisions.'),
  c('Novo comunicado', 'New announcement', 'Nuevo aviso', 'Nouvelle annonce'),
  c('Comunicado publicado', 'Announcement published', 'Aviso publicado', 'Annonce publiée'),
  c('Título', 'Title', 'Título', 'Titre'),
  c('Escreva o comunicado...', 'Write the announcement...', 'Escribe el aviso…', 'Rédigez l’annonce…'),
  c('Fixar no topo', 'Pin to top', 'Fijar arriba', 'Épingler en haut'),
  c('Publicar', 'Publish', 'Publicar', 'Publier'),
  c('Fixado', 'Pinned', 'Fijado', 'Épinglé'),
  c('Pinned', 'Pinned', 'Fijado', 'Épinglé'),
  c('AI meeting recap', 'AI meeting recap', 'Resumen IA de reunión', 'Récap IA de réunion'),
  c('AI decision', 'AI decision', 'Decisión IA', 'Décision IA'),
  c('Avisos do síndico. Itens fixados ficam no topo.', 'Notices from the board. Pinned items stay on top.', 'Avisos del administrador. Los fijados quedan arriba.', 'Annonces du syndic. Les épinglés restent en haut.'),

  // Board proposals & detail
  c('Proposta criada — em discussão', 'Proposal created — in discussion', 'Propuesta creada — en discusión', 'Proposition créée — en discussion'),
  c('Falha ao criar proposta', 'Failed to create proposal', 'Error al crear propuesta', 'Échec de la création de la proposition'),
  c('Título (ex: Trocar o portão da garagem)', 'Title (e.g. Replace the garage gate)', 'Título (ej.: Cambiar el portón del garaje)', 'Titre (ex. remplacer le portail du garage)'),
  c('ex: 47000', 'e.g. 47000', 'ej.: 47000', 'ex. 47000'),
  c('Análise pré-votação', 'Pre-vote analysis', 'Análisis previo a la votación', 'Analyse avant vote'),
  c('Análise gerada', 'Analysis generated', 'Análisis generado', 'Analyse générée'),
  c('Análise técnica', 'Technical analysis', 'Análisis técnico', 'Analyse technique'),
  c('Falha ao analisar com IA', 'AI analysis failed', 'Error al analizar con IA', 'Échec de l’analyse IA'),
  c('Discussão resumida', 'Discussion summarized', 'Discusión resumida', 'Discussion résumée'),
  c('Resumo gerado', 'Summary generated', 'Resumen generado', 'Résumé généré'),
  c('Explicação gerada', 'Explanation generated', 'Explicación generada', 'Explication générée'),
  c('Decisão e comunicado publicados', 'Decision and announcement published', 'Decisión y aviso publicados', 'Décision et annonce publiées'),
  c('Encerrar e gerar decisão', 'Close and publish decision', 'Cerrar y generar decisión', 'Clore et publier la décision'),
  c('Votar como proprietário', 'Vote as owner', 'Votar como propietario', 'Voter en tant que propriétaire'),
  c('Resumir discussão', 'Summarize discussion', 'Resumir discusión', 'Résumer la discussion'),
  c('Em linguagem simples', 'In plain language', 'En lenguaje simple', 'En langage clair'),
  c('Explicar pra mim', 'Explain to me', 'Explícame', 'M’expliquer'),
  c('Versão sem juridiquês, sem termo técnico.', 'A plain-language version — no legalese, no jargon.', 'Versión sin lenguaje legal, sin tecnicismos.', 'Version sans jargon juridique ni technique.'),
  c('Comentar', 'Comment', 'Comentar', 'Commenter'),
  c('Diga o que você acha...', 'Share your thoughts…', 'Comparte tu opinión…', 'Donnez votre avis…'),
  c('Comentário publicado', 'Comment published', 'Comentario publicado', 'Commentaire publié'),
  c('Voto registrado', 'Vote recorded', 'Voto registrado', 'Vote enregistré'),
  c('Voto falhou', 'Vote failed', 'Voto fallido', 'Échec du vote'),
  c('Aberta para votação', 'Open for voting', 'Abierta a votación', 'Ouverte au vote'),
  c('Você não pode votar nesta proposta.', 'You cannot vote on this proposal.', 'No puedes votar esta propuesta.', 'Vous ne pouvez pas voter cette proposition.'),
  c('Só proprietários votam em decisões de gastos do condomínio.', 'Only owners vote on condo spending decisions.', 'Solo los propietarios votan decisiones de gasto del condominio.', 'Seuls les propriétaires votent les décisions de dépense.'),
  c('Só o contato principal de cada unidade vota aqui.', 'Only each unit\'s primary contact votes here.', 'Solo el contacto principal de cada unidad vota aquí.', 'Seul le contact principal de chaque lot vote ici.'),
  c('Vincule sua unidade primeiro para participar.', 'Link your unit first to take part.', 'Vincula tu unidad primero para participar.', 'Reliez d’abord votre lot pour participer.'),
  c('Seu voto:', 'Your vote:', 'Tu voto:', 'Votre vote :'),
  c('Votação encerrada como inconclusiva.', 'Voting closed as inconclusive.', 'Votación cerrada como no concluyente.', 'Vote clos comme non concluant.'),
  c('Não houve votos suficientes para qualquer lado. Decisão adiada.', 'Not enough votes either way. Decision postponed.', 'No hubo votos suficientes para ningún lado. Decisión aplazada.', 'Pas assez de votes d’un côté ou de l’autre. Décision reportée.'),
  c('Adicione um custo estimado antes de abrir a votação. Use "Analisar com IA" se preferir.', 'Add an estimated cost before opening voting. Use "Analyze with AI" if you prefer.', 'Agrega un costo estimado antes de abrir la votación. Usa "Analizar con IA" si prefieres.', 'Ajoutez un coût estimé avant d’ouvrir le vote. Utilisez « Analyser avec IA » si vous préférez.'),
  c('Reprovar', 'Reject', 'Rechazar', 'Rejeter'),
  c('Aprovar', 'Approve', 'Aprobar', 'Approuver'),
  c('exigido', 'required', 'requerido', 'requis'),
  c('sim', 'yes', 'sí', 'oui'),
  c('não', 'no', 'no', 'non'),
  c('abstenção', 'abstention', 'abstención', 'abstention'),
  c('Manutenção', 'Maintenance', 'Mantenimiento', 'Maintenance'),

  // Board meetings
  c('Agende as reuniões. Cole as anotações depois — a IA gera o resumo e a lista de tarefas.', 'Schedule meetings. Paste notes afterwards — AI generates the summary and task list.', 'Agenda las reuniones. Pega las notas después — la IA genera el resumen y las tareas.', 'Planifiez les réunions. Collez les notes ensuite — l’IA génère le résumé et la liste des tâches.'),
  c('Nova reunião', 'New meeting', 'Nueva reunión', 'Nouvelle réunion'),
  c('Reunião agendada', 'Meeting scheduled', 'Reunión agendada', 'Réunion planifiée'),
  c('Pauta (opcional)', 'Agenda (optional)', 'Agenda (opcional)', 'Ordre du jour (facultatif)'),
  c('Agendar', 'Schedule', 'Agendar', 'Planifier'),
  c('agendada', 'scheduled', 'agendada', 'planifiée'),
  c('resumo da IA', 'AI summary', 'resumen IA', 'résumé IA'),
  c('notas pendentes', 'notes pending', 'notas pendientes', 'notes en attente'),
  c('Anotações', 'Notes', 'Notas', 'Notes'),
  c('Anotações salvas', 'Notes saved', 'Notas guardadas', 'Notes enregistrées'),
  c('Cole as anotações da reunião aqui. Tópicos, abreviações, do jeito que veio — a IA arruma.', 'Paste the meeting notes here. Bullets, abbreviations — AI cleans it up.', 'Pega aquí las notas de la reunión. Listas, abreviaciones, como vinieron — la IA las arregla.', 'Collez ici les notes de réunion. Puces, abréviations — l’IA met en forme.'),
  c('Resumir com IA', 'Summarize with AI', 'Resumir con IA', 'Résumer avec IA'),
  c('Reunião resumida', 'Meeting summarized', 'Reunión resumida', 'Réunion résumée'),
  c('Resumo da IA', 'AI summary', 'Resumen de la IA', 'Résumé de l’IA'),
  c('Pronto', 'Ready', 'Listo', 'Prêt'),
  c('Decisões', 'Decisions', 'Decisiones', 'Décisions'),
  c('Rascunho do comunicado', 'Announcement draft', 'Borrador del aviso', 'Brouillon de l’annonce'),
  c('Comunicado publicado para os moradores', 'Announcement published to residents', 'Aviso publicado a los residentes', 'Annonce publiée aux résidents'),
  c('Salve as anotações e clique em Resumir. Você recebe um resumo limpo, lista de decisões, tarefas, e um comunicado pronto para publicar.', 'Save the notes and click Summarize. You\'ll get a clean summary, decisions, tasks, and an announcement ready to publish.', 'Guarda las notas y haz clic en Resumir. Recibirás un resumen claro, decisiones, tareas y un aviso listo para publicar.', 'Enregistrez les notes et cliquez sur Résumer. Vous obtiendrez un résumé clair, des décisions, des tâches et une annonce prête à publier.'),
  c('Tarefas', 'Tasks', 'Tareas', 'Tâches'),
  c('Reuniões do síndico, pautas e resumos gerados pela IA.', 'Board meetings, agendas, and AI-generated recaps.', 'Reuniones del administrador, agendas y resúmenes generados por IA.', 'Réunions du syndic, ordres du jour et résumés générés par IA.'),

  // Resident overview
  c('Bom dia', 'Good morning', 'Buenos días', 'Bonjour'),
  c('Boa tarde', 'Good afternoon', 'Buenas tardes', 'Bon après-midi'),
  c('Boa noite', 'Good evening', 'Buenas noches', 'Bonsoir'),
  c('Aqui está o que está rolando no seu prédio hoje.', 'Here\'s what\'s happening in your building today.', 'Esto es lo que está pasando hoy en tu edificio.', 'Voici ce qui se passe dans votre immeuble aujourd’hui.'),
  c("Here's what's happening in your building today.", "Here's what's happening in your building today.", 'Esto es lo que está pasando hoy en tu edificio.', 'Voici ce qui se passe dans votre immeuble aujourd’hui.'),
  c('Encomendas aguardando', 'Packages waiting', 'Paquetes esperando', 'Colis en attente'),
  c('Próximas visitas', 'Upcoming visitors', 'Próximas visitas', 'Visites à venir'),
  c('Suas reservas', 'Your reservations', 'Tus reservas', 'Vos réservations'),
  c('Propostas abertas', 'Open proposals', 'Propuestas abiertas', 'Propositions ouvertes'),
  c('Últimos comunicados', 'Latest announcements', 'Últimos avisos', 'Dernières annonces'),
  c('Em votação', 'In the vote', 'En votación', 'En vote'),
  c('Ver tudo', 'View all', 'Ver todo', 'Voir tout'),
  c('Alguns dados do painel não puderam ser carregados. Atualize ou entre novamente se persistir.', 'Some dashboard data could not be loaded. Refresh or sign in again if it persists.', 'Algunos datos del panel no pudieron cargarse. Actualiza o vuelve a entrar si persiste.', 'Certaines données n’ont pas pu être chargées. Rafraîchissez ou reconnectez-vous si cela persiste.'),

  // Resident amenities
  c('Reserva confirmada', 'Reservation confirmed', 'Reserva confirmada', 'Réservation confirmée'),
  c('Aberto', 'Open', 'Abierto', 'Ouvert'),
  c('convidados', 'guests', 'invitados', 'invités'),

  // Tickets / incident loop
  c('Problemas', 'Issues', 'Problemas', 'Problèmes'),
  c('Chamados', 'Tickets', 'Tickets', 'Tickets'),
  c('Problemas no prédio', 'Building issues', 'Problemas del edificio', 'Problèmes dans l’immeuble'),
  c('Reporte uma falha, ajude a verificar relatos de vizinhos ou acompanhe o seu chamado.', 'Report a problem, help verify neighbors’ reports, or follow your ticket.', 'Reporta una falla, ayuda a verificar reportes de vecinos o sigue tu ticket.', 'Signalez un problème, vérifiez les signalements des voisins ou suivez votre ticket.'),
  c('Reportar problema', 'Report issue', 'Reportar problema', 'Signaler un problème'),
  c('Aguardando verificação', 'Awaiting verification', 'Esperando verificación', 'En attente de vérification'),
  c('Meus chamados privados', 'My private tickets', 'Mis tickets privados', 'Mes tickets privés'),
  c('Nenhum problema reportado', 'No issues reported', 'No hay problemas reportados', 'Aucun problème signalé'),
  c('Se algo no prédio quebrar, reporte aqui. Os vizinhos confirmam e o síndico aciona a manutenção certa.', 'If something breaks in the building, report it here. Neighbors confirm it and the board calls the right maintenance team.', 'Si algo se rompe en el edificio, repórtalo aquí. Los vecinos lo confirman y el administrador activa el mantenimiento correcto.', 'Si quelque chose tombe en panne dans l’immeuble, signalez-le ici. Les voisins confirment et le syndic lance la bonne maintenance.'),
  c('Novo problema', 'New issue', 'Nuevo problema', 'Nouveau problème'),
  c('Descreva o que quebrou ou está com defeito. Os vizinhos podem confirmar e o síndico acompanha pela operação.', 'Describe what broke or is not working. Neighbors can confirm it and the board follows it through operations.', 'Describe qué se rompió o no funciona. Los vecinos pueden confirmarlo y el administrador lo sigue desde operaciones.', 'Décrivez ce qui est cassé ou défectueux. Les voisins peuvent confirmer et le syndic suit l’opération.'),
  c('Título (ex: Elevador A parado no 12)', 'Title (e.g. Elevator A stopped on 12)', 'Título (ej.: Ascensor A detenido en el 12)', 'Titre (ex. ascenseur A bloqué au 12)'),
  c('O que aconteceu, onde, quando você notou.', 'What happened, where, and when you noticed it.', 'Qué pasó, dónde y cuándo lo notaste.', 'Ce qui s’est passé, où et quand vous l’avez remarqué.'),
  c('Categoria', 'Category', 'Categoría', 'Catégorie'),
  c('Prioridade', 'Priority', 'Prioridad', 'Priorité'),
  c('baixa', 'low', 'baja', 'basse'),
  c('normal', 'normal', 'normal', 'normal'),
  c('alta', 'high', 'alta', 'haute'),
  c('urgente', 'urgent', 'urgente', 'urgent'),
  c('Baixa', 'Low', 'Baja', 'Basse'),
  c('Normal', 'Normal', 'Normal', 'Normal'),
  c('Alta', 'High', 'Alta', 'Haute'),
  c('Urgente', 'Urgent', 'Urgente', 'Urgent'),
  c('low', 'low', 'baja', 'basse'),
  c('high', 'high', 'alta', 'haute'),
  c('urgent', 'urgent', 'urgente', 'urgent'),
  c('Elevador', 'Elevator', 'Ascensor', 'Ascenseur'),
  c('Elétrica', 'Electrical', 'Eléctrica', 'Électricité'),
  c('Hidráulica', 'Plumbing', 'Plomería', 'Plomberie'),
  c('Ar / climatização', 'AC / climate', 'Aire / climatización', 'Climatisation'),
  c('Manutenção geral', 'General maintenance', 'Mantenimiento general', 'Maintenance générale'),
  c('Visível para os vizinhos (eles confirmam o problema).', 'Visible to neighbors (they confirm the issue).', 'Visible para los vecinos (ellos confirman el problema).', 'Visible pour les voisins (ils confirment le problème).'),
  c('Desmarque para um chamado privado direto ao síndico.', 'Uncheck for a private ticket straight to the board.', 'Desmarca para un ticket privado directo al administrador.', 'Décochez pour un ticket privé envoyé directement au syndic.'),
  c('Reportado por', 'Reported by', 'Reportado por', 'Signalé par'),
  c('confirmações', 'confirmations', 'confirmaciones', 'confirmations'),
  c('negaram', 'denied', 'negaron', 'ont refusé'),
  c('meta:', 'target:', 'meta:', 'objectif :'),
  c('verificado', 'verified', 'verificado', 'vérifié'),
  c('IA acionada', 'AI engaged', 'IA activada', 'IA lancée'),
  c('aguardando fornecedor', 'awaiting vendor', 'esperando proveedor', 'en attente de prestataire'),
  c('fornecedor respondeu', 'vendor responded', 'proveedor respondió', 'prestataire répondu'),
  c('síndico vai resolver', 'board will handle it', 'el administrador lo resolverá', 'le syndic va s’en charger'),
  c('resolvido', 'resolved', 'resuelto', 'résolu'),
  c('Confirmo', 'Confirm', 'Confirmo', 'Je confirme'),
  c('Não confirmo', 'I do not confirm', 'No confirmo', 'Je ne confirme pas'),
  c('Você reportou este problema; aguardando vizinhos verificarem.', 'You reported this issue; waiting for neighbors to verify.', 'Reportaste este problema; esperando que los vecinos lo verifiquen.', 'Vous avez signalé ce problème ; en attente de vérification par les voisins.'),
  c('Votos', 'Votes', 'Votos', 'Votes'),
  c('Problema reportado', 'Issue reported', 'Problema reportado', 'Problème signalé'),
  c('Falha ao reportar', 'Failed to report', 'Error al reportar', 'Échec du signalement'),
  c('Problemas reportados pelos moradores, verificações da comunidade, e plano de manutenção sugerido pela IA.', 'Resident-reported issues, community verification, and AI-suggested maintenance plan.', 'Problemas reportados por residentes, verificación comunitaria y plan de mantenimiento sugerido por IA.', 'Problèmes signalés par les résidents, vérification communautaire et plan de maintenance suggéré par l’IA.'),
  c('Verificados — pronto para acionar a IA', 'Verified — ready to trigger AI', 'Verificados — listo para activar IA', 'Vérifiés — prêts à lancer l’IA'),
  c('Outros chamados', 'Other tickets', 'Otros tickets', 'Autres tickets'),
  c('Nenhum chamado aberto', 'No open tickets', 'No hay tickets abiertos', 'Aucun ticket ouvert'),
  c('Quando um morador reportar um problema, ele aparece aqui com a verificação dos vizinhos e um plano da IA.', 'When a resident reports an issue, it appears here with neighbor verification and an AI plan.', 'Cuando un residente reporta un problema, aparece aquí con verificación de vecinos y un plan de IA.', 'Quand un résident signale un problème, il apparaît ici avec la vérification des voisins et un plan IA.'),
  c('Novo problema recebido', 'New issue received', 'Nuevo problema recibido', 'Nouveau problème reçu'),
  c('comunidade', 'community', 'comunidad', 'communauté'),
  c('plano da IA', 'AI plan', 'plan de IA', 'plan IA'),
  c('precisa do síndico', 'needs board admin', 'necesita administrador', 'nécessite le syndic'),
  c('de', 'of', 'de', 'sur'),
  c('Atenção do síndico', 'Board attention', 'Atención del administrador', 'Attention du syndic'),
  c('Verificar como síndico', 'Verify as board admin', 'Verificar como administrador', 'Vérifier comme syndic'),
  c('Refazer plano IA', 'Redo AI plan', 'Rehacer plan IA', 'Refaire le plan IA'),
  c('Gerar plano IA', 'Generate AI plan', 'Generar plan IA', 'Générer le plan IA'),
  c('Acionar fornecedor', 'Contact vendor', 'Contactar proveedor', 'Contacter le prestataire'),
  c('Acionar (auto)', 'Contact automatically', 'Contactar automáticamente', 'Contacter automatiquement'),
  c('Escolher fornecedor', 'Choose vendor', 'Elegir proveedor', 'Choisir le prestataire'),
  c('Marcar resolvido', 'Mark resolved', 'Marcar resuelto', 'Marquer résolu'),
  c('Marcar como resolvido', 'Mark as resolved', 'Marcar como resuelto', 'Marquer comme résolu'),
  c('Plano sugerido', 'Suggested plan', 'Plan sugerido', 'Plan suggéré'),
  c('Próximo passo:', 'Next step:', 'Próximo paso:', 'Prochaine étape :'),
  c('Da rede já cadastrada', 'From the saved network', 'De la red ya registrada', 'Depuis le réseau enregistré'),
  c('Opções avaliadas', 'Options evaluated', 'Opciones evaluadas', 'Options évaluées'),
  c('Mensagem de contato', 'Contact message', 'Mensaje de contacto', 'Message de contact'),
  c('Histórico de acionamentos', 'Dispatch history', 'Historial de activaciones', 'Historique des actions'),
  c('entrega:', 'delivery:', 'entrega:', 'livraison :'),
  c('Resposta:', 'Response:', 'Respuesta:', 'Réponse :'),
  c('Registrar resposta', 'Record response', 'Registrar respuesta', 'Enregistrer la réponse'),
  c('O que o fornecedor respondeu?', 'What did the vendor answer?', '¿Qué respondió el proveedor?', 'Qu’a répondu le prestataire ?'),
  c('Fornecedor', 'Vendor', 'Proveedor', 'Prestataire'),
  c('Nenhum cadastrado', 'None registered', 'Ninguno registrado', 'Aucun enregistré'),
  c('Canal', 'Channel', 'Canal', 'Canal'),
  c('Manual (telefone)', 'Manual (phone)', 'Manual (teléfono)', 'Manuel (téléphone)'),
  c('Mensagem', 'Message', 'Mensaje', 'Message'),
  c('Enviar', 'Send', 'Enviar', 'Envoyer'),
  c('O que foi feito?', 'What was done?', '¿Qué se hizo?', 'Qu’est-ce qui a été fait ?'),
  c('Ex: Técnico da Otis trocou a roldana do cabo principal. Funcionando normalmente.', 'Example: Otis technician replaced the main cable pulley. Working normally.', 'Ej.: El técnico de Otis cambió la polea del cable principal. Funciona normalmente.', 'Ex. le technicien Otis a remplacé la poulie du câble principal. Fonctionne normalement.'),
  c('Publicar comunicado para todos os moradores.', 'Publish an announcement to all residents.', 'Publicar un aviso para todos los residentes.', 'Publier une annonce à tous les résidents.'),
  c('Posta em /app/comunicados e dispara WhatsApp para quem aceitou notificações.', 'Posts in /app/announcements and sends WhatsApp to residents who accepted notifications.', 'Publica en /app/announcements y envía WhatsApp a quienes aceptaron notificaciones.', 'Publie dans /app/announcements et envoie WhatsApp aux résidents qui ont accepté les notifications.'),
  c('Resolver', 'Resolve', 'Resolver', 'Résoudre'),

  // Resident visitors
  c('Visita pré-aprovada — a portaria já tem a liberação', 'Visitor pre-approved — the front desk has the green light', 'Visita pre-aprobada — la portería ya tiene la autorización', 'Visiteur pré-approuvé — la conciergerie a l’autorisation'),
  c('Solicitação enviada à portaria', 'Request sent to the front desk', 'Solicitud enviada a la portería', 'Demande envoyée à la conciergerie'),
  c('Próximas', 'Upcoming', 'Próximas', 'À venir'),
  c('Histórico', 'History', 'Historial', 'Historique'),
  c('Pré-aprovar', 'Pre-approve', 'Pre-aprobar', 'Pré-approuver'),

  // Resident proposals overview
  c('Todas as decisões do seu prédio — passadas, atuais e em andamento.', 'Every decision in your building — past, present, and ongoing.', 'Todas las decisiones de tu edificio — pasadas, actuales y en curso.', 'Toutes les décisions de votre immeuble — passées, actuelles et en cours.'),

  // Resident transparência
  c('Quando o síndico começar a lançar as despesas do prédio, elas aparecem aqui automaticamente — com valor, fornecedor e link do recibo.', 'When the board starts logging building expenses, they\'ll show up here automatically — with amount, vendor, and receipt link.', 'Cuando el administrador empiece a registrar los gastos del edificio, aparecerán aquí automáticamente — con valor, proveedor y enlace al recibo.', 'Quand le syndic commencera à enregistrer les dépenses, elles apparaîtront ici automatiquement — avec montant, fournisseur et lien du reçu.'),
  c('Período: últimos 12 meses. Lançado pelo síndico — clique em cada item para ver o recibo, quando disponível.', 'Period: last 12 months. Logged by the board — click any item for the receipt when available.', 'Período: últimos 12 meses. Registrado por el administrador — haz clic en cada ítem para ver el recibo si está disponible.', 'Période : 12 derniers mois. Enregistré par le syndic — cliquez sur chaque ligne pour le reçu si disponible.'),

  // Resident suggest
  c('Conta o que tá pegando. A IA transforma sua ideia numa proposta pronta pro síndico.', 'Tell us what\'s up. AI turns your idea into a proposal ready for the board.', 'Cuéntanos qué pasa. La IA convierte tu idea en una propuesta lista para el administrador.', 'Dites-nous ce qui ne va pas. L’IA transforme votre idée en proposition prête pour le syndic.'),
  c('O ar do saguão mal está funcionando. Ontem marcou 30°C aqui dentro.', 'The lobby AC barely works. It hit 30°C in here yesterday.', 'El aire del vestíbulo casi no funciona. Ayer marcó 30°C aquí dentro.', 'La clim du hall fonctionne à peine. Il faisait 30°C ici hier.'),
  c('Podemos colocar carregadores de carro elétrico na garagem?', 'Can we install EV chargers in the garage?', '¿Podemos poner cargadores para autos eléctricos en el garaje?', 'Peut-on installer des bornes de recharge dans le garage ?'),
  c('A esteira #3 da academia faz um barulho alto quando alguém usa.', 'Treadmill #3 in the gym is making a loud noise when used.', 'La cinta #3 del gimnasio hace mucho ruido cuando alguien la usa.', 'Le tapis #3 de la salle de sport fait beaucoup de bruit quand on l’utilise.'),
  c('Enviado ao síndico', 'Sent to the board', 'Enviado al administrador', 'Envoyé au syndic'),
  c('ex: O ar do saguão tá quebrado, marca 30°C aqui dentro...', 'e.g. The lobby AC is broken, it hits 30°C in here...', 'ej.: El aire del vestíbulo está roto, marca 30°C aquí dentro…', 'ex. la clim du hall est cassée, il fait 30°C ici…'),
  c('Recomeçar', 'Start over', 'Empezar de nuevo', 'Recommencer'),

  // Resident packages
  c('Encomenda retirada', 'Package picked up', 'Paquete retirado', 'Colis récupéré'),
  c('Retirei', 'Picked up', 'Retiré', 'Récupéré'),

  // Resident announcements
  c('Avisos do síndico', 'Notices from the board', 'Avisos del administrador', 'Annonces du syndic'),
  c('Itens fixados ficam no topo.', 'Pinned items stay on top.', 'Los fijados quedan arriba.', 'Les épinglés restent en haut.'),

  // Concierge
  c('Portaria', 'Front desk', 'Portería', 'Conciergerie'),
  c('Atualizar', 'Refresh', 'Actualizar', 'Actualiser'),
  c('Ativar notificações', 'Enable notifications', 'Activar notificaciones', 'Activer les notifications'),
  c('Notificações ativadas', 'Notifications enabled', 'Notificaciones activadas', 'Notifications activées'),
  c('Notificações bloqueadas', 'Notifications blocked', 'Notificaciones bloqueadas', 'Notifications bloquées'),
  c('Notificações bloqueadas — habilite nas configurações do navegador', 'Notifications blocked — enable them in your browser settings', 'Notificaciones bloqueadas — actívalas en la configuración del navegador', 'Notifications bloquées — activez-les dans les paramètres du navigateur'),
  c('Lista de convidados', 'Guest list', 'Lista de invitados', 'Liste d’invités'),
  c('Atualiza automaticamente', 'Auto-refresh', 'Actualiza automáticamente', 'Actualisation automatique'),
  c('Liberar', 'Let in', 'Dejar entrar', 'Laisser entrer'),
  c('Negar', 'Deny', 'Denegar', 'Refuser'),
  c('s/n', 'n/a', 's/n', 's/n'),

  // Sidebar / layouts
  c('Visão geral', 'Overview', 'Resumen', 'Vue d’ensemble'),
  c('Edifício', 'Building', 'Edificio', 'Immeuble'),
  c('Finanças', 'Finance', 'Finanzas', 'Finances'),
  c('Transparência', 'Transparency', 'Transparencia', 'Transparence'),
  c('Despesas', 'Expenses', 'Gastos', 'Dépenses'),
  c('Sugerir', 'Suggest', 'Sugerir', 'Suggérer'),

  // Seed/demo content — translate so the demo looks consistent across locales.
  // Announcements
  c('Piscina reabre na sexta', 'Pool reopens Friday', 'La piscina reabre el viernes', 'La piscine rouvre vendredi'),
  c('A piscina volta a funcionar nesta sexta após a manutenção trimestral. Obrigado pela paciência.', 'The pool reopens this Friday after quarterly maintenance. Thanks for your patience.', 'La piscina vuelve a funcionar este viernes tras el mantenimiento trimestral. Gracias por la paciencia.', 'La piscine rouvre ce vendredi après la maintenance trimestrielle. Merci de votre patience.'),
  c('Simulado de incêndio quinta 10h', 'Fire drill Thursday 10 a.m.', 'Simulacro de incendio jueves 10 h', 'Exercice incendie jeudi 10 h'),
  c('Simulado de incêndio em todo o prédio nesta quinta às 10h. Alarmes vão tocar por uns 10 minutos.', 'Building-wide fire drill this Thursday at 10 a.m. Alarms will sound for about 10 minutes.', 'Simulacro de incendio en todo el edificio este jueves a las 10 h. Las alarmas sonarán unos 10 minutos.', 'Exercice incendie dans tout l’immeuble jeudi à 10 h. Les alarmes sonneront environ 10 minutes.'),
  c('Nova orientação de reciclagem', 'New recycling guidance', 'Nueva orientación de reciclaje', 'Nouvelle consigne de recyclage'),
  c('Desmonte as caixas de papelão antes de colocar no contêiner. Coleta segundas e quintas.', 'Break down cardboard boxes before placing them in the bin. Collection on Mondays and Thursdays.', 'Desmonta las cajas de cartón antes de ponerlas en el contenedor. Recogida lunes y jueves.', 'Démontez les cartons avant de les déposer dans le conteneur. Collecte les lundis et jeudis.'),
  c('Redigido pela IA', 'AI-drafted', 'Redactado por IA', 'Rédigé par IA'),

  // Suggestions
  c('O ar do saguão mal está funcionando. Ontem à tarde marcou 30°C aqui dentro.', 'The lobby AC barely works. Yesterday afternoon it hit 30°C in here.', 'El aire del vestíbulo casi no funciona. Ayer por la tarde llegó a 30°C aquí dentro.', 'La clim du hall fonctionne à peine. Hier après-midi il faisait 30°C ici.'),
  c('O saguão está muito quente ultimamente. O ar quebrou?', 'The lobby is very hot lately. Did the AC break?', 'El vestíbulo está muy caliente últimamente. ¿Se rompió el aire?', 'Le hall est très chaud ces derniers temps. La clim est en panne ?'),

  // Proposals
  c('Trocar o ar-condicionado do saguão', 'Replace the lobby air conditioner', 'Cambiar el aire acondicionado del vestíbulo', 'Remplacer la climatisation du hall'),
  c('O ar do saguão falhou duas vezes neste verão. Orçamento da Cool Breeze HVAC para um novo equipamento de 5 TR: R$ 47.000 incluindo instalação e 5 anos de garantia.', 'The lobby AC failed twice this summer. Cool Breeze HVAC quote for new 5-ton equipment: R$ 47,000 including installation and 5-year warranty.', 'El aire del vestíbulo falló dos veces este verano. Presupuesto de Cool Breeze HVAC para un nuevo equipo de 5 TR: R$ 47.000 incluyendo instalación y 5 años de garantía.', 'La clim du hall est tombée en panne deux fois cet été. Devis Cool Breeze HVAC pour nouvel équipement 5 TR : 47 000 R$ incluant installation et garantie 5 ans.'),
  c('Carregadores de carro elétrico nas vagas de visitante', 'EV chargers in visitor spots', 'Cargadores eléctricos en plazas de visita', 'Bornes de recharge sur les places visiteurs'),
  c('Carregadores nível 2 nas 4 vagas de visitante perto do elevador. Estimativa de instalação + equipamento R$ 90.000. Energia consumida cobrada por usuário via cartão RFID.', 'Level 2 chargers in the 4 visitor spots near the elevator. Installation + equipment estimate: R$ 90,000. Power consumed billed per user via RFID card.', 'Cargadores nivel 2 en las 4 plazas de visita cerca del ascensor. Estimación instalación + equipo R$ 90.000. Energía consumida cobrada por usuario vía tarjeta RFID.', 'Bornes niveau 2 sur les 4 places visiteurs près de l’ascenseur. Estimation installation + équipement 90 000 R$. Énergie consommée facturée par utilisateur via carte RFID.'),
  c('Quem paga a eletricidade? Não quero ver minha taxa subsidiando o combustível de outros moradores.', 'Who pays the electricity? I don\'t want my fee subsidizing other residents\' fuel.', '¿Quién paga la electricidad? No quiero que mi cuota subsidie el combustible de otros residentes.', 'Qui paie l’électricité ? Je ne veux pas que ma charge subventionne le carburant des autres résidents.'),
  c('A medição por usuário resolve. Pede a planilha de consumo da empresa que vai instalar.', 'Per-user metering solves it. Ask the installer for the consumption sheet.', 'La medición por usuario lo resuelve. Pide a la empresa instaladora la hoja de consumo.', 'Le comptage par utilisateur règle ça. Demandez à l’installateur la fiche de consommation.'),

  // Meetings
  c('Reunião do síndico — 2º trimestre', 'Board meeting — Q2', 'Reunión del administrador — 2º trimestre', 'Réunion du syndic — T2'),
  c('Revisar propostas em pauta (carregadores EV, ar do saguão), orçamento trimestral, reclamações recentes.', 'Review proposals on the agenda (EV chargers, lobby AC), quarterly budget, recent complaints.', 'Revisar propuestas en agenda (cargadores EV, aire del vestíbulo), presupuesto trimestral, quejas recientes.', 'Examiner les propositions à l’ordre du jour (bornes EV, clim du hall), budget trimestriel, plaintes récentes.'),

  // Expenses
  c('Substituição do ar-condicionado do saguão', 'Lobby AC replacement', 'Reemplazo del aire del vestíbulo', 'Remplacement de la clim du hall'),
  c('Manutenção da esteira #3 da academia', 'Treadmill #3 maintenance (gym)', 'Mantenimiento cinta #3 (gimnasio)', 'Maintenance tapis #3 (salle de sport)'),
  c('Renovação anual do seguro do prédio', 'Annual building insurance renewal', 'Renovación anual del seguro del edificio', 'Renouvellement annuel de l’assurance immeuble'),
  c('Manutenção da piscina (junho)', 'Pool maintenance (June)', 'Mantenimiento de la piscina (junio)', 'Entretien de la piscine (juin)'),
  c('Limpeza profunda do saguão', 'Deep clean of the lobby', 'Limpieza profunda del vestíbulo', 'Nettoyage approfondi du hall'),
  c('Conserto da bomba de água', 'Water pump repair', 'Reparación de la bomba de agua', 'Réparation de la pompe à eau'),
  c('Materiais de limpeza (trimestre)', 'Cleaning supplies (quarter)', 'Productos de limpieza (trimestre)', 'Produits d’entretien (trimestre)'),
  c('Conta de luz das áreas comuns', 'Common-area electricity bill', 'Factura de luz de áreas comunes', 'Facture d’électricité parties communes'),
  c('Conta de água do prédio', 'Building water bill', 'Factura de agua del edificio', 'Facture d’eau de l’immeuble'),
  c('Internet do saguão', 'Lobby internet', 'Internet del vestíbulo', 'Internet du hall'),

  // Resident-page hero copy
  c('Seu prédio, num panorama.', 'Your building at a glance.', 'Tu edificio de un vistazo.', 'Votre immeuble en un coup d’œil.'),
  c('Um toque para retirar uma encomenda, aprovar uma visita, reservar a piscina ou opinar numa proposta.', 'One tap to pick up a package, approve a visit, book the pool, or weigh in on a proposal.', 'Un toque para retirar un paquete, aprobar una visita, reservar la piscina u opinar en una propuesta.', 'Un tap pour récupérer un colis, approuver une visite, réserver la piscine ou donner votre avis.'),
  c('Sugerir algo', 'Suggest something', 'Sugerir algo', 'Suggérer quelque chose'),
  c('Reservar área comum', 'Book amenity', 'Reservar área común', 'Réserver un espace commun'),

  // Common visitor types & misc
  c('Visita', 'Visit', 'Visita', 'Visite'),
  c('Entrega', 'Delivery', 'Entrega', 'Livraison'),
  c('Serviço', 'Service', 'Servicio', 'Service'),
  c('Aplicativo', 'App', 'Aplicación', 'App'),

  // Status / state words
  c('aprovada', 'approved', 'aprobada', 'approuvée'),
  c('aprovado', 'approved', 'aprobado', 'approuvé'),
  c('reprovada', 'rejected', 'rechazada', 'rejetée'),
  c('rejeitada', 'rejected', 'rechazada', 'rejetée'),
  c('inconclusiva', 'inconclusive', 'no concluyente', 'non concluante'),
  c('em discussão', 'in discussion', 'en discusión', 'en discussion'),
  c('em votação', 'voting open', 'en votación', 'en vote'),
  c('discussion', 'discussion', 'discusión', 'discussion'),
  c('voting', 'voting', 'votación', 'vote'),
  c('approved', 'approved', 'aprobada', 'approuvée'),
  c('rejected', 'rejected', 'rechazada', 'rejetée'),
  c('Aprovada', 'Approved', 'Aprobada', 'Approuvée'),
  c('Rejeitada', 'Rejected', 'Rechazada', 'Rejetée'),
  c('Em discussão', 'In discussion', 'En discusión', 'En discussion'),

  // Resident Settings (/app/settings)
  c('Preferências', 'Preferences', 'Preferencias', 'Préférences'),
  c('Perfil e notificações', 'Profile & notifications', 'Perfil y notificaciones', 'Profil et notifications'),
  c('Perfil', 'Profile', 'Perfil', 'Profil'),
  c('Notificações no WhatsApp', 'WhatsApp notifications', 'Notificaciones por WhatsApp', 'Notifications WhatsApp'),
  c('Receba avisos no WhatsApp: convocação de assembleia, abertura de votação, chegada de encomenda.', 'Get WhatsApp notices: assembly call, voting open, package arrival.', 'Recibe avisos por WhatsApp: convocatoria de asamblea, apertura de votación, llegada de paquete.', 'Recevez sur WhatsApp : convocation d’assemblée, ouverture du vote, arrivée de colis.'),
  c('Número com DDD (ex: +55 11 99999-0000)', 'Phone with country code (e.g. +55 11 99999-0000)', 'Teléfono con código (ej.: +55 11 99999-0000)', 'Téléphone avec indicatif (ex. +55 11 99999-0000)'),
  c('Autorizar notificações pelo WhatsApp', 'Authorize WhatsApp notifications', 'Autorizar notificaciones por WhatsApp', 'Autoriser les notifications WhatsApp'),
  c('Ativo', 'Active', 'Activo', 'Actif'),
  c('Desativado', 'Disabled', 'Desactivado', 'Désactivé'),
  c('Preferências salvas', 'Preferences saved', 'Preferencias guardadas', 'Préférences enregistrées'),
  c('Não foi possível salvar', 'Could not save', 'No se pudo guardar', 'Impossible d’enregistrer'),

  // Resident Packages (/app/packages)
  c('Tudo aguardando você na portaria.', 'Everything waiting for you at the front desk.', 'Todo esperando por ti en la portería.', 'Tout ce qui vous attend à la conciergerie.'),
  c('Nenhuma encomenda ainda', 'No packages yet', 'Sin paquetes todavía', 'Aucun colis pour l’instant'),
  c('As entregas aparecem aqui no momento que chegam.', 'Deliveries show up here the moment they arrive.', 'Las entregas aparecen aquí en cuanto llegan.', 'Les livraisons apparaissent ici dès leur arrivée.'),
  c('Aguardando retirada', 'Waiting for pickup', 'Esperando retiro', 'En attente de retrait'),
  c('aguardando', 'waiting', 'esperando', 'en attente'),
  c('Chegou em', 'Arrived on', 'Llegó el', 'Arrivé le'),
  c('Retiradas recentes', 'Recently picked up', 'Retiros recientes', 'Récemment récupérés'),

  // Resident Assemblies (/app/assemblies)
  c('AGO / AGE — conceda procuração se não puder comparecer, ou vote ao vivo.', 'AGM / EGM — grant a proxy if you cannot attend, or vote live.', 'AGO / AGE — concede un poder si no puedes asistir, o vota en vivo.', 'AGO / AGE — donnez procuration si vous ne pouvez pas venir, ou votez en direct.'),
  c('Nenhuma assembleia agendada', 'No assemblies scheduled', 'No hay asambleas programadas', 'Aucune assemblée planifiée'),
  c('Quando o síndico convocar uma AGO ou AGE você verá aqui — com a pauta, o horário e a opção de conceder procuração se não puder comparecer.', 'When the board admin calls an AGM or EGM, you will see it here — with the agenda, time, and proxy option if you cannot attend.', 'Cuando el administrador convoque una AGO o AGE, la verás aquí — con la agenda, horario y opción de conceder poder si no puedes asistir.', 'Quand le syndic convoquera une AG ou AGE, vous la verrez ici — avec l’ordre du jour, l’heure et l’option de donner procuration si vous ne pouvez pas venir.'),

  // Resident AssemblyDetail
  c('Conceda uma procuração a outro morador para votar em seu nome.', 'Grant a proxy to another resident to vote in your name.', 'Concede un poder a otro residente para que vote en tu nombre.', 'Donnez procuration à un autre résident pour voter en votre nom.'),
  c('Não poderá comparecer?', 'Cannot attend?', '¿No puedes asistir?', 'Vous ne pouvez pas venir ?'),
  c('Conceder procuração', 'Grant proxy', 'Conceder poder', 'Donner procuration'),
  c('Procuração ativa', 'Active proxy', 'Poder activo', 'Procuration active'),
  c('Procuração concedida', 'Proxy granted', 'Poder concedido', 'Procuration accordée'),
  c('Procuração revogada', 'Proxy revoked', 'Poder revocado', 'Procuration révoquée'),
  c('Revogar', 'Revoke', 'Revocar', 'Révoquer'),
  c('Sessão aberta', 'Session open', 'Sesión abierta', 'Session ouverte'),
  c('Registrar presença', 'Register attendance', 'Registrar asistencia', 'Enregistrer la présence'),
  c('Registre sua presença para votar.', 'Register your attendance to vote.', 'Registra tu asistencia para votar.', 'Enregistrez votre présence pour voter.'),
  c('Presença registrada', 'Attendance registered', 'Asistencia registrada', 'Présence enregistrée'),
  c('Você pode votar', 'You can vote', 'Puedes votar', 'Vous pouvez voter'),
  c('Apenas proprietários votam', 'Only owners can vote', 'Solo los propietarios votan', 'Seuls les propriétaires votent'),
  c('Inadimplente — voto bloqueado', 'In arrears — vote blocked', 'En mora — voto bloqueado', 'En arriérés — vote bloqué'),
  c('Pauta', 'Agenda', 'Agenda', 'Ordre du jour'),
  c('Ata', 'Minutes', 'Acta', 'Procès-verbal'),
  c('A lista nominal de presença e procurações fica visível apenas para o conselho.', 'The full attendance and proxy list is visible only to the board.', 'La lista nominal de asistencia y poderes solo es visible para el consejo.', 'La liste nominative de présence et procurations n’est visible que pour le conseil.'),
  c('Escolher morador…', 'Choose a resident…', 'Elegir residente…', 'Choisir un résident…'),

  // Resident Meetings (/app/meetings)
  c('Reuniões do síndico, pautas e resumos gerados pela IA.', 'Board meetings, agendas, and AI-generated recaps.', 'Reuniones del administrador, agendas y resúmenes generados por IA.', 'Réunions du syndic, ordres du jour et résumés générés par IA.'),

  // Concierge texts
  c('Eventos hoje', 'Today\'s events', 'Eventos de hoy', 'Événements du jour'),
  c('Encomendas pendentes', 'Pending packages', 'Paquetes pendientes', 'Colis en attente'),
  c('Retirar', 'Pick up', 'Retirar', 'Récupérer'),
  c('Marcar como chegou', 'Mark as arrived', 'Marcar como llegó', 'Marquer comme arrivé'),
  c('Ninguém aguardando agora', 'No one waiting right now', 'Nadie esperando ahora', 'Personne n’attend pour le moment'),
  c('Hoje não há reservas', 'No reservations today', 'Hoy no hay reservas', 'Aucune réservation aujourd’hui'),
  c('Visitantes do dia', 'Today\'s visitors', 'Visitantes del día', 'Visiteurs du jour'),
  c('Entregas em espera', 'Pending deliveries', 'Entregas en espera', 'Livraisons en attente'),

  // Marketing/board copy
  c('AGO / AGE. Proprietários votam. Procurações e quórum aplicados. A IA redige a ata.', 'AGM / EGM. Owners vote. Proxies and quorum applied. AI drafts the minutes.', 'AGO / AGE. Los propietarios votan. Poderes y quórum aplicados. La IA redacta el acta.', 'AGO / AGE. Les propriétaires votent. Procurations et quorum appliqués. L’IA rédige le procès-verbal.'),

  // Onboarding — landing /onboarding
  // Audit M-N6: 'Olá' was defined twice with conflicting FR (Salut vs Bonjour);
  // first match wins so the runtime ignored the later "Bonjour" entry. Removed
  // the duplicate further down — this single source uses the standard greeting.
  c('Olá', 'Hello', 'Hola', 'Bonjour'),
  c('Sair', 'Sign out', 'Cerrar sesión', 'Se déconnecter'),
  c('Carregando…', 'Loading…', 'Cargando…', 'Chargement…'),
  c('Passo 1 de 2', 'Step 1 of 2', 'Paso 1 de 2', 'Étape 1 sur 2'),
  c('Vamos encontrar seu prédio.', 'Let’s find your building.', 'Vamos a encontrar tu edificio.', 'Trouvons votre immeuble.'),
  c('Se seu prédio já está no CondoOS, entre com o código que o síndico mandou. Se não, monte um novo — você é o primeiro síndico.', 'If your building is already on CondoOS, sign in with the invite code your board admin shared. If not, set up a new one — you are the first board admin.', 'Si tu edificio ya está en CondoOS, entra con el código que te dio el administrador. Si no, crea uno nuevo — tú serás el primer administrador.', 'Si votre immeuble est déjà sur CondoOS, connectez-vous avec le code envoyé par le syndic. Sinon, créez-en un nouveau — vous serez le premier syndic.'),
  c('Aguardando aprovação', 'Waiting for approval', 'Esperando aprobación', 'En attente d’approbation'),
  c('Você reivindicou', 'You claimed', 'Reclamaste', 'Vous avez revendiqué'),
  c('como', 'as', 'como', 'en tant que'),
  c('O síndico vai analisar em breve.', 'The board admin will review shortly.', 'El administrador lo revisará pronto.', 'Le syndic va vérifier sous peu.'),
  c('Entrar num prédio', 'Join a building', 'Unirse a un edificio', 'Rejoindre un immeuble'),
  c('Tenho um código de convite de 6 caracteres do meu síndico. Vou inserir, escolher minha unidade e ocupar meu lugar.', 'I have a 6-character invite code from my board admin. I’ll enter it, pick my unit, and take my seat.', 'Tengo un código de invitación de 6 caracteres del administrador. Lo ingreso, elijo mi unidad y ocupo mi lugar.', 'J’ai un code d’invitation à 6 caractères du syndic. Je l’entre, choisis mon lot, et prends ma place.'),
  c('Inserir código', 'Enter code', 'Ingresar código', 'Saisir le code'),
  c('Montar um novo prédio', 'Set up a new building', 'Crear un nuevo edificio', 'Configurer un nouvel immeuble'),
  c('Meu condomínio ainda não está no sistema. Me guie pelo cadastro: nome, unidades e código de convite.', 'My condominium isn’t in the system yet. Guide me through setup: name, units, and invite code.', 'Mi condominio todavía no está en el sistema. Guíame en la configuración: nombre, unidades y código de invitación.', 'Ma copropriété n’est pas encore dans le système. Guidez-moi : nom, lots, et code d’invitation.'),
  c('Começar o cadastro', 'Start setup', 'Empezar configuración', 'Commencer la configuration'),
  c('Só explorando?', 'Just exploring?', '¿Solo explorando?', 'Vous explorez ?'),
  c('Entre como demo (síndico ou morador)', 'Sign in as demo (board admin or resident)', 'Entrar como demo (administrador o residente)', 'Connectez-vous en démo (syndic ou résident)'),

  // Onboarding — Join
  c('Insira o código de convite', 'Enter the invite code', 'Ingresa el código de invitación', 'Saisissez le code d’invitation'),
  c('Um código de 6 caracteres que o síndico te mandou.', 'A 6-character code sent to you by your board admin.', 'Un código de 6 caracteres que te envió el administrador.', 'Un code à 6 caractères envoyé par le syndic.'),
  c('Continuar', 'Continue', 'Continuar', 'Continuer'),
  c('Não tem código?', 'No code?', '¿Sin código?', 'Pas de code ?'),
  c('Crie seu próprio prédio', 'Create your own building', 'Crea tu propio edificio', 'Créez votre propre immeuble'),
  c('Esse código não corresponde a nenhum prédio', 'That code doesn’t match any building', 'Ese código no corresponde a ningún edificio', 'Ce code ne correspond à aucun immeuble'),
  c('Falha na busca', 'Lookup failed', 'Error en la búsqueda', 'Échec de la recherche'),
  c('Você entrou!', 'You’re in!', '¡Entraste!', 'Vous êtes entré !'),
  c('Prédio encontrado', 'Building found', 'Edificio encontrado', 'Immeuble trouvé'),
  c('Escolha sua unidade', 'Choose your unit', 'Elige tu unidad', 'Choisissez votre lot'),
  c('Unidades já reivindicadas estão marcadas — você ainda pode escolhê-las se está se mudando ou dividindo.', 'Already-claimed units are marked — you can still pick one if you’re moving in or sharing.', 'Las unidades ya reclamadas están marcadas — puedes elegirlas si te mudas o las compartes.', 'Les lots déjà revendiqués sont marqués — vous pouvez en choisir un si vous emménagez ou partagez.'),
  c('Especial', 'Special', 'Especial', 'Spécial'),
  c('aqui', 'here', 'aquí', 'ici'),
  c('Qual seu vínculo?', 'What’s your role?', '¿Cuál es tu vínculo?', 'Quel est votre rôle ?'),
  c('Proprietário', 'Owner', 'Propietario', 'Propriétaire'),
  c('Inquilino', 'Tenant', 'Inquilino', 'Locataire'),
  c('Ocupante', 'Occupant', 'Ocupante', 'Occupant'),
  c('Sou dono da unidade', 'I own the unit', 'Soy dueño de la unidad', 'Je suis propriétaire du lot'),
  c('Alugo a unidade', 'I rent the unit', 'Alquilo la unidad', 'Je loue le lot'),
  c('Família / outro', 'Family / other', 'Familia / otro', 'Famille / autre'),
  c('Voltar', 'Back', 'Volver', 'Retour'),
  c('Pedir entrada', 'Request access', 'Solicitar entrada', 'Demander l’accès'),
  c('Entrar agora', 'Join now', 'Entrar ahora', 'Rejoindre maintenant'),
  c('Pedido enviado', 'Request sent', 'Solicitud enviada', 'Demande envoyée'),
  c('O síndico vai analisar. Você terá acesso assim que ele aprovar.', 'The board admin will review. You’ll get access as soon as it’s approved.', 'El administrador lo revisará. Tendrás acceso en cuanto lo apruebe.', 'Le syndic va examiner. Vous aurez accès dès l’approbation.'),
  c('proprietário', 'owner', 'propietario', 'propriétaire'),
  c('inquilino', 'tenant', 'inquilino', 'locataire'),
  c('ocupante', 'occupant', 'ocupante', 'occupant'),

  // Onboarding — Create (board-admin set-up)
  c('Montar um prédio', 'Set up a building', 'Crear un edificio', 'Configurer un immeuble'),
  c('Como o prédio se chama?', 'What is your building called?', '¿Cómo se llama el edificio?', 'Comment s’appelle votre immeuble ?'),
  c('Os moradores vão ver esse nome ao entrar.', 'Residents will see this name when they sign in.', 'Los residentes verán este nombre al entrar.', 'Les résidents verront ce nom à la connexion.'),
  c('Modelo de votação', 'Voting model', 'Modelo de votación', 'Modèle de vote'),
  c('Padrões sensatos — pode mudar depois.', 'Sensible defaults — you can change them later.', 'Valores predeterminados sensatos — puedes cambiarlos después.', 'Réglages par défaut — vous pourrez changer plus tard.'),
  c('Comum em condomínios brasileiros.', 'Common in Brazilian condominiums.', 'Común en condominios brasileños.', 'Courant dans les copropriétés brésiliennes.'),
  c('Exigir aprovação do síndico para novos moradores', 'Require board-admin approval for new residents', 'Requerir aprobación del administrador para nuevos residentes', 'Exiger l’approbation du syndic pour les nouveaux résidents'),
  c('Recomendado. Novos moradores ficam em fila até o síndico aprovar.', 'Recommended. New residents wait in a queue until the board admin approves.', 'Recomendado. Los nuevos residentes esperan en cola hasta que el administrador apruebe.', 'Recommandé. Les nouveaux résidents attendent dans une file jusqu’à approbation du syndic.'),
  c('Sou síndico mas não moro neste prédio', 'I’m the board admin but I don’t live in this building', 'Soy el administrador pero no vivo en este edificio', 'Je suis syndic mais je n’habite pas dans cet immeuble'),
  c('Criar prédio', 'Create building', 'Crear edificio', 'Créer l’immeuble'),
  c('Use um modelo e preencha empresa, telefone, contrato e observações.', 'Use a template and fill in company, phone, contract, and notes.', 'Usa una plantilla y completa empresa, teléfono, contrato y notas.', 'Utilisez un modèle et remplissez entreprise, téléphone, contrat, notes.'),
  c('Salão de festas', 'Party room', 'Salón de fiestas', 'Salle des fêtes'),
  c('Rede de operação', 'Operating network', 'Red operativa', 'Réseau d’exploitation'),

  // Onboarding /create — stepper labels
  c('Prédio', 'Building', 'Edificio', 'Immeuble'),
  c('Estrutura', 'Structure', 'Estructura', 'Structure'),
  c('Operação', 'Operations', 'Operación', 'Opérations'),
  c('Pronto', 'Ready', 'Listo', 'Prêt'),

  // Onboarding /create — step 1
  c('Nome do condomínio', 'Condominium name', 'Nombre del condominio', 'Nom de la copropriété'),
  c('Endereço', 'Address', 'Dirección', 'Adresse'),
  c('Os blocos / torres você cadastra no próximo passo — pode ter mais de um.', 'You add the blocks / towers in the next step — you can have more than one.', 'Los bloques / torres se agregan en el siguiente paso — puede haber más de uno.', 'Vous ajoutez les blocs / tours à l’étape suivante — il peut y en avoir plusieurs.'),

  // Onboarding /create — step 2 (blocks & units)
  c('Blocos e sua unidade', 'Blocks and your unit', 'Bloques y tu unidad', 'Blocs et votre lot'),
  c('Cadastre cada torre ou bloco. Para um único prédio, deixe como está. Vamos gerar números tipo 101, 102… (renomeáveis depois).', 'Register each tower or block. For a single building, leave as-is. We will generate numbers like 101, 102… (renameable later).', 'Registra cada torre o bloque. Para un único edificio, déjalo así. Generaremos números como 101, 102… (renombrables después).', 'Enregistrez chaque tour ou bloc. Pour un seul immeuble, laissez tel quel. Nous générerons des numéros comme 101, 102… (renommables plus tard).'),
  c('Nome do bloco', 'Block name', 'Nombre del bloque', 'Nom du bloc'),
  c('ex: Torre A, Bloco 1, Cobertura', 'e.g. Tower A, Block 1, Penthouse', 'ej.: Torre A, Bloque 1, Ático', 'ex. Tour A, Bloc 1, Penthouse'),
  c('Andares', 'Floors', 'Pisos', 'Étages'),
  c('Unidades padrão', 'Default units', 'Unidades estándar', 'Lots par défaut'),
  c('Unidades por andar', 'Units per floor', 'Unidades por piso', 'Lots par étage'),
  c('Edite os andares que fogem do padrão. Use 0 para andares sem apartamentos.', 'Edit floors that differ from the default. Use 0 for floors without units.', 'Edita los pisos que difieren del estándar. Usa 0 para pisos sin departamentos.', 'Modifiez les étages qui diffèrent du standard. Utilisez 0 pour les étages sans appartements.'),
  c('Layout personalizado', 'Custom layout', 'Layout personalizado', 'Mise en page personnalisée'),
  c('Mesmo padrão', 'Same default', 'Mismo estándar', 'Même standard'),
  c('unidades neste bloco', 'units in this block', 'unidades en este bloque', 'lots dans ce bloc'),
  c('Adicionar bloco', 'Add block', 'Añadir bloque', 'Ajouter un bloc'),
  c('Remover bloco', 'Remove block', 'Eliminar bloque', 'Supprimer le bloc'),
  c('unidades no total', 'units total', 'unidades en total', 'lots au total'),
  c('em', 'in', 'en', 'dans'),
  c('blocos', 'blocks', 'bloques', 'blocs'),
  c('Para administradoras / síndicos profissionais. Você gerencia o prédio mas não vai votar nas AGOs (só proprietários votam, conforme o Código Civil).', 'For property managers / professional board admins. You manage the building but you will not vote at AGMs (only owners vote per the Civil Code).', 'Para administradoras / administradores profesionales. Gestionas el edificio pero no votas en las AGO (solo los propietarios votan, según el Código Civil).', 'Pour les administrateurs / syndics professionnels. Vous gérez l’immeuble mais ne votez pas en AGO (seuls les propriétaires votent, conformément au Code civil).'),
  c('Sua unidade (você é o síndico, então essa é a sua)', 'Your unit (you are the board admin, so this is yours)', 'Tu unidad (eres el administrador, así que esta es la tuya)', 'Votre lot (vous êtes le syndic, donc c’est le vôtre)'),
  c('ex: 801 ou Cobertura-1', 'e.g. 801 or Penthouse-1', 'ej.: 801 o Ático-1', 'ex. 801 ou Penthouse-1'),

  // Onboarding /create — step 3 (preferences)
  c('Criar áreas comuns reserváveis agora', 'Create bookable amenities now', 'Crear áreas comunes reservables ahora', 'Créer des espaces communs réservables maintenant'),
  c('Academia, piscina, quadras, campo, salão de festas — cada uma com capacidade e slots próprios.', 'Gym, pool, courts, field, party room — each with its own capacity and slots.', 'Gimnasio, piscina, canchas, campo, salón de fiestas — cada uno con su propia capacidad y slots.', 'Salle de sport, piscine, courts, terrain, salle des fêtes — chacun avec sa propre capacité et ses créneaux.'),
  c('Academia', 'Gym', 'Gimnasio', 'Salle de sport'),
  c('Piscina', 'Pool', 'Piscina', 'Piscine'),
  c('Quadra / campo', 'Court / field', 'Cancha / campo', 'Court / terrain'),
  c('pessoas · slots de', 'people · slots of', 'personas · slots de', 'personnes · créneaux de'),
  c('Criar área personalizada', 'Create custom amenity', 'Crear área personalizada', 'Créer un espace personnalisé'),
  c('Nova área', 'New amenity', 'Nueva área', 'Nouvel espace'),
  c('Remover área', 'Remove amenity', 'Eliminar área', 'Supprimer l’espace'),
  c('Tipo', 'Type', 'Tipo', 'Type'),
  c('Slot', 'Slot', 'Slot', 'Créneau'),
  c('Abre', 'Opens', 'Abre', 'Ouvre'),
  c('Fecha', 'Closes', 'Cierra', 'Ferme'),
  c('Modelo de votação', 'Voting model', 'Modelo de votación', 'Modèle de vote'),
  c('Um voto por unidade', 'One vote per unit', 'Un voto por unidad', 'Un vote par lot'),
  c('Simples e justo.', 'Simple and fair.', 'Simple y justo.', 'Simple et juste.'),
  c('Ponderado por m²', 'Weighted by m²', 'Ponderado por m²', 'Pondéré par m²'),

  // Onboarding /create — step 4 (operational network)
  c('Registre os fornecedores que já conhecem o prédio: eletricista, hidráulica, elevador, academia, piscina, limpeza, segurança e outros contatos úteis.', 'Register the vendors that already know the building: electrician, plumbing, elevator, gym, pool, cleaning, security, and other useful contacts.', 'Registra los proveedores que ya conocen el edificio: electricista, fontanería, ascensor, gimnasio, piscina, limpieza, seguridad y otros contactos útiles.', 'Enregistrez les prestataires qui connaissent déjà l’immeuble : électricien, plomberie, ascenseur, salle de sport, piscine, nettoyage, sécurité et autres contacts utiles.'),
  c('Adicionar contato por tipo', 'Add contact by type', 'Añadir contacto por tipo', 'Ajouter un contact par type'),
  c('prontos para salvar', 'ready to save', 'listos para guardar', 'prêts à enregistrer'),
  c('Tipo de serviço', 'Service type', 'Tipo de servicio', 'Type de service'),
  c('Empresa / fornecedor', 'Company / vendor', 'Empresa / proveedor', 'Entreprise / prestataire'),
  c('Pessoa de contato', 'Contact person', 'Persona de contacto', 'Personne de contact'),
  c('Telefone', 'Phone', 'Teléfono', 'Téléphone'),
  c('Site', 'Website', 'Sitio web', 'Site web'),
  c('Link do contrato / garantia', 'Contract / warranty link', 'Enlace al contrato / garantía', 'Lien du contrat / garantie'),
  c('O que essa empresa resolve', 'What this vendor handles', 'Qué resuelve esta empresa', 'Ce que ce prestataire gère'),
  c('Observações importantes', 'Important notes', 'Notas importantes', 'Notes importantes'),
  c('Atende emergência', 'On-call for emergencies', 'Atiende emergencias', 'Disponible en urgence'),
  c('Fornecedor preferido', 'Preferred vendor', 'Proveedor preferido', 'Prestataire préféré'),
  c('emergência', 'emergency', 'emergencia', 'urgence'),
  c('Adicionar contato personalizado', 'Add custom contact', 'Añadir contacto personalizado', 'Ajouter un contact personnalisé'),
  c('Remover contato', 'Remove contact', 'Eliminar contacto', 'Supprimer le contact'),
  c('Último atendimento / visita', 'Last service / visit', 'Último servicio / visita', 'Dernière intervention / visite'),
  c('Cada contato salvo precisa ter empresa e pelo menos uma forma de contato ou observação. Links devem ser URLs válidas começando com https://.', 'Each saved contact needs a company and at least one contact channel or note. Links must be valid URLs starting with https://.', 'Cada contacto guardado necesita una empresa y al menos un canal de contacto o nota. Los enlaces deben ser URL válidas que empiecen con https://.', 'Chaque contact enregistré doit avoir une entreprise et au moins un canal de contact ou une note. Les liens doivent être des URL valides commençant par https://.'),
  c('Links devem ser URLs válidas começando com https://.', 'Links must be valid URLs starting with https://.', 'Los enlaces deben ser URL válidas que empiecen con https://.', 'Les liens doivent être des URL valides commençant par https://.'),
  c('Criar prédio', 'Create building', 'Crear edificio', 'Créer l’immeuble'),
  c('ex: Fitness Pro, Elevadores Atlas', 'e.g. Fitness Pro, Atlas Elevators', 'ej.: Fitness Pro, Ascensores Atlas', 'ex. Fitness Pro, Ascenseurs Atlas'),
  c('ex: manutenção da esteira, instalação de aparelhos, emergência elétrica', 'e.g. treadmill maintenance, equipment install, electrical emergency', 'ej.: mantenimiento de cinta, instalación de aparatos, emergencia eléctrica', 'ex. maintenance de tapis, installation d’appareils, urgence électrique'),
  c('ex: horário de atendimento, SLA, quem chama, número do contrato, restrições de acesso', 'e.g. business hours, SLA, who to call, contract number, access restrictions', 'ej.: horario de atención, SLA, a quién llamar, número de contrato, restricciones de acceso', 'ex. horaires, SLA, qui contacter, numéro de contrat, restrictions d’accès'),

  // Onboarding /create — step 5 (ready)
  c('Tudo pronto.', 'All set.', 'Todo listo.', 'Tout est prêt.'),
  c('está no ar. Compartilhe este código com os moradores para entrarem:', 'is live. Share this code with residents so they can join:', 'está en línea. Comparte este código con los residentes para que entren:', 'est en ligne. Partagez ce code avec les résidents pour qu’ils rejoignent :'),
  c('Código de convite', 'Invite code', 'Código de invitación', 'Code d’invitation'),
  c('Copiado!', 'Copied!', '¡Copiado!', 'Copié !'),
  c('Copiar código', 'Copy code', 'Copiar código', 'Copier le code'),
  c('Compartilhe direto com os moradores', 'Share directly with residents', 'Comparte directamente con los residentes', 'Partagez directement avec les résidents'),
  c('Copiar link', 'Copy link', 'Copiar enlace', 'Copier le lien'),
  c('Quem clicar no link cai direto no cadastro com o código já preenchido — não precisa digitar nada.', 'Anyone who clicks the link lands on the join form with the code pre-filled — no typing needed.', 'Quien haga clic en el enlace cae directo en el formulario con el código ya rellenado — sin escribir nada.', 'Toute personne qui clique sur le lien arrive sur le formulaire avec le code pré-rempli — pas besoin de taper.'),
  c('Ir ao painel do síndico', 'Go to the board admin dashboard', 'Ir al panel del administrador', 'Aller au tableau de bord du syndic'),
  c('Set up a building', 'Set up a building', 'Crear un edificio', 'Configurer un immeuble'),

  // AI-drafted proposal copy that exists in production demo data. Adding
  // these here so the existing demo proposals translate; new proposals get
  // drafted in the user's locale via the locale param on /ai/proposal-draft.
  c('Reparar ou substituir esteira #3 com ruído excessivo', 'Repair or replace treadmill #3 with excessive noise', 'Reparar o sustituir cinta #3 con ruido excesivo', 'Réparer ou remplacer le tapis #3 trop bruyant'),
  c('A esteira #3 na academia está produzindo ruído anormal durante o uso, potencialmente indicando desgaste mecânico.', 'Treadmill #3 in the gym is producing abnormal noise during use, potentially indicating mechanical wear.', 'La cinta #3 del gimnasio produce un ruido anormal durante el uso, lo que indica posible desgaste mecánico.', 'Le tapis #3 de la salle de sport produit un bruit anormal pendant l’utilisation, indiquant probablement une usure mécanique.'),
  c('A esteira #3 na academia está produzindo ruído anormal durante o uso, potencialmente indicando desgaste mecânico ou problema estrutural. O ruído excessivo pode comprometer a experiência dos usuários e sinalizar necessidade de manutenção.', 'Treadmill #3 in the gym is producing abnormal noise during use, potentially indicating mechanical wear or a structural issue. The excessive noise can hurt the user experience and signal the need for maintenance.', 'La cinta #3 del gimnasio produce ruido anormal durante el uso, lo que puede indicar desgaste mecánico o un problema estructural. El ruido excesivo puede afectar la experiencia de los usuarios y señalar necesidad de mantenimiento.', 'Le tapis #3 de la salle de sport produit un bruit anormal pendant l’utilisation, indiquant possiblement une usure mécanique ou un problème structurel. Le bruit excessif peut nuire à l’expérience des utilisateurs et signaler un besoin d’entretien.'),
  c('Realizar inspeção técnica completa na esteira, verificando componentes como rolamentos, correia e sistema de amortecimento. Dependendo do diagnóstico, proceder com reparo pontual ou substituição do equipamento.', 'Carry out a full technical inspection of the treadmill, checking components like bearings, belt, and shock-absorption system. Depending on the diagnosis, proceed with a targeted repair or replace the equipment.', 'Realizar una inspección técnica completa de la cinta, revisando rodamientos, banda y sistema de amortiguación. Según el diagnóstico, proceder con reparación puntual o reemplazo del equipo.', 'Effectuer une inspection technique complète du tapis, en vérifiant les composants comme les roulements, la courroie et le système d’amortissement. Selon le diagnostic, procéder à une réparation ciblée ou au remplacement de l’équipement.'),
  c('Próximo passo: agendar vistoria com técnico especializado em equipamentos de fitness, com objetivo de avaliar e solucionar o problema em até 15 dias.', 'Next step: schedule an inspection with a fitness-equipment technician, aiming to assess and resolve the issue within 15 days.', 'Próximo paso: programar una visita con un técnico especializado en equipos de fitness, con el objetivo de evaluar y resolver el problema en 15 días.', 'Prochaine étape : planifier une visite avec un technicien spécialisé en équipements de fitness, dans le but d’évaluer et de résoudre le problème sous 15 jours.'),
  c('Trocar ou consertar o portão da garagem', 'Replace or repair the garage gate', 'Cambiar o reparar el portón del garaje', 'Remplacer ou réparer le portail du garage'),
  c('O portão da garagem está apresentando falhas mecânicas frequentes, causando transtorno aos moradores. Avaliar reparo vs substituição com 3 orçamentos.', 'The garage gate has frequent mechanical failures, causing inconvenience for residents. Evaluate repair vs replacement with three bids.', 'El portón del garaje presenta fallas mecánicas frecuentes, causando molestias a los residentes. Evaluar reparación vs reemplazo con 3 presupuestos.', 'Le portail du garage tombe régulièrement en panne, gênant les résidents. Comparer réparation et remplacement avec trois devis.'),

  // AI/manual badges still leaking on cards
  c('AI-drafted', 'AI-drafted', 'redactado por IA', 'rédigé par IA'),
  c('discussion', 'discussion', 'en discusión', 'en discussion'),
  c('maintenance', 'maintenance', 'mantenimiento', 'maintenance'),
  c('infrastructure', 'infrastructure', 'infraestructura', 'infrastructure'),
  c('safety', 'safety', 'seguridad', 'sécurité'),
  c('amenity', 'amenity', 'área común', 'espace commun'),
  c('community', 'community', 'comunidad', 'communauté'),
  c('policy', 'policy', 'política', 'politique'),
  c('financial', 'financial', 'financiero', 'financier'),

  // Board amenities (added in upstream commit)
  c('Áreas comuns', 'Amenities', 'Áreas comunes', 'Espaces communs'),
  c('Carregando…', 'Loading…', 'Cargando…', 'Chargement…'),
  c('Adicionar por modelo', 'Add from a template', 'Añadir desde plantilla', 'Ajouter depuis un modèle'),
  c('Comece com um padrão e ajuste capacidade, horários e duração dos slots.', 'Start from a preset and tweak capacity, hours, and slot length.', 'Empieza desde una plantilla y ajusta capacidad, horarios y duración de los slots.', 'Partez d’un modèle puis ajustez capacité, horaires et durée des créneaux.'),
  c('capacidade = pessoas por slot', 'capacity = people per slot', 'capacidad = personas por slot', 'capacité = personnes par créneau'),
  c('Nova área', 'New amenity', 'Nueva área', 'Nouvel espace'),
  c('Nova área comum', 'New amenity', 'Nueva área común', 'Nouvel espace commun'),
  c('Editar área comum', 'Edit amenity', 'Editar área común', 'Modifier l’espace commun'),
  c('Cancelar', 'Cancel', 'Cancelar', 'Annuler'),
  c('Salvar', 'Save', 'Guardar', 'Enregistrer'),
  c('Sem descrição.', 'No description.', 'Sin descripción.', 'Aucune description.'),
  c('ativa', 'active', 'activa', 'active'),
  c('inativa', 'inactive', 'inactiva', 'inactive'),
  c('pessoas', 'people', 'personas', 'personnes'),
  c('dias de antecedência', 'days in advance', 'días de antelación', 'jours à l’avance'),
  c('Editar área', 'Edit amenity', 'Editar área', 'Modifier l’espace'),
  c('Desativar área', 'Deactivate amenity', 'Desactivar área', 'Désactiver l’espace'),
  c('Área desativada', 'Amenity deactivated', 'Área desactivada', 'Espace désactivé'),
  c('Área criada', 'Amenity created', 'Área creada', 'Espace créé'),
  c('Área atualizada', 'Amenity updated', 'Área actualizada', 'Espace mis à jour'),
  c('Falha ao desativar', 'Deactivate failed', 'Error al desactivar', 'Échec de la désactivation'),
  c('Falha ao salvar área', 'Failed to save amenity', 'Error al guardar el área', 'Échec de l’enregistrement'),
  c('Dê um nome para a área.', 'Give the amenity a name.', 'Dale un nombre al área.', 'Donnez un nom à l’espace.'),
  c('O horário final precisa ser depois da abertura.', 'Closing time must be after opening time.', 'La hora de cierre debe ser posterior a la apertura.', 'L’heure de fermeture doit être après l’ouverture.'),
  c('O slot precisa caber no horário de funcionamento.', 'The slot length must fit inside the open hours.', 'La duración del slot debe caber en el horario.', 'La durée du créneau doit tenir dans les horaires d’ouverture.'),
  c('Nome', 'Name', 'Nombre', 'Nom'),
  c('Tipo visual', 'Visual type', 'Tipo visual', 'Type visuel'),
  c('Descrição', 'Description', 'Descripción', 'Description'),
  c('Pessoas por slot', 'People per slot', 'Personas por slot', 'Personnes par créneau'),
  c('Duração do slot', 'Slot length', 'Duración del slot', 'Durée du créneau'),
  c('minutos', 'minutes', 'minutos', 'minutes'),
  c('Abre às', 'Opens at', 'Abre a las', 'Ouvre à'),
  c('Fecha às', 'Closes at', 'Cierra a las', 'Ferme à'),
  c('Reservar com antecedência', 'Booking lead time', 'Reservar con antelación', 'Réservation à l’avance'),
  c('Número de dias que aparecem para os moradores.', 'Number of days residents see in the booking calendar.', 'Días que ven los residentes en el calendario.', 'Nombre de jours visibles par les résidents.'),
  c('Status', 'Status', 'Estado', 'Statut'),
  c('Ativa para reservas', 'Active for bookings', 'Activa para reservas', 'Active pour les réservations'),
  c('Inativa', 'Inactive', 'Inactiva', 'Inactive'),
  c('Observações internas', 'Internal notes', 'Notas internas', 'Notes internes'),
  c('Nenhuma área comum cadastrada ainda. Crie a primeira para liberar reservas aos moradores.', 'No amenities set up yet. Create the first one to enable bookings.', 'Aún no hay áreas comunes. Crea la primera para habilitar reservas.', 'Aucun espace commun configuré. Créez le premier pour activer les réservations.'),
  // Board operations — trusted vendors and service contacts
  c('contato ativo', 'active contact', 'contacto activo', 'contact actif'),
  c('contatos ativos', 'active contacts', 'contactos activos', 'contacts actifs'),
  c('atende emergência', 'handles emergencies', 'atiende emergencias', 'gère les urgences'),
  c('atendem emergência', 'handle emergencies', 'atienden emergencias', 'gèrent les urgences'),
  c('Guarde aqui eletricistas, hidráulica, elevadores, fabricantes ou instaladores da academia, piscina, segurança, limpeza e contratos importantes.', 'Keep electricians, plumbing, elevators, gym equipment manufacturers or installers, pool, security, cleaning, and important contracts here.', 'Guarda aquí electricistas, fontanería, ascensores, fabricantes o instaladores del gimnasio, piscina, seguridad, limpieza y contratos importantes.', 'Gardez ici électriciens, plomberie, ascenseurs, fabricants ou installateurs de salle de sport, piscine, sécurité, nettoyage et contrats importants.'),
  c('Nenhum contato operacional cadastrado ainda. Comece pelos fornecedores que você chamaria em uma emergência.', 'No operations contacts yet. Start with the vendors you would call in an emergency.', 'Aún no hay contactos operativos. Empieza por los proveedores que llamarías en una emergencia.', 'Aucun contact opérationnel pour l’instant. Commencez par les prestataires à appeler en urgence.'),
  c('Desativar contato', 'Deactivate contact', 'Desactivar contacto', 'Désactiver le contact'),
  c('Contato desativado', 'Contact deactivated', 'Contacto desactivado', 'Contact désactivé'),
  c('Informe a empresa ou fornecedor.', 'Enter the company or vendor.', 'Indica la empresa o proveedor.', 'Indiquez l’entreprise ou le prestataire.'),
  c('Inclua telefone, WhatsApp, email, site, endereço ou observação.', 'Add phone, WhatsApp, email, website, address, or a note.', 'Añade teléfono, WhatsApp, email, sitio web, dirección o una nota.', 'Ajoutez téléphone, WhatsApp, e-mail, site, adresse ou une note.'),
  c('Contato criado', 'Contact created', 'Contacto creado', 'Contact créé'),
  c('Contato atualizado', 'Contact updated', 'Contacto actualizado', 'Contact mis à jour'),
  c('Falha ao salvar contato', 'Failed to save contact', 'Error al guardar el contacto', 'Échec de l’enregistrement du contact'),
  c('Editar contato', 'Edit contact', 'Editar contacto', 'Modifier le contact'),
  c('Tel:', 'Phone:', 'Tel.:', 'Tél. :'),
  c('site', 'website', 'sitio web', 'site'),
  c('contrato', 'contract', 'contrato', 'contrat'),
  c('último uso:', 'last used:', 'último uso:', 'dernière utilisation :'),
  c('Último uso', 'Last used', 'Último uso', 'Dernière utilisation'),
  c('Ativo', 'Active', 'Activo', 'Actif'),
  c('Inativo', 'Inactive', 'Inactivo', 'Inactif'),
  c('Observações', 'Notes', 'Observaciones', 'Notes'),
  c('Elétrica', 'Electrical', 'Electricidad', 'Électricité'),
  c('Hidráulica', 'Plumbing', 'Fontanería', 'Plomberie'),
  c('Elevadores', 'Elevators', 'Ascensores', 'Ascenseurs'),
  c('Academia / equipamentos', 'Gym / equipment', 'Gimnasio / equipos', 'Salle de sport / équipements'),
  c('Limpeza', 'Cleaning', 'Limpieza', 'Nettoyage'),
  c('Segurança / portaria', 'Security / front desk', 'Seguridad / portería', 'Sécurité / conciergerie'),
  c('Jardim', 'Landscaping', 'Jardinería', 'Espaces verts'),
  c('Internet / CFTV', 'Internet / CCTV', 'Internet / CCTV', 'Internet / vidéosurveillance'),
  c('Dedetização', 'Pest control', 'Control de plagas', 'Dératisation'),
  c('Manutenção geral', 'General maintenance', 'Mantenimiento general', 'Maintenance générale'),
  c('Jurídico / contábil', 'Legal / accounting', 'Legal / contable', 'Juridique / comptable'),
  c('Outro', 'Other', 'Otro', 'Autre'),
  // Board AI agent — operations workbench
  c('Agente IA', 'AI agent', 'Agente IA', 'Agent IA'),
  c('Peça ajuda para consertos, instalações, fornecedores, concorrentes e próximos passos operacionais.', 'Ask for help with repairs, installations, vendors, competitors, and operational next steps.', 'Pide ayuda con reparaciones, instalaciones, proveedores, competidores y próximos pasos operativos.', 'Demandez de l’aide pour réparations, installations, prestataires, concurrents et prochaines étapes opérationnelles.'),
  c('Workbench operacional', 'Operations workbench', 'Mesa de trabajo operativa', 'Atelier opérationnel'),
  c('O agente usa a rede de serviços, áreas comuns, sugestões e propostas do condomínio para montar opções, perguntas para fornecedores, plano de ação, comunicado e rascunho de proposta.', 'The agent uses the service network, amenities, suggestions, and proposals to assemble options, vendor questions, an action plan, a notice, and a proposal draft.', 'El agente usa la red de servicios, áreas comunes, sugerencias y propuestas para armar opciones, preguntas a proveedores, plan de acción, aviso y borrador de propuesta.', 'L’agent utilise le réseau de services, les espaces communs, suggestions et propositions pour préparer options, questions aux prestataires, plan d’action, message et brouillon de proposition.'),
  c('Ele não compra, contrata nem promete pesquisa ao vivo: entrega o plano e os atalhos para você executar com controle.', 'It does not buy, hire, or promise live research: it delivers the plan and shortcuts for you to execute with control.', 'No compra, contrata ni promete investigación en vivo: entrega el plan y atajos para que ejecutes con control.', 'Il n’achète pas, ne recrute pas et ne promet pas de recherche en direct : il livre le plan et les raccourcis pour exécuter avec contrôle.'),
  c('O que você quer resolver?', 'What do you want to solve?', '¿Qué quieres resolver?', 'Que voulez-vous résoudre ?'),
  c('Descreva o conserto, instalação, comparação de fornecedores ou decisão operacional que você precisa tomar.', 'Describe the repair, installation, vendor comparison, or operational decision you need to make.', 'Describe la reparación, instalación, comparación de proveedores o decisión operativa que necesitas tomar.', 'Décrivez la réparation, l’installation, la comparaison de prestataires ou la décision opérationnelle à prendre.'),
  c('Comparar fornecedores para manutenção da esteira da academia', 'Compare vendors for gym treadmill maintenance', 'Comparar proveedores para mantenimiento de la cinta del gimnasio', 'Comparer des prestataires pour la maintenance du tapis de la salle de sport'),
  c('Encontrar opções para instalar carregadores de carro elétrico', 'Find options to install EV chargers', 'Encontrar opciones para instalar cargadores eléctricos', 'Trouver des options pour installer des bornes de recharge'),
  c('Planejar conserto urgente do portão da garagem', 'Plan an urgent garage gate repair', 'Planificar reparación urgente del portón del garaje', 'Planifier une réparation urgente du portail du garage'),
  c('Avaliar concorrentes para controle de acesso', 'Evaluate competitors for access control', 'Evaluar competidores para control de acceso', 'Évaluer des concurrents pour le contrôle d’accès'),
  c('Tipo de ajuda', 'Help type', 'Tipo de ayuda', 'Type d’aide'),
  c('Geral', 'General', 'General', 'Général'),
  c('Conserto', 'Repair', 'Reparación', 'Réparation'),
  c('Instalação', 'Installation', 'Instalación', 'Installation'),
  c('Fornecedores / concorrentes', 'Vendors / competitors', 'Proveedores / competidores', 'Prestataires / concurrents'),
  c('Regra / política', 'Rule / policy', 'Regla / política', 'Règle / politique'),
  c('Localização ou área', 'Location or area', 'Ubicación o área', 'Emplacement ou zone'),
  c('ex: academia, garagem, São Paulo', 'e.g. gym, garage, São Paulo', 'ej.: gimnasio, garaje, São Paulo', 'ex. salle de sport, garage, São Paulo'),
  c('Orçamento ou teto', 'Budget or cap', 'Presupuesto o límite', 'Budget ou plafond'),
  c('ex: até R$ 15.000', 'e.g. up to R$ 15,000', 'ej.: hasta R$ 15.000', 'ex. jusqu’à 15 000 R$'),
  c('Urgência', 'Urgency', 'Urgencia', 'Urgence'),
  c('ex: urgente esta semana', 'e.g. urgent this week', 'ej.: urgente esta semana', 'ex. urgent cette semaine'),
  c('Gerar plano', 'Generate plan', 'Generar plan', 'Générer le plan'),
  c('Descreva o problema ou objetivo com mais detalhe.', 'Describe the problem or goal in more detail.', 'Describe el problema u objetivo con más detalle.', 'Décrivez le problème ou l’objectif plus en détail.'),
  c('Plano gerado', 'Plan generated', 'Plan generado', 'Plan généré'),
  c('Falha ao gerar plano', 'Failed to generate plan', 'Error al generar el plan', 'Échec de génération du plan'),
  c('Não foi possível copiar', 'Could not copy', 'No se pudo copiar', 'Impossible de copier'),
  c('Copiado', 'Copied', 'Copiado', 'Copié'),
  c('Proposta criada', 'Proposal created', 'Propuesta creada', 'Proposition créée'),
  c('Falha ao criar proposta', 'Failed to create proposal', 'Error al crear la propuesta', 'Échec de création de la proposition'),
  c('Fallback seguro', 'Safe fallback', 'Fallback seguro', 'Repli sécurisé'),
  c('repair', 'repair', 'reparación', 'réparation'),
  c('install', 'install', 'instalación', 'installation'),
  c('vendor_research', 'vendor research', 'investigación de proveedores', 'recherche prestataires'),
  c('general', 'general', 'general', 'général'),
  c('Resumo', 'Summary', 'Resumen', 'Résumé'),
  c('Copiar', 'Copy', 'Copiar', 'Copier'),
  c('Próximo passo', 'Next step', 'Próximo paso', 'Prochaine étape'),
  c('Rede cadastrada', 'Saved network', 'Red guardada', 'Réseau enregistré'),
  c('Opções', 'Options', 'Opciones', 'Options'),
  c('Prós', 'Pros', 'Ventajas', 'Avantages'),
  c('Contras', 'Cons', 'Desventajas', 'Inconvénients'),
  c('Custo', 'Cost', 'Costo', 'Coût'),
  c('Prazo', 'Timeline', 'Plazo', 'Délai'),
  c('Perguntas para fornecedor', 'Questions for vendor', 'Preguntas para proveedor', 'Questions au prestataire'),
  c('Critérios', 'Criteria', 'Criterios', 'Critères'),
  c('Plano de pesquisa', 'Research plan', 'Plan de investigación', 'Plan de recherche'),
  c('Buscas prontas', 'Ready searches', 'Búsquedas listas', 'Recherches prêtes'),
  c('Critérios de seleção', 'Shortlisting criteria', 'Criterios de selección', 'Critères de sélection'),
  c('Mensagem para fornecedores', 'Message to vendors', 'Mensaje para proveedores', 'Message aux prestataires'),
  c('Copiar mensagem', 'Copy message', 'Copiar mensaje', 'Copier le message'),
  c('Plano de ação', 'Action plan', 'Plan de acción', 'Plan d’action'),
  c('Responsável', 'Owner', 'Responsable', 'Responsable'),
  c('Quando', 'When', 'Cuándo', 'Quand'),
  c('Comunicado aos moradores', 'Resident notice', 'Aviso a residentes', 'Message aux résidents'),
  c('Copiar comunicado', 'Copy notice', 'Copiar aviso', 'Copier le message'),
  c('Proposta pronta', 'Ready proposal', 'Propuesta lista', 'Proposition prête'),
  c('Criar proposta', 'Create proposal', 'Crear propuesta', 'Créer la proposition'),
  c('Riscos', 'Risks', 'Riesgos', 'Risques'),
  c('Premissas', 'Assumptions', 'Supuestos', 'Hypothèses'),
  // Audit 2026-05 — H5 /board/pending was rendered entirely in English.
  c('Aprovações pendentes', 'Pending approvals', 'Aprobaciones pendientes', 'Approbations en attente'),
  c('Pessoas que pediram para entrar no seu prédio. Aprove para conceder acesso; recuse para rejeitar.', 'People who requested to join your building. Approve to grant them access; deny to reject.', 'Personas que pidieron unirse a tu edificio. Aprueba para concederles acceso; rechaza para denegar.', "Personnes qui ont demandé à rejoindre votre immeuble. Approuvez pour leur accorder l'accès ; refusez pour les rejeter."),
  c('Nada pendente', 'Nothing pending', 'Nada pendiente', 'Rien en attente'),
  c('Você verá novos moradores aqui quando entrarem com seu código de convite. Compartilhe o código na página de Moradores.', "You'll see new residents here when they join with your invite code. Share the code in the Residents page.", 'Verás nuevos residentes aquí cuando se unan con tu código de invitación. Comparte el código en la página de Residentes.', "Vous verrez les nouveaux résidents ici lorsqu'ils rejoignent avec votre code d'invitation. Partagez le code sur la page Résidents."),
  c('contato principal', 'primary contact', 'contacto principal', 'contact principal'),
  c('Reivindicando', 'Claiming', 'Reclamando', 'Réclamant'),
  c('solicitado', 'requested', 'solicitado', 'demandé'),
  c('Recusar', 'Deny', 'Rechazar', 'Refuser'),
  c('Aprovar', 'Approve', 'Aprobar', 'Approuver'),
  c('Morador aprovado', 'Resident approved', 'Residente aprobado', 'Résident approuvé'),
  c('Pedido recusado', 'Request denied', 'Solicitud rechazada', 'Demande refusée'),
  c('proprietário', 'owner', 'propietario', 'propriétaire'),
  c('inquilino', 'tenant', 'inquilino', 'locataire'),
  c('ocupante', 'occupant', 'ocupante', 'occupant'),
  // H6 — plural forms used by pluralize() helper, locale-aware singular/plural.
  c('item', 'item', 'ítem', 'élément'),
  c('itens', 'items', 'ítems', 'éléments'),
  c('na agenda', 'on agenda', 'en la agenda', "à l'ordre du jour"),
  c('bloco', 'building', 'bloque', 'bâtiment'),
  c('blocos', 'buildings', 'bloques', 'bâtiments'),
  c('unidade', 'unit', 'unidad', 'lot'),
  c('unidades', 'units', 'unidades', 'lots'),
  c('andar', 'floor', 'piso', 'étage'),
  c('andares', 'floors', 'pisos', 'étages'),
  c('participante registrado', 'attendee registered', 'participante registrado', 'participant inscrit'),
  c('participantes registrados', 'attendees registered', 'participantes registrados', 'participants inscrits'),
  // H9 — proposal card cost label
  c('Estimativa', 'Estimate', 'Estimación', 'Estimation'),
  c('discussão', 'discussion', 'discusión', 'discussion'),
  // H2 — login error toasts (rendered in react-hot-toast portal, must resolve via t())
  c('Bem-vindo de volta', 'Welcome back', 'Bienvenido de vuelta', 'Bon retour'),
  // Note: 'Olá' and 'Falha ao entrar' tuples are at line ~1164 / earlier sections;
  // not duplicated here (audit M-N6 / M-N7 dedup pass).
  c('Email ou senha incorretos', 'Wrong email or password', 'Correo o contraseña incorrectos', 'Email ou mot de passe incorrects'),
  c('Muitas tentativas. Tente novamente em {n} min.', 'Too many attempts. Try again in {n} min.', 'Demasiados intentos. Inténtalo de nuevo en {n} min.', "Trop d'essais. Réessayez dans {n} min."),
  c('Muitas tentativas. Aguarde um momento.', 'Too many attempts. Please wait a moment.', 'Demasiados intentos. Espera un momento.', "Trop d'essais. Veuillez patienter."),
  c('Nenhuma credencial do Google recebida', 'No Google credential received', 'No se recibió credencial de Google', "Aucune information d'identification Google reçue"),
  // Audit round 2 — H10 form label leaks. Disclaimer is split around a <strong>
  // Transparência</strong> tag, so the runtime walks each text-node fragment
  // independently and the full sentence never matches as one chunk. Provide
  // tuples for the two surrounding fragments — the middle word is already
  // covered by the existing 'Transparência' phrase.
  c('Valor', 'Amount', 'Importe', 'Montant'),
  c('Custo estimado (opcional)', 'Estimated cost (optional)', 'Costo estimado (opcional)', 'Coût estimé (facultatif)'),
  c('Tudo que você lançar aqui aparece automaticamente na', 'Anything you log here shows up automatically in', 'Todo lo que registres aquí aparece automáticamente en la', 'Tout ce que vous enregistrez ici apparaît automatiquement dans la'),
  c('dos moradores.', 'for residents.', 'para residentes.', 'des résidents.'),
  c('Valor inválido — use números (ex: 1500 ou 1500,00)', 'Invalid amount — use numbers (e.g. 1500 or 1500.00)', 'Importe inválido — usa números (ej. 1500 o 1500,00)', 'Montant invalide — utilisez des chiffres (ex. 1500 ou 1500,00)'),
  c('Despesa registrada — visível para os moradores', 'Expense logged — visible to residents', 'Gasto registrado — visible para residentes', 'Dépense enregistrée — visible pour les résidents'),
  c('Falha ao registrar', 'Failed to log', 'Error al registrar', "Échec de l'enregistrement"),
  // H3 — confirmation prompt before location detection overrides a manual choice
  c('Substituir sua escolha manual pela detecção de localização?', 'Replace your manual choice with location detection?', '¿Reemplazar tu elección manual por la detección de ubicación?', 'Remplacer votre choix manuel par la détection de la localisation ?'),
  // Audit H-N4 — /app/announcements footer + badge labels were hardcoded EN
  c('Postado por', 'Posted by', 'Publicado por', 'Publié par'),
  c('Fixado', 'Pinned', 'Fijado', 'Épinglé'),
  c('Resumo de reunião pela IA', 'AI meeting recap', 'Resumen de reunión por IA', 'Résumé de réunion par IA'),
  c('Decisão pela IA', 'AI decision', 'Decisión por IA', 'Décision par IA'),
  // Audit H-N5 — visitor type badges (TYPE_LABEL) — PT singular forms
  c('visita', 'visit', 'visita', 'visite'),
  c('entrega', 'delivery', 'entrega', 'livraison'),
  c('serviço', 'service', 'servicio', 'service'),
  // Audit M-N5 — sidebar ⌖ button title/aria-label
  c('Detect language from location', 'Detect language from location', 'Detectar idioma por ubicación', 'Détecter la langue par la localisation'),
  c('Using location-detected language', 'Using location-detected language', 'Usando idioma detectado por ubicación', 'Langue détectée par la localisation'),
  // Audit H-N7 — /board/residents has many JSX literals not in `phrases`.
  // Add tuples so the MutationObserver runtime can translate them at render.
  c('Importar CSV', 'Import CSV', 'Importar CSV', 'Importer CSV'),
  c('Compartilhe este código com quem precisa entrar no prédio. Eles acessam', 'Share this code with anyone who needs to access the building. They go to', 'Comparte este código con quien necesite entrar al edificio. Acceden a', "Partagez ce code avec qui doit entrer dans l'immeuble. Ils accèdent à"),
  c('digitam, e escolhem a unidade.', 'enter it, and pick their unit.', 'lo escriben y eligen su unidad.', "le saisissent, et choisissent leur lot."),
  c('Importar lista de moradores', 'Import resident list', 'Importar lista de residentes', 'Importer la liste des résidents'),
  c('Cole um CSV abaixo. Colunas:', 'Paste a CSV below. Columns:', 'Pega un CSV abajo. Columnas:', 'Collez un CSV ci-dessous. Colonnes :'),
  c('Quando o morador entrar com esse email, ele é vinculado automaticamente à unidade — sem aprovação manual.', 'When the resident signs in with this email they are automatically linked to the unit — no manual approval.', 'Cuando el residente entre con este email queda vinculado automáticamente a la unidad — sin aprobación manual.', "Quand le résident se connectera avec cet email, il sera automatiquement rattaché au lot — sans approbation manuelle."),
  c('Enviar email de convite para cada morador agora.', 'Send an invite email to each resident now.', 'Enviar un email de invitación a cada residente ahora.', "Envoyer un email d'invitation à chaque résident maintenant."),
  c('Precisa das envs do Resend. Os convites são criados mesmo sem email configurado.', 'Requires Resend env vars. Invites are created even without email configured.', 'Requiere las envs de Resend. Las invitaciones se crean aunque no haya email configurado.', "Nécessite les env Resend. Les invitations sont créées même sans email configuré."),
  c('Linhas com problema', 'Lines with problems', 'Líneas con problemas', 'Lignes avec problèmes'),
  c('Criar e enviar convites', 'Create and send invites', 'Crear y enviar invitaciones', 'Créer et envoyer les invitations'),
  c('Criar convites', 'Create invites', 'Crear invitaciones', 'Créer les invitations'),
  c('Convites pendentes', 'Pending invites', 'Invitaciones pendientes', 'Invitations en attente'),
  c('principal', 'primary', 'principal', 'principal'),
  c('Unidade', 'Unit', 'Unidad', 'Lot'),
  c('Copiado', 'Copied', 'Copiado', 'Copié'),
  c('Copiar', 'Copy', 'Copiar', 'Copier'),
  // Audit H-N7 supporting: amenity name fragments shown verbatim in EN
  c('Padel Court', 'Padel Court', 'Pista de pádel', 'Terrain de padel'),
  c('Football Field', 'Football Field', 'Cancha de fútbol', 'Terrain de football'),
  c('Basketball Court', 'Basketball Court', 'Cancha de básquet', 'Terrain de basket'),
  c('Tennis Court', 'Tennis Court', 'Pista de tenis', 'Court de tennis'),
  c('Party Room', 'Party Room', 'Salón de fiestas', 'Salle de réception'),
  c('BBQ Grill', 'BBQ Grill', 'Parrilla', 'Barbecue'),
  c('Fitness Center', 'Fitness Center', 'Gimnasio', 'Salle de sport'),
  c('Rooftop Pool', 'Rooftop Pool', 'Piscina en azotea', 'Piscine sur le toit'),
  c('Heated, with sun deck', 'Heated, with sun deck', 'Climatizada, con solárium', 'Chauffée, avec solarium'),
  c('Full cardio + weights', 'Full cardio + weights', 'Cardio + pesas completos', 'Cardio + musculation complets'),
  c('Rooftop grill station', 'Rooftop grill station', 'Parrilla en azotea', 'Station barbecue sur le toit'),
  c('Lounge, kitchen, seats 40', 'Lounge, kitchen, seats 40', 'Salón, cocina, 40 plazas', 'Salon, cuisine, 40 places'),
];

function c(pt: string, en: string, es: string, fr: string): Copy {
  return { 'pt-BR': pt, 'en-US': en, 'es-ES': es, 'fr-FR': fr };
}

const indexes: Record<AppLocale, Map<string, string>> = {
  'pt-BR': new Map(),
  'en-US': new Map(),
  'es-ES': new Map(),
  'fr-FR': new Map(),
};

for (const entry of phrases) {
  for (const target of Object.keys(indexes) as AppLocale[]) {
    for (const source of Object.values(entry)) {
      const key = normalize(source);
      if (!indexes[target].has(key)) indexes[target].set(key, entry[target]);
    }
  }
}

function translateText(value: string, locale: AppLocale): string {
  if (!/[A-Za-zÀ-ÿ]/.test(value)) return value;
  const leading = value.match(/^\s*/)?.[0] || '';
  const trailing = value.match(/\s*$/)?.[0] || '';
  const body = normalize(value);
  const exact = indexes[locale].get(body);
  if (exact) return `${leading}${exact}${trailing}`;
  // Try comma/punctuation-stripped match, e.g. "Bem-vindo de volta," → key "Bem-vindo de volta"
  const stripped = body.replace(/[\s,.;:!?]+$/, '').trim();
  if (stripped !== body) {
    const exact2 = indexes[locale].get(stripped);
    if (exact2) {
      const tail = body.slice(stripped.length);
      return `${leading}${exact2}${tail}${trailing}`;
    }
  }
  return translatePatterns(value, locale);
}

// Pattern-based replacements for dynamic strings (template literals).
// Each pattern matches a PT prefix/suffix and rewrites it in the target locale.
// `replace` receives the full match as the first arg and capture groups (1-indexed) afterward.
type Pattern = { match: RegExp; replace: (locale: AppLocale, match: string, ...groups: string[]) => string };
const dynamicPatterns: Pattern[] = [
  // "Bem-vindo de volta, X." → "Welcome back, X."
  {
    match: /^Bem-vindo de volta,\s*/u,
    replace: (locale) => `${pickWord(locale, ['Bem-vindo de volta', 'Welcome back', 'Bienvenido de vuelta', 'Bon retour'])}, `,
  },
  // "Bem-vinda de volta, X."
  {
    match: /^Bem-vinda de volta,\s*/u,
    replace: (locale) => `${pickWord(locale, ['Bem-vinda de volta', 'Welcome back', 'Bienvenida de vuelta', 'Bon retour'])}, `,
  },
  // "Tudo que precisa da sua atenção no X."
  {
    match: /^Tudo que precisa da sua atenção no\s+/u,
    replace: (locale) => `${pickWord(locale, [
      'Tudo que precisa da sua atenção no',
      'Everything that needs your attention at',
      'Todo lo que necesita tu atención en',
      'Tout ce qui demande votre attention à',
    ])} `,
  },
  // "Tudo que precisa da sua atenção." (standalone)
  {
    match: /^Tudo que precisa da sua atenção\.?$/u,
    replace: (locale) => pickWord(locale, [
      'Tudo que precisa da sua atenção.',
      'Everything that needs your attention.',
      'Todo lo que necesita tu atención.',
      'Tout ce qui demande votre attention.',
    ]),
  },
  // "X · Portaria" → "X · Front desk"
  {
    match: /\s·\s*Portaria$/u,
    replace: (locale) => ` · ${pickWord(locale, ['Portaria', 'Front desk', 'Portería', 'Conciergerie'])}`,
  },
  // Unit/floor labels with a trailing number when present in the same text node.
  // Also covers JSX-split cases where "(Unidade " is a separate text node from {var}.
  {
    match: /\bUnidade\b/gu,
    replace: (locale) => pickWord(locale, ['Unidade', 'Unit', 'Unidad', 'Lot']),
  },
  {
    match: /\bUnidades\b/gu,
    replace: (locale) => pickWord(locale, ['Unidades', 'Units', 'Unidades', 'Lots']),
  },
  {
    match: /\bunidades\b/gu,
    replace: (locale) => pickWord(locale, ['unidades', 'units', 'unidades', 'lots']),
  },
  {
    match: /\bApto\b/gu,
    replace: (locale) => pickWord(locale, ['Apto', 'Unit', 'Unidad', 'Lot']),
  },
  {
    match: /\bAndar\b/gu,
    replace: (locale) => pickWord(locale, ['Andar', 'Floor', 'Piso', 'Étage']),
  },
  // "Reunião X" e.g. "Reunião do síndico"
  {
    match: /\bReunião\b/gu,
    replace: (locale) => pickWord(locale, ['Reunião', 'Meeting', 'Reunión', 'Réunion']),
  },
  {
    match: /\breunião\b/gu,
    replace: (locale) => pickWord(locale, ['reunião', 'meeting', 'reunión', 'réunion']),
  },
  // "Síndico" / "síndico"
  {
    match: /\bSíndico\b/gu,
    replace: (locale) => pickWord(locale, ['Síndico', 'Board admin', 'Administrador', 'Syndic']),
  },
  {
    match: /\bsíndico\b/gu,
    replace: (locale) => pickWord(locale, ['síndico', 'board admin', 'administrador', 'syndic']),
  },
  // "Moradores" / "moradores"
  {
    match: /\bMoradores\b/gu,
    replace: (locale) => pickWord(locale, ['Moradores', 'Residents', 'Residentes', 'Résidents']),
  },
  {
    match: /\bmoradores\b/gu,
    replace: (locale) => pickWord(locale, ['moradores', 'residents', 'residentes', 'résidents']),
  },
  // "Visitante" / "visitante"
  {
    match: /\bVisitante\b/gu,
    replace: (locale) => pickWord(locale, ['Visitante', 'Visitor', 'Visitante', 'Visiteur']),
  },
  // "Orçamento"
  {
    match: /\bOrçamento\b/gu,
    replace: (locale) => pickWord(locale, ['Orçamento', 'Budget', 'Presupuesto', 'Budget']),
  },
  // "Votação" / "votação"
  {
    match: /\bVotação\b/gu,
    replace: (locale) => pickWord(locale, ['Votação', 'Voting', 'Votación', 'Vote']),
  },
  {
    match: /\bvotação\b/gu,
    replace: (locale) => pickWord(locale, ['votação', 'voting', 'votación', 'vote']),
  },
  // "Próximas" / "Próximos"
  {
    match: /\bPróximas\b/gu,
    replace: (locale) => pickWord(locale, ['Próximas', 'Upcoming', 'Próximas', 'À venir']),
  },
  {
    match: /\bPróximos\b/gu,
    replace: (locale) => pickWord(locale, ['Próximos', 'Upcoming', 'Próximos', 'À venir']),
  },
  // "Histórico"
  {
    match: /\bHistórico\b/gu,
    replace: (locale) => pickWord(locale, ['Histórico', 'History', 'Historial', 'Historique']),
  },
  // "Edifício"
  {
    match: /\bEdifício\b/gu,
    replace: (locale) => pickWord(locale, ['Edifício', 'Building', 'Edificio', 'Immeuble']),
  },
  // "Chegou em " — prefix before a formatted date (template literal split)
  {
    match: /\bChegou em\s/gu,
    replace: (locale) => `${pickWord(locale, ['Chegou em', 'Arrived on', 'Llegó el', 'Arrivé le'])} `,
  },
  // " · chegou " — lowercase variant from concierge package list (template split)
  {
    match: /\bchegou\b/gu,
    replace: (locale) => pickWord(locale, ['chegou', 'arrived', 'llegó', 'arrivé']),
  },
  // Lowercase "quórum" in marketing/landing copy
  {
    match: /\bquórum\b/gu,
    replace: (locale) => pickWord(locale, ['quórum', 'quorum', 'quórum', 'quorum']),
  },
  // "Proposto por" — prefix before a name
  {
    match: /\bProposto por\s/gu,
    replace: (locale) => `${pickWord(locale, ['Proposto por', 'Proposed by', 'Propuesto por', 'Proposé par'])} `,
  },
  // "Quórum" / "Quorum"
  {
    match: /\bQuórum\b/gu,
    replace: (locale) => pickWord(locale, ['Quórum', 'Quorum', 'Quórum', 'Quorum']),
  },
  // "Procuração" / "Procurações"
  {
    match: /\bProcurações\b/gu,
    replace: (locale) => pickWord(locale, ['Procurações', 'Proxies', 'Poderes', 'Procurations']),
  },
  {
    match: /\bProcuração\b/gu,
    replace: (locale) => pickWord(locale, ['Procuração', 'Proxy', 'Poder', 'Procuration']),
  },
  // "Proprietários" / "Proprietária"
  {
    match: /\bProprietários\b/gu,
    replace: (locale) => pickWord(locale, ['Proprietários', 'Owners', 'Propietarios', 'Propriétaires']),
  },
  {
    match: /\bproprietários\b/gu,
    replace: (locale) => pickWord(locale, ['proprietários', 'owners', 'propietarios', 'propriétaires']),
  },
  // "Inadimplente"
  {
    match: /\bInadimplente\b/gu,
    replace: (locale) => pickWord(locale, ['Inadimplente', 'In arrears', 'En mora', 'En arriérés']),
  },
];

function pickWord(locale: AppLocale, [pt, en, es, fr]: [string, string, string, string]) {
  return ({ 'pt-BR': pt, 'en-US': en, 'es-ES': es, 'fr-FR': fr } as const)[locale];
}

function translatePatterns(value: string, locale: AppLocale): string {
  const unit = unitLabel(locale);
  const floor = word(locale, 'Floor');
  const due = word(locale, 'due');
  let result = value
    .replace(/\bUnit ([A-Za-z0-9-]+)/g, `${unit} $1`)
    .replace(/\bFloor ([0-9]+)/g, `${floor} $1`)
    .replace(/\bdue /gi, `${due} `)
    .replace(/\bYes\b/g, word(locale, 'Yes'))
    .replace(/\bAbstain\b/g, word(locale, 'Abstain'));

  for (const p of dynamicPatterns) {
    result = result.replace(p.match, (...args: unknown[]) => {
      // String.replace passes: (match, p1, p2, ..., offset, string [, groups]).
      // We want match + capture groups only.
      const stringArgs = args.filter((a) => typeof a === 'string') as string[];
      // Last string arg is the full input; drop it.
      const captures = stringArgs.slice(0, -1);
      const [match, ...groups] = captures;
      return p.replace(locale, match, ...groups);
    });
  }
  return result;
}

// Synchronous translate helper — usable from toasts, alerts, and template literals.
export function t(key: string, locale?: AppLocale): string {
  const target = locale || detectLocale();
  return translateText(key, target);
}

function word(locale: AppLocale, key: string) {
  const map: Record<string, Copy> = {
    Floor: c('Andar', 'Floor', 'Piso', 'Étage'),
    due: c('vence', 'due', 'vence', 'échéance'),
    Yes: c('Sim', 'Yes', 'Sí', 'Oui'),
    No: c('Não', 'No', 'No', 'Non'),
    Abstain: c('Abstenção', 'Abstain', 'Abstención', 'Abstention'),
  };
  return map[key]?.[locale] || key;
}

function unitLabel(locale: AppLocale) {
  return ({ 'pt-BR': 'Apto', 'en-US': 'Unit', 'es-ES': 'Unidad', 'fr-FR': 'Lot' } as const)[locale];
}

// Locale-aware "{count} <noun>" formatting. The runtime cannot fix
// English-only `${n===1?'':'s'}` patterns sprinkled across components, so
// callsites must pick singular vs plural explicitly. Each form is then
// translated through the phrase index. Use as:
//   pluralize(count, 'unidade', 'unidades')  →  "1 unit" / "5 units"
export function pluralize(count: number, ptSingular: string, ptPlural: string): string {
  const locale = detectLocale();
  const rule = new Intl.PluralRules(locale).select(count);
  const key = rule === 'one' ? ptSingular : ptPlural;
  // Note: translateText is module-scoped below; call site is fine because the
  // function is hoisted.
  return `${count} ${translateText(key, locale)}`;
}

function shouldSkip(node: Node) {
  const parent = node.parentElement;
  if (!parent) return true;
  return !!parent.closest('script,style,textarea,code,pre,[data-i18n-skip]');
}

function translateElement(root: ParentNode, locale: AppLocale) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
      if (!node.textContent || !/[A-Za-zÀ-ÿ]/.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const next = translateText(node.textContent || '', locale);
    if (next !== node.textContent) node.textContent = next;
  }

  const attrNames = ['placeholder', 'aria-label', 'title', 'alt'];
  for (const el of Array.from(root.querySelectorAll?.('[placeholder],[aria-label],[title],[alt]') || [])) {
    if ((el as HTMLElement).closest('[data-i18n-skip]')) continue;
    for (const attr of attrNames) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const next = translateText(value, locale);
      if (next !== value) el.setAttribute(attr, next);
    }
  }
}

type LocaleContextValue = {
  locale: AppLocale;
  source: 'manual' | 'location';
  setLocale: (locale: AppLocale) => void;
  useLocationLocale: () => Promise<void>;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'pt-BR',
  source: 'location',
  setLocale: () => {},
  useLocationLocale: async () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => detectLocale());
  const [source, setSource] = useState<'manual' | 'location'>(() => (
    readLocaleSource() === 'manual' || readManualLocale() ? 'manual' : 'location'
  ));

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    source,
    setLocale(next) {
      localStorage.setItem(STORAGE_KEY, next);
      localStorage.setItem(LOCATION_STORAGE_KEY, 'manual');
      setSource('manual');
      setLocaleState(next);
      window.location.reload();
    },
    async useLocationLocale() {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(LOCATION_STORAGE_KEY, 'location');
      setSource('location');
      const next = await detectPreciseLocationLocale();
      localStorage.setItem(STORAGE_KEY, next);
      setLocaleState(next);
      window.location.reload();
    },
  }), [locale, source]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = 'ltr';
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function TranslationRuntime() {
  const { locale } = useLocale();

  useEffect(() => {
    let queued = false;
    const run = () => {
      queued = false;
      translateElement(document.body, locale);
    };
    const queue = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(run);
    };

    queue();
    const observer = new MutationObserver(queue);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'aria-label', 'title', 'alt'],
    });
    return () => observer.disconnect();
  }, [locale]);

  return null;
}

export function currentIntlLocale(): AppLocale {
  return detectLocale();
}

export function formatDate(value: string | number | Date) {
  return new Date(value).toLocaleDateString(currentIntlLocale());
}

export function formatDateTime(value: string | number | Date) {
  // Audit M-N4 — default toLocaleString output included seconds ("16:00:00"),
  // which read as machine-y on visitor schedules. Pin to short date + short
  // time so every locale shows e.g. "10/05/2026, 16:00" / "5/10/2026, 4:00 PM".
  return new Date(value).toLocaleString(currentIntlLocale(), {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatCurrency(value: number, currency = 'BRL') {
  // Audit M-N3 — Intl.NumberFormat for BRL renders different things per
  // locale: pt-BR -> "R$ 1.500", en-US -> "BRL 1,500", es-ES -> "1500 BRL",
  // fr-FR -> "1 500 R$". Pin currencyDisplay to 'narrowSymbol' so every
  // locale shows the actual symbol ("R$") rather than the ISO code, and
  // the demo reads consistently for non-PT users.
  return new Intl.NumberFormat(currentIntlLocale(), {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(value);
}

export function LanguageSwitcher() {
  const { locale, source, setLocale, useLocationLocale } = useLocale();
  const location = useLocation();
  const [detecting, setDetecting] = useState(false);
  const active = LOCALE_OPTIONS.find((option) => option.locale === locale);
  const appSurface = location.pathname.startsWith('/app') || location.pathname.startsWith('/board') || location.pathname.startsWith('/concierge');

  // On app/board/concierge surfaces the sidebar owns the language switcher.
  if (appSurface) return null;

  const handleLocation = async () => {
    setDetecting(true);
    try {
      await useLocationLocale();
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div
      className="fixed top-4 right-4 z-[80] flex flex-row items-center gap-1.5 rounded-3xl border border-white/60 bg-cream-50/85 p-1.5 text-xs font-semibold text-dusk-400 shadow-clay backdrop-blur-xl sm:bottom-4 sm:right-4 sm:top-auto sm:gap-2 sm:p-2"
      aria-label="Language controls"
    >
      <label className="flex items-center gap-1.5 rounded-full bg-white/45 px-2 py-1 sm:gap-2 sm:px-3 sm:py-2">
        <span className="hidden text-[11px] uppercase tracking-[0.14em] text-dusk-300 sm:inline">Language</span>
        <span aria-hidden className="rounded-full bg-dusk-500 px-1.5 py-0.5 text-[10px] text-cream-50 sm:px-2 sm:text-[11px]">
          {active?.short}
        </span>
        <select
          className="bg-transparent text-xs outline-none"
          value={locale}
          onChange={(e) => setLocale(e.target.value as AppLocale)}
          aria-label="Language"
        >
          {LOCALE_OPTIONS.map((option) => (
            <option key={option.locale} value={option.locale}>{option.label}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="rounded-full border border-dusk-200/20 bg-sage-200/70 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-sage-900 transition hover:bg-sage-300 disabled:cursor-wait disabled:opacity-70 sm:px-3 sm:py-2 sm:text-[11px]"
        onClick={handleLocation}
        disabled={detecting}
        aria-label={detecting ? 'Detecting location...' : source === 'manual' ? 'Use location' : 'Using location'}
      >
        <span className="hidden sm:inline">
          {detecting ? 'Detecting location...' : source === 'manual' ? 'Use location' : 'Using location'}
        </span>
        <span className="sm:hidden">{detecting ? '…' : '⌖'}</span>
      </button>
    </div>
  );
}

export function SidebarLangSwitcher() {
  const { locale, source, setLocale, useLocationLocale } = useLocale();
  const [detecting, setDetecting] = useState(false);

  const handleLocation = async () => {
    setDetecting(true);
    try {
      await useLocationLocale();
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 pt-1" data-i18n-skip>
      <div className="flex gap-1.5 flex-wrap items-center">
        {LOCALE_OPTIONS.map((opt) => (
          <button
            key={opt.locale}
            type="button"
            onClick={() => locale !== opt.locale && setLocale(opt.locale)}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all ${
              locale === opt.locale
                ? 'bg-white/70 text-dusk-500 shadow-clay-sm border border-white/80'
                : 'text-dusk-300 hover:bg-white/40 hover:text-dusk-500'
            }`}
            aria-label={opt.label}
            aria-pressed={locale === opt.locale}
          >
            {opt.short}
          </button>
        ))}
        {/* Visual separator: the ⌖ button is a different action (location-
            based detection) and shouldn't read as a 5th language pill. */}
        <span aria-hidden className="mx-0.5 h-4 w-px bg-dusk-200/40" />
        <button
          type="button"
          onClick={handleLocation}
          disabled={detecting}
          title={source === 'manual' ? 'Detect language from location' : 'Using location-detected language'}
          aria-label={source === 'manual' ? 'Detect language from location' : 'Using location-detected language'}
          className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all disabled:cursor-wait disabled:opacity-60 ${
            source === 'location'
              ? 'bg-sage-200/80 text-sage-900 border border-sage-300/40'
              : 'text-dusk-300 hover:bg-white/40 hover:text-dusk-500'
          }`}
        >
          {detecting ? '…' : '⌖'}
        </button>
      </div>
    </div>
  );
}
