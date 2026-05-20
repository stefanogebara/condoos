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
  c('Recolher menu', 'Collapse menu', 'Contraer menú', 'Réduire le menu'),
  c('Expandir menu', 'Expand menu', 'Expandir menú', 'Déplier le menu'),
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
  c('Documentos', 'Documents', 'Documentos', 'Documents'),
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

  // Document vault
  c('Regulamento', 'Rules', 'Reglamento', 'Règlement'),
  c('Atas e reuniões', 'Minutes and meetings', 'Actas y reuniones', 'Procès-verbaux et réunions'),
  c('Contratos', 'Contracts', 'Contratos', 'Contrats'),
  c('Garantias', 'Warranties', 'Garantías', 'Garanties'),
  c('Recibos', 'Receipts', 'Recibos', 'Reçus'),
  c('Fornecedores', 'Vendors', 'Proveedores', 'Prestataires'),
  c('Avisos formais', 'Formal notices', 'Avisos formales', 'Avis formels'),
  c('Apenas administração', 'Admin only', 'Solo administración', 'Administration uniquement'),
  c('Visível para moradores', 'Visible to residents', 'Visible para residentes', 'Visible pour les résidents'),
  c('publicado', 'published', 'publicado', 'publié'),
  c('publicados', 'published', 'publicados', 'publiés'),
  c('interno', 'internal', 'interno', 'interne'),
  c('internos', 'internal', 'internos', 'internes'),
  c('Novo documento', 'New document', 'Nuevo documento', 'Nouveau document'),
  c('Cofre de documentos do prédio', 'Building document vault', 'Bóveda de documentos del edificio', 'Coffre documentaire de l’immeuble'),
  c('Publique regras, atas, contratos, seguros, garantias, recibos e documentos de fornecedores em um lugar só.', 'Publish rules, minutes, contracts, insurance, warranties, receipts, and vendor documents in one place.', 'Publica reglas, actas, contratos, seguros, garantías, recibos y documentos de proveedores en un solo lugar.', 'Publiez règlements, procès-verbaux, contrats, assurances, garanties, reçus et documents prestataires au même endroit.'),
  c('Filtros de documentos', 'Document filters', 'Filtros de documentos', 'Filtres de documents'),
  c('Todos', 'All', 'Todos', 'Tous'),
  c('Nenhum documento encontrado.', 'No documents found.', 'No se encontró ningún documento.', 'Aucun document trouvé.'),
  c('Adicione o primeiro documento para que moradores e administração encontrem tudo sem pedir no grupo.', 'Add the first document so residents and admins can find everything without asking in the chat.', 'Agrega el primer documento para que residentes y administración encuentren todo sin pedirlo en el chat.', 'Ajoutez le premier document pour que résidents et administration trouvent tout sans le demander dans le groupe.'),
  c('Arquivar documento', 'Archive document', 'Archivar documento', 'Archiver le document'),
  c('Documento arquivado', 'Document archived', 'Documento archivado', 'Document archivé'),
  c('Falha ao arquivar documento', 'Could not archive document', 'No se pudo archivar el documento', 'Impossible d’archiver le document'),
  c('Editar documento', 'Edit document', 'Editar documento', 'Modifier le document'),
  c('arquivado', 'archived', 'archivado', 'archivé'),
  c('Enviado por', 'Uploaded by', 'Subido por', 'Envoyé par'),
  c('abrir documento', 'open document', 'abrir documento', 'ouvrir le document'),
  c('Data do documento', 'Document date', 'Fecha del documento', 'Date du document'),
  c('Visibilidade', 'Visibility', 'Visibilidad', 'Visibilité'),
  c('Arquivo do documento', 'Document file', 'Archivo del documento', 'Fichier du document'),
  c('Selecionado:', 'Selected:', 'Seleccionado:', 'Sélectionné :'),
  c('Arquivo já armazenado no CondoOS.', 'File already stored in CondoOS.', 'Archivo ya almacenado en CondoOS.', 'Fichier déjà stocké dans CondoOS.'),
  c('Envie um PDF, imagem ou documento, ou cole um link seguro abaixo.', 'Upload a PDF, image, or document, or paste a secure link below.', 'Sube un PDF, imagen o documento, o pega un enlace seguro abajo.', 'Téléversez un PDF, une image ou un document, ou collez un lien sécurisé ci-dessous.'),
  c('Link seguro (https://)', 'Secure link (https://)', 'Enlace seguro (https://)', 'Lien sécurisé (https://)'),
  c('Documento ativo', 'Active document', 'Documento activo', 'Document actif'),
  c('Informe o título do documento.', 'Enter the document title.', 'Ingresa el título del documento.', 'Saisissez le titre du document.'),
  c('Use um link seguro começando com https://.', 'Use a secure link starting with https://.', 'Usa un enlace seguro que empiece con https://.', 'Utilisez un lien sécurisé commençant par https://.'),
  c('Envie um arquivo ou use um link seguro começando com https://.', 'Upload a file or use a secure link starting with https://.', 'Sube un archivo o usa un enlace seguro que empiece con https://.', 'Téléversez un fichier ou utilisez un lien sécurisé commençant par https://.'),
  c('Documento publicado', 'Document published', 'Documento publicado', 'Document publié'),
  c('Documento atualizado', 'Document updated', 'Documento actualizado', 'Document mis à jour'),
  c('Falha ao salvar documento', 'Could not save document', 'No se pudo guardar el documento', 'Impossible d’enregistrer le document'),
  c('Regras, atas, contratos, seguros, garantias e avisos importantes publicados pela administração.', 'Rules, minutes, contracts, insurance, warranties, and important notices published by admins.', 'Reglas, actas, contratos, seguros, garantías y avisos importantes publicados por la administración.', 'Règles, procès-verbaux, contrats, assurances, garanties et avis importants publiés par l’administration.'),
  c('Nenhum documento publicado ainda.', 'No documents published yet.', 'Aún no hay documentos publicados.', 'Aucun document publié pour le moment.'),
  c('Quando a administração publicar documentos do prédio, eles aparecem aqui para consulta rápida.', 'When admins publish building documents, they appear here for quick reference.', 'Cuando la administración publique documentos del edificio, aparecerán aquí para consulta rápida.', 'Lorsque l’administration publie des documents de l’immeuble, ils apparaissent ici pour consultation rapide.'),
  c('Não encontrou o documento que precisa? Peça para a administração publicar no cofre.', 'Can’t find the document you need? Ask admins to publish it in the vault.', '¿No encuentras el documento que necesitas? Pide a la administración que lo publique en la bóveda.', 'Vous ne trouvez pas le document nécessaire ? Demandez à l’administration de le publier dans le coffre.'),

  // Login
  c('Sou síndico', 'I am the board admin', 'Soy administrador', 'Je suis syndic'),
  c('Tenho um código', 'I have a code', 'Tengo un código', 'J’ai un code'),
  c('Vamos montar seu prédio', 'Let’s set up your building', 'Vamos a configurar tu edificio', 'Configurons votre immeuble'),
  c('Entre com o Google e em poucos cliques seu condomínio está no ar — com código de convite pronto pros moradores.', 'Sign in with Google and your condo is live in a few clicks — with an invite code ready for residents.', 'Entra con Google y tu condominio estará listo en pocos clics, con código de invitación para residentes.', 'Connectez-vous avec Google et votre copropriété est prête en quelques clics, avec un code d’invitation pour les résidents.'),
  c('Acesso privado aprovado', 'Approved private access', 'Acceso privado aprobado', 'Accès privé approuvé'),
  c('Ative seu prédio aprovado', 'Activate your approved building', 'Activa tu edificio aprobado', 'Activez votre immeuble approuvé'),
  c('Entre com Google ou email. Depois use o código privado enviado pela equipe CONDOS para ativar o prédio.', 'Sign in with Google or email. Then use the private code sent by the CONDOS team to activate the building.', 'Entra con Google o email. Luego usa el código privado enviado por el equipo de CONDOS para activar el edificio.', 'Connectez-vous avec Google ou e-mail. Utilisez ensuite le code privé envoyé par l’équipe CONDOS pour activer l’immeuble.'),
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
  c('Email confirmado. Entre para continuar.', 'Email confirmed. Sign in to continue.', 'Email confirmado. Inicia sesión para continuar.', 'E-mail confirmé. Connectez-vous pour continuer.'),
  c('Link expirado. Entre e solicite um novo email de confirmação.', 'Link expired. Sign in and request a new confirmation email.', 'El enlace expiró. Inicia sesión y solicita un nuevo email de confirmación.', 'Lien expiré. Connectez-vous et demandez un nouvel e-mail de confirmation.'),
  c('Link de confirmação inválido ou já usado.', 'Confirmation link is invalid or already used.', 'El enlace de confirmación no es válido o ya fue usado.', 'Le lien de confirmation est invalide ou déjà utilisé.'),
  c('Conta criada. Confirme seu email para criar o prédio.', 'Account created. Confirm your email to create the building.', 'Cuenta creada. Confirma tu email para crear el edificio.', 'Compte créé. Confirmez votre e-mail pour créer l’immeuble.'),
  c('Confirme seu email para criar um prédio', 'Confirm your email to create a building', 'Confirma tu email para crear un edificio', 'Confirmez votre e-mail pour créer un immeuble'),
  c('Enviaremos um link para', 'We will send a link to', 'Enviaremos un enlace a', 'Nous enverrons un lien à'),
  c('Depois de confirmar, volte para finalizar a criação.', 'After confirming, come back to finish setup.', 'Después de confirmar, vuelve para finalizar la creación.', 'Après confirmation, revenez finaliser la création.'),
  c('Enviar confirmação', 'Send confirmation', 'Enviar confirmación', 'Envoyer la confirmation'),
  c('Email já confirmado.', 'Email already confirmed.', 'Email ya confirmado.', 'E-mail déjà confirmé.'),
  c('Enviamos o link de confirmação para seu email.', 'We sent the confirmation link to your email.', 'Enviamos el enlace de confirmación a tu email.', 'Nous avons envoyé le lien de confirmation à votre e-mail.'),
  c('Email de verificação ainda não está configurado. Tente novamente mais tarde.', 'Verification email is not configured yet. Try again later.', 'El email de verificación aún no está configurado. Inténtalo más tarde.', 'L’e-mail de vérification n’est pas encore configuré. Réessayez plus tard.'),
  c('Não foi possível enviar o email de confirmação.', 'Could not send the confirmation email.', 'No se pudo enviar el email de confirmación.', 'Impossible d’envoyer l’e-mail de confirmation.'),
  c('Confirme seu email antes de criar o prédio.', 'Confirm your email before creating the building.', 'Confirma tu email antes de crear el edificio.', 'Confirmez votre e-mail avant de créer l’immeuble.'),
  c('A verificação humana falhou. Tente novamente.', 'Human verification failed. Try again.', 'La verificación humana falló. Inténtalo de nuevo.', 'La vérification humaine a échoué. Réessayez.'),
  c('Verificação humana', 'Human verification', 'Verificación humana', 'Vérification humaine'),
  c('Protege a criação de prédios contra abuso automático.', 'Protects building creation from automated abuse.', 'Protege la creación de edificios contra abuso automático.', 'Protège la création d’immeubles contre les abus automatisés.'),
  c('Não foi possível carregar a verificação. Confira sua conexão e tente novamente.', 'Could not load verification. Check your connection and try again.', 'No se pudo cargar la verificación. Revisa tu conexión e inténtalo de nuevo.', 'Impossible de charger la vérification. Vérifiez votre connexion et réessayez.'),
  c('A verificação humana está exigida, mas a chave pública do Turnstile não está configurada. Avise o suporte antes de criar o prédio.', 'Human verification is required, but the Turnstile site key is not configured. Contact support before creating the building.', 'La verificación humana es obligatoria, pero la clave pública de Turnstile no está configurada. Avisa al soporte antes de crear el edificio.', 'La vérification humaine est requise, mais la clé publique Turnstile n’est pas configurée. Contactez le support avant de créer l’immeuble.'),
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
  c('Ativar prédio aprovado', 'Activate approved building', 'Activar edificio aprobado', 'Activer un immeuble approuvé'),
  c('Use código privado da equipe CONDOS.', 'Use a private code from the CONDOS team.', 'Usa un código privado del equipo de CONDOS.', 'Utilisez un code privé de l’équipe CONDOS.'),
  c('Entre no seu prédio sem pedir ajuda na portaria.', 'Join your building without asking the front desk for help.', 'Entra a tu edificio sin pedir ayuda en portería.', "Rejoignez votre immeuble sans demander d'aide à l'accueil."),
  c('Crie sua conta, use o código do administrador e escolha sua unidade.', 'Create your account, use the admin code, and choose your unit.', 'Crea tu cuenta, usa el código del administrador y elige tu unidad.', 'Créez votre compte, utilisez le code du syndic et choisissez votre lot.'),
  c('Ative apenas prédios aprovados com código privado CONDOS.', 'Activate only approved buildings with a private CONDOS code.', 'Activa solo edificios aprobados con código privado de CONDOS.', 'Activez uniquement des immeubles approuvés avec un code privé CONDOS.'),
  c('Voltar para entrar', 'Back to sign in', 'Volver a entrar', 'Retour à la connexion'),
  c('Novo administrador', 'New admin', 'Nuevo administrador', 'Nouveau syndic'),
  c('Novo morador', 'New resident', 'Nuevo residente', 'Nouveau résident'),
  c('Crie sua conta de administrador', 'Create your admin account', 'Crea tu cuenta de administrador', 'Créez votre compte syndic'),
  c('Crie sua conta para ativar o prédio', 'Create your account to activate the building', 'Crea tu cuenta para activar el edificio', 'Créez votre compte pour activer l’immeuble'),
  c('Crie sua conta para entrar', 'Create your account to join', 'Crea tu cuenta para unirte', 'Créez votre compte pour rejoindre'),
  c('Depois de criar sua conta, configuramos o prédio e geramos o código para moradores.', 'After you create your account, we set up the building and generate the resident code.', 'Después de crear tu cuenta, configuramos el edificio y generamos el código para residentes.', 'Après avoir créé votre compte, nous configurons l’immeuble et générons le code résident.'),
  c('Depois de criar sua conta, use o código privado da equipe CONDOS para configurar o prédio aprovado.', 'After creating your account, use the private CONDOS team code to set up the approved building.', 'Después de crear tu cuenta, usa el código privado del equipo de CONDOS para configurar el edificio aprobado.', 'Après avoir créé votre compte, utilisez le code privé de l’équipe CONDOS pour configurer l’immeuble approuvé.'),
  c('Depois de criar sua conta, insira o código do administrador e escolha sua unidade.', 'After you create your account, enter the admin code and choose your unit.', 'Después de crear tu cuenta, ingresa el código del administrador y elige tu unidad.', 'Après avoir créé votre compte, entrez le code du syndic et choisissez votre lot.'),
  c('ou com email', 'or with email', 'o con email', 'ou avec e-mail'),
  c('Nome', 'First name', 'Nombre', 'Prénom'),
  c('Sobrenome', 'Last name', 'Apellido', 'Nom'),
  c('Senha', 'Password', 'Contraseña', 'Mot de passe'),
  c('senha de 12+ caracteres', 'password, 12+ characters', 'contraseña de 12+ caracteres', 'mot de passe de 12 caractères ou plus'),
  c('Código de convite', 'Invite code', 'Código de invitación', 'Code d’invitation'),
  c('Criar conta e prédio', 'Create account and building', 'Crear cuenta y edificio', 'Créer le compte et l’immeuble'),
  c('Criar conta e continuar para ativação', 'Create account and continue to activation', 'Crear cuenta y continuar a la activación', 'Créer le compte et continuer vers l’activation'),
  c('Criar conta e entrar', 'Create account and join', 'Crear cuenta y unirme', 'Créer le compte et rejoindre'),
  c('Já tem conta?', 'Already have an account?', '¿Ya tienes cuenta?', 'Vous avez déjà un compte ?'),
  c('O administrador aprova seu acesso se o prédio exigir.', 'The admin approves your access if the building requires it.', 'El administrador aprueba tu acceso si el edificio lo requiere.', 'Le syndic approuve votre accès si l’immeuble l’exige.'),
  c('Você pode administrar mesmo sem morar no prédio.', 'You can manage even if you do not live in the building.', 'Puedes administrar aunque no vivas en el edificio.', 'Vous pouvez gérer même si vous n’habitez pas dans l’immeuble.'),
  c('Apenas prédios aprovados por CONDOS ou pela administradora podem ser ativados.', 'Only buildings approved by CONDOS or the management agency can be activated.', 'Solo edificios aprobados por CONDOS o por la administradora pueden activarse.', 'Seuls les immeubles approuvés par CONDOS ou la société de gestion peuvent être activés.'),
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
  c('Perfil', 'Profile', 'Perfil', 'Profil'),
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
  c('Quando o síndico começar a lançar as despesas do prédio, elas aparecem aqui automaticamente — com valor, fornecedor e link do recibo.', 'When the board starts logging building expenses, they appear here automatically — with amount, vendor, and receipt link.', 'Cuando el administrador empiece a registrar los gastos del edificio, aparecerán aquí automáticamente — con valor, proveedor y enlace del recibo.', 'Quand le syndic commence à enregistrer les dépenses de l’immeuble, elles apparaissent ici automatiquement — avec montant, prestataire et lien vers le reçu.'),
  c('Lançamentos', 'Expenses', 'Gastos', 'Dépenses'),
  c('Minha unidade', 'My unit', 'Mi unidad', 'Mon lot'),
  c('Minhas cobranças', 'My charges', 'Mis cobros', 'Mes appels de charges'),
  c('Saldo aberto', 'Open balance', 'Saldo pendiente', 'Solde ouvert'),
  c('Em dia', 'Up to date', 'Al día', 'À jour'),
  c('Próximo vencimento', 'Next due date', 'Siguiente vencimiento', 'Prochaine échéance'),
  c('Nenhuma cobrança aberta', 'No open charges', 'Sin cobros pendientes', 'Aucune charge ouverte'),
  c('Pagamentos registrados', 'Recorded payments', 'Pagos registrados', 'Paiements enregistrés'),
  c('Nenhuma unidade ativa encontrada para exibir cobranças.', 'No active unit was found to show charges.', 'No se encontró una unidad activa para mostrar cobros.', 'Aucun lot actif trouvé pour afficher les charges.'),
  c('Sem cobranças geradas para sua unidade ainda.', 'No charges have been generated for your unit yet.', 'Aún no hay cobros generados para tu unidad.', 'Aucun appel de charges n’a encore été généré pour votre lot.'),
  c('Apto', 'Unit', 'Unidad', 'Lot'),
  c('Pago', 'Paid', 'Pagado', 'Payé'),
  c('Aberto', 'Open', 'Abierto', 'Ouvert'),
  c('Parcial', 'Partial', 'Parcial', 'Partiel'),
  c('Cancelado', 'Cancelled', 'Cancelado', 'Annulé'),
  c('Vence em', 'Due on', 'Vence el', 'Échéance le'),
  c('Pago até agora', 'Paid so far', 'Pagado hasta ahora', 'Payé à ce jour'),
  c('Restante', 'Remaining', 'Restante', 'Restant'),
  c('Enviar comprovante', 'Upload proof', 'Enviar comprobante', 'Envoyer un justificatif'),
  c('Comprovante de pagamento', 'Payment proof', 'Comprobante de pago', 'Justificatif de paiement'),
  c('Comprovantes pendentes', 'Pending proofs', 'Comprobantes pendientes', 'Justificatifs en attente'),
  c('Aguardando revisão', 'Awaiting review', 'En revisión', 'En attente de révision'),
  c('Comprovante aprovado', 'Proof approved', 'Comprobante aprobado', 'Justificatif approuvé'),
  c('Comprovante rejeitado', 'Proof rejected', 'Comprobante rechazado', 'Justificatif rejeté'),
  c('Aprovar comprovante', 'Approve proof', 'Aprobar comprobante', 'Approuver le justificatif'),
  c('Rejeitar', 'Reject', 'Rechazar', 'Rejeter'),
  c('Abrir comprovante', 'Open proof', 'Abrir comprobante', 'Ouvrir le justificatif'),
  c('Arquivo do comprovante', 'Proof file', 'Archivo del comprobante', 'Fichier justificatif'),
  c('Valor pago', 'Paid amount', 'Valor pagado', 'Montant payé'),
  c('Referência', 'Reference', 'Referencia', 'Référence'),
  c('Método de pagamento', 'Payment method', 'Método de pago', 'Moyen de paiement'),
  c('Observação para administração', 'Note for admin', 'Nota para administración', 'Note pour l’administration'),
  c('O admin confere o recibo antes de registrar o pagamento.', 'The admin checks the receipt before recording the payment.', 'El administrador revisa el recibo antes de registrar el pago.', 'L’admin vérifie le reçu avant d’enregistrer le paiement.'),
  c('Comprovante enviado', 'Proof submitted', 'Comprobante enviado', 'Justificatif envoyé'),
  c('Falha ao enviar comprovante', 'Could not submit proof', 'No se pudo enviar el comprobante', 'Impossible d’envoyer le justificatif'),
  c('Falha ao aprovar comprovante', 'Could not approve proof', 'No se pudo aprobar el comprobante', 'Impossible d’approuver le justificatif'),
  c('Falha ao rejeitar comprovante', 'Could not reject proof', 'No se pudo rechazar el comprobante', 'Impossible de rejeter le justificatif'),
  c('Nenhum comprovante pendente.', 'No pending proofs.', 'No hay comprobantes pendientes.', 'Aucun justificatif en attente.'),
  c('Selecione um arquivo de comprovante.', 'Select a proof file.', 'Selecciona un archivo de comprobante.', 'Sélectionnez un fichier justificatif.'),
  c('Revise recibos enviados por moradores antes de registrar o pagamento.', 'Review receipts submitted by residents before recording the payment.', 'Revisa los recibos enviados por residentes antes de registrar el pago.', 'Révisez les reçus envoyés par les résidents avant d’enregistrer le paiement.'),
  c('Motivo da rejeição', 'Rejection reason', 'Motivo del rechazo', 'Motif du rejet'),
  c('Não foi possível atualizar cobranças', 'Could not refresh charges', 'No se pudieron actualizar los cobros', 'Impossible d’actualiser les charges'),
  c('Orçamento vs realizado', 'Budget vs actual', 'Presupuesto vs ejecutado', 'Budget vs réalisé'),
  c('Defina o teto mensal por categoria e acompanhe o gasto real lançado.', 'Set the monthly cap by category and track actual logged spending.', 'Define el límite mensual por categoría y sigue el gasto real registrado.', 'Définissez le plafond mensuel par catégorie et suivez les dépenses réelles enregistrées.'),
  c('Orçamento do mês', 'Monthly budget', 'Presupuesto del mes', 'Budget du mois'),
  c('Gasto atual', 'Current spend', 'Gasto actual', 'Dépense actuelle'),
  c('Sobra no orçamento', 'Budget remaining', 'Sobra en el presupuesto', 'Reste du budget'),
  c('Acima do orçamento', 'Over budget', 'Sobre el presupuesto', 'Au-dessus du budget'),
  c('Dentro do orçamento', 'Within budget', 'Dentro del presupuesto', 'Dans le budget'),
  c('Cobertura de recibos', 'Receipt coverage', 'Cobertura de recibos', 'Couverture des reçus'),
  c('Recibos anexados', 'Receipts attached', 'Recibos adjuntos', 'Reçus joints'),
  c('Categorias acima do orçamento', 'Categories over budget', 'Categorías sobre el presupuesto', 'Catégories au-dessus du budget'),
  c('Meta do mês', 'Monthly target', 'Meta del mes', 'Objectif mensuel'),
  c('Realizado', 'Actual', 'Ejecutado', 'Réalisé'),
  c('Diferença', 'Difference', 'Diferencia', 'Différence'),
  c('Sem meta', 'No target', 'Sin meta', 'Sans objectif'),
  c('Mês', 'Month', 'Mes', 'Mois'),
  c('Salvar orçamento do mês', 'Save monthly budget', 'Guardar presupuesto del mes', 'Enregistrer le budget du mois'),
  c('Orçamento salvo', 'Budget saved', 'Presupuesto guardado', 'Budget enregistré'),
  c('Falha ao salvar orçamento', 'Could not save budget', 'No se pudo guardar el presupuesto', 'Impossible d’enregistrer le budget'),
  c('Resumo financeiro do mês', 'Monthly financial summary', 'Resumen financiero del mes', 'Résumé financier du mois'),
  c('O orçamento ainda não foi configurado para este mês.', 'The budget has not been configured for this month yet.', 'El presupuesto aún no está configurado para este mes.', 'Le budget n’est pas encore configuré pour ce mois.'),
  c('do orçamento usado', 'of budget used', 'del presupuesto usado', 'du budget utilisé'),
  c('com recibo', 'with receipt', 'con recibo', 'avec reçu'),
  c('Use valores zerados para limpar uma meta.', 'Use zero values to clear a target.', 'Usa valores en cero para limpiar una meta.', 'Utilisez zéro pour effacer un objectif.'),
  c('Nenhum gasto lançado neste mês.', 'No spending logged this month.', 'No hay gastos registrados este mes.', 'Aucune dépense enregistrée ce mois-ci.'),
  c('Explicação para moradores', 'Explanation for residents', 'Explicación para residentes', 'Explication pour les résidents'),
  c('Explique em linguagem simples por que esse gasto foi necessário.', 'Explain in plain language why this expense was necessary.', 'Explica en lenguaje simple por qué este gasto fue necesario.', 'Expliquez simplement pourquoi cette dépense était nécessaire.'),
  c('Explicação do administrador', 'Admin explanation', 'Explicación del administrador', 'Explication de l’admin'),
  c('Período: últimos 12 meses. Lançado pelo síndico — clique em cada item para ver o recibo, quando disponível.', 'Period: last 12 months. Logged by the board — open each item to view the receipt when available.', 'Periodo: últimos 12 meses. Registrado por el administrador — abre cada ítem para ver el recibo cuando esté disponible.', 'Période : 12 derniers mois. Enregistré par le syndic — ouvrez chaque élément pour voir le reçu si disponible.'),
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
  c('Não foi possível carregar as propostas', 'Could not load proposals', 'No se pudieron cargar las propuestas', 'Impossible de charger les propositions'),
  c('Não foi possível carregar as encomendas', 'Could not load packages', 'No se pudieron cargar los paquetes', 'Impossible de charger les colis'),
  c('Verifique sua conexão e tente recarregar a página.', 'Check your connection and try reloading the page.', 'Verifica tu conexión y vuelve a cargar la página.', 'Vérifiez votre connexion et rechargez la page.'),
  c('Nenhuma proposta no momento.', 'No proposals right now.', 'Ninguna propuesta por ahora.', 'Aucune proposition pour le moment.'),
  c('Proposta criada! Agora fica em discussão — vizinhos podem comentar e o síndico abre a votação quando estiver pronto.', 'Proposal created! It will now be in discussion — neighbours can comment and the board opens voting when ready.', '¡Propuesta creada! Ahora queda en discusión — los vecinos pueden comentar y el síndico abre la votación cuando esté listo.', 'Proposition créée ! Elle est en discussion — les voisins peuvent commenter et le syndic ouvre le vote quand prêt.'),
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
  c('Convocar', 'Convoke', 'Emitir convocatoria', 'Convoquer'),
  c('Abrir sessão', 'Open session', 'Abrir sesión', 'Ouvrir la séance'),
  c('Encerrar assembleia', 'Close assembly', 'Cerrar asamblea', 'Clore l’assemblée'),
  c('Convocada — moradores já podem confirmar presença e conceder procurações', 'Convoked — residents can now confirm attendance and grant proxies', 'Convocatoria emitida: los residentes ya pueden confirmar asistencia y otorgar poderes', 'Convoquée : les résidents peuvent confirmer leur présence et donner procuration'),
  c('Falha', 'Failed', 'Error', 'Échec'),
  c('Sessão aberta', 'Session opened', 'Sesión abierta', 'Séance ouverte'),
  c('Assembleia encerrada', 'Assembly closed', 'Asamblea cerrada', 'Assemblée close'),
  c('Ata gerada', 'Minutes generated', 'Acta generada', 'Procès-verbal généré'),
  c('Pauta', 'Agenda', 'Agenda', 'Ordre du jour'),
  c('A IA monta uma pauta padrão de AGO a partir das propostas abertas.', 'AI builds a standard AGO agenda from open proposals.', 'La IA arma una agenda base de AGO desde las propuestas abiertas.', 'L’IA prépare un ordre du jour standard d’AGO à partir des propositions ouvertes.'),
  c('Redigir com IA', 'Draft with AI', 'Redactar con IA', 'Rédiger avec IA'),
  c('Ordinária', 'Ordinary', 'Ordinaria', 'Ordinaire'),
  c('Orçamento', 'Budget', 'Presupuesto', 'Budget'),
  c('Contas', 'Accounts', 'Cuentas', 'Comptes'),
  c('Convenção', 'Bylaws', 'Reglamento', 'Règlement'),
  c('Eleição', 'Election', 'Elección', 'Élection'),
  c('Outros', 'Other', 'Otros', 'Autres'),
  c('Maioria simples', 'Simple majority', 'Mayoría simple', 'Majorité simple'),
  c('2/3 dos presentes', 'Two-thirds present', '2/3 de presentes', '2/3 des présents'),
  c('Unanimidade', 'Unanimity', 'Unanimidad', 'Unanimité'),
  c('proprietários elegíveis', 'eligible owners', 'propietarios elegibles', 'propriétaires éligibles'),
  c('Presença', 'Attendance', 'Asistencia', 'Présence'),
  c('pendente', 'pending', 'pendiente', 'en attente'),
  c('votando', 'voting', 'en votación', 'en vote'),
  c('aprovado', 'approved', 'aprobado', 'approuvé'),
  c('rejeitado', 'rejected', 'rechazado', 'rejeté'),
  c('inconclusivo', 'inconclusive', 'inconcluso', 'non concluant'),
  c('adiado', 'deferred', 'aplazado', 'reporté'),
  c('Título do item (ex: Aprovar orçamento 2026)', 'Item title (e.g. Approve 2026 budget)', 'Título del punto (ej.: Aprobar presupuesto 2026)', 'Titre du point (ex. approuver le budget 2026)'),
  c('Descrição (opcional)', 'Description (optional)', 'Descripción (opcional)', 'Description (facultative)'),
  c('Adicionar item', 'Add item', 'Agregar punto', 'Ajouter le point'),
  c('Repolir com IA', 'Polish with AI', 'Pulir con IA', 'Repolir avec IA'),
  c('(a ata será gerada quando você encerrar a assembleia)', '(minutes will be generated when you close the assembly)', '(el acta se generará al cerrar la asamblea)', '(le procès-verbal sera généré à la clôture de l’assemblée)'),
  c('Invite code', 'Invite code', 'Código de invitación', 'Code d’invitation'),
  c('Copied', 'Copied', 'Copiado', 'Copié'),
  c('Copiar', 'Copy', 'Copiar', 'Copier'),
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
  c('Copiar código', 'Copy code', 'Copiar código', 'Copier le code'),
  c('Copiado!', 'Copied!', '¡Copiado!', 'Copié !'),
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
  c('Próximos passos', 'Next steps', 'Siguientes pasos', 'Prochaines étapes'),
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
  c('Crie usuários simples para porteiros. Ao entrar, eles vão direto para o painel de visitantes, encomendas e entregas.', 'Create simple guard users. When they sign in, they go straight to the visitor, package, and delivery desk.', 'Crea usuarios simples para guardias. Al iniciar sesión entran directo al panel de visitantes, paquetes y entregas.', 'Créez des utilisateurs simples pour les gardiens. À la connexion, ils arrivent directement au panneau visiteurs, colis et livraisons.'),
  c('Novo porteiro', 'New guard', 'Nuevo guardia', 'Nouveau gardien'),
  c('O administrador cria o email e uma senha temporária. O porteiro entra com esses dados e vê apenas o painel da portaria.', 'The admin creates the email and a temporary password. The guard signs in with those details and only sees the front desk dashboard.', 'El administrador crea el email y una contraseña temporal. El guardia entra con esos datos y solo ve el panel de portería.', 'L’administrateur crée l’e-mail et un mot de passe temporaire. Le gardien se connecte avec ces accès et ne voit que le panneau de conciergerie.'),
  c('O administrador cria o email e uma senha temporária. O porteiro entra com esses dados e vê apenas o painel da portaria. O app ainda não envia email automático para o porteiro.', 'The admin creates the email and a temporary password. The guard signs in with those details and only sees the front desk dashboard. The app does not send an automatic guard email yet.', 'El administrador crea el email y una contraseña temporal. El guardia entra con esos datos y solo ve el panel de portería. La app todavía no envía un email automático al guardia.', 'L’administrateur crée l’e-mail et un mot de passe temporaire. Le gardien se connecte avec ces accès et ne voit que le panneau de conciergerie. L’app n’envoie pas encore d’e-mail automatique au gardien.'),
  c('O porteiro não tem unidade, não vota e não vê o painel administrativo.', 'The guard has no unit, cannot vote, and cannot see the admin dashboard.', 'El guardia no tiene unidad, no vota y no ve el panel administrativo.', 'Le gardien n’a pas de lot, ne vote pas et ne voit pas le panneau administrateur.'),
  c('Copie as instruções de acesso depois de criar ou redefinir a senha. O porteiro não tem unidade, não vota e não vê o painel administrativo.', 'Copy the access instructions after creating or resetting the password. The guard has no unit, cannot vote, and cannot see the admin dashboard.', 'Copia las instrucciones de acceso después de crear o restablecer la contraseña. El guardia no tiene unidad, no vota y no ve el panel administrativo.', 'Copiez les instructions d’accès après avoir créé ou réinitialisé le mot de passe. Le gardien n’a pas de lot, ne vote pas et ne voit pas le panneau administrateur.'),
  c('Senha temporária', 'Temporary password', 'Contraseña temporal', 'Mot de passe temporaire'),
  c('Criar porteiro', 'Create guard', 'Crear guardia', 'Créer le gardien'),
  c('Porteiro criado', 'Guard created', 'Guardia creado', 'Gardien créé'),
  c('Porteiro criado. Copie os dados de acesso.', 'Guard created. Copy the access details.', 'Guardia creado. Copia los datos de acceso.', 'Gardien créé. Copiez les accès.'),
  c('Dados de acesso prontos', 'Access details ready', 'Datos de acceso listos', 'Accès prêts'),
  c('O email automático ainda não está ativo. Copie estes dados e envie ao porteiro pelo canal que você usa.', 'Automatic email is not active yet. Copy these details and send them to the guard through your usual channel.', 'El email automático todavía no está activo. Copia estos datos y envíaselos al guardia por el canal que uses.', 'L’e-mail automatique n’est pas encore actif. Copiez ces accès et envoyez-les au gardien par votre canal habituel.'),
  c('A senha aparece aqui apenas agora. Se ela for perdida, use redefinir senha.', 'The password appears here only now. If it is lost, use reset password.', 'La contraseña aparece aquí solo ahora. Si se pierde, usa restablecer contraseña.', 'Le mot de passe apparaît ici seulement maintenant. S’il est perdu, utilisez la réinitialisation.'),
  c('Acesso de portaria CondoOS', 'CondoOS guard access', 'Acceso de portería CondoOS', 'Accès gardien CondoOS'),
  c('Login', 'Login', 'Login', 'Connexion'),
  c('Entre com esses dados. O painel abrirá direto na portaria.', 'Sign in with these details. The dashboard will open directly at the front desk.', 'Entra con estos datos. El panel se abrirá directamente en portería.', 'Connectez-vous avec ces accès. Le tableau de bord s’ouvrira directement à la conciergerie.'),
  c('Instruções copiadas', 'Instructions copied', 'Instrucciones copiadas', 'Instructions copiées'),
  c('Copiar instruções', 'Copy instructions', 'Copiar instrucciones', 'Copier les instructions'),
  c('Copiar login', 'Copy login', 'Copiar login', 'Copier le login'),
  c('Use a senha temporária que o administrador definiu. Se ela foi perdida, redefina a senha aqui no painel.', 'Use the temporary password the admin set. If it was lost, reset the password here in the dashboard.', 'Usa la contraseña temporal que definió el administrador. Si se perdió, restablécela aquí en el panel.', 'Utilisez le mot de passe temporaire défini par l’administrateur. S’il est perdu, réinitialisez-le ici dans le tableau de bord.'),
  c('Redefinir senha', 'Reset password', 'Restablecer contraseña', 'Réinitialiser le mot de passe'),
  c('Nova senha temporária', 'New temporary password', 'Nueva contraseña temporal', 'Nouveau mot de passe temporaire'),
  c('Guardar nova senha', 'Save new password', 'Guardar nueva contraseña', 'Enregistrer le nouveau mot de passe'),
  c('Senha temporária redefinida. Copie os dados de acesso.', 'Temporary password reset. Copy the access details.', 'Contraseña temporal restablecida. Copia los datos de acceso.', 'Mot de passe temporaire réinitialisé. Copiez les accès.'),
  c('Não foi possível redefinir a senha', 'Could not reset the password', 'No se pudo restablecer la contraseña', 'Impossible de réinitialiser le mot de passe'),
  c('Não foi possível carregar a equipe de portaria', 'Could not load front desk staff', 'No se pudo cargar el equipo de portería', 'Impossible de charger l’équipe de conciergerie'),
  c('Preencha email, nome e senha.', 'Fill in email, first name, and password.', 'Completa email, nombre y contraseña.', 'Renseignez l’e-mail, le prénom et le mot de passe.'),
  c('A senha precisa ter pelo menos 12 caracteres.', 'Password must be at least 12 characters.', 'La contraseña debe tener al menos 12 caracteres.', 'Le mot de passe doit comporter au moins 12 caractères.'),
  c('Esse email já existe', 'That email already exists', 'Ese email ya existe', 'Cet e-mail existe déjà'),
  c('Não foi possível criar o porteiro', 'Could not create guard', 'No se pudo crear el guardia', 'Impossible de créer le gardien'),
  c('Criado', 'Created', 'Creado', 'Créé'),
  c('Ainda não há porteiros criados.', 'No guards have been created yet.', 'Aún no hay guardias creados.', 'Aucun gardien créé pour le moment.'),

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
  c('Arquivo do recibo (opcional)', 'Receipt file (optional)', 'Archivo del recibo (opcional)', 'Fichier du reçu (facultatif)'),
  c('Use upload para guardar o recibo dentro do CondoOS.', 'Use upload to store the receipt inside CondoOS.', 'Usa la carga para guardar el recibo dentro de CondoOS.', 'Utilisez le téléversement pour garder le reçu dans CondoOS.'),
  c('Registrar despesa', 'Log expense', 'Registrar gasto', 'Enregistrer la dépense'),
  c('Foto ou arquivo de evidência (opcional)', 'Evidence photo or file (optional)', 'Foto o archivo de evidencia (opcional)', 'Photo ou fichier de preuve (facultatif)'),
  c('Ajuda o síndico e fornecedores a entenderem o problema mais rápido.', 'Helps the admin and vendors understand the issue faster.', 'Ayuda al administrador y a los proveedores a entender el problema más rápido.', 'Aide le syndic et les prestataires à comprendre le problème plus vite.'),
  c('O problema foi reportado, mas o arquivo não subiu. Tente anexar novamente depois.', 'The issue was reported, but the file did not upload. Try attaching it again later.', 'El problema fue reportado, pero el archivo no se subió. Intenta anexarlo de nuevo después.', 'Le problème a été signalé, mais le fichier n’a pas été téléversé. Réessayez plus tard.'),
  c('Anexos', 'Attachments', 'Anexos', 'Pièces jointes'),
  c('anexo', 'attachment', 'anexo', 'pièce jointe'),
  c('Sugestões dos moradores', 'Resident suggestions', 'Sugerencias de residentes', 'Suggestions des résidents'),
  c('O que os moradores estão pedindo. Agrupe semelhantes, promova a propostas ou descarte.', 'What residents are requesting. Cluster similar ones, promote to proposals, or dismiss.', 'Lo que piden los residentes. Agrupa similares, promueve a propuestas o descarta.', 'Ce que demandent les résidents. Regroupez les similaires, promouvez en propositions ou ignorez.'),
  c('Agrupar com IA', 'Cluster with AI', 'Agrupar con IA', 'Regrouper avec IA'),
  c('Redigir proposta', 'Draft proposal', 'Redactar propuesta', 'Rédiger une proposition'),
  c('Agrupamento', 'Cluster', 'Agrupamiento', 'Regroupement'),
  c('Sem agrupamento', 'Unclustered', 'Sin agrupar', 'Non regroupé'),
  c('Sugestões abertas', 'Open suggestions', 'Sugerencias abiertas', 'Suggestions ouvertes'),
  c('Descartar', 'Dismiss', 'Descartar', 'Ignorer'),
  c('Promover', 'Promote', 'Promover', 'Promouvoir'),
  c('Tudo em dia! Use o agrupador da IA quando novas sugestões chegarem.', 'All clear. Use the AI clusterer when new suggestions come in.', 'Todo al día. Usa el agrupador con IA cuando lleguen nuevas sugerencias.', 'Tout est à jour. Utilisez le regroupement IA quand de nouvelles suggestions arrivent.'),

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
  c('Controle cobranças, pagamentos, despesas e recibos em um só lugar. Moradores veem a parte transparente sem editar nada.', 'Manage dues, payments, expenses, and receipts in one place. Residents see the transparent read-only side.', 'Controla cobros, pagos, gastos y recibos en un solo lugar. Los residentes ven la parte transparente sin editar nada.', 'Gérez appels de charges, paiements, dépenses et reçus au même endroit. Les résidents voient la partie transparente en lecture seule.'),
  c('Não foi possível carregar finanças', 'Could not load finances', 'No se pudieron cargar las finanzas', 'Impossible de charger les finances'),
  c('Gerar cobranças', 'Generate charges', 'Generar cobros', 'Générer les appels'),
  c('Regras de cobrança', 'Charge rules', 'Reglas de cobro', 'Règles d’appel'),
  c('Defina o valor recorrente que vira cobrança para as unidades.', 'Set the recurring amount that becomes a charge for units.', 'Define el valor recurrente que se convierte en cobro para las unidades.', 'Définissez le montant récurrent facturé aux lots.'),
  c('Nova regra', 'New rule', 'Nueva regla', 'Nouvelle règle'),
  c('Nenhuma regra de cobrança ainda. Crie a mensalidade do condomínio ou uma taxa recorrente.', 'No charge rules yet. Create the condo monthly dues or a recurring fee.', 'Aún no hay reglas de cobro. Crea la cuota mensual del condominio o una tasa recurrente.', 'Aucune règle d’appel pour le moment. Créez les charges mensuelles ou des frais récurrents.'),
  c('Mensal', 'Monthly', 'Mensual', 'Mensuel'),
  c('Trimestral', 'Quarterly', 'Trimestral', 'Trimestriel'),
  c('Anual', 'Annual', 'Anual', 'Annuel'),
  c('Uma vez', 'One time', 'Una vez', 'Une fois'),
  c('vence dia', 'due day', 'vence día', 'échéance le jour'),
  c('Cobranças e pagamentos', 'Charges and payments', 'Cobros y pagos', 'Appels et paiements'),
  c('Veja saldos por unidade e registre pagamentos manuais quando entrarem.', 'See balances by unit and record manual payments when they arrive.', 'Ve saldos por unidad y registra pagos manuales cuando entren.', 'Consultez les soldes par lot et enregistrez les paiements manuels à réception.'),
  c('Exportar CSV', 'Export CSV', 'Exportar CSV', 'Exporter CSV'),
  c('Sem morador ativo', 'No active resident', 'Sin residente activo', 'Aucun résident actif'),
  c('Sem vencimento', 'No due date', 'Sin vencimiento', 'Aucune échéance'),
  c('Nenhum saldo aberto. Gere cobranças quando começar o próximo ciclo.', 'No open balances. Generate charges when the next cycle starts.', 'No hay saldos pendientes. Genera cobros cuando empiece el siguiente ciclo.', 'Aucun solde ouvert. Générez les appels au début du prochain cycle.'),
  c('Cobrança', 'Charge', 'Cobro', 'Appel'),
  c('Vencimento', 'Due date', 'Vencimiento', 'Échéance'),
  c('Status', 'Status', 'Estado', 'Statut'),
  c('Ação', 'Action', 'Acción', 'Action'),
  c('Cobrança avulsa', 'One-time charge', 'Cobro único', 'Appel ponctuel'),
  c('Registrar pago', 'Record payment', 'Registrar pago', 'Enregistrer le paiement'),
  c('Mostrando as 12 cobranças abertas mais antigas. Exporte CSV para ver tudo.', 'Showing the 12 oldest open charges. Export CSV to see everything.', 'Mostrando los 12 cobros pendientes más antiguos. Exporta CSV para ver todo.', 'Affichage des 12 appels ouverts les plus anciens. Exportez le CSV pour tout voir.'),
  c('Nova regra de cobrança', 'New charge rule', 'Nueva regla de cobro', 'Nouvelle règle d’appel'),
  c('Use para mensalidade do condomínio, fundo de reserva ou cobranças recorrentes.', 'Use this for condo dues, reserve fund, or recurring charges.', 'Úsalo para cuota del condominio, fondo de reserva o cobros recurrentes.', 'Utilisez-la pour les charges, le fonds de réserve ou les appels récurrents.'),
  c('Nome', 'Name', 'Nombre', 'Nom'),
  c('Valor', 'Amount', 'Valor', 'Montant'),
  c('Vence dia', 'Due day', 'Vence día', 'Échéance le jour'),
  c('Frequência', 'Frequency', 'Frecuencia', 'Fréquence'),
  c('Salvar regra', 'Save rule', 'Guardar regla', 'Enregistrer la règle'),
  c('Mensalidade do condomínio', 'Condo monthly dues', 'Cuota mensual del condominio', 'Charges mensuelles'),
  c('Regra de cobrança criada', 'Charge rule created', 'Regla de cobro creada', 'Règle d’appel créée'),
  c('Regra', 'Rule', 'Regla', 'Règle'),
  c('Período', 'Period', 'Periodo', 'Période'),
  c('Todas as unidades', 'All units', 'Todas las unidades', 'Tous les lots'),
  c('Gere para todas as unidades ou apenas uma unidade específica.', 'Generate for all units or one specific unit.', 'Genera para todas las unidades o solo una unidad específica.', 'Générez pour tous les lots ou un lot précis.'),
  c('Cobranças geradas', 'Charges generated', 'Cobros generados', 'Appels générés'),
  c('ignoradas', 'skipped', 'omitidas', 'ignorés'),
  c('Falha ao gerar cobranças', 'Could not generate charges', 'Error al generar cobros', 'Échec de génération des appels'),
  c('Registrar pagamento', 'Record payment', 'Registrar pago', 'Enregistrer le paiement'),
  c('restante', 'remaining', 'restante', 'restant'),
  c('Método', 'Method', 'Método', 'Méthode'),
  c('Referência (opcional)', 'Reference (optional)', 'Referencia (opcional)', 'Référence (facultative)'),
  c('ex: PIX, transferência, recibo', 'e.g. ACH, transfer, receipt', 'ej.: transferencia, recibo, comprobante', 'ex. virement, reçu, justificatif'),
  c('Pagamento registrado', 'Payment recorded', 'Pago registrado', 'Paiement enregistré'),
  c('Falha ao registrar pagamento', 'Could not record payment', 'Error al registrar pago', 'Échec de l’enregistrement du paiement'),
  c('Fechar', 'Close', 'Cerrar', 'Fermer'),
  c('Em atraso', 'Overdue', 'En atraso', 'En retard'),
  c('Cobranças abertas', 'Open charges', 'Cobros pendientes', 'Appels ouverts'),
  c('Unidades', 'Units', 'Unidades', 'Lots'),
  c('open in dues', 'open in dues', 'pendientes en cuotas', 'ouverts en charges'),
  c('overdue', 'overdue', 'vencido', 'en retard'),
  c('open charges', 'open charges', 'cobros pendientes', 'appels ouverts'),

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
  c('Discussão', 'Discussion', 'Discusión', 'Discussion'),
  c('Faça uma leitura rápida dos comentários.', 'Read {count} comments quickly.', 'Lee rápidamente {count} comentarios.', 'Lire rapidement {count} commentaires.'),
  c('Peça pra IA ler os comentários e resumir onde os moradores concordam ou discordam.', 'Ask AI to read {count} comments and summarize where residents agree or disagree.', 'Pide a la IA que lea {count} comentarios y resuma dónde coinciden o discrepan los residentes.', 'Demandez à l’IA de lire {count} commentaires et de résumer les accords et désaccords.'),
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
  c('Apuração com peso:', 'Weighted tally:', 'Conteo ponderado:', 'Décompte pondéré :'),
  c('votaram', 'voted', 'votaron', 'ont voté'),
  c('de', 'of', 'de', 'sur'),
  c('O quórum de', 'The quorum of', 'El quórum de', 'Le quorum de'),
  c('não foi atingido', 'was not reached', 'no fue alcanzado', 'n’a pas été atteint'),
  c('só', 'only', 'solo', 'seulement'),
  c('O síndico pode reabrir a votação depois.', 'The board admin can reopen voting later.', 'El administrador puede reabrir la votación después.', 'Le syndic peut rouvrir le vote plus tard.'),
  c('A janela de votação fechou sem atingir o quórum de', 'The voting window closed without reaching quorum of', 'La ventana de votación cerró sin alcanzar el quórum de', 'La période de vote s’est terminée sans atteindre le quorum de'),
  c('Nenhuma decisão registrada. Você pode reabrir uma nova proposta com janela maior ou quórum mais baixo.', 'No decision recorded. You can reopen a new proposal with a longer window or lower quorum.', 'No se registró ninguna decisión. Puedes reabrir una nueva propuesta con una ventana más larga o quórum más bajo.', 'Aucune décision enregistrée. Vous pouvez rouvrir une nouvelle proposition avec une fenêtre plus longue ou un quorum plus bas.'),
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
  c('Reserva confirmada para', 'Reservation confirmed for', 'Reserva confirmada para', 'Réservation confirmée pour'),
  c('Reserva cancelada', 'Reservation cancelled', 'Reserva cancelada', 'Réservation annulée'),
  c('Cancelar reserva', 'Cancel booking', 'Cancelar reserva', 'Annuler la réservation'),
  c('Falha ao cancelar reserva', 'Failed to cancel booking', 'Error al cancelar la reserva', 'Échec de l’annulation'),
  c('Motivo do cancelamento', 'Cancellation reason', 'Motivo de cancelación', 'Motif d’annulation'),
  c('Veja quem reservou áreas comuns e cancele quando houver erro ou conflito.', 'See who booked amenities and cancel when there is a mistake or conflict.', 'Ve quién reservó áreas comunes y cancela cuando haya un error o conflicto.', 'Voyez qui a réservé les espaces communs et annulez en cas d’erreur ou de conflit.'),
  c('ativas', 'active', 'activas', 'actives'),
  c('Calendário da semana', 'Weekly calendar', 'Calendario semanal', 'Calendrier de la semaine'),
  c('Veja rapidamente quais horários já estão ocupados.', 'Quickly see which times are already booked.', 'Ve rápidamente qué horarios tienen reserva.', 'Voyez rapidement quels créneaux sont déjà occupés.'),
  c('Anterior', 'Previous', 'Anterior', 'Précédente'),
  c('Hoje', 'Today', 'Hoy', 'Aujourd’hui'),
  c('Próxima', 'Next', 'Siguiente', 'Suivante'),
  c('Livre', 'Free', 'Libre', 'Libre'),
  c('Prévia de horários', 'Slot preview', 'Vista previa de horarios', 'Aperçu des créneaux'),
  c('Ajuste o horário para criar pelo menos um turno.', 'Adjust the hours to create at least one slot.', 'Ajusta el horario para crear al menos un turno.', 'Ajustez les horaires pour créer au moins un créneau.'),
  c('Reservar', 'Book', 'Reservar', 'Réserver'),
  c('Escolha um espaço e um horário disponível.', 'Choose a space and an available time.', 'Elige un espacio y un horario disponible.', 'Choisissez un espace et un créneau disponible.'),
  c('Não conseguimos carregar as áreas comuns. Atualize a página e tente de novo.', 'We could not load the amenities. Refresh the page and try again.', 'No pudimos cargar las áreas comunes. Actualiza la página e inténtalo de nuevo.', 'Impossible de charger les espaces communs. Actualisez la page et réessayez.'),
  c('Ainda não há áreas reserváveis', 'No bookable areas yet', 'Aún no hay áreas reservables', 'Aucun espace réservable pour le moment'),
  c('Quando o administrador ativar uma piscina, academia, quadra ou salão, você poderá reservar um horário nesta página.', 'When the admin activates a pool, gym, court, or room, you will be able to book a time from this page.', 'Cuando el administrador active una piscina, gimnasio, cancha o salón, podrás reservar un horario desde esta página.', 'Quand l’administrateur active une piscine, salle de sport, terrain ou salle, vous pourrez réserver un créneau depuis cette page.'),
  c('Esse horário só tem', 'That time only has', 'Ese horario solo tiene', 'Ce créneau n’a que'),
  c('vaga(s) disponível(is).', 'spot(s) available.', 'cupo(s) disponible(s).', 'place(s) disponible(s).'),
  c('Pessoas na reserva', 'People in the booking', 'Personas en la reserva', 'Personnes dans la réservation'),
  c('Horários disponíveis', 'Available times', 'Horarios disponibles', 'Créneaux disponibles'),
  c('slots de', 'slots of', 'turnos de', 'créneaux de'),
  c('Nenhum horário disponível para esta data.', 'No times available for this date.', 'No hay horarios disponibles para esta fecha.', 'Aucun créneau disponible pour cette date.'),
  c('vaga(s)', 'spot(s)', 'cupo(s)', 'place(s)'),
  c('Reservado', 'Reserved', 'Reservado', 'Réservé'),
  c('lugares disponíveis', 'spots available', 'lugares disponibles', 'places disponibles'),
  c('Acompanhe suas reservas separadas do calendário geral do prédio.', 'Track your reservations separately from the building calendar.', 'Sigue tus reservas separadas del calendario general del edificio.', 'Suivez vos réservations séparément du calendrier général de l’immeuble.'),
  c('Minhas reservas', 'My bookings', 'Mis reservas', 'Mes réservations'),
  c('Reservas do prédio', 'Building bookings', 'Reservas del edificio', 'Réservations de l’immeuble'),
  c('ex: aniversário, fornecedor de buffet às 18h', 'e.g. birthday, catering vendor at 6pm', 'ej.: cumpleaños, proveedor de catering a las 18h', 'ex. anniversaire, traiteur à 18 h'),
  c('Ana Souza\nBruno Lima\nCarla Ferreira\n…', 'Ana Souza\nBruno Lima\nCarla Ferreira\n...', 'Ana Souza\nBruno Lima\nCarla Ferreira\n...', 'Ana Souza\nBruno Lima\nCarla Ferreira\n...'),
  c('Lista', 'List', 'Lista', 'Liste'),
  c('Choose valid start and end times.', 'Choose valid start and end times.', 'Elige horarios válidos de inicio y fin.', 'Choisissez des horaires de début et de fin valides.'),
  c('End time must be after start time.', 'End time must be after start time.', 'El horario final debe ser después del inicio.', 'L’heure de fin doit être après le début.'),
  c('Booking must stay within the amenity open hours.', 'Booking must stay within the amenity open hours.', 'La reserva debe estar dentro del horario del área.', 'La réservation doit rester dans les heures d’ouverture.'),
  c('Reservations open Sunday at midday for the current week only.', 'Reservations open Sunday at midday for the current week only.', 'Las reservas abren el domingo al mediodía solo para la semana en curso.', 'Les réservations ouvrent le dimanche à midi uniquement pour la semaine en cours.'),
  c('As reservas abrem todo domingo ao meio-dia e valem apenas para a semana em curso.', 'Reservations open every Sunday at midday and apply only to the current week.', 'Las reservas abren cada domingo al mediodía y solo valen para la semana en curso.', 'Les réservations ouvrent chaque dimanche à midi et ne valent que pour la semaine en cours.'),
  c('Quando abrem as reservas', 'When bookings open', 'Cuándo se abren las reservas', 'Quand les réservations ouvrent'),
  c('Os horários das áreas comuns são liberados todo domingo ao meio-dia. Só é possível reservar a semana em curso; quando um horário fica cheio, ele aparece bloqueado para evitar conflitos.', 'Amenity time slots are released every Sunday at midday. You can only book the current week; when a slot is full, it appears blocked to prevent conflicts.', 'Los horarios de áreas comunes se liberan cada domingo al mediodía. Solo puedes reservar la semana en curso; cuando un turno se llena, aparece bloqueado para evitar conflictos.', 'Les créneaux des espaces communs sont libérés chaque dimanche à midi. Vous pouvez seulement réserver la semaine en cours ; lorsqu’un créneau est complet, il apparaît bloqué pour éviter les conflits.'),
  c('Semana disponível', 'Available week', 'Semana disponible', 'Semaine disponible'),
  c('Próxima abertura', 'Next opening', 'Próxima apertura', 'Prochaine ouverture'),
  c('That time conflicts with an existing reservation.', 'That time conflicts with an existing reservation.', 'Ese horario entra en conflicto con otra reserva.', 'Ce créneau est en conflit avec une réservation existante.'),
  c('Booking failed', 'Booking failed', 'No se pudo reservar', 'Échec de la réservation'),
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
  c('Em andamento — fornecedor acionado', 'In progress — vendor contacted', 'En curso — proveedor contactado', 'En cours — prestataire contacté'),
  c('Precisa do síndico', 'Needs board admin', 'Necesita administrador', 'Nécessite le syndic'),
  c('Outros chamados', 'Other tickets', 'Otros tickets', 'Autres tickets'),
  c('Nenhum chamado aberto', 'No open tickets', 'No hay tickets abiertos', 'Aucun ticket ouvert'),
  c('Quando um morador reportar um problema, ele aparece aqui com a verificação dos vizinhos e um plano da IA.', 'When a resident reports an issue, it appears here with neighbor verification and an AI plan.', 'Cuando un residente reporta un problema, aparece aquí con verificación de vecinos y un plan de IA.', 'Quand un résident signale un problème, il apparaît ici avec la vérification des voisins et un plan IA.'),
  c('Novo problema recebido', 'New issue received', 'Nuevo problema recibido', 'Nouveau problème reçu'),
  c('Plano gerado (modo offline)', 'Plan generated (offline mode)', 'Plan generado (modo offline)', 'Plan généré (mode hors ligne)'),
  c('Plano gerado pela IA', 'Plan generated by AI', 'Plan generado por IA', 'Plan généré par IA'),
  c('Falha ao acionar agente', 'Failed to trigger agent', 'Error al activar el agente', 'Échec du lancement de l’agent'),
  c('Verificado — IA será acionada em segundos', 'Verified — AI will start in seconds', 'Verificado — la IA se activará en segundos', 'Vérifié — l’IA sera lancée dans quelques secondes'),
  c('Falha ao verificar', 'Failed to verify', 'Error al verificar', 'Échec de la vérification'),
  c('Acionado:', 'Contacted:', 'Contactado:', 'Contacté :'),
  c('Nenhum fornecedor disponível para essa categoria', 'No vendor available for this category', 'No hay proveedor disponible para esta categoría', 'Aucun prestataire disponible pour cette catégorie'),
  c('Falha ao acionar fornecedor', 'Failed to contact vendor', 'Error al contactar proveedor', 'Échec du contact prestataire'),
  c('Resolvido — comunicado publicado', 'Resolved — announcement published', 'Resuelto — aviso publicado', 'Résolu — annonce publiée'),
  c('Resolvido', 'Resolved', 'Resuelto', 'Résolu'),
  c('Falha ao resolver', 'Failed to resolve', 'Error al resolver', 'Échec de la résolution'),
  c('Resposta registrada', 'Response recorded', 'Respuesta registrada', 'Réponse enregistrée'),
  c('Falha ao registrar resposta', 'Failed to record response', 'Error al registrar respuesta', 'Échec de l’enregistrement de la réponse'),
  c('comunidade', 'community', 'comunidad', 'communauté'),
  c('plano da IA', 'AI plan', 'plan de IA', 'plan IA'),
  c('precisa do síndico', 'needs board admin', 'necesita administrador', 'nécessite le syndic'),
  c('de', 'of', 'de', 'sur'),
  c('Atenção do síndico', 'Board attention', 'Atención del administrador', 'Attention du syndic'),
  c('Nenhum fornecedor cadastrado para essa categoria. Adicione um em Operação para a IA acionar.', 'No vendor is registered for this category. Add one in Operations so AI can contact them.', 'No hay proveedor registrado para esta categoría. Agrega uno en Operación para que la IA pueda contactarlo.', 'Aucun prestataire n’est enregistré pour cette catégorie. Ajoutez-en un dans Opérations pour que l’IA puisse le contacter.'),
  c('O fornecedor acionado não respondeu dentro do prazo. Considere acionar outro ou contactar manualmente.', 'The contacted vendor did not respond in time. Consider contacting another one or reaching out manually.', 'El proveedor contactado no respondió a tiempo. Considera contactar a otro o hacerlo manualmente.', 'Le prestataire contacté n’a pas répondu dans les délais. Envisagez d’en contacter un autre ou de le faire manuellement.'),
  c('O agente identificou que é necessária inspeção presencial antes do conserto.', 'The agent identified that an in-person inspection is needed before repair.', 'El agente identificó que se necesita una inspección presencial antes de reparar.', 'L’agent a identifié qu’une inspection sur place est nécessaire avant la réparation.'),
  c('Os relatos da comunidade estão divididos. Verifique pessoalmente antes de acionar.', 'Community reports are split. Check in person before contacting anyone.', 'Los reportes de la comunidad están divididos. Verifica presencialmente antes de activar algo.', 'Les signalements de la communauté sont partagés. Vérifiez sur place avant de contacter quelqu’un.'),
  c('A IA falhou ao montar o plano automaticamente. Gere novamente ou resolva manualmente.', 'AI failed to build the plan automatically. Generate it again or resolve manually.', 'La IA no pudo montar el plan automáticamente. Genéralo otra vez o resuelve manualmente.', 'L’IA n’a pas réussi à préparer le plan automatiquement. Relancez-la ou résolvez manuellement.'),
  c('Verificar como síndico', 'Verify as board admin', 'Verificar como administrador', 'Vérifier comme syndic'),
  c('Refazer plano IA', 'Redo AI plan', 'Rehacer plan IA', 'Refaire le plan IA'),
  c('Gerar plano IA', 'Generate AI plan', 'Generar plan IA', 'Générer le plan IA'),
  c('Acionar fornecedor', 'Contact vendor', 'Contactar proveedor', 'Contacter le prestataire'),
  c('Acionar (auto)', 'Contact automatically', 'Contactar automáticamente', 'Contacter automatiquement'),
  c('Escolher fornecedor', 'Choose vendor', 'Elegir proveedor', 'Choisir le prestataire'),
  c('Marcar resolvido', 'Mark resolved', 'Marcar resuelto', 'Marquer résolu'),
  c('Marcar como resolvido', 'Mark as resolved', 'Marcar como resuelto', 'Marquer comme résolu'),
  c('Plano sugerido', 'Suggested plan', 'Plan sugerido', 'Plan suggéré'),
  c('Próximo passo:', 'Next step:', 'Siguiente paso:', 'Prochaine étape :'),
  c('Da rede já cadastrada', 'From the saved network', 'De la red ya registrada', 'Depuis le réseau enregistré'),
  c('Opções avaliadas', 'Options evaluated', 'Opciones evaluadas', 'Options évaluées'),
  c('Mensagem de contato', 'Contact message', 'Mensaje de contacto', 'Message de contact'),
  c('Histórico de acionamentos', 'Dispatch history', 'Historial de activaciones', 'Historique des actions'),
  c('entrega:', 'delivery:', 'entrega:', 'livraison :'),
  c('Resposta:', 'Response:', 'Respuesta:', 'Réponse :'),
  c('Registrar resposta', 'Record response', 'Registrar respuesta', 'Enregistrer la réponse'),
  c('O que o fornecedor respondeu?', 'What did the vendor answer?', '¿Qué respondió el proveedor?', 'Qu’a répondu le prestataire ?'),
  c('Registrar resposta do fornecedor', 'Record vendor response', 'Registrar respuesta del proveedor', 'Enregistrer la réponse du prestataire'),
  c('Resumo da resposta', 'Response summary', 'Resumen de la respuesta', 'Résumé de la réponse'),
  c('Ex: Confirmou visita amanhã às 9h e pediu foto do problema antes da chegada.', 'Example: Confirmed a visit tomorrow at 9am and asked for a photo of the issue before arrival.', 'Ej.: Confirmó visita mañana a las 9 y pidió foto del problema antes de llegar.', 'Ex. visite confirmée demain à 9 h et photo du problème demandée avant l’arrivée.'),
  c('Salvar resposta', 'Save response', 'Guardar respuesta', 'Enregistrer la réponse'),
  c('Fornecedor', 'Vendor', 'Proveedor', 'Prestataire'),
  c('Nenhum cadastrado', 'None registered', 'Ninguno registrado', 'Aucun enregistré'),
  c('Canal', 'Channel', 'Canal', 'Canal'),
  c('Manual (telefone)', 'Manual (phone)', 'Manual (teléfono)', 'Manuel (téléphone)'),
  c('Mensagem', 'Message', 'Mensaje', 'Message'),
  c('Olá, somos do condomínio. Precisamos de ajuda com: {title}. Pode nos atender?', 'Hello, we are from the condo. We need help with: {title}. Can you assist us?', 'Hola, somos del condominio. Necesitamos ayuda con: {title}. ¿Nos puedes atender?', 'Bonjour, nous sommes de la copropriété. Nous avons besoin d’aide pour : {title}. Pouvez-vous intervenir ?'),
  c('Enviar', 'Send', 'Enviar', 'Envoyer'),
  c('O que foi feito?', 'What was done?', '¿Qué se hizo?', 'Qu’est-ce qui a été fait ?'),
  c('Ex: Técnico da Otis trocou a roldana do cabo principal. Funcionando normalmente.', 'Example: Otis technician replaced the main cable pulley. Working normally.', 'Ej.: El técnico de Otis cambió la polea del cable principal. Funciona normalmente.', 'Ex. le technicien Otis a remplacé la poulie du câble principal. Fonctionne normalement.'),
  c('Publicar comunicado para todos os moradores.', 'Publish an announcement to all residents.', 'Publicar un aviso para todos los residentes.', 'Publier une annonce à tous les résidents.'),
  c('Posta em /app/comunicados e dispara WhatsApp para quem aceitou notificações.', 'Posts in /app/announcements and sends WhatsApp to residents who accepted notifications.', 'Publica en /app/announcements y envía WhatsApp a quienes aceptaron notificaciones.', 'Publie dans /app/announcements et envoie WhatsApp aux résidents qui ont accepté les notifications.'),
  c('Resolver', 'Resolve', 'Resolver', 'Résoudre'),
  c('rascunho', 'draft', 'borrador', 'brouillon'),
  c('agendada', 'scheduled', 'programada', 'planifiée'),
  c('em execução', 'in progress', 'en ejecución', 'en cours'),
  c('concluída', 'completed', 'concluida', 'terminée'),
  c('cancelada', 'cancelled', 'cancelada', 'annulée'),
  c('Ordem de serviço', 'Work order', 'Orden de trabajo', 'Ordre de service'),
  c('Ordem de serviço salva', 'Work order saved', 'Orden de trabajo guardada', 'Ordre de service enregistré'),
  c('Falha ao salvar ordem de serviço', 'Failed to save work order', 'Error al guardar la orden de trabajo', 'Échec de l’enregistrement de l’ordre de service'),
  c('Atualizar ordem', 'Update order', 'Actualizar orden', 'Mettre à jour l’ordre'),
  c('Criar ordem de serviço', 'Create work order', 'Crear orden de trabajo', 'Créer un ordre de service'),
  c('Nota fiscal', 'Invoice', 'Factura', 'Facture'),
  c('Foto', 'Photo', 'Foto', 'Photo'),
  c('Conclusão:', 'Completion:', 'Conclusión:', 'Conclusion :'),
  c('Ordem de serviço: {title}', 'Work order: {title}', 'Orden de trabajo: {title}', 'Ordre de service : {title}'),
  c('Sem fornecedor vinculado', 'No linked vendor', 'Sin proveedor vinculado', 'Aucun prestataire lié'),
  c('Título da ordem', 'Order title', 'Título de la orden', 'Titre de l’ordre'),
  c('Escopo do trabalho', 'Work scope', 'Alcance del trabajo', 'Périmètre des travaux'),
  c('Agendado para', 'Scheduled for', 'Programado para', 'Planifié pour'),
  c('Estimativa', 'Estimate', 'Estimación', 'Estimation'),
  c('Valor aprovado', 'Approved amount', 'Valor aprobado', 'Montant approuvé'),
  c('URL da nota fiscal', 'Invoice URL', 'URL de la factura', 'URL de la facture'),
  c('URL da foto', 'Photo URL', 'URL de la foto', 'URL de la photo'),
  c('Nota de conclusão', 'Completion note', 'Nota de conclusión', 'Note de conclusion'),
  c('Ex: Reparo concluído, testado com o zelador e funcionando normalmente.', 'Example: Repair completed, tested with the building staff, and working normally.', 'Ej.: Reparación concluida, probada con el encargado y funcionando normalmente.', 'Ex. réparation terminée, testée avec le gardien et fonctionnant normalement.'),
  c('Salvar ordem', 'Save order', 'Guardar orden', 'Enregistrer l’ordre'),
  c('Ordem de serviço aberta', 'Work order opened', 'Orden de trabajo abierta', 'Ordre de service ouvert'),
  c('Visita técnica agendada', 'Technical visit scheduled', 'Visita técnica programada', 'Visite technique planifiée'),
  c('Reparo em execução', 'Repair in progress', 'Reparación en ejecución', 'Réparation en cours'),
  c('Ordem de serviço concluída', 'Work order completed', 'Orden de trabajo concluida', 'Ordre de service terminé'),
  c('Cotações de fornecedores', 'Vendor quotes', 'Cotizaciones de proveedores', 'Devis des prestataires'),
  c('Registrar cotação', 'Record quote', 'Registrar cotización', 'Enregistrer un devis'),
  c('Adicionar cotação', 'Add quote', 'Añadir cotización', 'Ajouter un devis'),
  c('Salvar cotação', 'Save quote', 'Guardar cotización', 'Enregistrer le devis'),
  c('Cotação salva', 'Quote saved', 'Cotización guardada', 'Devis enregistré'),
  c('Falha ao salvar cotação', 'Failed to save quote', 'Error al guardar la cotización', 'Échec de l’enregistrement du devis'),
  c('Cotação adicionada', 'Quote added', 'Cotización añadida', 'Devis ajouté'),
  c('Cotação atualizada', 'Quote updated', 'Cotización actualizada', 'Devis mis à jour'),
  c('Falha ao atualizar cotação', 'Failed to update quote', 'Error al actualizar la cotización', 'Échec de la mise à jour du devis'),
  c('Pré-selecionar', 'Shortlist', 'Preseleccionar', 'Présélectionner'),
  c('Fornecedor livre', 'Custom vendor', 'Proveedor libre', 'Prestataire libre'),
  c('Nome do fornecedor', 'Vendor name', 'Nombre del proveedor', 'Nom du prestataire'),
  c('Valor cotado', 'Quoted amount', 'Valor cotizado', 'Montant du devis'),
  c('Moeda', 'Currency', 'Moneda', 'Devise'),
  c('Disponibilidade', 'Availability', 'Disponibilidad', 'Disponibilité'),
  c('Disponibilidade:', 'Availability:', 'Disponibilidad:', 'Disponibilité :'),
  c('Garantia', 'Warranty', 'Garantía', 'Garantie'),
  c('Garantia:', 'Warranty:', 'Garantía:', 'Garantie :'),
  c('Notas internas', 'Internal notes', 'Notas internas', 'Notes internes'),
  c('Notas internas:', 'Internal notes:', 'Notas internas:', 'Notes internes :'),
  c('URL do anexo da cotação', 'Quote attachment URL', 'URL del anexo de la cotización', 'URL de la pièce jointe du devis'),
  c('Abrir cotação', 'Open quote', 'Abrir cotización', 'Ouvrir le devis'),
  c('Cotação', 'Quote', 'Cotización', 'Devis'),
  c('recebida', 'received', 'recibida', 'reçu'),
  c('pré-selecionada', 'shortlisted', 'preseleccionada', 'présélectionné'),
  c('selecionada', 'selected', 'seleccionada', 'sélectionné'),
  c('rejeitada', 'rejected', 'rechazada', 'rejeté'),
  c('Fornecedor não pertence a este condomínio', 'Vendor does not belong to this condo', 'El proveedor no pertenece a este condominio', 'Le prestataire n’appartient pas à cette copropriété'),
  c('Informe um fornecedor', 'Enter a vendor', 'Ingresa un proveedor', 'Indiquez un prestataire'),
  c('Ex: Elevadores Norte', 'Example: North Elevators', 'Ej.: Ascensores Norte', 'Ex. Ascenseurs Nord'),
  c('Ex: Amanhã de manhã', 'Example: Tomorrow morning', 'Ej.: Mañana por la mañana', 'Ex. demain matin'),
  c('Ex: 90 dias', 'Example: 90 days', 'Ej.: 90 días', 'Ex. 90 jours'),
  c('Ex: Inclui materiais, visita técnica e limpeza final.', 'Example: Includes materials, technical visit, and final cleanup.', 'Ej.: Incluye materiales, visita técnica y limpieza final.', 'Ex. matériaux, visite technique et nettoyage final inclus.'),

  // Resident visitors
  c('Visita pré-aprovada — a portaria já tem a liberação', 'Visitor pre-approved — the front desk has the green light', 'Visita pre-aprobada — la portería ya tiene la autorización', 'Visiteur pré-approuvé — la conciergerie a l’autorisation'),
  c('Solicitação enviada à portaria', 'Request sent to the front desk', 'Solicitud enviada a la portería', 'Demande envoyée à la conciergerie'),
  c('Festa registrada — a portaria recebeu a lista', 'Party saved — the front desk received the list', 'Fiesta registrada — portería recibió la lista', 'Fête enregistrée — la conciergerie a reçu la liste'),
  c('Contato para portaria', 'Front desk contact', 'Contacto para portería', 'Contact conciergerie'),
  c('Informe celular, telefone fixo ou ambos. A portaria e o administrador usam isso se precisarem confirmar uma entrada.', 'Enter a mobile phone, home phone, or both. The front desk and admin use this if they need to confirm an entry.', 'Ingresa celular, teléfono de casa o ambos. Portería y administración lo usan si necesitan confirmar una entrada.', 'Indiquez un mobile, un fixe, ou les deux. La conciergerie et l’administrateur s’en servent pour confirmer une entrée.'),
  c('Celular', 'Mobile', 'Celular', 'Mobile'),
  c('Telefone de casa', 'Home phone', 'Teléfono de casa', 'Téléphone fixe'),
  c('Casa', 'Home', 'Casa', 'Domicile'),
  c('Tel', 'Phone', 'Tel', 'Tél.'),
  c('Adicione ao menos um telefone para continuar.', 'Add at least one phone number to continue.', 'Agrega al menos un teléfono para continuar.', 'Ajoutez au moins un numéro pour continuer.'),
  c('Adicione ao menos um telefone válido', 'Add at least one valid phone number', 'Agrega al menos un teléfono válido', 'Ajoutez au moins un numéro valide'),
  c('Entrada autorizada', 'Entry authorized', 'Entrada autorizada', 'Entrée autorisée'),
  c('Entrada recusada', 'Entry denied', 'Entrada rechazada', 'Entrée refusée'),
  c('A portaria está esperando sua aprovação.', 'The front desk is waiting for your approval.', 'Portería está esperando tu aprobación.', 'La conciergerie attend votre approbation.'),
  c('Autorize no app ou, se preferir, confirme por telefone com a portaria.', 'Approve in the app or, if you prefer, confirm by phone with the front desk.', 'Autoriza en la app o, si prefieres, confirma por teléfono con portería.', 'Approuvez dans l’app ou confirmez par téléphone avec la conciergerie.'),
  c('Autorizar entrada', 'Approve entry', 'Autorizar entrada', 'Autoriser l’entrée'),
  c('Recusar', 'Deny', 'Rechazar', 'Refuser'),
  c('Próximas', 'Upcoming', 'Próximas', 'À venir'),
  c('Histórico', 'History', 'Historial', 'Historique'),
  c('Pré-aprovar', 'Pre-approve', 'Pre-aprobar', 'Pré-approuver'),
  c('Festa / evento', 'Party / event', 'Fiesta / evento', 'Fête / événement'),
  c('Visitante', 'Visitor', 'Visitante', 'Visiteur'),
  c('Festa', 'Party', 'Fiesta', 'Fête'),
  c('Nome da festa ou evento', 'Party or event name', 'Nombre de la fiesta o evento', 'Nom de la fête ou de l’événement'),
  c('Quantidade de convidados', 'Number of guests', 'Cantidad de invitados', 'Nombre d’invités'),
  c('Quando começa', 'Start time', 'Cuándo empieza', 'Début'),
  c('Lista de participantes (um nome por linha)', 'Attendee list (one name per line)', 'Lista de asistentes (un nombre por línea)', 'Liste des participants (un nom par ligne)'),
  c('A portaria vê esta lista e libera por nome.', 'The front desk sees this list and admits by name.', 'Portería ve esta lista y autoriza por nombre.', 'La conciergerie voit cette liste et autorise par nom.'),
  c('Pré-aprovar entrada', 'Pre-approve entry', 'Preaprobar entrada', 'Pré-approuver l’entrée'),
  c('Quando chegar, a portaria já tem liberação — sem precisar te ligar.', 'When they arrive, the front desk already has clearance — no need to call you.', 'Cuando llegue, portería ya tiene autorización — sin llamarte.', 'À son arrivée, la conciergerie a déjà l’autorisation — sans vous appeler.'),
  c('Visitante recorrente', 'Recurring visitor', 'Visitante recurrente', 'Visiteur récurrent'),
  c('Permite entrada em dias específicos, usando a hora marcada acima.', 'Allows entry on specific days, using the time set above.', 'Permite entrada en días específicos, usando la hora marcada arriba.', 'Autorise l’entrée certains jours, à l’heure indiquée ci-dessus.'),
  c('Até', 'Until', 'Hasta', 'Jusqu’à'),
  c('Salvar visitante recorrente', 'Save recurring visitor', 'Guardar visitante recurrente', 'Enregistrer le visiteur récurrent'),
  c('Registrar festa', 'Save party', 'Registrar fiesta', 'Enregistrer la fête'),
  c('Visitantes anteriores', 'Past visitors', 'Visitantes anteriores', 'Visiteurs précédents'),
  c('Usar de novo', 'Use again', 'Usar de nuevo', 'Réutiliser'),
  c('recorrente', 'recurring', 'recurrente', 'récurrent'),
  c('Lista de participantes', 'Attendee list', 'Lista de asistentes', 'Liste des participants'),

  // Concierge
  c('Chegada sem pré-aprovação', 'Arrival without pre-approval', 'Llegada sin preaprobación', 'Arrivée sans pré-approbation'),
  c('Apartamento / morador', 'Apartment / resident', 'Apartamento / residente', 'Appartement / résident'),
  c('Selecionar', 'Select', 'Seleccionar', 'Sélectionner'),
  c('Tipo', 'Type', 'Tipo', 'Type'),
  c('Entrega / comida', 'Delivery / food', 'Entrega / comida', 'Livraison / repas'),
  c('App / motorista', 'App / driver', 'App / conductor', 'App / chauffeur'),
  c('Nome, empresa ou app', 'Name, company, or app', 'Nombre, empresa o app', 'Nom, entreprise ou app'),
  c('Observação opcional', 'Optional note', 'Observación opcional', 'Remarque facultative'),
  c('O morador aprova no app. Se não responder, use os telefones abaixo para confirmar.', 'The resident approves in the app. If they do not answer, use the phone numbers below to confirm.', 'El residente aprueba en la app. Si no responde, usa los teléfonos abajo para confirmar.', 'Le résident approuve dans l’app. Sans réponse, utilisez les numéros ci-dessous pour confirmer.'),
  c('Avisar morador', 'Notify resident', 'Avisar residente', 'Prévenir le résident'),
  c('Morador avisado para aprovar no app', 'Resident notified to approve in the app', 'Residente avisado para aprobar en la app', 'Résident prévenu pour approuver dans l’app'),
  c('Precisa aprovação do morador', 'Needs resident approval', 'Necesita aprobación del residente', 'Nécessite l’approbation du résident'),
  c('Registrar entrada por telefone', 'Record phone-approved entry', 'Registrar entrada aprobada por teléfono', 'Enregistrer l’entrée approuvée par téléphone'),
  c('Já pré-aprovado · registrar entrada', 'Already pre-approved · record entry', 'Ya preaprobado · registrar entrada', 'Déjà pré-approuvé · enregistrer l’entrée'),
  c('Avisar encomenda', 'Notify package', 'Avisar paquete', 'Prévenir pour le colis'),
  c('Avisar comida', 'Notify food delivery', 'Avisar comida', 'Prévenir pour le repas'),
  c('Entregue ao morador', 'Handed to resident', 'Entregado al residente', 'Remis au résident'),

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
  c('Morador avisado', 'Resident notified', 'Residente avisado', 'Résident prévenu'),
  c('Falha ao avisar', 'Failed to notify', 'Error al avisar', 'Échec de notification'),
  c('Avisar apto', 'Notify unit', 'Avisar apto', 'Prévenir le lot'),
  c('Avisar', 'Notify', 'Avisar', 'Prévenir'),
  c('Comida', 'Food', 'Comida', 'Repas'),
  c('Lista da festa', 'Party list', 'Lista de la fiesta', 'Liste de la fête'),

  // Sidebar / layouts
  c('Visão geral', 'Overview', 'Resumen', 'Vue d’ensemble'),
  c('Portfólio', 'Portfolio', 'Portafolio', 'Portefeuille'),
  c('Modo privado B2B', 'Private B2B mode', 'Modo privado B2B', 'Mode B2B privé'),
  c('Visão executiva para administradoras: prédios, riscos operacionais, dinheiro e configuração de produção.', 'Executive view for management agencies: buildings, operational risk, money, and production configuration.', 'Vista ejecutiva para administradoras: edificios, riesgos operativos, dinero y configuración de producción.', 'Vue exécutive pour gestionnaires: immeubles, risques opérationnels, finances et configuration de production.'),
  c('Nenhuma administradora vinculada', 'No management agency linked', 'Ninguna administradora vinculada', 'Aucun gestionnaire lié'),
  c('Quando um prédio for ativado com um código privado de administradora, ele aparecerá aqui com métricas de portfólio.', 'When a building is activated with a private agency code, it will appear here with portfolio metrics.', 'Cuando un edificio se active con un código privado de administradora, aparecerá aquí con métricas de portafolio.', 'Lorsqu’un immeuble est activé avec un code privé de gestionnaire, il apparaîtra ici avec les métriques de portefeuille.'),
  c('Administradora', 'Management agency', 'Administradora', 'Gestionnaire'),
  c('prédios vinculados', 'linked buildings', 'edificios vinculados', 'immeubles liés'),
  c('Selecionar administradora', 'Select management agency', 'Seleccionar administradora', 'Sélectionner le gestionnaire'),
  c('Configurado', 'Configured', 'Configurado', 'Configuré'),
  c('Revisar', 'Review', 'Revisar', 'À vérifier'),
  c('Exportar CSV', 'Export CSV', 'Exportar CSV', 'Exporter CSV'),
  c('Cobranças em atraso', 'Overdue dues', 'Cobros vencidos', 'Appels en retard'),
  c('SLA fornecedor', 'Vendor SLA', 'SLA proveedor', 'SLA prestataire'),
  c('Recorrentes', 'Recurring', 'Recurrentes', 'Récurrents'),
  c('Comprovantes', 'Proofs', 'Comprobantes', 'Justificatifs'),
  c('Propostas sem orçamento', 'Proposals missing budget', 'Propuestas sin presupuesto', 'Propositions sans budget'),
  c('Prioridade do portfólio', 'Portfolio priority', 'Prioridad del portafolio', 'Priorité du portefeuille'),
  c('Atenção agora', 'Needs attention now', 'Atención ahora', 'Attention maintenant'),
  c('Nenhuma ação urgente no portfólio.', 'No urgent portfolio action.', 'No hay acciones urgentes en el portafolio.', 'Aucune action urgente dans le portefeuille.'),
  c('ações', 'actions', 'acciones', 'actions'),
  c('Chamados urgentes', 'Urgent tickets', 'Tickets urgentes', 'Tickets urgents'),
  c('Problemas recorrentes', 'Recurring problems', 'Problemas recurrentes', 'Problèmes récurrents'),
  c('SLA de fornecedor', 'Vendor SLA', 'SLA de proveedor', 'SLA prestataire'),
  c('Moradores pendentes', 'Pending residents', 'Residentes pendientes', 'Résidents en attente'),
  c('Ver', 'View', 'Ver', 'Voir'),
  c('Atrasos', 'Overdues', 'Atrasos', 'Retards'),
  c('Estado enterprise', 'Enterprise status', 'Estado enterprise', 'État enterprise'),
  c('Acesso privado', 'Private access', 'Acceso privado', 'Accès privé'),
  c('Google login', 'Google login', 'Login con Google', 'Connexion Google'),
  c('Uploads R2', 'R2 uploads', 'Uploads R2', 'Uploads R2'),
  c('Backups', 'Backups', 'Backups', 'Sauvegardes'),
  c('Sentry/PostHog', 'Sentry/PostHog', 'Sentry/PostHog', 'Sentry/PostHog'),
  c('Checklist de piloto privado', 'Private pilot checklist', 'Checklist de piloto privado', 'Checklist pilote privé'),
  c('Use esta lista antes de apresentar para uma administradora real.', 'Use this list before presenting to a real management agency.', 'Usa esta lista antes de presentar a una administradora real.', 'Utilisez cette liste avant de présenter à un vrai gestionnaire.'),
  c('Acesso privado obrigatório', 'Private access required', 'Acceso privado obligatorio', 'Accès privé obligatoire'),
  c('Novos prédios só entram com código aprovado.', 'New buildings can only enter with an approved code.', 'Los edificios nuevos solo entran con código aprobado.', 'Les nouveaux immeubles entrent seulement avec un code approuvé.'),
  c('Ative PRIVATE_CREATE_BUILDING_REQUIRED e emita códigos.', 'Enable PRIVATE_CREATE_BUILDING_REQUIRED and issue codes.', 'Activa PRIVATE_CREATE_BUILDING_REQUIRED y emite códigos.', 'Activez PRIVATE_CREATE_BUILDING_REQUIRED et émettez des codes.'),
  c('Email transacional', 'Transactional email', 'Email transaccional', 'Email transactionnel'),
  c('Convites e resets podem sair por email.', 'Invites and resets can be sent by email.', 'Invitaciones y resets pueden enviarse por email.', 'Invitations et réinitialisations peuvent partir par email.'),
  c('Configure Resend e EMAIL_FROM antes do piloto.', 'Configure Resend and EMAIL_FROM before the pilot.', 'Configura Resend y EMAIL_FROM antes del piloto.', 'Configurez Resend et EMAIL_FROM avant le pilote.'),
  c('Uploads e documentos', 'Uploads and documents', 'Uploads y documentos', 'Uploads et documents'),
  c('R2 está pronto para documentos, recibos e evidências.', 'R2 is ready for documents, receipts, and evidence.', 'R2 está listo para documentos, recibos y evidencias.', 'R2 est prêt pour les documents, reçus et preuves.'),
  c('Configure R2 para não depender de armazenamento local.', 'Configure R2 so pilots do not depend on local storage.', 'Configura R2 para no depender de almacenamiento local.', 'Configurez R2 pour ne pas dépendre du stockage local.'),
  c('Backups estão configurados.', 'Backups are configured.', 'Los backups están configurados.', 'Les sauvegardes sont configurées.'),
  c('Configure backup antes de usar dados reais.', 'Configure backup before using real data.', 'Configura backup antes de usar datos reales.', 'Configurez la sauvegarde avant d’utiliser de vraies données.'),
  c('Observabilidade', 'Observability', 'Observabilidad', 'Observabilité'),
  c('Sentry/PostHog estão configurados.', 'Sentry/PostHog are configured.', 'Sentry/PostHog están configurados.', 'Sentry/PostHog sont configurés.'),
  c('Configure erro e analytics para pilotos.', 'Configure errors and analytics for pilots.', 'Configura errores y analytics para pilotos.', 'Configurez erreurs et analytics pour les pilotes.'),
  c('Fila crítica', 'Critical queue', 'Fila crítica', 'File critique'),
  c('Sem chamados urgentes ou SLA crítico no portfólio.', 'No urgent tickets or critical SLA items in the portfolio.', 'Sin tickets urgentes ni SLA crítico en el portafolio.', 'Aucun ticket urgent ni SLA critique dans le portefeuille.'),
  c('Resolva chamados urgentes ou SLA de fornecedor antes da demo.', 'Resolve urgent tickets or vendor SLA issues before the demo.', 'Resuelve tickets urgentes o SLA de proveedor antes de la demo.', 'Résolvez les tickets urgents ou les SLA prestataires avant la démo.'),
  c('Dois admins da administradora', 'Two agency admins', 'Dos admins de la administradora', 'Deux admins gestionnaire'),
  c('Há redundância de administradores.', 'Admin redundancy is in place.', 'Hay redundancia de administradores.', 'La redondance administrateur est en place.'),
  c('Adicione pelo menos outro admin da administradora.', 'Add at least one more agency admin.', 'Agrega al menos otro admin de la administradora.', 'Ajoutez au moins un autre admin gestionnaire.'),
  c('Todo prédio tem responsável direto.', 'Every building has a direct owner.', 'Cada edificio tiene un responsable directo.', 'Chaque immeuble a un responsable direct.'),
  c('Atribua um responsável direto a cada prédio.', 'Assign a direct owner to each building.', 'Asigna un responsable directo a cada edificio.', 'Attribuez un responsable direct à chaque immeuble.'),
  c('Códigos privados', 'Private codes', 'Códigos privados', 'Codes privés'),
  c('Emita códigos para ativar novos prédios vendidos pela administradora. O código completo aparece apenas uma vez.', 'Issue codes to activate new buildings sold by the management agency. The full code appears only once.', 'Emite códigos para activar nuevos edificios vendidos por la administradora. El código completo aparece solo una vez.', 'Émettez des codes pour activer les nouveaux immeubles vendus par le gestionnaire. Le code complet apparaît une seule fois.'),
  c('Código criado', 'Code created', 'Código creado', 'Code créé'),
  c('Rótulo', 'Label', 'Etiqueta', 'Libellé'),
  c('Ex: piloto Edifício Jardins', 'Ex: Jardins Building pilot', 'Ej: piloto Edificio Jardines', 'Ex: pilote Immeuble Jardins'),
  c('Usos', 'Uses', 'Usos', 'Utilisations'),
  c('usos', 'uses', 'usos', 'utilisations'),
  c('Vence', 'Expires', 'Vence', 'Expire'),
  c('Criar código', 'Create code', 'Crear código', 'Créer un code'),
  c('Códigos emitidos', 'Issued codes', 'Códigos emitidos', 'Codes émis'),
  c('Nenhum código privado emitido ainda.', 'No private codes issued yet.', 'Aún no hay códigos privados emitidos.', 'Aucun code privé émis pour le moment.'),
  c('Código privado', 'Private code', 'Código privado', 'Code privé'),
  c('Ativou', 'Activated', 'Activó', 'A activé'),
  c('prédio', 'building', 'edificio', 'immeuble'),
  c('Ainda não ativou nenhum prédio.', 'No building activated yet.', 'Aún no activó ningún edificio.', 'Aucun immeuble activé pour le moment.'),
  c('Desativar', 'Disable', 'Desactivar', 'Désactiver'),
  c('Não foi possível carregar os códigos privados.', 'Could not load private codes.', 'No se pudieron cargar los códigos privados.', 'Impossible de charger les codes privés.'),
  c('Não foi possível criar o código privado.', 'Could not create the private code.', 'No se pudo crear el código privado.', 'Impossible de créer le code privé.'),
  c('Expirado', 'Expired', 'Expirado', 'Expiré'),
  c('Esgotado', 'Exhausted', 'Agotado', 'Épuisé'),
  c('Exportações operacionais', 'Operational exports', 'Exportaciones operativas', 'Exports opérationnels'),
  c('Baixe dados do portfólio respeitando os prédios permitidos para sua função.', 'Download portfolio data respecting the buildings allowed for your role.', 'Descarga datos del portafolio respetando los edificios permitidos para tu función.', 'Téléchargez les données du portefeuille en respectant les immeubles autorisés pour votre rôle.'),
  c('Sua função não tem exportações liberadas.', 'Your role does not have any exports enabled.', 'Tu función no tiene exportaciones habilitadas.', 'Votre rôle n’a aucune exportation autorisée.'),
  c('Relatório mensal da administradora', 'Monthly agency report', 'Reporte mensual de la administradora', 'Rapport mensuel du gestionnaire'),
  c('Resumo do portfólio', 'Portfolio summary', 'Resumen del portafolio', 'Résumé du portefeuille'),
  c('Prédio ativo', 'Active building', 'Edificio activo', 'Immeuble actif'),
  c('Abrir prédio', 'Open building', 'Abrir edificio', 'Ouvrir l’immeuble'),
  c('Não foi possível trocar de prédio.', 'Could not switch buildings.', 'No se pudo cambiar de edificio.', 'Impossible de changer d’immeuble.'),
  c('Moradores', 'Residents', 'Residentes', 'Résidents'),
  c('Financeiro', 'Finance', 'Finanzas', 'Finances'),
  c('Chamados', 'Tickets', 'Tickets', 'Tickets'),
  c('Ordens de serviço', 'Work orders', 'Órdenes de servicio', 'Ordres de service'),
  c('Auditoria', 'Audit log', 'Auditoría', 'Audit'),
  c('Auditoria recente', 'Recent audit', 'Auditoría reciente', 'Audit récent'),
  c('Últimas ações sensíveis visíveis para sua administradora e seus prédios permitidos.', 'Recent sensitive actions visible to your agency and allowed buildings.', 'Últimas acciones sensibles visibles para tu administradora y tus edificios permitidos.', 'Dernières actions sensibles visibles pour votre gestionnaire et vos immeubles autorisés.'),
  c('Nenhum evento de auditoria ainda.', 'No audit events yet.', 'Aún no hay eventos de auditoría.', 'Aucun événement d’audit pour le moment.'),
  c('Sistema', 'System', 'Sistema', 'Système'),
  c('Revisão de permissões', 'Permission review', 'Revisión de permisos', 'Revue des permissions'),
  c('Confirme que a administradora tem cobertura real por prédio antes de vender ou pilotar.', 'Confirm the agency has real building coverage before selling or piloting.', 'Confirma que la administradora tenga cobertura real por edificio antes de vender o pilotear.', 'Confirmez que le gestionnaire couvre réellement chaque immeuble avant une vente ou un pilote.'),
  c('Admins da administradora', 'Agency admins', 'Admins de la administradora', 'Admins gestionnaire'),
  c('Convites de equipe', 'Team invites', 'Invitaciones del equipo', 'Invitations équipe'),
  c('Cobertura por prédio', 'Building coverage', 'Cobertura por edificio', 'Couverture par immeuble'),
  c('Escopo definido', 'Scoped access', 'Alcance definido', 'Périmètre défini'),
  c('Falhas', 'Failures', 'Fallos', 'Échecs'),
  c('Somente um administrador da agência. Adicione outro antes de pilotos reais.', 'Only one agency admin. Add another before real pilots.', 'Solo hay un admin de la administradora. Agrega otro antes de pilotos reales.', 'Un seul admin gestionnaire. Ajoutez-en un autre avant de vrais pilotes.'),
  c('Sem responsável direto', 'No direct owner', 'Sin responsable directo', 'Sans responsable direct'),
  c('Todos os prédios têm pelo menos uma pessoa responsável.', 'Every building has at least one responsible person.', 'Todos los edificios tienen al menos una persona responsable.', 'Chaque immeuble a au moins une personne responsable.'),
  c('mais', 'more', 'más', 'de plus'),
  c('convites expirados', 'expired invites', 'invitaciones expiradas', 'invitations expirées'),
  c('Equipe da administradora', 'Agency team', 'Equipo de la administradora', 'Équipe du gestionnaire'),
  c('Adicione contas existentes à administradora e limite cada pessoa aos prédios certos. Use o mesmo email para atualizar função ou prédios.', 'Add existing accounts to the agency and limit each person to the right buildings. Use the same email to update role or buildings.', 'Agrega cuentas existentes a la administradora y limita cada persona a los edificios correctos. Usa el mismo email para actualizar función o edificios.', 'Ajoutez des comptes existants au gestionnaire et limitez chaque personne aux bons immeubles. Utilisez le même email pour mettre à jour le rôle ou les immeubles.'),
  c('Email da equipe', 'Team email', 'Email del equipo', 'Email de l’équipe'),
  c('Função', 'Role', 'Función', 'Rôle'),
  c('Prédios permitidos', 'Allowed buildings', 'Edificios permitidos', 'Immeubles autorisés'),
  c('Salvar equipe', 'Save team', 'Guardar equipo', 'Enregistrer l’équipe'),
  c('Membros', 'Members', 'Miembros', 'Membres'),
  c('Nenhum membro de equipe vinculado ainda.', 'No team members linked yet.', 'Aún no hay miembros del equipo vinculados.', 'Aucun membre d’équipe lié pour le moment.'),
  c('Todos os prédios', 'All buildings', 'Todos los edificios', 'Tous les immeubles'),
  c('Sem prédios', 'No buildings', 'Sin edificios', 'Aucun immeuble'),
  c('Admin de administradora', 'Agency admin', 'Admin de administradora', 'Admin gestionnaire'),
  c('Admin de edifício', 'Building admin', 'Admin de edificio', 'Admin immeuble'),
  c('Manutenção', 'Maintenance', 'Mantenimiento', 'Maintenance'),
  c('Supervisor de portaria', 'Front desk supervisor', 'Supervisor de portería', 'Superviseur conciergerie'),
  c('Não foi possível carregar a equipe.', 'Could not load the team.', 'No se pudo cargar el equipo.', 'Impossible de charger l’équipe.'),
  c('Não foi possível salvar a equipe. Verifique se a conta já existe e se há prédios selecionados.', 'Could not save the team. Check that the account already exists and buildings are selected.', 'No se pudo guardar el equipo. Verifica que la cuenta ya exista y que haya edificios seleccionados.', 'Impossible d’enregistrer l’équipe. Vérifiez que le compte existe déjà et que des immeubles sont sélectionnés.'),
  c('Não foi possível remover este membro da equipe.', 'Could not remove this team member.', 'No se pudo remover este miembro del equipo.', 'Impossible de retirer ce membre de l’équipe.'),
  c('Remover', 'Remove', 'Remover', 'Retirer'),
  c('Edifício', 'Building', 'Edificio', 'Immeuble'),
  c('Finanças', 'Finance', 'Finanzas', 'Finances'),
  c('Transparência', 'Transparency', 'Transparencia', 'Transparence'),
  c('Despesas', 'Expenses', 'Gastos', 'Dépenses'),
  c('Sugerir', 'Suggest', 'Sugerir', 'Suggérer'),

  // Board reports / monthly packet
  c('Relatórios', 'Reports', 'Informes', 'Rapports'),
  c('Pacote mensal para conselho, administração e reunião de prestação de contas.', 'Monthly packet for the board, management, and accountability meetings.', 'Paquete mensual para el consejo, la administración y la reunión de rendición de cuentas.', 'Dossier mensuel pour le conseil, la gestion et les réunions de reddition de comptes.'),
  c('Mês do relatório', 'Report month', 'Mes del informe', 'Mois du rapport'),
  c('Atualizar', 'Refresh', 'Actualizar', 'Actualiser'),
  c('Carregando relatório…', 'Loading report…', 'Cargando informe…', 'Chargement du rapport…'),
  c('Não foi possível carregar relatório', 'Could not load report', 'No se pudo cargar el informe', 'Impossible de charger le rapport'),
  c('Dados gerados em', 'Data generated on', 'Datos generados el', 'Données générées le'),
  c('até', 'to', 'hasta', 'au'),
  c('Copiar pacote', 'Copy packet', 'Copiar paquete', 'Copier le dossier'),
  c('Baixar Markdown', 'Download Markdown', 'Descargar Markdown', 'Télécharger Markdown'),
  c('Imprimir', 'Print', 'Imprimir', 'Imprimer'),
  c('Pacote copiado', 'Packet copied', 'Paquete copiado', 'Dossier copié'),
  c('Resumo executivo', 'Executive summary', 'Resumen ejecutivo', 'Résumé exécutif'),
  c('Despesas do mês', 'Monthly expenses', 'Gastos del mes', 'Dépenses du mois'),
  c('lançamento', 'entry', 'movimiento', 'écriture'),
  c('lançamentos', 'entries', 'movimientos', 'écritures'),
  c('gastos registrados no mês', 'spent this month', 'gastados este mes', 'dépensés ce mois-ci'),
  c('Cobranças em aberto', 'Open dues', 'Cobros abiertos', 'Appels ouverts'),
  c('em cobranças abertas', 'in open dues', 'en cobros abiertos', 'en appels ouverts'),
  c('em atraso', 'overdue', 'en mora', 'en retard'),
  c('Chamados abertos', 'Open tickets', 'Tickets abiertos', 'Tickets ouverts'),
  c('chamados abertos', 'open tickets', 'tickets abiertos', 'tickets ouverts'),
  c('urgentes', 'urgent', 'urgentes', 'urgents'),
  c('Ordens abertas', 'Open work orders', 'Órdenes abiertas', 'Ordres ouverts'),
  c('em andamento', 'in progress', 'en curso', 'en cours'),
  c('Propostas ativas', 'Active proposals', 'Propuestas activas', 'Propositions actives'),
  c('propostas ativas', 'active proposals', 'propuestas activas', 'propositions actives'),
  c('fechadas no mês', 'closed this month', 'cerradas este mes', 'closes ce mois-ci'),
  c('Reuniões próximas', 'Upcoming meetings', 'Reuniones próximas', 'Réunions à venir'),
  c('reuniões próximas', 'upcoming meetings', 'reuniones próximas', 'réunions à venir'),
  c('na agenda', 'on the calendar', 'en agenda', 'à l’agenda'),
  c('Riscos e próximos passos', 'Risks and next steps', 'Riesgos y próximos pasos', 'Risques et prochaines étapes'),
  c('Sem riscos críticos detectados.', 'No critical risks detected.', 'No se detectaron riesgos críticos.', 'Aucun risque critique détecté.'),
  c('Próximos passos', 'Next steps', 'Siguientes pasos', 'Prochaines étapes'),
  c('high', 'high', 'alto', 'élevé'),
  c('medium', 'medium', 'medio', 'moyen'),
  c('low', 'low', 'bajo', 'faible'),
  c('chamados urgentes abertos', 'urgent open tickets', 'tickets urgentes abiertos', 'tickets urgents ouverts'),
  c('Problemas urgentes ainda esperam ação.', 'Urgent issues still need action.', 'Los problemas urgentes aún esperan acción.', 'Des problèmes urgents attendent encore une action.'),
  c('Revise a fila de chamados e atribua responsável ou fornecedor hoje.', 'Review the ticket queue and assign an owner or vendor today.', 'Revisa la cola de tickets y asigna responsable o proveedor hoy.', 'Passez en revue la file de tickets et assignez un responsable ou un prestataire aujourd’hui.'),
  c('cobranças estão vencidas', 'dues are overdue', 'cobros están vencidos', 'appels sont en retard'),
  c('Envie lembrete de cobrança para as unidades em atraso.', 'Send a dues reminder to overdue units.', 'Envía recordatorio de cobro a las unidades en mora.', 'Envoyez un rappel de paiement aux lots en retard.'),
  c('ordens de serviço abertas', 'open work orders', 'órdenes de servicio abiertas', 'ordres de service ouverts'),
  c('Há reparos planejados que ainda não foram concluídos.', 'Planned repairs have not been completed yet.', 'Hay reparaciones planificadas que aún no se han completado.', 'Des réparations planifiées ne sont pas encore terminées.'),
  c('Confirme agenda, orçamento, recibo e foto de conclusão com o fornecedor.', 'Confirm schedule, estimate, receipt, and completion photo with the vendor.', 'Confirma agenda, presupuesto, recibo y foto de cierre con el proveedor.', 'Confirmez planning, devis, reçu et photo de fin avec le prestataire.'),
  c('Nenhum fornecedor cadastrado', 'No vendor saved', 'Ningún proveedor registrado', 'Aucun prestataire enregistré'),
  c('O prédio ainda não tem rede operacional reutilizável.', 'The building does not have a reusable operations network yet.', 'El edificio todavía no tiene una red operativa reutilizable.', 'L’immeuble n’a pas encore de réseau opérationnel réutilisable.'),
  c('Cadastre fornecedores de emergência, manutenção, elevador, limpeza e áreas comuns.', 'Add emergency, maintenance, elevator, cleaning, and amenity vendors.', 'Registra proveedores de emergencia, mantenimiento, ascensor, limpieza y áreas comunes.', 'Ajoutez les prestataires d’urgence, maintenance, ascenseur, nettoyage et espaces communs.'),
  c('Resolver chamados urgentes ou atribuir acompanhamento no mesmo dia.', 'Resolve urgent tickets or assign same-day follow-up.', 'Resuelve tickets urgentes o asigna seguimiento el mismo día.', 'Résolvez les tickets urgents ou assignez un suivi le jour même.'),
  c('Enviar lembretes das cobranças vencidas.', 'Send overdue dues reminders.', 'Enviar recordatorios de cobros vencidos.', 'Envoyer les rappels des appels en retard.'),
  c('Atualizar agenda, orçamento, recibo ou foto das ordens de serviço.', 'Update schedule, estimate, receipt, or photos for work orders.', 'Actualizar agenda, presupuesto, recibo o foto de las órdenes de servicio.', 'Mettre à jour planning, devis, reçu ou photo des ordres de service.'),
  c('Revisar propostas ativas antes dos prazos de votação.', 'Review active proposals before voting deadlines.', 'Revisar propuestas activas antes de los plazos de votación.', 'Revoir les propositions actives avant les échéances de vote.'),
  c('Preparar pauta e pacote para as próximas reuniões.', 'Prepare agenda and packet for upcoming meetings.', 'Preparar agenda y paquete para las próximas reuniones.', 'Préparer l’ordre du jour et le dossier des prochaines réunions.'),
  c('Nenhum risco crítico detectado este mês; mantenha o relatório atualizado antes da reunião.', 'No critical risk detected this month; keep the report updated before the meeting.', 'Ningún riesgo crítico detectado este mes; mantén el informe actualizado antes de la reunión.', 'Aucun risque critique détecté ce mois-ci ; gardez le rapport à jour avant la réunion.'),
  c('Categorias de despesa', 'Expense categories', 'Categorías de gasto', 'Catégories de dépenses'),
  c('Unidades em atraso', 'Overdue units', 'Unidades en mora', 'Lots en retard'),
  c('Nenhuma unidade em atraso.', 'No overdue units.', 'Ninguna unidad en mora.', 'Aucun lot en retard.'),
  c('Maiores despesas', 'Largest expenses', 'Mayores gastos', 'Plus grosses dépenses'),
  c('Nenhuma despesa neste mês.', 'No expenses this month.', 'No hay gastos este mes.', 'Aucune dépense ce mois-ci.'),
  c('Sem fornecedor', 'No vendor', 'Sin proveedor', 'Sans prestataire'),
  c('Operação', 'Operations', 'Operación', 'Opérations'),
  c('Chamados por status', 'Tickets by status', 'Tickets por estado', 'Tickets par statut'),
  c('Chamados por prioridade', 'Tickets by priority', 'Tickets por prioridad', 'Tickets par priorité'),
  c('Nenhum chamado ativo.', 'No active tickets.', 'Ningún ticket activo.', 'Aucun ticket actif.'),
  c('Chamados ativos', 'Active tickets', 'Tickets activos', 'Tickets actifs'),
  c('Ordens de serviço ativas', 'Active work orders', 'Órdenes de servicio activas', 'Ordres de service actifs'),
  c('Nenhuma ordem ativa.', 'No active work order.', 'Ninguna orden activa.', 'Aucun ordre actif.'),
  c('Votações e reuniões', 'Votes and meetings', 'Votaciones y reuniones', 'Votes et réunions'),
  c('Propostas em andamento', 'Active proposals', 'Propuestas en curso', 'Propositions en cours'),
  c('Nenhuma proposta ativa.', 'No active proposal.', 'Ninguna propuesta activa.', 'Aucune proposition active.'),
  c('Próximas reuniões', 'Upcoming meetings', 'Próximas reuniones', 'Prochaines réunions'),
  c('Nenhuma reunião próxima.', 'No upcoming meeting.', 'No hay reunión programada.', 'Aucune réunion à venir.'),
  c('Comunicados recentes', 'Recent announcements', 'Avisos recientes', 'Annonces récentes'),
  c('Nenhum comunicado recente.', 'No recent announcement.', 'Ningún aviso reciente.', 'Aucune annonce récente.'),
  c('Rede operacional', 'Operations network', 'Red operativa', 'Réseau opérationnel'),
  c('Taxa média de resposta', 'Average response rate', 'Tasa media de respuesta', 'Taux moyen de réponse'),
  c('Sem histórico', 'No history', 'Sin historial', 'Aucun historique'),
  c('Gasto rastreado', 'Tracked spend', 'Gasto rastreado', 'Dépense suivie'),
  c('Nenhum fornecedor cadastrado.', 'No vendor saved.', 'Ningún proveedor registrado.', 'Aucun prestataire enregistré.'),
  c('open', 'open', 'abierto', 'ouvert'),
  c('waiting', 'waiting', 'en espera', 'en attente'),
  c('resolved', 'resolved', 'resuelto', 'résolu'),
  c('closed', 'closed', 'cerrado', 'fermé'),
  c('draft', 'draft', 'borrador', 'brouillon'),
  c('scheduled', 'scheduled', 'programado', 'programmé'),
  c('completed', 'completed', 'completado', 'terminé'),
  c('cancelled', 'cancelled', 'cancelado', 'annulé'),
  c('utilities', 'utilities', 'servicios', 'services publics'),
  c('cleaning', 'cleaning', 'limpieza', 'nettoyage'),
  c('security', 'security', 'seguridad', 'sécurité'),
  c('staff', 'staff', 'personal', 'personnel'),
  c('admin', 'admin', 'administración', 'administration'),
  c('infrastructure', 'infrastructure', 'infraestructura', 'infrastructure'),
  c('amenity', 'amenity', 'área común', 'équipement'),
  c('insurance', 'insurance', 'seguro', 'assurance'),
  c('tax', 'tax', 'impuesto', 'taxe'),
  c('reserve', 'reserve', 'reserva', 'réserve'),
  c('other', 'other', 'otro', 'autre'),

  // Seed/demo content — translate so the demo looks consistent across locales.
  // Announcements
  c('Piscina reabre na sexta', 'Pool reopens Friday', 'La piscina reabre el viernes', 'La piscine rouvre vendredi'),
  c('A piscina volta a funcionar nesta sexta após a manutenção trimestral. Obrigado pela paciência.', 'The pool reopens this Friday after quarterly maintenance. Thanks for your patience.', 'La piscina vuelve a funcionar este viernes tras el mantenimiento trimestral. Gracias por la paciencia.', 'La piscine rouvre ce vendredi après la maintenance trimestrielle. Merci de votre patience.'),
  c('Simulado de incêndio quinta 10h', 'Fire drill Thursday 10 a.m.', 'Simulacro de incendio jueves 10 h', 'Exercice incendie jeudi 10 h'),
  c('Simulado de incêndio em todo o prédio nesta quinta às 10h. Alarmes vão tocar por uns 10 minutos.', 'Building-wide fire drill this Thursday at 10 a.m. Alarms will sound for about 10 minutes.', 'Simulacro de incendio en todo el edificio este jueves a las 10 h. Las alarmas sonarán unos 10 minutos.', 'Exercice incendie dans tout l’immeuble jeudi à 10 h. Les alarmes sonneront environ 10 minutes.'),
  c('Nova orientação de reciclagem', 'New recycling guidance', 'Nueva orientación de reciclaje', 'Nouvelle consigne de recyclage'),
  c('Desmonte as caixas de papelão antes de colocar no contêiner. Coleta segundas e quintas.', 'Break down cardboard boxes before placing them in the bin. Collection on Mondays and Thursdays.', 'Desmonta las cajas de cartón antes de ponerlas en el contenedor. Recogida lunes y jueves.', 'Démontez les cartons avant de les déposer dans le conteneur. Collecte les lundis et jeudis.'),
  c('Resolvido: Playwright walk — luz hall queimada', 'Resolved: Playwright walk — lobby light out', 'Resuelto: Playwright walk — luz del vestíbulo quemada', 'Résolu : Playwright walk — lumière du hall grillée'),
  c('Resolvido: Playwright test — luz do hall queimada', 'Resolved: Playwright test — lobby light out', 'Resuelto: prueba Playwright — luz del vestíbulo quemada', 'Résolu : test Playwright — lumière du hall grillée'),
  c('Resolvido: Elevador A travando entre andares', 'Resolved: Elevator A stuck between floors', 'Resuelto: Ascensor A trabado entre pisos', 'Résolu : ascenseur A bloqué entre étages'),
  c('Resolução: Lâmpada trocada hoje pela manhã.', 'Resolution: Bulb replaced this morning.', 'Resolución: Bombilla reemplazada esta mañana.', 'Résolution : ampoule remplacée ce matin.'),
  c('Lâmpada trocada hoje pela manhã.', 'Bulb replaced this morning.', 'Bombilla reemplazada esta mañana.', 'Ampoule remplacée ce matin.'),
  c('Otis veio na mesma tarde, trocou a roldana. Funcionando.', 'Otis came the same afternoon, replaced the pulley, and it is working.', 'Otis vino esa misma tarde, cambió la polea y ya funciona.', 'Otis est venu le jour même, a remplacé la poulie, et tout fonctionne.'),
  c('Manutenção programada do elevador nesta sexta-feira das 8h às 18h.', 'Scheduled elevator maintenance this Friday from 8 a.m. to 6 p.m.', 'Mantenimiento programado del ascensor este viernes de 8 h a 18 h.', 'Maintenance programmée de l’ascenseur ce vendredi de 8 h à 18 h.'),
  c('A proposta de reforma foi aprovada em assembleia.', 'The renovation proposal was approved at the assembly.', 'La propuesta de reforma fue aprobada en la asamblea.', 'La proposition de rénovation a été approuvée en assemblée.'),
  c('Redigido pela IA', 'AI-drafted', 'Redactado por IA', 'Rédigé par IA'),

  // Suggestions
  c('O ar do saguão mal está funcionando. Ontem à tarde marcou 30°C aqui dentro.', 'The lobby AC barely works. Yesterday afternoon it hit 30°C in here.', 'El aire del vestíbulo casi no funciona. Ayer por la tarde llegó a 30°C aquí dentro.', 'La clim du hall fonctionne à peine. Hier après-midi il faisait 30°C ici.'),
  c('O saguão está muito quente ultimamente. O ar quebrou?', 'The lobby is very hot lately. Did the AC break?', 'El vestíbulo está muy caliente últimamente. ¿Se rompió el aire?', 'Le hall est très chaud ces derniers temps. La clim est en panne ?'),

  // Proposals
  c('Trocar o ar-condicionado do saguão', 'Replace the lobby air conditioner', 'Cambiar el aire acondicionado del vestíbulo', 'Remplacer la climatisation du hall'),
  c('O ar do saguão falhou duas vezes neste verão. Orçamento da Cool Breeze HVAC para um novo equipamento de 5 TR: R$ 47.000 incluindo instalação e 5 anos de garantia.', 'The lobby AC failed twice this summer. Cool Breeze HVAC quote for new 5-ton equipment: R$ 47,000 including installation and 5-year warranty.', 'El aire del vestíbulo falló dos veces este verano. Presupuesto de Cool Breeze HVAC para un nuevo equipo de 5 TR: R$ 47.000 incluyendo instalación y 5 años de garantía.', 'La clim du hall est tombée en panne deux fois cet été. Devis Cool Breeze HVAC pour nouvel équipement 5 TR : 47 000 R$ incluant installation et garantie 5 ans.'),
  c('Carregadores de carro elétrico nas vagas de visitante', 'EV chargers in visitor spots', 'Cargadores eléctricos en plazas de visita', 'Bornes de recharge sur les places visiteurs'),
  c('Carregadores nível 2 nas 4 vagas de visitante perto do elevador. Estimativa de instalação + equipamento R$ 90.000. Energia consumida cobrada por usuário via cartão RFID.', 'Level 2 chargers in the 4 visitor spots near the elevator. Installation + equipment estimate: R$ 90,000. Power consumed billed per user via RFID card.', 'Cargadores nivel 2 en las 4 plazas de visita cerca del ascensor. Estimación instalación + equipo R$ 90.000. Energía consumida cobrada por usuario vía tarjeta RFID.', 'Bornes niveau 2 sur les 4 places visiteurs près de l’ascenseur. Estimation installation + équipement 90 000 R$. Énergie consommée facturée par utilisateur via carte RFID.'),
  c('Instalar pontos de carregamento para veículos elétricos', 'Install charging points for electric vehicles', 'Instalar puntos de carga para vehículos eléctricos', 'Installer des points de recharge pour véhicules électriques'),
  c('Dois condôminos atualmente possuem veículos elétricos, indicando demanda crescente por infraestrutura de carregamento no estacionamento do condomínio.\n\nPropõe-se a instalação de 2 estações de carregamento de carga rápida (22kW) em locais estratégicos do estacionamento, com sistema de reserva e cobrança proporcional ao consumo de energia.\n\nPróximo passo: solicitar orçamentos de empresas especializadas em infraestrutura de carregamento veicular, avaliar pontos elétricos disponíveis e definir modelo de uso e custeio.', 'Two residents currently own electric vehicles, indicating growing demand for charging infrastructure in the condominium parking area.\n\nThe proposal is to install 2 fast charging stations (22 kW) in strategic parking locations, with a reservation system and proportional billing based on energy consumption.\n\nNext step: request quotes from companies specialized in vehicle-charging infrastructure, assess available electrical points, and define the usage and cost model.', 'Dos condóminos actualmente tienen vehículos eléctricos, lo que indica una demanda creciente de infraestructura de carga en el estacionamiento del condominio.\n\nSe propone instalar 2 estaciones de carga rápida (22 kW) en puntos estratégicos del estacionamiento, con sistema de reserva y cobro proporcional al consumo de energía.\n\nSiguiente paso: solicitar presupuestos a empresas especializadas en infraestructura de carga vehicular, evaluar puntos eléctricos disponibles y definir el modelo de uso y coste.', 'Deux résidents possèdent actuellement des véhicules électriques, ce qui indique une demande croissante d’infrastructure de recharge dans le parking de la copropriété.\n\nLa proposition consiste à installer 2 bornes de recharge rapide (22 kW) à des emplacements stratégiques du parking, avec système de réservation et facturation proportionnelle à la consommation d’énergie.\n\nProchaine étape : demander des devis à des entreprises spécialisées dans l’infrastructure de recharge, évaluer les points électriques disponibles et définir le modèle d’usage et de coût.'),
  c('Carregadores Nível 2 (4 unidades): R$ 60.000\nInstalação elétrica e infraestrutura: R$ 25.000\nSistema de gestão RFID: R$ 10.000', 'Level 2 chargers (4 units): R$ 60,000\nElectrical installation and infrastructure: R$ 25,000\nRFID management system: R$ 10,000', 'Cargadores Nivel 2 (4 unidades): R$ 60.000\nInstalación eléctrica e infraestructura: R$ 25.000\nSistema de gestión RFID: R$ 10.000', 'Bornes niveau 2 (4 unités) : 60 000 R$\nInstallation électrique et infrastructure : 25 000 R$\nSystème de gestion RFID : 10 000 R$'),
  c('A instalação requer reforma significativa no quadro elétrico do condomínio, com possível necessidade de reforço da rede. O consumo de energia pode gerar conflitos entre moradores sobre uso e rateio. Há risco de subutilização se poucos condôminos tiverem carros elétricos.', 'The installation requires significant work on the condominium electrical panel, with a possible need to reinforce the network. Energy consumption may create disputes among residents over usage and cost allocation. There is a risk of underuse if few residents have electric cars.', 'La instalación requiere una reforma significativa del cuadro eléctrico del condominio, con posible necesidad de reforzar la red. El consumo de energía puede generar conflictos entre residentes sobre uso y reparto de costes. Existe riesgo de infrautilización si pocos condóminos tienen coches eléctricos.', 'L’installation nécessite une intervention importante sur le tableau électrique de la copropriété, avec un possible renforcement du réseau. La consommation d’énergie peut générer des conflits entre résidents sur l’usage et la répartition des coûts. Il existe un risque de sous-utilisation si peu de résidents ont des voitures électriques.'),
  c('Adorei. Acabei de comprar um EV e carregar no trabalho é um saco.', 'Love it. I just bought an EV and charging at work is a pain.', 'Me encanta. Acabo de comprar un EV y cargar en el trabajo es un fastidio.', 'J’adore. Je viens d’acheter un VE et recharger au travail est pénible.'),
  c('Quem paga a eletricidade? Não quero ver minha taxa subsidiando o combustível de outros moradores.', 'Who pays the electricity? I don\'t want my fee subsidizing other residents\' fuel.', '¿Quién paga la electricidad? No quiero que mi cuota subsidie el combustible de otros residentes.', 'Qui paie l’électricité ? Je ne veux pas que ma charge subventionne le carburant des autres résidents.'),
  c('A medição por usuário resolve. Pede a planilha de consumo da empresa que vai instalar.', 'Per-user metering solves it. Ask the installer for the consumption sheet.', 'La medición por usuario lo resuelve. Pide a la empresa instaladora la hoja de consumo.', 'Le comptage par utilisateur règle ça. Demandez à l’installateur la fiche de consommation.'),
  c('R$ 90 mil parece alto. Dá pra pegar um segundo orçamento?', 'R$ 90k seems high. Can we get a second quote?', 'R$ 90 mil parece alto. ¿Podemos pedir un segundo presupuesto?', '90 000 R$ semble élevé. Peut-on demander un deuxième devis ?'),
  c('Duas vagas já basta por agora. Dá pra expandir depois se aparecer demanda.', 'Two spots are enough for now. We can expand later if demand shows up.', 'Dos plazas bastan por ahora. Podemos ampliar después si aparece demanda.', 'Deux places suffisent pour l’instant. On pourra agrandir plus tard si la demande arrive.'),

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
  c('Se seu prédio já está no CondoOS, entre com o código que o síndico mandou.', 'If your building is already on CondoOS, sign in with the code your board admin shared.', 'Si tu edificio ya está en CondoOS, entra con el código que te dio el administrador.', 'Si votre immeuble est déjà sur CondoOS, connectez-vous avec le code envoyé par le syndic.'),
  c('Novos prédios são ativados pela administradora ou equipe CONDOS com código privado.', 'New buildings are activated by the management agency or CONDOS team with a private code.', 'Los edificios nuevos son activados por la administradora o el equipo de CONDOS con un código privado.', 'Les nouveaux immeubles sont activés par la société de gestion ou l’équipe CONDOS avec un code privé.'),
  c('Se não, monte um novo — você é o primeiro síndico.', 'If not, set up a new one — you are the first board admin.', 'Si no, crea uno nuevo — tú serás el primer administrador.', 'Sinon, créez-en un nouveau — vous serez le premier syndic.'),
  c('Aguardando aprovação', 'Waiting for approval', 'Esperando aprobación', 'En attente d’approbation'),
  c('Você reivindicou', 'You claimed', 'Reclamaste', 'Vous avez revendiqué'),
  c('como', 'as', 'como', 'en tant que'),
  c('O síndico vai analisar em breve.', 'The board admin will review shortly.', 'El administrador lo revisará pronto.', 'Le syndic va vérifier sous peu.'),
  c('O administrador vai analisar em breve.', 'The admin will review shortly.', 'El administrador lo revisará pronto.', 'L’administrateur va vérifier sous peu.'),
  c('Entrar num prédio', 'Join a building', 'Unirse a un edificio', 'Rejoindre un immeuble'),
  c('Tenho um código de convite de 6 caracteres do meu síndico. Vou inserir, escolher minha unidade e ocupar meu lugar.', 'I have a 6-character invite code from my board admin. I’ll enter it, pick my unit, and take my seat.', 'Tengo un código de invitación de 6 caracteres del administrador. Lo ingreso, elijo mi unidad y ocupo mi lugar.', 'J’ai un code d’invitation à 6 caractères du syndic. Je l’entre, choisis mon lot, et prends ma place.'),
  c('Tenho um código de convite de 6 caracteres do meu administrador. Vou inserir, escolher minha unidade e ocupar meu lugar.', 'I have a 6-character invite code from my admin. I’ll enter it, choose my unit, and take my place.', 'Tengo un código de invitación de 6 caracteres de mi administrador. Lo ingreso, elijo mi unidad y ocupo mi lugar.', 'J’ai un code d’invitation à 6 caractères de mon administrateur. Je l’entre, choisis mon lot et prends ma place.'),
  c('Inserir código', 'Enter code', 'Ingresar código', 'Saisir le code'),
  c('Montar um novo prédio', 'Set up a new building', 'Crear un nuevo edificio', 'Configurer un nouvel immeuble'),
  c('Criação privada para administradoras e prédios aprovados. Tenha em mãos o código de ativação antes de começar.', 'Private creation for management agencies and approved buildings. Have the activation code ready before you start.', 'Creación privada para administradoras y edificios aprobados. Ten a mano el código de activación antes de empezar.', 'Création privée pour les sociétés de gestion et immeubles approuvés. Préparez le code d’activation avant de commencer.'),
  c('Meu condomínio ainda não está no sistema. Me guie pelo cadastro: nome, unidades e código de convite.', 'My condominium isn’t in the system yet. Guide me through setup: name, units, and invite code.', 'Mi condominio todavía no está en el sistema. Guíame en la configuración: nombre, unidades y código de invitación.', 'Ma copropriété n’est pas encore dans le système. Guidez-moi : nom, lots, et code d’invitation.'),
  c('Ativar com código privado', 'Activate with private code', 'Activar con código privado', 'Activer avec un code privé'),
  c('Começar o cadastro', 'Start setup', 'Empezar configuración', 'Commencer la configuration'),
  c('Só explorando?', 'Just exploring?', '¿Solo explorando?', 'Vous explorez ?'),
  c('Entre como demo (administrador ou morador)', 'Sign in as demo (admin or resident)', 'Entrar como demo (administrador o residente)', 'Connectez-vous en démo (administrateur ou résident)'),
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
  c('Você foi convidado(a) para', 'You were invited to', 'Te invitaron a', 'Vous avez été invité(e) à'),
  c('no CondoOS. Entre por este link (o código já vem preenchido):', 'on CondoOS. Join through this link (the code is already filled in):', 'en CondoOS. Entra por este enlace (el código ya viene rellenado):', 'sur CondoOS. Rejoignez via ce lien (le code est déjà rempli) :'),
  c('Convite', 'Invitation', 'Invitación', 'Invitation'),
  c('Set up a building', 'Set up a building', 'Crear un edificio', 'Configurer un immeuble'),

  // AI-drafted proposal copy that exists in production demo data. Adding
  // these here so the existing demo proposals translate; new proposals get
  // drafted in the user's locale via the locale param on /ai/proposal-draft.
  c('Reparar ou substituir esteira #3 com ruído excessivo', 'Repair or replace treadmill #3 with excessive noise', 'Reparar o sustituir cinta #3 con ruido excesivo', 'Réparer ou remplacer le tapis #3 trop bruyant'),
  c('A esteira #3 na academia está produzindo ruído anormal durante o uso, potencialmente indicando desgaste mecânico.', 'Treadmill #3 in the gym is producing abnormal noise during use, potentially indicating mechanical wear.', 'La cinta #3 del gimnasio produce un ruido anormal durante el uso, lo que indica posible desgaste mecánico.', 'Le tapis #3 de la salle de sport produit un bruit anormal pendant l’utilisation, indiquant probablement une usure mécanique.'),
  c('A esteira #3 na academia está produzindo ruído anormal durante o uso, potencialmente indicando desgaste mecânico ou problema estrutural. O ruído excessivo pode comprometer a experiência dos usuários e sinalizar necessidade de manutenção.', 'Treadmill #3 in the gym is producing abnormal noise during use, potentially indicating mechanical wear or a structural issue. The excessive noise can hurt the user experience and signal the need for maintenance.', 'La cinta #3 del gimnasio produce ruido anormal durante el uso, lo que puede indicar desgaste mecánico o un problema estructural. El ruido excesivo puede afectar la experiencia de los usuarios y señalar necesidad de mantenimiento.', 'Le tapis #3 de la salle de sport produit un bruit anormal pendant l’utilisation, indiquant possiblement une usure mécanique ou un problème structurel. Le bruit excessif peut nuire à l’expérience des utilisateurs et signaler un besoin d’entretien.'),
  c('Realizar inspeção técnica completa na esteira, verificando componentes como rolamentos, correia e sistema de amortecimento. Dependendo do diagnóstico, proceder com reparo pontual ou substituição do equipamento.', 'Carry out a full technical inspection of the treadmill, checking components like bearings, belt, and shock-absorption system. Depending on the diagnosis, proceed with a targeted repair or replace the equipment.', 'Realizar una inspección técnica completa de la cinta, revisando rodamientos, banda y sistema de amortiguación. Según el diagnóstico, proceder con reparación puntual o reemplazo del equipo.', 'Effectuer une inspection technique complète du tapis, en vérifiant les composants comme les roulements, la courroie et le système d’amortissement. Selon le diagnostic, procéder à une réparation ciblée ou au remplacement de l’équipement.'),
  c('Próximo passo: agendar vistoria com técnico especializado em equipamentos de fitness, com objetivo de avaliar e solucionar o problema em até 15 dias.', 'Next step: schedule an inspection with a fitness-equipment technician, aiming to assess and resolve the issue within 15 days.', 'Siguiente paso: programar una visita con un técnico especializado en equipos de fitness, con el objetivo de evaluar y resolver el problema en 15 días.', 'Prochaine étape : planifier une visite avec un technicien spécialisé en équipements de fitness, dans le but d’évaluer et de résoudre le problème sous 15 jours.'),
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
  c('Comece com um padrão e ajuste capacidade, horários de funcionamento e duração dos slots.', 'Start from a template and adjust capacity, opening hours, and slot length.', 'Empieza desde una plantilla y ajusta capacidad, horario de funcionamiento y duración de los turnos.', 'Partez d’un modèle puis ajustez la capacité, les horaires d’ouverture et la durée des créneaux.'),
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
  c('As reservas abrem todo domingo ao meio-dia para a semana em curso. O administrador controla apenas horários, duração e capacidade.', 'Reservations open every Sunday at midday for the current week. Admins only control hours, duration, and capacity.', 'Las reservas abren cada domingo al mediodía para la semana en curso. El administrador solo controla horarios, duración y capacidad.', 'Les réservations ouvrent chaque dimanche à midi pour la semaine en cours. L’administrateur ne contrôle que les horaires, la durée et la capacité.'),
  c('Otis Elevadores SP', 'Otis Elevators SP', 'Otis Ascensores SP', 'Otis Ascenseurs SP'),
  c('Manutenção Geral SP', 'General Maintenance SP', 'Mantenimiento General SP', 'Maintenance générale SP'),
  c('Manutenção Geral SP Teste', 'General Maintenance SP Test', 'Mantenimiento General SP Prueba', 'Maintenance générale SP Test'),
  c('Manutenção corretiva e preventiva de elevadores', 'Corrective and preventive elevator maintenance', 'Mantenimiento correctivo y preventivo de ascensores', 'Maintenance corrective et préventive des ascenseurs'),
  c('Encanador Plantão 24h', '24h Plumbing On Call', 'Fontanero de guardia 24 h', 'Plombier d’astreinte 24 h'),
  c('Pequenos reparos, troca de lâmpadas, fechaduras', 'Small repairs, bulb replacement, locks', 'Reparaciones menores, cambio de bombillas, cerraduras', 'Petites réparations, remplacement d’ampoules, serrures'),
  c('Vazamentos, entupimentos, emergências hidráulicas', 'Leaks, clogs, plumbing emergencies', 'Fugas, atascos, emergencias de fontanería', 'Fuites, bouchons, urgences plomberie'),
  c('Reservar com antecedência', 'Booking lead time', 'Reservar con antelación', 'Réservation à l’avance'),
  c('Número de dias que aparecem para os moradores.', 'Number of days residents see in the booking calendar.', 'Días que ven los residentes en el calendario.', 'Nombre de jours visibles par les résidents.'),
  c('Status', 'Status', 'Estado', 'Statut'),
  // Dashboard action feed
  c('Aprovar visitante', 'Approve visitor', 'Aprobar visitante', 'Approuver le visiteur'),
  c('Visitante chegou', 'Visitor arrived', 'Visitante llegó', 'Visiteur arrivé'),
  c('Visitante aprovado', 'Visitor approved', 'Visitante aprobado', 'Visiteur approuvé'),
  c('Visitante recusado', 'Visitor rejected', 'Visitante rechazado', 'Visiteur refusé'),
  c('Recusar', 'Reject', 'Rechazar', 'Refuser'),
  c('Aprovar', 'Approve', 'Aprobar', 'Approuver'),
  c('Revisar', 'Review', 'Revisar', 'Examiner'),
  c('Encomenda aguardando', 'Package waiting', 'Paquete esperando', 'Colis en attente'),
  c('Comida chegou', 'Food delivery arrived', 'Comida llegó', 'Livraison de repas arrivée'),
  c('Marcar como retirado', 'Mark picked up', 'Marcar retirado', 'Marquer comme retiré'),
  c('Encomenda retirada', 'Package picked up', 'Paquete retirado', 'Colis retiré'),
  c('Pagamento pendente', 'Payment due', 'Pago pendiente', 'Paiement dû'),
  c('Abrir cobranças', 'Open charges', 'Abrir cobros', 'Ouvrir les appels'),
  c('Reserva hoje', 'Reservation today', 'Reserva hoy', 'Réservation aujourd’hui'),
  c('Ver reserva', 'View booking', 'Ver reserva', 'Voir la réservation'),
  c('Votar agora', 'Vote now', 'Votar ahora', 'Voter maintenant'),
  c('Chamado atualizado', 'Ticket updated', 'Ticket actualizado', 'Ticket mis à jour'),
  c('Acompanhar', 'Follow up', 'Dar seguimiento', 'Suivre'),
  c('Pronto', 'Done', 'Listo', 'Terminé'),
  c('1 morador aguardando aprovação', '1 resident waiting for approval', '1 residente espera aprobación', '1 résident attend une approbation'),
  c('moradores aguardando aprovação', 'residents waiting for approval', 'residentes esperan aprobación', 'résidents attendent une approbation'),
  c('1 chamado precisa de atenção', '1 ticket needs attention', '1 ticket necesita atención', '1 ticket demande attention'),
  c('chamados precisam de atenção', 'tickets need attention', 'tickets necesitan atención', 'tickets demandent attention'),
  c('em cobranças abertas', 'open in dues', 'abiertos en cobros', 'ouverts en appels'),
  c('Abrir finanças', 'Open finance', 'Abrir finanzas', 'Ouvrir les finances'),
  c('1 proposta precisa de análise de orçamento', '1 proposal needs budget analysis', '1 propuesta necesita análisis de presupuesto', '1 proposition nécessite une analyse budgétaire'),
  c('propostas precisam de análise de orçamento', 'proposals need budget analysis', 'propuestas necesitan análisis de presupuesto', 'propositions nécessitent une analyse budgétaire'),
  c('Adicionar análise', 'Add analysis', 'Agregar análisis', 'Ajouter l’analyse'),
  c('Conflito de reserva', 'Reservation conflict', 'Conflicto de reserva', 'Conflit de réservation'),
  c('Revisar horários', 'Review slots', 'Revisar horarios', 'Examiner les créneaux'),
  c('Reunião próxima', 'Upcoming meeting', 'Reunión programada', 'Réunion à venir'),
  c('Preparar', 'Prepare', 'Preparar', 'Préparer'),
  c('Nada urgente agora', 'Nothing urgent right now', 'Nada urgente ahora', 'Rien d’urgent pour le moment'),
  c('Nenhuma aprovação, cobrança vencida, chamado urgente ou bloqueio de reunião precisa de ação.', 'No approvals, overdue dues, urgent tickets, or meeting blockers need action.', 'No hay aprobaciones, cobros vencidos, tickets urgentes ni bloqueos de reunión pendientes.', 'Aucune approbation, aucun appel en retard, ticket urgent ou blocage de réunion à traiter.'),
  c('Manter atenção', 'Stay ready', 'Mantenerse listo', 'Rester prêt'),
  c('Visitante precisa de aprovação do morador', 'Visitor needs resident approval', 'Visitante necesita aprobación del residente', 'Le visiteur doit être approuvé par le résident'),
  c('Avisar morador', 'Notify resident', 'Avisar al residente', 'Notifier le résident'),
  c('Morador avisado', 'Resident notified', 'Residente avisado', 'Résident notifié'),
  c('Visitante pré-aprovado esperado', 'Pre-approved visitor expected', 'Visitante preaprobado esperado', 'Visiteur préapprouvé attendu'),
  c('Registrar entrada', 'Register entry', 'Registrar entrada', 'Enregistrer l’entrée'),
  c('Entrada registrada', 'Entry registered', 'Entrada registrada', 'Entrée enregistrée'),
  c('Lista de festa hoje', 'Party guest list today', 'Lista de invitados de fiesta hoy', 'Liste d’invités aujourd’hui'),
  c('listas de festa hoje', 'party guest lists today', 'listas de invitados de fiesta hoy', 'listes d’invités aujourd’hui'),
  c('Use a busca para encontrar nomes, unidade, anfitrião ou área.', 'Use search to find guest names, unit, host, or amenity.', 'Usa la búsqueda para encontrar invitados, unidad, anfitrión o área.', 'Utilisez la recherche pour trouver invités, lot, hôte ou espace.'),
  c('Buscar lista', 'Search list', 'Buscar en lista', 'Chercher dans la liste'),
  c('Portaria sem pendências', 'Front desk is clear', 'Portería sin pendientes', 'Conciergerie dégagée'),
  c('Nenhum visitante, pacote ou lista de festa precisa de atenção agora.', 'No expected visitors, packages, or party lists need attention right now.', 'No hay visitantes, paquetes ni listas de fiesta pendientes ahora.', 'Aucun visiteur, colis ou liste d’invités ne demande attention.'),
  c('Continuar atento', 'Keep watch', 'Seguir atento', 'Continuer la veille'),
  c('Comando da portaria', 'Front desk command', 'Comando de portería', 'Poste de conciergerie'),
  c('Visitantes, encomendas e festas esperados para a portaria.', 'Expected visitors, packages, and parties for the guard desk.', 'Visitantes, paquetes y fiestas esperados para portería.', 'Visiteurs, colis et événements attendus à la conciergerie.'),
  c('ativo', 'active', 'activos', 'actifs'),
  c('Eventos', 'Events', 'Eventos', 'Événements'),
  c('Ativa para reservas', 'Active for bookings', 'Activa para reservas', 'Active pour les réservations'),
  c('Inativa', 'Inactive', 'Inactiva', 'Inactive'),
  c('Observações internas', 'Internal notes', 'Notas internas', 'Notes internes'),
  c('Nenhuma área comum cadastrada ainda. Crie a primeira para liberar reservas aos moradores.', 'No amenities set up yet. Create the first one to enable bookings.', 'Aún no hay áreas comunes. Crea la primera para habilitar reservas.', 'Aucun espace commun configuré. Créez le premier pour activer les réservations.'),
  // Board operations — trusted vendors and service contacts
  c('contato ativo', 'active contact', 'contacto activo', 'contact actif'),
  c('contatos ativos', 'active contacts', 'contactos activos', 'contacts actifs'),
  c('atende emergência', 'handles emergencies', 'atiende emergencias', 'gère les urgences'),
  c('atendem emergência', 'handle emergencies', 'atienden emergencias', 'gèrent les urgences'),
  c('Inteligência de fornecedores', 'Vendor intelligence', 'Inteligencia de proveedores', 'Intelligence prestataires'),
  c('Scorecards baseados em respostas, ordens de serviço e despesas já registradas.', 'Scorecards based on replies, work orders, and expenses already recorded.', 'Scorecards basados en respuestas, órdenes de trabajo y gastos ya registrados.', 'Scorecards basés sur les réponses, ordres de service et dépenses déjà enregistrés.'),
  c('Taxa média de resposta', 'Average response rate', 'Tasa media de respuesta', 'Taux de réponse moyen'),
  c('sem histórico', 'no history', 'sin historial', 'aucun historique'),
  c('fornecedor medido', 'measured vendor', 'proveedor medido', 'prestataire mesuré'),
  c('fornecedores medidos', 'measured vendors', 'proveedores medidos', 'prestataires mesurés'),
  c('Ordens abertas', 'Open work orders', 'Órdenes abiertas', 'Ordres ouverts'),
  c('em andamento ou agendadas', 'in progress or scheduled', 'en curso o programadas', 'en cours ou planifiés'),
  c('Gasto rastreado', 'Tracked spend', 'Gasto rastreado', 'Dépenses suivies'),
  c('ligado a fornecedores', 'linked to vendors', 'vinculado a proveedores', 'lié aux prestataires'),
  c('Scorecard', 'Scorecard', 'Scorecard', 'Scorecard'),
  c('Resposta', 'Response', 'Respuesta', 'Réponse'),
  c('sem dado', 'no data', 'sin datos', 'aucune donnée'),
  c('respondidas', 'answered', 'respondidas', 'répondues'),
  c('Ordens', 'Orders', 'Órdenes', 'Ordres'),
  c('abertas', 'open', 'abiertas', 'ouvertes'),
  c('canceladas', 'cancelled', 'canceladas', 'annulées'),
  c('Gasto', 'Spend', 'Gasto', 'Dépense'),
  c('recibo', 'receipt', 'recibo', 'reçu'),
  c('recibos', 'receipts', 'recibos', 'reçus'),
  c('sem recibos', 'no receipts', 'sin recibos', 'aucun reçu'),
  c('Sem histórico ainda. Quando houver respostas, ordens ou gastos, eles aparecerão aqui.', 'No history yet. When there are replies, orders, or spend, they will appear here.', 'Sin historial todavía. Cuando haya respuestas, órdenes o gastos, aparecerán aquí.', 'Aucun historique pour l’instant. Les réponses, ordres et dépenses apparaîtront ici.'),
  c('última resposta:', 'last reply:', 'última respuesta:', 'dernière réponse :'),
  c('última ordem:', 'last order:', 'última orden:', 'dernier ordre :'),
  c('último gasto:', 'last spend:', 'último gasto:', 'dernière dépense :'),
  c('minuto', 'minute', 'minuto', 'minute'),
  c('minutos', 'minutes', 'minutos', 'minutes'),
  c('hora', 'hour', 'hora', 'heure'),
  c('horas', 'hours', 'horas', 'heures'),
  c('dia', 'day', 'día', 'jour'),
  c('dias', 'days', 'días', 'jours'),
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
  c('Por que esse plano — evidências e memória do prédio', 'Why this plan — evidence and building memory', 'Por qué este plan — evidencia y memoria del edificio', "Pourquoi ce plan — preuves et mémoire de l'immeuble"),
  c('IA disponível', 'AI available', 'IA disponible', 'IA disponible'),
  c('IA indisponível', 'AI unavailable', 'IA no disponible', 'IA indisponible'),
  c('Auto-dispatch ativo', 'Auto-dispatch active', 'Auto-despacho activo', 'Auto-dispatch actif'),
  c('Auto-dispatch pausado', 'Auto-dispatch paused', 'Auto-despacho pausado', 'Auto-dispatch en pause'),
  c('Auto-dispatch ligado', 'Auto-dispatch enabled', 'Auto-despacho activado', 'Auto-dispatch activé'),
  c('Chamados verificados são enviados ao fornecedor automaticamente após a janela de cancelamento.', 'Verified tickets are sent to the vendor automatically after the cancellation window.', 'Los tickets verificados se envían automáticamente al proveedor después de la ventana de cancelación.', 'Les tickets vérifiés sont envoyés automatiquement au prestataire après la fenêtre d’annulation.'),
  c('O agente continua analisando, mas nenhum disparo automático é enviado. Aprovação manual obrigatória.', 'The agent keeps analyzing, but no automatic dispatch is sent. Manual approval is required.', 'El agente sigue analizando, pero no se envía ningún despacho automático. La aprobación manual es obligatoria.', 'L’agent continue d’analyser, mais aucun dispatch automatique n’est envoyé. Approbation manuelle obligatoire.'),
  c('Uso dos últimos 7 dias', 'Usage over the last 7 days', 'Uso de los últimos 7 días', 'Utilisation des 7 derniers jours'),
  c('Circuito de créditos aberto até', 'Credit circuit open until', 'Circuito de créditos abierto hasta', 'Circuit de crédits ouvert jusqu’à'),
  c('Mostra chamadas reais ao modelo, tokens e custo estimado para o condomínio ativo.', 'Shows real model calls, tokens, and estimated cost for the active condominium.', 'Muestra llamadas reales al modelo, tokens y coste estimado para el condominio activo.', 'Affiche les appels réels au modèle, les tokens et le coût estimé pour la copropriété active.'),
  c('Chamadas', 'Calls', 'Llamadas', 'Appels'),
  c('Tokens', 'Tokens', 'Tokens', 'Tokens'),
  c('Custo est.', 'Est. cost', 'Coste est.', 'Coût estimé'),
  c('Maior uso', 'Top usage', 'Mayor uso', 'Plus forte utilisation'),
  c('tokens', 'tokens', 'tokens', 'tokens'),
  c('Iniciando análise', 'Starting analysis', 'Iniciando análisis', 'Démarrage de l’analyse'),
  c('Muitas análises simultâneas — usando checklist padrão', 'Too many simultaneous analyses — using standard checklist', 'Demasiados análisis simultáneos — usando checklist estándar', 'Trop d’analyses simultanées — utilisation de la liste standard'),
  c('Consultando histórico do prédio com ferramentas', 'Checking building history with tools', 'Consultando historial del edificio con herramientas', 'Consultation de l’historique de l’immeuble avec outils'),
  c('Consultando histórico do prédio', 'Checking building history', 'Consultando historial del edificio', 'Consultation de l’historique de l’immeuble'),
  c('Buscando chamados anteriores parecidos', 'Searching similar past tickets', 'Buscando tickets anteriores similares', 'Recherche de tickets similaires passés'),
  c('Consultando histórico do fornecedor', 'Checking vendor history', 'Consultando historial del proveedor', 'Consultation de l’historique du prestataire'),
  c('Listando fornecedores cadastrados', 'Listing saved vendors', 'Listando proveedores guardados', 'Liste des prestataires enregistrés'),
  c('Detectando padrões abertos', 'Detecting open patterns', 'Detectando patrones abiertos', 'Détection des tendances ouvertes'),
  c('Compondo resposta final', 'Composing final answer', 'Componiendo respuesta final', 'Composition de la réponse finale'),
  c('Ferramentas falharam — gerando plano direto', 'Tools failed — generating a direct plan', 'Fallaron las herramientas — generando plan directo', 'Les outils ont échoué — génération d’un plan direct'),
  c('IA indisponível — checklist seguro', 'AI unavailable — safe checklist', 'IA no disponible — checklist seguro', 'IA indisponible — liste sûre'),
  c('O serviço de IA não está disponível agora. Este checklist é operacional, mas não foi personalizado pelo modelo; use-o como triagem e tente gerar novamente quando a IA voltar.', 'The AI service is not available right now. This checklist is operational, but it was not personalized by the model; use it for triage and generate again when AI is back.', 'El servicio de IA no está disponible ahora. Este checklist es operativo, pero no fue personalizado por el modelo; úsalo como triaje e intenta generar de nuevo cuando vuelva la IA.', "Le service d'IA n'est pas disponible pour le moment. Cette liste est opérationnelle, mais elle n'a pas été personnalisée par le modèle ; utilisez-la pour le triage et regénérez lorsque l'IA revient."),
  c('IA incompleta — checklist seguro', 'AI incomplete — safe checklist', 'IA incompleta — checklist seguro', 'IA incomplète — liste sûre'),
  c('O agente não conseguiu concluir uma resposta sob medida, então mostramos um checklist seguro para não travar o fluxo. Você ainda pode copiar mensagens, procurar fornecedores e continuar a conversa.', 'The agent could not complete a tailored answer, so we showed a safe checklist instead of blocking the flow. You can still copy messages, search for vendors, and continue the conversation.', 'El agente no pudo completar una respuesta a medida, así que mostramos un checklist seguro para no bloquear el flujo. Aún puedes copiar mensajes, buscar proveedores y continuar la conversación.', "L'agent n'a pas pu terminer une réponse sur mesure, donc nous affichons une liste sûre pour ne pas bloquer le flux. Vous pouvez toujours copier les messages, chercher des prestataires et continuer la conversation."),
  c('repair', 'repair', 'reparación', 'réparation'),
  c('install', 'install', 'instalación', 'installation'),
  c('vendor_research', 'vendor research', 'investigación de proveedores', 'recherche prestataires'),
  c('general', 'general', 'general', 'général'),
  c('Resumo', 'Summary', 'Resumen', 'Résumé'),
  c('Copiar', 'Copy', 'Copiar', 'Copier'),
  c('Próximo passo', 'Next step', 'Siguiente paso', 'Prochaine étape'),
  c('Rede cadastrada', 'Saved network', 'Red guardada', 'Réseau enregistré'),
  c('Opções', 'Options', 'Opciones', 'Options'),
  c('Prós', 'Pros', 'Ventajas', 'Avantages'),
  c('Contras', 'Cons', 'Desventajas', 'Inconvénients'),
  c('Custo', 'Cost', 'Costo', 'Coût'),
  c('Prazo', 'Timeline', 'Plazo', 'Délai'),
  c('Perguntas para fornecedor', 'Questions for vendor', 'Preguntas para proveedor', 'Questions au prestataire'),
  c('Critérios', 'Criteria', 'Criterios', 'Critères'),
  c('Plano de pesquisa', 'Research plan', 'Plan de investigación', 'Plan de recherche'),
  c('Evidências usadas', 'Evidence used', 'Evidencias usadas', 'Preuves utilisées'),
  c('Chamado anterior', 'Past ticket', 'Ticket anterior', 'Ticket précédent'),
  c('Histórico do fornecedor', 'Vendor history', 'Historial del proveedor', 'Historique prestataire'),
  c('Citação web', 'Web citation', 'Cita web', 'Citation web'),
  c('Foto', 'Photo', 'Foto', 'Photo'),
  c('Padrão', 'Pattern', 'Patrón', 'Tendance'),
  c('Fora do expediente', 'After hours', 'Fuera de horario', 'Hors horaires'),
  c('Pesquisa de fornecedores', 'Vendor research', 'Investigación de proveedores', 'Recherche prestataires'),
  c('past_ticket', 'past ticket', 'ticket anterior', 'ticket précédent'),
  c('vendor_history', 'vendor history', 'historial del proveedor', 'historique prestataire'),
  c('web_citation', 'web citation', 'cita web', 'citation web'),
  c('photo', 'photo', 'foto', 'photo'),
  c('pattern', 'pattern', 'patrón', 'tendance'),
  c('after_hours', 'after hours', 'fuera de horario', 'hors horaires'),
  c('Abrir fonte', 'Open source', 'Abrir fuente', 'Ouvrir la source'),
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
  c('Linha', 'Line', 'Línea', 'Ligne'),
  c('Faltou email ou unidade', 'Missing email or unit', 'Falta email o unidad', 'E-mail ou lot manquant'),
  c('Email inválido', 'Invalid email', 'Email inválido', 'E-mail invalide'),
  c('Unidade não encontrada', 'Unit not found', 'Unidad no encontrada', 'Lot introuvable'),
  c('Já convidado', 'Already invited', 'Ya invitado', 'Déjà invité'),
  c('Criar e enviar convites', 'Create and send invites', 'Crear y enviar invitaciones', 'Créer et envoyer les invitations'),
  c('Criar convites', 'Create invites', 'Crear invitaciones', 'Créer les invitations'),
  c('Convites pendentes', 'Pending invites', 'Invitaciones pendientes', 'Invitations en attente'),
  c('principal', 'primary', 'principal', 'principal'),
  c('owner', 'owner', 'propietario', 'propriétaire'),
  c('tenant', 'tenant', 'inquilino', 'locataire'),
  c('occupant', 'occupant', 'ocupante', 'occupant'),
  c('Unidade', 'Unit', 'Unidad', 'Lot'),
  c('Copiado', 'Copied', 'Copiado', 'Copié'),
  c('Copiar', 'Copy', 'Copiar', 'Copier'),
  c('falha no email', 'email failed', 'falló el email', 'échec de l’e-mail'),
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
  // Incident Loop UX round 1 — dispatch status + channel labels, modal copy,
  // section headers. PT canonical strings match the constants in BoardTickets.tsx.
  c('na fila',      'queued',     'en cola',    'en attente'),
  c('enviado',      'sent',       'enviado',    'envoyé'),
  c('falhou',       'failed',     'falló',      'échec'),
  c('respondeu',    'responded',  'respondió',  'a répondu'),
  c('cancelado',    'cancelled',  'cancelado',  'annulé'),
  c('WhatsApp',     'WhatsApp',   'WhatsApp',   'WhatsApp'),
  c('email',        'email',      'correo',     'email'),
  c('manual',       'manual',     'manual',     'manuel'),
  c('Resposta do fornecedor', "Vendor's reply", 'Respuesta del proveedor', 'Réponse du prestataire'),
  c('O que o fornecedor respondeu?', 'What did the vendor reply?', '¿Qué respondió el proveedor?', "Qu'a répondu le prestataire ?"),
  c('Ex: Confirmado para amanhã às 10h. Trazem a peça nova.', 'Ex: Confirmed for tomorrow at 10am. Bringing the new part.', 'Ej: Confirmado para mañana a las 10h. Traen la pieza nueva.', 'Ex: Confirmé pour demain 10h. Apportent la nouvelle pièce.'),
  c('Registrar',    'Record',     'Registrar',  'Enregistrer'),
  c('Resolvidos pela comunidade', 'Resolved by the community', 'Resueltos por la comunidad', 'Résolus par la communauté'),
  c('Chamados privados', 'Private tickets', 'Tickets privados', 'Tickets privés'),
  c('Resolvidos',   'Resolved',   'Resueltos',  'Résolus'),
  c('baixa',        'low',        'baja',       'basse'),
  c('alta',         'high',       'alta',       'haute'),
  c('urgente',      'urgent',     'urgente',    'urgent'),
  // UX round 2 — vendor category labels (replace raw enum render
  // `general_maintenance`). Keys are PT labels emitted by vendorCategoryLabel.
  c('Manutenção geral', 'General maintenance', 'Mantenimiento general', 'Maintenance générale'),
  c('Manutenção',      'Maintenance',         'Mantenimiento',         'Maintenance'),
  c('Elétrica',         'Electrical',          'Eléctrica',             'Électrique'),
  c('Hidráulica',       'Plumbing',            'Fontanería',            'Plomberie'),
  c('Climatização',     'HVAC',                'Climatización',         'Climatisation'),
  c('Elevador',         'Elevator',            'Ascensor',              'Ascenseur'),
  c('Limpeza',          'Cleaning',            'Limpieza',              'Nettoyage'),
  c('Segurança',        'Security',            'Seguridad',             'Sécurité'),
  c('Segurança / acesso', 'Security / access', 'Seguridad / acceso',    'Sécurité / accès'),
  c('Áreas comuns',     'Amenities',           'Áreas comunes',         'Espaces communs'),
  c('Segurança contra incêndio', 'Fire safety', 'Seguridad contra incendios', 'Sécurité incendie'),
  c('Gás',              'Gas',                 'Gas',                   'Gaz'),
  c('Gás (vazamento)',  'Gas (leak)',          'Gas (fuga)',            'Gaz (fuite)'),
  c('Hidráulica (vazamento)', 'Plumbing (leak)', 'Fontanería (fuga)', 'Plomberie (fuite)'),
  c('Jardinagem',       'Landscaping',         'Jardinería',            'Jardinage'),
  c('Internet / CCTV',  'Internet / CCTV',     'Internet / CCTV',       'Internet / CCTV'),
  c('Controle de pragas', 'Pest control',      'Control de plagas',     'Lutte antiparasitaire'),
  c('Administrativo / jurídico', 'Admin / legal', 'Administrativo / legal', 'Administratif / juridique'),
  c('Outros',           'Other',               'Otros',                 'Autres'),
  // Round 3 — picker enhancements + reporter byline
  c('Adicionar novo fornecedor', 'Add new vendor', 'Añadir nuevo proveedor', 'Ajouter un prestataire'),
  c('somente telefone', 'phone only', 'solo teléfono', 'téléphone uniquement'),
  // Pilot-readiness round — resident timeline strings.
  c('Linha do tempo', 'Timeline', 'Línea de tiempo', 'Chronologie'),
  c('Chamado criado', 'Ticket created', 'Ticket creado', 'Ticket créé'),
  c('Verificado pela comunidade', 'Verified by community', 'Verificado por la comunidad', 'Vérifié par la communauté'),
  c('Chamado atualizado', 'Ticket updated', 'Ticket actualizado', 'Ticket mis à jour'),
  c('Comentário adicionado', 'Comment added', 'Comentario agregado', 'Commentaire ajouté'),
  c('Nota interna adicionada', 'Internal note added', 'Nota interna agregada', 'Note interne ajoutée'),
  c('Anexo adicionado', 'Attachment added', 'Adjunto agregado', 'Pièce jointe ajoutée'),
  c('Ordem de serviço atualizada', 'Work order updated', 'Orden de trabajo actualizada', 'Ordre de service mis à jour'),
  c('Acionamento cancelado', 'Dispatch cancelled', 'Contacto cancelado', 'Contact annulé'),
  c('interno', 'internal', 'interno', 'interne'),
  c('Vizinhos confirmaram o problema', 'Neighbours confirmed the issue', 'Los vecinos confirmaron el problema', 'Les voisins ont confirmé le problème'),
  c('IA gerou plano de remediação', 'AI generated remediation plan', 'IA generó plan de remediación', "L'IA a généré un plan de remédiation"),
  c('Síndico acionou', 'Manager dispatched', 'El administrador contactó', 'Le syndic a contacté'),
  c('vizinho', 'neighbour', 'vecino', 'voisin'),
  c('fornecedor', 'vendor', 'proveedor', 'prestataire'),
  c('Aguardando síndico — sem fornecedor disponível', 'Awaiting manager — no vendor available', 'Esperando al administrador — sin proveedor disponible', 'En attente du syndic — aucun prestataire disponible'),
  c('Sem resposta do fornecedor — síndico vai retomar', 'No response from vendor — manager will follow up', 'Sin respuesta del proveedor — el administrador retomará', 'Pas de réponse du prestataire — le syndic va relancer'),
  c('Fornecedor não pôde atender — síndico vai acionar outro', 'Vendor could not take the job — manager will contact another', 'El proveedor no pudo atender — el administrador contactará a otro', 'Le prestataire n\'a pas pu intervenir — le syndic en contactera un autre'),
  c('Problema resolvido', 'Issue resolved', 'Problema resuelto', 'Problème résolu'),
  // Vendor auto-rewire toast (BoardServices) — fired when a new contact
  // unsticks tickets that were blocked on no_vendor_in_category.
  c('Contato salvo — 1 chamado bloqueado foi reaberto.', 'Contact saved — 1 blocked ticket was reopened.', 'Contacto guardado — se reabrió 1 ticket bloqueado.', 'Contact enregistré — 1 ticket bloqué a été rouvert.'),
  c('Contato salvo —', 'Contact saved —', 'Contacto guardado —', 'Contact enregistré —'),
  c('chamados bloqueados foram reabertos.', 'blocked tickets were reopened.', 'tickets bloqueados fueron reabiertos.', 'tickets bloqués ont été rouverts.'),
  // Admin inbox banner (BoardTickets) — surfaces escalated work at top of page.
  c('1 chamado esperando você', '1 ticket waiting for you', '1 ticket esperando por ti', '1 ticket en attente de votre intervention'),
  c('chamados esperando você', 'tickets waiting for you', 'tickets esperando por ti', 'tickets en attente de votre intervention'),
  c('sem fornecedor', 'no vendor', 'sin proveedor', 'aucun prestataire'),
  // Plural-suffix variant — kept distinct so the (n) marker only renders when count>1.
  c('sem fornecedor (n)', 'no vendor', 'sin proveedor', 'aucun prestataire'),
  c('sem resposta do fornecedor', 'no vendor reply', 'sin respuesta del proveedor', 'aucune réponse du prestataire'),
  c('fornecedor recusou', 'vendor declined', 'proveedor rechazó', 'prestataire a refusé'),
  c('sem resposta do fornecedor (n)', 'no vendor reply', 'sin respuesta del proveedor', 'aucune réponse du prestataire'),
  // Agent workbench overhaul — replaces the broken search-queries panel
  // and the standalone "Mensagem para fornecedores" with per-vendor send
  // buttons backed by POST /api/service-contacts/:id/outreach.
  c('Copiloto operacional para consertos, instalações e decisões — usa a sua rede de fornecedores cadastrada para sugerir e enviar o próximo passo.', 'Operations copilot for repairs, installs, and decisions — uses your saved vendor network to suggest and send the next step.', 'Copiloto operativo para reparaciones, instalaciones y decisiones — usa tu red de proveedores guardada para sugerir y enviar el siguiente paso.', 'Copilote opérationnel pour réparations, installations et décisions — utilise votre réseau de prestataires enregistré pour suggérer et envoyer la prochaine étape.'),
  c('Usa a rede de serviços, áreas comuns e propostas do condomínio para sugerir o próximo passo — e te dá um botão para enviar a mensagem ao fornecedor certo direto pelo WhatsApp.', 'Uses the building\'s saved services, amenities, and proposals to suggest a next step — and gives you a button to send the message to the right vendor by WhatsApp.', 'Usa los servicios guardados, espacios comunes y propuestas para sugerir el siguiente paso — y te da un botón para enviar el mensaje al proveedor correcto por WhatsApp.', 'Utilise les services enregistrés, espaces communs et propositions pour suggérer la prochaine étape — et vous donne un bouton pour envoyer le message au bon prestataire par WhatsApp.'),
  c('Pesquisa externa só aparece com fontes; sem provedor configurado, o agente mostra buscas manuais e não inventa fornecedores ou preços.', 'External research only appears with sources; without a configured provider, the agent shows manual searches and does not invent vendors or prices.', 'La investigación externa solo aparece con fuentes; sin un proveedor configurado, el agente muestra búsquedas manuales y no inventa proveedores ni precios.', 'La recherche externe apparaît uniquement avec des sources ; sans fournisseur configuré, l’agent affiche des recherches manuelles et n’invente pas de prestataires ni de prix.'),
  c('Sua rede cadastrada', 'Your saved network', 'Tu red guardada', 'Votre réseau enregistré'),
  c('Copiar mensagem genérica', 'Copy generic message', 'Copiar mensaje genérico', 'Copier le message générique'),
  c('Enviar mensagem', 'Send message', 'Enviar mensaje', 'Envoyer le message'),
  c('Sem contato no cadastro', 'No contact details saved', 'Sin contacto guardado', 'Aucun contact enregistré'),
  c('Nenhum fornecedor da sua rede combina com essa categoria.', 'No vendor in your network matches this category.', 'Ningún proveedor de tu red coincide con esta categoría.', 'Aucun prestataire de votre réseau ne correspond à cette catégorie.'),
  c('Sem bloqueio: use o plano de pesquisa abaixo para procurar opções agora, ou cadastre o fornecedor escolhido para a próxima vez.', 'No blocker: use the research plan below to look for options now, or save the chosen vendor for next time.', 'Sin bloqueo: usa el plan de investigación abajo para buscar opciones ahora, o guarda el proveedor elegido para la próxima vez.', 'Pas de blocage : utilisez le plan de recherche ci-dessous pour trouver des options maintenant, ou enregistrez le prestataire choisi pour la prochaine fois.'),
  c('Buscar fornecedores', 'Search vendors', 'Buscar proveedores', 'Chercher des prestataires'),
  c('Ver plano', 'View plan', 'Ver plan', 'Voir le plan'),
  c('Cadastrar fornecedor', 'Save vendor', 'Guardar proveedor', 'Enregistrer le prestataire'),
  c('Ir para Operação', 'Go to Operations', 'Ir a Operación', 'Aller à Opérations'),
  c('Recomendação', 'Recommendation', 'Recomendación', 'Recommandation'),
  c('Enviar para', 'Send to', 'Enviar a', 'Envoyer à'),
  c('Você pode editar antes de enviar.', 'You can edit before sending.', 'Puedes editar antes de enviar.', 'Vous pouvez modifier avant d\'envoyer.'),
  c('não cadastrado', 'not saved', 'no guardado', 'non enregistré'),
  c('Escreva uma mensagem curta e direta. Ex: "Olá Ricardo, elevador A parando entre andares. Pode vir hoje?"', 'Write a short, direct message. E.g. "Hi Ricardo, elevator A is stopping between floors. Can you come today?"', 'Escribe un mensaje corto y directo. Ej: "Hola Ricardo, el ascensor A se detiene entre pisos. ¿Puedes venir hoy?"', 'Écrivez un message court et direct. Ex : "Bonjour Ricardo, l\'ascenseur A s\'arrête entre les étages. Peux-tu venir aujourd\'hui ?"'),
  c('Enviar agora', 'Send now', 'Enviar ahora', 'Envoyer maintenant'),
  c('Mensagem enviada', 'Message sent', 'Mensaje enviado', 'Message envoyé'),
  c('Falha ao enviar mensagem', 'Failed to send message', 'Error al enviar el mensaje', 'Échec de l\'envoi du message'),
  c('Mensagem vazia', 'Empty message', 'Mensaje vacío', 'Message vide'),
  // Cost history chip — surfaces real spend from expenses ledger on each
  // vendor card so the admin sees concrete numbers regardless of model output.
  c('Histórico', 'History', 'Historial', 'Historique'),
  c('última vez', 'last time', 'última vez', 'la dernière fois'),
  c('média', 'avg', 'media', 'moy.'),
  // Overview agent-in-action strip — pulls from /api/tickets/recent-auto-actions.
  c('Agente em ação', 'Agent in action', 'Agente en acción', 'Agent en action'),
  c('Ver todos', 'See all', 'Ver todos', 'Tout voir'),
  c('Sem fornecedor cadastrado', 'No vendor saved', 'Sin proveedor guardado', 'Aucun prestataire enregistré'),
  c('Verificado', 'Verified', 'Verificado', 'Vérifié'),
  c('Fornecedor acionado', 'Vendor dispatched', 'Proveedor contactado', 'Prestataire contacté'),
  c('IA gerou plano', 'AI generated plan', 'IA generó plan', "L'IA a généré un plan"),
  c('Sem resposta do fornecedor', 'No vendor reply', 'Sin respuesta del proveedor', 'Aucune réponse du prestataire'),
  c('Resolvido', 'Resolved', 'Resuelto', 'Résolu'),
  c('Fornecedor respondeu', 'Vendor responded', 'Proveedor respondió', 'Prestataire a répondu'),
  // Outreach modal — honest delivery state + provider info.
  c('De:', 'From:', 'De:', 'De :'),
  c('Sessão WhatsApp', 'WhatsApp session', 'Sesión WhatsApp', 'Session WhatsApp'),
  c('Atenção: WhatsApp não está conectado', 'Heads up: WhatsApp is not connected', 'Atención: WhatsApp no está conectado', 'Attention : WhatsApp n\'est pas connecté'),
  c('verifique a sessão', 'check the session', 'verifica la sesión', 'vérifiez la session'),
  c('Esse número parece ser do dado de demonstração. A mensagem vai ser enfileirada mas não chega a um WhatsApp real. Atualize o cadastro do fornecedor com um número de teste antes de enviar.', 'This number looks like demo data. The message will queue but won\'t reach a real WhatsApp. Update the vendor record with a test number before sending.', 'Este número parece de datos de demostración. El mensaje se pondrá en cola pero no llegará a un WhatsApp real. Actualiza el contacto con un número de prueba antes de enviar.', 'Ce numéro ressemble à des données de démonstration. Le message sera mis en file mais n\'atteindra pas un vrai WhatsApp. Mettez à jour le contact avec un numéro de test avant d\'envoyer.'),
  c('Enfileirada para envio', 'Queued for sending', 'En cola para envío', 'En file pour envoi'),
  c('Enviando…', 'Sending…', 'Enviando…', 'Envoi…'),
  c('Mensagem entregue ao provedor', 'Delivered to provider', 'Entregado al proveedor', 'Remis au prestataire'),
  c('Falha na entrega', 'Delivery failed', 'Error en la entrega', 'Échec de la livraison'),
  c('Mensagem ignorada', 'Message skipped', 'Mensaje omitido', 'Message ignoré'),
  c('Destino:', 'To:', 'Destino:', 'Destination :'),
  c('Erro:', 'Error:', 'Error:', 'Erreur :'),
  c('O provedor aceitou. Veja sua sessão de WhatsApp para confirmar entrega real.', 'Provider accepted. Check your WhatsApp session to confirm real delivery.', 'El proveedor aceptó. Revisa tu sesión de WhatsApp para confirmar la entrega real.', 'Le prestataire a accepté. Consultez votre session WhatsApp pour confirmer la livraison réelle.'),
  c('Fechar', 'Close', 'Cerrar', 'Fermer'),
  // Sidebar WhatsApp health pill (j) + vendor form test button (k).
  c('Verificando WhatsApp…', 'Checking WhatsApp…', 'Verificando WhatsApp…', 'Vérification WhatsApp…'),
  c('Não configurado', 'Not configured', 'No configurado', 'Non configuré'),
  c('desconectado', 'disconnected', 'desconectado', 'déconnecté'),
  c('conectado', 'connected', 'conectado', 'connecté'),
  c('Enviar teste', 'Send test', 'Enviar prueba', 'Envoyer un test'),
  c('Enviando teste…', 'Sending test…', 'Enviando prueba…', 'Envoi du test…'),
  c('Teste enfileirado — verifique seu WhatsApp.', 'Test queued — check your WhatsApp.', 'Prueba en cola — revisa tu WhatsApp.', 'Test en file — vérifiez votre WhatsApp.'),
  c('Falha ao enviar teste', 'Failed to send test', 'Error al enviar prueba', 'Échec de l\'envoi du test'),
  // Cost-history confidence tiering + action-plan label change.
  c('Valor de referência', 'Reference value', 'Valor de referencia', 'Valeur de référence'),
  c('1 cobrança anterior', '1 prior expense', '1 cargo anterior', '1 dépense antérieure'),
  c('cobranças anteriores', 'prior expenses', 'cargos anteriores', 'dépenses antérieures'),
  c('Peça orçamento atualizado.', 'Request an updated quote.', 'Solicita una cotización actualizada.', 'Demandez un devis actualisé.'),
  c('Próximos passos manuais', 'Manual next steps', 'Siguientes pasos manuales', 'Prochaines étapes manuelles'),
  // Building memory section — past resolutions + patterns + after-hours.
  c('Memória do prédio', 'Building memory', 'Memoria del edificio', 'Mémoire du bâtiment'),
  c('Padrão detectado', 'Pattern detected', 'Patrón detectado', 'Motif détecté'),
  c('chamados abertos da mesma categoria nos últimos 30 dias. Considere vistoria preventiva antes que vire emergência.', 'open tickets in the same category in the last 30 days. Consider a preventive inspection before it becomes an emergency.', 'tickets abiertos de la misma categoría en los últimos 30 días. Considera una inspección preventiva antes de que sea una emergencia.', 'tickets ouverts dans la même catégorie sur les 30 derniers jours. Envisagez une inspection préventive avant que cela ne devienne une urgence.'),
  c('Fora do horário comercial agora', 'Outside business hours now', 'Fuera del horario comercial ahora', 'Hors des heures ouvrables'),
  c('Para tarefas não urgentes, prefira contatar amanhã de manhã.', 'For non-urgent tasks, prefer contacting tomorrow morning.', 'Para tareas no urgentes, prefiere contactar mañana por la mañana.', 'Pour les tâches non urgentes, préférez contacter demain matin.'),
  c('Resoluções anteriores', 'Past resolutions', 'Resoluciones anteriores', 'Résolutions antérieures'),
  // Conversational thread — workbench becomes thread-based.
  c('Conversas', 'Conversations', 'Conversaciones', 'Conversations'),
  c('Nova conversa', 'New conversation', 'Nueva conversación', 'Nouvelle conversation'),
  c('Conversas recentes', 'Recent conversations', 'Conversaciones recientes', 'Conversations récentes'),
  c('Conversa sem título', 'Untitled conversation', 'Conversación sin título', 'Conversation sans titre'),
  c('turno', 'turn', 'turno', 'tour'),
  c('turnos', 'turns', 'turnos', 'tours'),
  c('Turno', 'Turn', 'Turno', 'Tour'),
  c('Turnos anteriores', 'Previous turns', 'Turnos anteriores', 'Tours précédents'),
  c('Você', 'You', 'Tú', 'Vous'),
  c('Agente', 'Agent', 'Agente', 'Agent'),
  c('Continuar a conversa', 'Continue the conversation', 'Continuar la conversación', 'Continuer la conversation'),
  c('o agente lembra o que vocês discutiram acima', 'the agent remembers what you discussed above', 'el agente recuerda lo que discutieron arriba', 'l\'agent se souvient de ce que vous avez discuté plus haut'),
  c('ex: "E se Ricardo disser que está ocupado?" ou "Quanto tempo costuma demorar?"', 'e.g. "What if Ricardo says he\'s busy?" or "How long does it usually take?"', 'ej.: "¿Y si Ricardo dice que está ocupado?" o "¿Cuánto suele tardar?"', 'ex. « Et si Ricardo dit qu\'il est occupé ? » ou « Combien de temps cela prend-il généralement ? »'),
  c('Enviar', 'Send', 'Enviar', 'Envoyer'),
  c('Escreva sua pergunta de acompanhamento.', 'Write your follow-up question.', 'Escribe tu pregunta de seguimiento.', 'Écrivez votre question de suivi.'),
  c('Falha ao enviar pergunta', 'Failed to send question', 'Error al enviar pregunta', 'Échec de l\'envoi de la question'),
  c('Falha ao abrir conversa', 'Failed to open conversation', 'Error al abrir conversación', 'Échec de l\'ouverture de la conversation'),
  c('Arquivar essa conversa?', 'Archive this conversation?', '¿Archivar esta conversación?', 'Archiver cette conversation ?'),
  c('Falha ao arquivar', 'Failed to archive', 'Error al archivar', 'Échec de l\'archivage'),
  c('Arquivar', 'Archive', 'Archivar', 'Archiver'),
  // Veto window UI on auto-dispatched scheduled sends.
  c('Envio agendado pela IA em', 'AI send scheduled in', 'Envío programado por la IA en', 'Envoi programmé par l\'IA dans'),
  c('— você pode cancelar antes.', '— you can cancel before then.', '— puedes cancelar antes.', '— vous pouvez annuler avant.'),
  c('Cancelar envio', 'Cancel send', 'Cancelar envío', 'Annuler l\'envoi'),
  c('Cancelando…', 'Cancelling…', 'Cancelando…', 'Annulation…'),
  c('Envio cancelado', 'Send cancelled', 'Envío cancelado', 'Envoi annulé'),
  c('Falha ao cancelar', 'Failed to cancel', 'Error al cancelar', 'Échec de l\'annulation'),
  c('Cancelado:', 'Cancelled:', 'Cancelado:', 'Annulé :'),
  c('admin_cancelled', 'manually cancelled by admin', 'cancelado manualmente por el administrador', 'annulé manuellement par l\'administrateur'),
  // ReAct thinking-trace pane (roadmap item 4). Tool names are
  // translated to friendly phrases so the trace reads as steps the
  // admin recognises, not server-internal endpoints.
  c('Como o agente pesquisou', 'How the agent researched', 'Cómo el agente investigó', "Comment l'agent a recherché"),
  c('search_past_tickets', 'searched past tickets', 'buscó tickets anteriores', 'a cherché les anciens tickets'),
  c('get_vendor_history', 'pulled vendor history', 'consultó el historial del proveedor', "a consulté l'historique du prestataire"),
  c('list_vendors', 'listed saved vendors', 'listó proveedores guardados', 'a listé les prestataires enregistrés'),
  c('get_open_similar_tickets', 'checked pattern', 'verificó patrón', 'a vérifié le motif'),
  c('submit_final_answer', 'composed final plan', 'compuso el plan final', 'a composé le plan final'),

  // Buyer-readiness Phase 1 — action feeds, command center, and guard search.
  c('Hoje na sua unidade', 'Today in your unit', 'Hoy en tu unidad', 'Aujourd’hui dans votre lot'),
  c('Fast actions so you do not have to hunt through menus.', 'Fast actions so you do not have to hunt through menus.', 'Acciones rápidas para que no tengas que buscar en menús.', 'Actions rapides pour éviter de chercher dans les menus.'),
  c('Nada urgente', 'Nothing urgent', 'Nada urgente', 'Rien d’urgent'),
  c('Nothing needs your attention right now.', 'Nothing needs your attention right now.', 'Nada necesita tu atención ahora.', 'Rien ne demande votre attention pour l’instant.'),
  c('Aprovar visitante', 'Approve visitor', 'Aprobar visitante', 'Approuver le visiteur'),
  c('Revisar', 'Review', 'Revisar', 'Vérifier'),
  c('Encomenda aguardando', 'Package waiting', 'Paquete esperando', 'Colis en attente'),
  c('Ver encomenda', 'See package', 'Ver paquete', 'Voir le colis'),
  c('Pagamento pendente', 'Payment due', 'Pago pendiente', 'Paiement dû'),
  c('Abrir cobranças', 'Open charges', 'Ver cobros', 'Voir les charges'),
  c('Reserva hoje', 'Reservation today', 'Reserva hoy', 'Réservation aujourd’hui'),
  c('Ver reserva', 'View booking', 'Ver reserva', 'Voir la réservation'),
  c('Vote agora', 'Vote now', 'Vota ahora', 'Votez maintenant'),
  c('Votar', 'Vote', 'Votar', 'Voter'),
  c('Chamado atualizado', 'Ticket updated', 'Ticket actualizado', 'Ticket mis à jour'),
  c('Acompanhar', 'Follow up', 'Seguir', 'Suivre'),
  c('Central de comando', 'Command center', 'Centro de comando', 'Centre de commande'),
  c('Start with what needs a decision, approval, or follow-up today.', 'Start with what needs a decision, approval, or follow-up today.', 'Empieza por lo que necesita decisión, aprobación o seguimiento hoy.', 'Commencez par ce qui demande une décision, validation ou relance aujourd’hui.'),
  c('Tudo limpo', 'All clear', 'Todo claro', 'Tout est clair'),
  c('itens', 'items', 'ítems', 'éléments'),
  c('Tudo que precisa da sua atenção no', 'Everything that needs your attention at', 'Todo lo que necesita tu atención en', 'Tout ce qui demande votre attention à'),
  c('1 morador esperando aprovação', '1 resident waiting for approval', '1 residente esperando aprobación', '1 résident en attente d’approbation'),
  c('moradores esperando aprovação', 'residents waiting for approval', 'residentes esperando aprobación', 'résidents en attente d’approbation'),
  c('1 chamado precisa de atenção', '1 ticket needs attention', '1 ticket necesita atención', '1 ticket demande de l’attention'),
  c('chamados precisam de atenção', 'tickets need attention', 'tickets necesitan atención', 'tickets demandent de l’attention'),
  c('Verified, blocked, or waiting for admin action.', 'Verified, blocked, or waiting for admin action.', 'Verificados, bloqueados o esperando acción del administrador.', 'Vérifiés, bloqués ou en attente d’action admin.'),
  c('1 sugestão de morador', '1 resident suggestion', '1 sugerencia de residente', '1 suggestion de résident'),
  c('sugestões de moradores', 'resident suggestions', 'sugerencias de residentes', 'suggestions de résidents'),
  c('Cluster, promote, or dismiss before they pile up.', 'Cluster, promote, or dismiss before they pile up.', 'Agrupa, promueve o descarta antes de que se acumulen.', 'Regroupez, promouvez ou ignorez avant accumulation.'),
  c('1 proposta ativa', '1 active proposal', '1 propuesta activa', '1 proposition active'),
  c('propostas ativas', 'active proposals', 'propuestas activas', 'propositions actives'),
  c('Keep budgets, analysis, quorum, and voting windows moving.', 'Keep budgets, analysis, quorum, and voting windows moving.', 'Mantén presupuesto, análisis, quórum y ventanas de votación avanzando.', 'Faites avancer budgets, analyses, quorum et fenêtres de vote.'),
  c('1 reunião próxima', '1 upcoming meeting', '1 reunión programada', '1 réunion à venir'),
  c('reuniões próximas', 'upcoming meetings', 'reuniones por venir', 'réunions à venir'),
  c('Prepare agenda, notes, decisions, and resident updates.', 'Prepare agenda, notes, decisions, and resident updates.', 'Prepara agenda, notas, decisiones y avisos para residentes.', 'Préparez ordre du jour, notes, décisions et mises à jour résidents.'),
  c('Nothing urgent right now', 'Nothing urgent right now', 'Nada urgente ahora', 'Rien d’urgent pour l’instant'),
  c('Your building has no admin blockers in the command center.', 'Your building has no admin blockers in the command center.', 'Tu edificio no tiene bloqueos administrativos en el centro de comando.', 'Votre immeuble n’a aucun blocage admin dans le centre de commande.'),
  c('1 sugestão de morador esperando', '1 resident suggestion waiting', '1 sugerencia de residente esperando', '1 suggestion de résident en attente'),
  c('Novo visitante', 'New visitor', 'Nuevo visitante', 'Nouveau visiteur'),
  c('para', 'for', 'para', 'pour'),
  c('s/n', 'n/a', 's/n', 's/o'),
  c('Nova encomenda', 'New package', 'Nuevo paquete', 'Nouveau colis'),
  c('Para', 'For', 'Para', 'Pour'),
  c('Ativar notificações', 'Enable notifications', 'Activar notificaciones', 'Activer les notifications'),
  c('Notificações bloqueadas', 'Notifications blocked', 'Notificaciones bloqueadas', 'Notifications bloquées'),
  c('Notificações ativadas', 'Notifications enabled', 'Notificaciones activadas', 'Notifications activées'),
  c('Search unit, resident, visitor, package, or party', 'Search unit, resident, visitor, package, or party', 'Busca unidad, residente, visitante, paquete o fiesta', 'Rechercher lot, résident, visiteur, colis ou fête'),
  c('Search front desk queue', 'Search front desk queue', 'Buscar en la fila de portería', 'Rechercher dans la file conciergerie'),
  c('Clear search', 'Clear search', 'Limpiar búsqueda', 'Effacer la recherche'),
  c('matching front desk items', 'matching front desk items', 'resultados de portería', 'éléments de conciergerie trouvés'),
  c('No matching arrivals.', 'No matching arrivals.', 'No hay llegadas que coincidan.', 'Aucune arrivée correspondante.'),
  c('Atualiza a cada', 'Updates every', 'Actualiza cada', 'Actualisation toutes les'),
  c('automaticamente', 'automatically', 'automáticamente', 'automatiquement'),
  c('Encerradas', 'Closed', 'Cerradas', 'Closes'),
  c('Cria a proposta direto em discussão. Você define quórum + janela e abre a votação quando quiser.', 'Creates the proposal directly in discussion. You set quorum + window and open voting when ready.', 'Crea la propuesta directamente en discusión. Defines quórum + ventana y abres la votación cuando quieras.', 'Crée la proposition directement en discussion. Vous définissez quorum + fenêtre et ouvrez le vote quand vous voulez.'),
  c('Título (ex: Trocar o portão da garagem)', 'Title (e.g. Replace the garage gate)', 'Título (ej.: Cambiar el portón del garaje)', 'Titre (ex. remplacer le portail du garage)'),
  c('Contexto, motivo, o que vai mudar. Quanto mais claro, mais fácil pros moradores votarem.', 'Context, reason, what will change. The clearer it is, the easier residents can vote.', 'Contexto, motivo y qué cambiará. Mientras más claro, más fácil votan los residentes.', 'Contexte, raison, ce qui changera. Plus c’est clair, plus le vote est simple.'),
  c('Custo estimado (opcional)', 'Estimated cost (optional)', 'Costo estimado (opcional)', 'Coût estimé (facultatif)'),
  c('ex: 47000', 'e.g. 47000', 'ej.: 47000', 'ex. 47000'),
  c('Criar proposta', 'Create proposal', 'Crear propuesta', 'Créer la proposition'),
  c('por', 'by', 'por', 'par'),
  c('Todas as decisões do seu prédio — passadas, atuais e em andamento.', 'Every building decision — past, current, and in progress.', 'Todas las decisiones de tu edificio — pasadas, actuales y en curso.', 'Toutes les décisions de l’immeuble — passées, actuelles et en cours.'),
  c('cadastradas para reserva', 'registered for booking', 'registradas para reserva', 'enregistrées pour réservation'),
  c('Nenhuma área comum cadastrada ainda. Crie a primeira para liberar reservas aos moradores.', 'No amenity has been registered yet. Create the first one to enable resident bookings.', 'Aún no hay áreas comunes registradas. Crea la primera para habilitar reservas.', 'Aucun espace commun enregistré. Créez le premier pour ouvrir les réservations.'),
  c('Desativar reservas para', 'Deactivate bookings for', 'Desactivar reservas para', 'Désactiver les réservations pour'),
  c('Reservas antigas ficam no histórico.', 'Past bookings stay in history.', 'Las reservas antiguas quedan en el historial.', 'Les anciennes réservations restent dans l’historique.'),
  c('Tipo visual', 'Visual type', 'Tipo visual', 'Type visuel'),
  c('Descrição', 'Description', 'Descripción', 'Description'),
  c('Pessoas por slot', 'People per slot', 'Personas por turno', 'Personnes par créneau'),
  c('Duração do slot', 'Slot length', 'Duración del turno', 'Durée du créneau'),
  c('minutos', 'minutes', 'minutos', 'minutes'),
  c('Abre às', 'Opens at', 'Abre a las', 'Ouvre à'),
  c('Fecha às', 'Closes at', 'Cierra a las', 'Ferme à'),
  c('As reservas abrem todo domingo ao meio-dia para a semana em curso. O administrador controla apenas horários, duração e capacidade.', 'Reservations open every Sunday at midday for the current week. The admin only controls hours, duration, and capacity.', 'Las reservas abren cada domingo al mediodía para la semana en curso. El administrador solo controla horarios, duración y capacidad.', 'Les réservations ouvrent chaque dimanche à midi pour la semaine en cours. L’admin contrôle seulement horaires, durée et capacité.'),
  c('Ativa para reservas', 'Active for bookings', 'Activa para reservas', 'Active pour réservation'),
  c('Inativa', 'Inactive', 'Inactiva', 'Inactive'),
  c('Observações internas', 'Internal notes', 'Observaciones internas', 'Notes internes'),
  c('Padel Court', 'Padel Court', 'Cancha de pádel', 'Court de padel'),
  c('Football Field', 'Football Field', 'Cancha de fútbol', 'Terrain de football'),
  c('Basketball Court', 'Basketball Court', 'Cancha de básquet', 'Terrain de basket'),
  c('Tennis Court', 'Tennis Court', 'Cancha de tenis', 'Court de tennis'),
  c('Party Room', 'Party Room', 'Salón de fiestas', 'Salle des fêtes'),
  c('Weights, cardio and stretching area', 'Weights, cardio and stretching area', 'Pesas, cardio y zona de estiramiento', 'Poids, cardio et zone d’étirement'),
  c('Reservation by court, up to four players', 'Reservation by court, up to four players', 'Reserva por cancha, hasta cuatro jugadores', 'Réservation par court, jusqu’à quatre joueurs'),
  c('Shared field reservation for one group', 'Shared field reservation for one group', 'Reserva de campo compartido para un grupo', 'Réservation du terrain partagé pour un groupe'),
  c('Half-court or full-court booking', 'Half-court or full-court booking', 'Reserva de media cancha o cancha completa', 'Réservation demi-terrain ou terrain complet'),
  c('Singles or doubles court booking', 'Singles or doubles court booking', 'Reserva para singles o dobles', 'Réservation simple ou double'),
  c('Pool deck and swimming area', 'Pool deck and swimming area', 'Zona de piscina y deck', 'Bassin et plage de piscine'),
  c('Event room with kitchen and tables', 'Event room with kitchen and tables', 'Salón de eventos con cocina y mesas', 'Salle d’événements avec cuisine et tables'),
  c('Residents should add guest names for concierge access.', 'Residents should add guest names for concierge access.', 'Los residentes deben agregar nombres de invitados para acceso por portería.', 'Les résidents doivent ajouter les noms des invités pour l’accès conciergerie.'),
  c('Opens in', 'Opens in', 'Abre en', 'Ouvre dans'),
  c('Voting closed', 'Voting closed', 'Votación cerrada', 'Vote fermé'),
  c('Closes in', 'Closes in', 'Cierra en', 'Ferme dans'),

  // Building Memory — searchable operating history.
  c('Memória', 'Memory', 'Memoria', 'Mémoire'),
  c('Memória do prédio', 'Building Memory', 'Memoria del edificio', 'Mémoire de l’immeuble'),
  c('Decisões, custos, documentos, chamados e fornecedores do histórico.', 'Decisions, costs, documents, tickets, and vendors from the building history.', 'Decisiones, costos, documentos, tickets y proveedores del historial.', 'Décisions, coûts, documents, tickets et prestataires de l’historique.'),
  c('Buscar fornecedor, despesa, proposta, documento ou chamado', 'Search vendor, expense, proposal, document, or ticket', 'Buscar proveedor, gasto, propuesta, documento o ticket', 'Rechercher prestataire, dépense, proposition, document ou ticket'),
  c('Buscar', 'Search', 'Buscar', 'Rechercher'),
  c('Tudo', 'All', 'Todo', 'Tout'),
  c('Buscas rápidas', 'Quick searches', 'Búsquedas rápidas', 'Recherches rapides'),
  c('Buscando memória do prédio…', 'Searching building memory…', 'Buscando en la memoria del edificio…', 'Recherche dans la mémoire de l’immeuble…'),
  c('A memória está pronta para busca.', 'Memory is ready to search.', 'La memoria está lista para buscar.', 'La mémoire est prête pour la recherche.'),
  c('Procure por fornecedor, custo, equipamento, votação, documento ou problema recorrente.', 'Search by vendor, cost, equipment, vote, document, or recurring issue.', 'Busca por proveedor, costo, equipo, votación, documento o problema recurrente.', 'Recherchez par prestataire, coût, équipement, vote, document ou problème récurrent.'),
  c('1 registro encontrado', '1 record found', '1 registro encontrado', '1 enregistrement trouvé'),
  c('registros encontrados', 'records found', 'registros encontrados', 'enregistrements trouvés'),
  c('Nenhum registro encontrado.', 'No records found.', 'No se encontraron registros.', 'Aucun enregistrement trouvé.'),
  c('Tente outro fornecedor, equipamento, despesa ou decisão.', 'Try another vendor, equipment, expense, or decision.', 'Prueba otro proveedor, equipo, gasto o decisión.', 'Essayez un autre prestataire, équipement, dépense ou décision.'),
  c('Abrir registro', 'Open record', 'Abrir registro', 'Ouvrir l’enregistrement'),
  c('Falha ao buscar memória', 'Could not search memory', 'No se pudo buscar en la memoria', 'Impossible de rechercher dans la mémoire'),
  c('Ordens de serviço', 'Work orders', 'Órdenes de trabajo', 'Ordres de service'),
  c('Despesas', 'Expenses', 'Gastos', 'Dépenses'),
  c('Fornecedores', 'Vendors', 'Proveedores', 'Prestataires'),
  c('Recibo', 'Receipt', 'Recibo', 'Reçu'),
  c('Nota fiscal', 'Invoice', 'Factura', 'Facture'),
  c('Foto', 'Photo', 'Foto', 'Photo'),
  c('Contrato', 'Contract', 'Contrato', 'Contrat'),
  c('Site', 'Website', 'Sitio', 'Site'),
  c('preferred', 'preferred', 'preferido', 'préféré'),
  c('emergency', 'emergency', 'emergencia', 'urgence'),
  c('pinned', 'pinned', 'fijado', 'épinglé'),
  c('draft', 'draft', 'borrador', 'brouillon'),
  c('scheduled', 'scheduled', 'programada', 'planifié'),
  c('in_progress', 'in progress', 'en curso', 'en cours'),
  c('completed', 'completed', 'completado', 'terminé'),
  c('cancelled', 'cancelled', 'cancelado', 'annulé'),
  c('discussion', 'discussion', 'discusión', 'discussion'),
  c('voting', 'voting', 'en votación', 'en vote'),
  c('approved', 'approved', 'aprobada', 'approuvée'),
  c('rejected', 'rejected', 'rechazada', 'rejetée'),
  c('inconclusive', 'inconclusive', 'inconclusa', 'non concluante'),
  c('residents', 'residents', 'residentes', 'résidents'),
  c('board_only', 'board only', 'solo administración', 'admin seulement'),
  c('voto', 'vote', 'voto', 'vote'),
  c('votos', 'votes', 'votos', 'votes'),
  // Confidence calibration chip (roadmap item 5).
  c('alta confiança', 'high confidence', 'alta confianza', 'haute confiance'),
  c('confiança moderada', 'moderate confidence', 'confianza moderada', 'confiance modérée'),
  c('baixa confiança', 'low confidence', 'baja confianza', 'faible confiance'),
  c('Por quê essa confiança?', 'Why this confidence?', '¿Por qué esta confianza?', 'Pourquoi cette confiance ?'),
  c('Sugestões para continuar', 'Suggestions to continue', 'Sugerencias para continuar', 'Suggestions pour continuer'),
  c('O agente está pesquisando', 'The agent is researching', 'El agente está investigando', 'L\'agent fait sa recherche'),
  c('bloqueados', 'blocked', 'bloqueados', 'bloqués'),
  c('com plano da IA pronto', 'with AI plan ready', 'con plan de IA listo', 'avec plan IA prêt'),
  c('bloqueados — precisa de você', 'blocked — needs you', 'bloqueados — te necesitan', 'bloqués — vous attendent'),
  c('com plano da IA pronto para acionar', 'with AI plan ready to dispatch', 'con plan de IA listo para acción', 'avec plan IA prêt à déclencher'),
  // Vision / attachment analysis (roadmap item 6). Signal tags are
  // emitted by the vision model in snake_case; we translate each.
  c('O que a IA viu nas fotos', 'What the AI saw in the photos', 'Lo que la IA vio en las fotos', "Ce que l'IA a vu sur les photos"),
  c('water_damage', 'water damage', 'daño por agua', 'dégât des eaux'),
  c('water_visible', 'water visible', 'agua visible', 'eau visible'),
  c('mold_visible', 'mould visible', 'moho visible', 'moisissure visible'),
  c('leak_active', 'active leak', 'fuga activa', 'fuite active'),
  c('leak_dried', 'dried leak', 'fuga seca', 'fuite séchée'),
  c('electrical_burn', 'electrical burn', 'quemadura eléctrica', 'brûlure électrique'),
  c('exposed_wiring', 'exposed wiring', 'cables expuestos', 'câblage exposé'),
  c('damaged_fixture', 'damaged fixture', 'accesorio dañado', 'équipement endommagé'),
  c('structural_crack', 'structural crack', 'grieta estructural', 'fissure structurelle'),
  c('paint_peel', 'paint peeling', 'pintura descascarada', 'peinture qui pèle'),
  c('ceiling_damage', 'ceiling damage', 'daño en el techo', 'plafond endommagé'),
  c('broken_glass', 'broken glass', 'vidrio roto', 'verre brisé'),
  c('broken_lock', 'broken lock', 'cerradura rota', 'serrure cassée'),
  c('broken_hinge', 'broken hinge', 'bisagra quebrada', 'charnière cassée'),
  c('broken_door', 'broken door', 'puerta rota', 'porte cassée'),
  c('pest_visible', 'pest visible', 'plaga visible', 'parasite visible'),
  c('debris', 'debris', 'escombros', 'débris'),
  c('no_visible_problem', 'no visible problem', 'sin problema visible', 'aucun problème visible'),
  c('photo_too_dark', 'photo too dark', 'foto muy oscura', 'photo trop sombre'),
  c('photo_blurred', 'photo blurred', 'foto borrosa', 'photo floue'),
  c('is_invoice', 'invoice', 'factura', 'facture'),
  c('is_contract', 'contract', 'contrato', 'contrat'),
  c('is_quote', 'quote', 'cotización', 'devis'),
  c('is_receipt', 'receipt', 'recibo', 'reçu'),
  c('urgency_high', 'high urgency', 'alta urgencia', 'urgence élevée'),
  c('urgency_low', 'low urgency', 'baja urgencia', 'urgence faible'),
  // Admin agent simplified operator flow.
  c('Agente operacional', 'Operations agent', 'Agente operativo', 'Agent opérationnel'),
  c('Descreva o problema ou decisão. O agente devolve um próximo passo, uma mensagem pronta e os detalhes só quando você quiser abrir.', 'Describe the problem or decision. The agent returns one next step, a ready message, and details only when you choose to open them.', 'Describe el problema o la decisión. El agente devuelve un siguiente paso, un mensaje listo y los detalles solo cuando quieras abrirlos.', 'Décrivez le problème ou la décision. L’agent renvoie une prochaine étape, un message prêt et les détails seulement si vous les ouvrez.'),
  c('Ação recomendada', 'Recommended action', 'Acción recomendada', 'Action recommandée'),
  c('Copiar plano', 'Copy plan', 'Copiar plan', 'Copier le plan'),
  c('Fornecedor sugerido', 'Suggested vendor', 'Proveedor sugerido', 'Prestataire suggéré'),
  c('Mensagem pronta', 'Ready message', 'Mensaje listo', 'Message prêt'),
  c('Detalhes do plano', 'Plan details', 'Detalles del plan', 'Détails du plan'),
  c('Fornecedores salvos', 'Saved vendors', 'Proveedores guardados', 'Prestataires enregistrés'),
  c('Encontrar fornecedor', 'Find a vendor', 'Encontrar proveedor', 'Trouver un prestataire'),
  c('Nenhum fornecedor salvo combina com esse pedido. Use a busca pronta e cadastre o escolhido para a próxima vez.', 'No saved vendor matches this request. Use the prepared search and save the chosen vendor for next time.', 'Ningún proveedor guardado coincide con este pedido. Usa la búsqueda preparada y guarda el proveedor elegido para la próxima vez.', 'Aucun prestataire enregistré ne correspond à cette demande. Utilisez la recherche prête et enregistrez le prestataire choisi pour la prochaine fois.'),
  c('Buscar alternativa', 'Search alternative', 'Buscar alternativa', 'Chercher une alternative'),
  c('Diagnóstico técnico', 'Technical diagnostics', 'Diagnóstico técnico', 'Diagnostic technique'),
  c('Confiança técnica', 'Technical confidence', 'Confianza técnica', 'Confiance technique'),
  c('Detalhes de auditoria disponíveis apenas quando o modo debug é solicitado pela API.', 'Audit details are available only when debug mode is requested from the API.', 'Los detalles de auditoría solo están disponibles cuando se solicita el modo debug desde la API.', 'Les détails d’audit ne sont disponibles que lorsque le mode debug est demandé à l’API.'),
  // Building market configuration.
  c('Mercado e regras do prédio', 'Market and building rules', 'Mercado y reglas del edificio', 'Marché et règles de l’immeuble'),
  c('Defina país, moeda, idioma base e fuso horário para que finanças, relatórios e regras não misturem Brasil com Equador.', 'Set country, currency, base language, and timezone so finances, reports, and rules do not mix Brazil with Ecuador.', 'Define país, moneda, idioma base y zona horaria para que finanzas, reportes y reglas no mezclen Brasil con Ecuador.', 'Définissez le pays, la devise, la langue de base et le fuseau horaire pour éviter de mélanger Brésil et Équateur.'),
  c('Configuração de mercado salva', 'Market settings saved', 'Configuración de mercado guardada', 'Configuration de marché enregistrée'),
  c('Não foi possível salvar a configuração de mercado', 'Could not save market settings', 'No se pudo guardar la configuración de mercado', 'Impossible d’enregistrer la configuration de marché'),
  c('Salvar configuração', 'Save settings', 'Guardar configuración', 'Enregistrer la configuration'),
  c('País', 'Country', 'País', 'Pays'),
  c('Brasil', 'Brazil', 'Brasil', 'Brésil'),
  c('Ecuador', 'Ecuador', 'Ecuador', 'Équateur'),
  c('Equador', 'Ecuador', 'Ecuador', 'Équateur'),
  c('Moeda', 'Currency', 'Moneda', 'Devise'),
  c('Moeda base', 'Base currency', 'Moneda base', 'Devise de base'),
  c('Idioma base', 'Base language', 'Idioma base', 'Langue de base'),
  c('Fuso horário', 'Timezone', 'Zona horaria', 'Fuseau horaire'),
  c('Governança', 'Governance', 'Gobernanza', 'Gouvernance'),
  c('Condomínio Brasil', 'Brazil condominium', 'Condominio Brasil', 'Copropriété Brésil'),
  c('Condomínio Equador', 'Ecuador condominium', 'Condominio Ecuador', 'Copropriété Équateur'),
  c('Neutral', 'Neutral', 'Neutral', 'Neutre'),
  c('Mercado inicial', 'Initial market', 'Mercado inicial', 'Marché initial'),
  c('Equador · USD · Espanhol', 'Ecuador · USD · Spanish', 'Ecuador · USD · Español', 'Équateur · USD · Espagnol'),
  c('Você pode mudar moeda, idioma e fuso horário depois em Edifício.', 'You can change currency, language, and timezone later in Building.', 'Puedes cambiar moneda, idioma y zona horaria después en Edificio.', 'Vous pourrez modifier devise, langue et fuseau horaire plus tard dans Immeuble.'),
  c('Usada por padrão em cobranças, orçamentos e despesas.', 'Used by default for dues, budgets, and expenses.', 'Se usa por defecto en cobros, presupuestos y gastos.', 'Utilisée par défaut pour appels, budgets et dépenses.'),
  // Agency staff invite flow.
  c('Adicione uma conta existente ou envie convite por email. Cada pessoa vê somente os prédios permitidos para sua função.', 'Add an existing account or send an email invite. Each person sees only the buildings allowed for their role.', 'Agrega una cuenta existente o envía una invitación por email. Cada persona ve solo los edificios permitidos para su función.', 'Ajoutez un compte existant ou envoyez une invitation par e-mail. Chaque personne ne voit que les immeubles autorisés pour son rôle.'),
  c('Não foi possível salvar a equipe. Verifique se há prédios selecionados e se a permissão faz sentido.', 'Could not save staff. Check that buildings are selected and the permission makes sense.', 'No se pudo guardar el equipo. Verifica que haya edificios seleccionados y que el permiso tenga sentido.', 'Impossible d’enregistrer l’équipe. Vérifiez que les immeubles sont sélectionnés et que l’autorisation est cohérente.'),
  c('Convite enviado', 'Invite sent', 'Invitación enviada', 'Invitation envoyée'),
  c('Se o email não chegar, copie este link privado e envie manualmente. Ele aparece apenas agora.', 'If the email does not arrive, copy this private link and send it manually. It only appears now.', 'Si el email no llega, copia este enlace privado y envíalo manualmente. Solo aparece ahora.', 'Si l’e-mail n’arrive pas, copiez ce lien privé et envoyez-le manuellement. Il n’apparaît que maintenant.'),
  c('Copiar link do convite', 'Copy invite link', 'Copiar enlace de invitación', 'Copier le lien d’invitation'),
  c('Adicionar ou convidar', 'Add or invite', 'Agregar o invitar', 'Ajouter ou inviter'),
  c('Convites pendentes', 'Pending invites', 'Invitaciones pendientes', 'Invitations en attente'),
  c('Nenhum convite pendente.', 'No pending invites.', 'No hay invitaciones pendientes.', 'Aucune invitation en attente.'),
  c('Novo membro da equipe', 'New staff member', 'Nuevo miembro del equipo', 'Nouveau membre de l’équipe'),
  c('Crie sua conta para aceitar o convite', 'Create your account to accept the invite', 'Crea tu cuenta para aceptar la invitación', 'Créez votre compte pour accepter l’invitation'),
  c('Depois de criar sua conta, ativamos seu acesso à administradora e aos prédios permitidos.', 'After you create your account, we activate your agency access and allowed buildings.', 'Después de crear tu cuenta, activamos tu acceso a la administradora y a los edificios permitidos.', 'Après la création de votre compte, nous activons votre accès à la société de gestion et aux immeubles autorisés.'),
  c('Não foi possível aceitar o convite da administradora', 'Could not accept the agency invite', 'No se pudo aceptar la invitación de la administradora', 'Impossible d’accepter l’invitation de la société de gestion'),
  c('Convite aceito', 'Invite accepted', 'Invitación aceptada', 'Invitation acceptée'),
  c('Criar conta e aceitar convite', 'Create account and accept invite', 'Crear cuenta y aceptar invitación', 'Créer le compte et accepter l’invitation'),
  c('Você receberá acesso somente aos prédios autorizados pela administradora.', 'You will receive access only to the buildings authorized by the agency.', 'Recibirás acceso solo a los edificios autorizados por la administradora.', 'Vous recevrez uniquement l’accès aux immeubles autorisés par la société de gestion.'),
  c('sent', 'sent', 'enviado', 'envoyé'),
  c('skipped', 'skipped', 'omitido', 'ignoré'),
  c('failed', 'failed', 'falló', 'échoué'),
  c('pendente', 'pending', 'pendiente', 'en attente'),
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
    // Prefer identity for strings that are already in the target locale.
    // Without this, duplicate words across languages can collide. Example:
    // "Copiar código" is Spanish for one older "Copy code" entry and also
    // Portuguese for the onboarding success card; Portuguese must stay
    // Portuguese when the selected locale is pt-BR.
    indexes[target].set(normalize(entry[target]), entry[target]);
  }
}

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
  {
    match: /\bA iluminação do hall do ([0-9]+º?) andar fica piscando à noite, parece que vai apagar a qualquer momento\.?/gu,
    replace: (locale, _match, floor) => pickWord(locale, [
      `A iluminação do hall do ${floor} andar fica piscando à noite, parece que vai apagar a qualquer momento.`,
      `The hallway lighting on the ${floor} floor is flickering at night and looks like it could go out at any moment.`,
      `La iluminación del hall del ${floor} piso parpadea por la noche y parece que puede apagarse en cualquier momento.`,
      `L’éclairage du hall du ${floor} étage clignote la nuit et semble pouvoir s’éteindre à tout moment.`,
    ]),
  },
  {
    match: /\bElevador\s+([A-Za-z0-9-]+)\s+parado no\s+([0-9]+)º?\s+[—-]\s+porta não abre\b/gu,
    replace: (locale, _match, elevator, floor) => pickWord(locale, [
      `Elevador ${elevator} parado no ${floor}º — porta não abre`,
      `Elevator ${elevator} stopped on floor ${floor} — door will not open`,
      `Ascensor ${elevator} detenido en el piso ${floor} — la puerta no abre`,
      `Ascenseur ${elevator} bloqué à l’étage ${floor} — la porte ne s’ouvre pas`,
    ]),
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

// Round 3 — relative time for "fresh" timestamps. Tickets, dispatches, and
// comments rendered with formatDateTime always showed the full date even
// for events 10 minutes ago, which buried recency. Use formatRelativeTime
// for timelines where freshness matters; falls back to the absolute format
// once the gap exceeds ~24h so old entries stay deterministic.
const REL_UNITS: Array<{ ms: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { ms: 60_000,           unit: 'second' },
  { ms: 60 * 60_000,      unit: 'minute' },
  { ms: 24 * 60 * 60_000, unit: 'hour' },
];
export function formatRelativeTime(value: string | number | Date) {
  const now = Date.now();
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return formatDateTime(value);
  const diffMs = then - now; // negative = past
  const absMs = Math.abs(diffMs);
  if (absMs >= REL_UNITS[REL_UNITS.length - 1].ms) return formatDateTime(value);
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  let unitMs = 1_000;
  for (const u of REL_UNITS) {
    if (absMs < u.ms) break;
    unit = u.unit; unitMs = u.ms;
  }
  const value2 = Math.round(diffMs / unitMs);
  try {
    const rtf = new Intl.RelativeTimeFormat(currentIntlLocale(), { numeric: 'auto' });
    return rtf.format(value2, unit);
  } catch {
    return formatDateTime(value);
  }
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
