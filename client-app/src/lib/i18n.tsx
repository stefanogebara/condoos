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
  return locationLocale() || browserLocale();
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
  c('Falha ao entrar', 'Sign in failed', 'Error al entrar', 'Échec de la connexion'),
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
  c('Resident approved', 'Resident approved', 'Residente aprobado', 'Résident approuvé'),
  c('Request denied', 'Request denied', 'Solicitud rechazada', 'Demande refusée'),
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
  c('Continue', 'Continue', 'Continuar', 'Continuer'),
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
  return translatePatterns(value, locale);
}

function translatePatterns(value: string, locale: AppLocale): string {
  const unit = unitLabel(locale);
  const floor = word(locale, 'Floor');
  const due = word(locale, 'due');
  return value
    .replace(/\bUnit ([A-Za-z0-9-]+)/g, `${unit} $1`)
    .replace(/\bApto ([A-Za-z0-9-]+)/g, `${unit} $1`)
    .replace(/\bFloor ([0-9]+)/g, `${floor} $1`)
    .replace(/\bdue /gi, `${due} `)
    .replace(/\bYes\b/g, word(locale, 'Yes'))
    .replace(/\bNo\b/g, word(locale, 'No'))
    .replace(/\bAbstain\b/g, word(locale, 'Abstain'));
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
  return new Date(value).toLocaleString(currentIntlLocale());
}

export function formatCurrency(value: number, currency = 'BRL') {
  return new Intl.NumberFormat(currentIntlLocale(), {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function LanguageSwitcher() {
  const { locale, source, setLocale, useLocationLocale } = useLocale();
  const location = useLocation();
  const [detecting, setDetecting] = useState(false);
  const active = LOCALE_OPTIONS.find((option) => option.locale === locale);
  const appSurface = location.pathname.startsWith('/app') || location.pathname.startsWith('/board');

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
      className={`${appSurface ? 'hidden sm:flex' : 'flex'} fixed left-1/2 top-16 z-[80] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-row flex-wrap items-center gap-2 rounded-3xl border border-white/60 bg-cream-50/85 p-2 text-xs font-semibold text-dusk-400 shadow-clay backdrop-blur-xl sm:bottom-4 sm:left-auto sm:right-4 sm:top-auto sm:translate-x-0`}
      aria-label="Language controls"
    >
      <label className="flex items-center gap-2 rounded-full bg-white/45 px-3 py-2">
        <span className="hidden text-[11px] uppercase tracking-[0.14em] text-dusk-300 sm:inline">Language</span>
        <span aria-hidden className="rounded-full bg-dusk-500 px-2 py-0.5 text-[11px] text-cream-50">
          {active?.short}
        </span>
        <select
          className="max-w-24 bg-transparent text-xs outline-none sm:max-w-none"
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
        className="rounded-full border border-dusk-200/20 bg-sage-200/70 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-sage-900 transition hover:bg-sage-300 disabled:cursor-wait disabled:opacity-70"
        onClick={handleLocation}
        disabled={detecting}
        aria-label={source === 'manual' ? 'Use location' : 'Using location'}
      >
        <span className="hidden sm:inline">
          {detecting ? 'Detecting location...' : source === 'manual' ? 'Use location' : 'Using location'}
        </span>
        <span className="sm:hidden">{detecting ? '...' : 'Auto'}</span>
      </button>
    </div>
  );
}
