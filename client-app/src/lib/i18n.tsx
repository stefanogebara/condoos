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
      <div className="flex gap-1.5 flex-wrap">
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
        <button
          type="button"
          onClick={handleLocation}
          disabled={detecting}
          title={source === 'manual' ? 'Use location' : 'Using location'}
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
